// __tests__/integration/bridge-handler.test.ts
// Protokol bridge WebView → native. Yang dijaga: requestId yang sama TIDAK
// pernah menghasilkan job kedua (anti-struk-dobel), payload cacat ditolak
// sebelum jadi job, dan WebView tidak pernah diberi host/port printer.

import { FakeDatabase } from '../helpers/fakeDatabase';
import {
  BridgeHandler,
  CONNECTION_NOT_PRINTED_NOTICE,
  type BridgeDeps,
} from '../../src/webview/bridgeHandler';
import { PrintDispatcher } from '../../src/printing/PrintDispatcher';
import { PrintJobRepository } from '../../src/printing/PrintJobRepository';
import type {
  PrinterTransport,
  SendResult,
} from '../../src/printing/PrinterTransport';
import type { PrinterConfig, ReceiptOrder } from '../../src/types/printing';

class NoopTransport implements PrinterTransport {
  static sends = 0;
  async send(): Promise<SendResult> {
    NoopTransport.sends += 1;
    return { ok: true };
  }
  async test(): Promise<SendResult> {
    return { ok: true };
  }
  close(): void {}
}

const printer: PrinterConfig = {
  id: 'prn-1',
  name: 'Printer Kasir',
  connectionType: 'lan',
  host: '192.168.1.50',
  port: 9100,
  enabled: true,
  destinations: ['customer_receipt', 'kitchen_ticket'],
  paperWidthMm: 58,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const order: ReceiptOrder = {
  noreceipt: 'SPZ-900',
  paymentMethod: 'CASH',
  paymentStatus: 'PAID',
  finalAmount: 25_000,
  staffName: 'Kasir',
  customerName: null,
  customerPhone: null,
  customerAddress: null,
  tableNumber: null,
  createdAt: '2026-09-27T10:00:00.000Z',
  items: [{ menuName: 'Kopi Susu', quantity: 1, priceAtOrder: 25_000 }],
};

function setup(printers: PrinterConfig[] = [printer]) {
  const db = new FakeDatabase();
  const repo = new PrintJobRepository(db);
  const subscriptions: { requestId: string; jobIds?: string[] }[] = [];

  const deps: BridgeDeps = {
    dispatcher: new PrintDispatcher({
      repo,
      getPrinter: async id => printers.find(p => p.id === id) ?? null,
      transportFactory: () => new NoopTransport(),
    }),
    repo,
    listPrinters: async () => printers,
    findPrinterForDestination: async destination =>
      printers.find(p => p.enabled && p.destinations.includes(destination)) ??
      null,
    platform: 'android',
    appVersion: '0.0.1',
    onJobStatusSubscribe: (requestId, jobIds) =>
      subscriptions.push({ requestId, jobIds }),
  };

  return { handler: new BridgeHandler(deps), repo, db, subscriptions };
}

function request(type: string, requestId: string, payload?: unknown): string {
  return JSON.stringify({ type, requestId, payload });
}

beforeEach(() => {
  NoopTransport.sends = 0;
});

it('PING dijawab pong', async () => {
  const { handler } = setup();
  const response = await handler.handle(request('PING', 'r1'));

  expect(response.ok).toBe(true);
  expect(response.data).toEqual({ pong: true });
  expect(response.requestId).toBe('r1');
});

it('pesan tidak sah ditolak tanpa melempar', async () => {
  const { handler } = setup();

  expect((await handler.handle('bukan json')).ok).toBe(false);
  // requestId wajib ada — tanpa itu dedup mustahil.
  expect((await handler.handle(request('PING', ''))).ok).toBe(false);
  expect((await handler.handle(request('TIDAK_ADA', 'r1'))).ok).toBe(false);
  expect((await handler.handle(JSON.stringify({ type: 'PING' }))).ok).toBe(
    false,
  );
});

it('requestId yang sama dikembalikan dari cache — tidak mencetak dua kali', async () => {
  const { handler, repo } = setup();

  const raw = request('PRINT_REQUEST', 'same-id', {
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    order,
  });

  const first = await handler.handle(raw);
  const second = await handler.handle(raw);

  expect(first.ok).toBe(true);
  expect(second).toEqual(first);
  // Kuncinya: satu job, bukan dua.
  expect(repo.findRecent()).toHaveLength(1);
});

it('orderId berbeda dengan requestId berbeda menghasilkan dua job', async () => {
  const { handler, repo } = setup();

  await handler.handle(
    request('PRINT_REQUEST', 'r1', {
      orderId: 'ord-1',
      destination: 'customer_receipt',
      printerId: 'prn-1',
      order,
    }),
  );
  await handler.handle(
    request('PRINT_REQUEST', 'r2', {
      orderId: 'ord-2',
      destination: 'customer_receipt',
      printerId: 'prn-1',
      order,
    }),
  );

  expect(repo.findRecent()).toHaveLength(2);
});

it('PRINT_REQUEST tanpa printerId memakai printer aktif untuk tujuan itu', async () => {
  // PWA memang TIDAK mengirim printerId — native yang memilih. Ini kontrak,
  // bukan kelonggaran: web tidak boleh tahu printer mana yang dipakai.
  const { handler, repo } = setup();

  const response = await handler.handle(
    request('PRINT_REQUEST', 'r1', {
      orderId: 'ord-1',
      destination: 'customer_receipt',
      order,
    }),
  );

  expect(response.ok).toBe(true);
  expect(repo.findRecent()).toHaveLength(1);
});

it('PRINT_REQUEST tanpa printerId ditolak NO_PRINTER kalau tak ada printer untuk tujuan itu', async () => {
  const { handler, repo } = setup([
    { ...printer, destinations: ['kitchen_ticket'] },
  ]);

  const response = await handler.handle(
    request('PRINT_REQUEST', 'r1', {
      orderId: 'ord-1',
      destination: 'customer_receipt',
      order,
    }),
  );

  // Tanpa printer, permintaan TETAP diterima dan dicatat sebagai job gagal.
  // Tiket/struk yang hilang tanpa jejak tidak boleh terjadi: kasir harus
  // melihatnya di Riwayat Cetak dan bisa mencetak ulang setelah mendaftarkan
  // printer.
  expect(response.ok).toBe(true);
  expect((response.data as { queued?: boolean })?.queued).toBe(false);

  const recent = repo.findRecent();
  expect(recent).toHaveLength(1);
  expect(recent[0].status).toBe('failed');
  expect(recent[0].lastError?.code).toBe('NO_PRINTER');
});

it('PRINT_REQUEST tanpa printerId mengabaikan printer nonaktif', async () => {
  const { handler, repo } = setup([{ ...printer, enabled: false }]);

  const response = await handler.handle(
    request('PRINT_REQUEST', 'r1', {
      orderId: 'ord-1',
      destination: 'customer_receipt',
      order,
    }),
  );

  expect(response.ok).toBe(true);
  expect((response.data as { queued?: boolean })?.queued).toBe(false);

  const recent = repo.findRecent();
  expect(recent).toHaveLength(1);
  expect(recent[0].lastError?.code).toBe('NO_PRINTER');
});

it('PRINT_REQUEST dengan payload cacat ditolak, tanpa membuat job', async () => {
  const { handler, repo } = setup();

  const cases: unknown[] = [
    null,
    {},
    { orderId: '', destination: 'customer_receipt', order },
    { orderId: 'ord-1', destination: 'struk', order },
    { orderId: 'ord-1', destination: 'customer_receipt', order: null },
    { orderId: 'ord-1', destination: 'customer_receipt', order, printerId: 42 },
  ];

  for (const [index, payload] of cases.entries()) {
    const response = await handler.handle(
      request('PRINT_REQUEST', `bad-${index}`, payload),
    );
    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe('INVALID_PAYLOAD');
  }

  expect(repo.findRecent()).toHaveLength(0);
});

it('respons cetak membawa pesan eksplisit koneksi ≠ tercetak', async () => {
  const { handler } = setup();

  const response = await handler.handle(
    request('PRINT_REQUEST', 'r1', {
      orderId: 'ord-1',
      destination: 'customer_receipt',
      printerId: 'prn-1',
      order,
    }),
  );

  const data = response.data as { notice: string; status: string };
  expect(data.notice).toBe(CONNECTION_NOT_PRINTED_NOTICE);
  expect(data.notice).toMatch(/bukan berarti struk tercetak/);
  // Ack berarti "tercatat di antrean", bukan "tercetak".
  expect(data.status).toBe('queued');
});

it('host dan port printer TIDAK pernah dikirim ke WebView', async () => {
  const { handler } = setup();

  const response = await handler.handle(request('GET_PRINTERS', 'r1'));
  const serialized = JSON.stringify(response.data);

  expect(serialized).not.toContain('192.168.1.50');
  expect(serialized).not.toContain('9100');
  expect(serialized).toContain('Printer Kasir');
});

it('GET_DEVICE_STATUS melaporkan kesiapan dan jumlah job menunggu', async () => {
  const { handler, repo } = setup();

  const empty = await handler.handle(request('GET_DEVICE_STATUS', 'r1'));
  expect((empty.data as { hasPrinter: boolean }).hasPrinter).toBe(true);
  expect((empty.data as { pendingJobCount: number }).pendingJobCount).toBe(0);
  expect((empty.data as { notice: string }).notice).toBe(
    CONNECTION_NOT_PRINTED_NOTICE,
  );

  await handler.handle(
    request('PRINT_REQUEST', 'r2', {
      orderId: 'ord-1',
      destination: 'customer_receipt',
      printerId: 'prn-1',
      order,
    }),
  );

  // Transport palsu di sini selesai seketika, jadi job sudah berstatus
  // 'submitted' saat dicek. Yang penting statusnya BUKAN pending — job
  // benar-benar meninggalkan antrean, tidak menggantung di dalamnya.
  expect(repo.findPending()).toHaveLength(0);
  expect(repo.findRecent()).toHaveLength(1);
});

it('tanpa printer aktif, hasPrinter false', async () => {
  const { handler } = setup([{ ...printer, enabled: false }]);

  const response = await handler.handle(request('GET_DEVICE_STATUS', 'r1'));
  expect((response.data as { hasPrinter: boolean }).hasPrinter).toBe(false);
});

it('SUBSCRIBE_JOB_STATUS meneruskan langganan ke native', async () => {
  const { handler, subscriptions } = setup();

  const response = await handler.handle(
    request('SUBSCRIBE_JOB_STATUS', 'sub-1', { jobIds: ['job-a'] }),
  );

  expect(response.ok).toBe(true);
  expect(subscriptions).toEqual([{ requestId: 'sub-1', jobIds: ['job-a'] }]);
});

it('CANCEL_PRINT_JOB hanya boleh untuk job yang belum mulai', async () => {
  const { handler, repo } = setup();

  const printed = await handler.handle(
    request('PRINT_REQUEST', 'r1', {
      orderId: 'ord-1',
      destination: 'customer_receipt',
      printerId: 'prn-1',
      order,
    }),
  );
  const jobId = (printed.data as { jobId: string }).jobId;

  // Job sedang dikirim: pembatalan ditolak.
  repo.updateStatus(jobId, 'sending');
  const rejected = await handler.handle(
    request('CANCEL_PRINT_JOB', 'r2', { jobId }),
  );
  expect(rejected.ok).toBe(false);
  expect(rejected.error?.code).toBe('JOB_NOT_CANCELLABLE');

  // Job yang masih queued boleh dibatalkan.
  repo.updateStatus(jobId, 'queued');
  const cancelled = await handler.handle(
    request('CANCEL_PRINT_JOB', 'r3', { jobId }),
  );
  expect(cancelled.ok).toBe(true);
  expect(repo.findById(jobId)?.status).toBe('cancelled');
});

it('CANCEL_PRINT_JOB untuk job yang tidak ada dijawab JOB_NOT_FOUND', async () => {
  const { handler } = setup();

  const response = await handler.handle(
    request('CANCEL_PRINT_JOB', 'r1', { jobId: 'tidak-ada' }),
  );

  expect(response.ok).toBe(false);
  expect(response.error?.code).toBe('JOB_NOT_FOUND');
});

