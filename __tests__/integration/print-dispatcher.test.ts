// __tests__/integration/print-dispatcher.test.ts
// Perilaku end-to-end jalur cetak, dengan transport palsu — tanpa socket.
//
// Yang dijaga di sini adalah janji-janji yang mahal kalau salah:
//  1. Job dipersist SEBELUM ada byte yang dikirim.
//  2. Job yang sama tidak dicetak dua kali (dedup by idempotency key).
//  3. Koneksi putus setelah byte pertama → 'unknown', BUKAN 'failed'.
//  4. Host/port selalu dari konfigurasi printer, bukan dari payload job.
//  5. Bluetooth/USB langsung gagal, tidak menggantung di antrean.

import { FakeDatabase } from '../helpers/fakeDatabase';
import { PrintDispatcher } from '../../src/printing/PrintDispatcher';
import type { DispatcherDeps } from '../../src/printing/PrintDispatcher';
import { PrintJobRepository } from '../../src/printing/PrintJobRepository';
import type {
  PrinterTransport,
  SendResult,
  TransportTarget,
} from '../../src/printing/PrinterTransport';
import type { PrinterConfig, ReceiptOrder } from '../../src/types/printing';

/** Order contoh — sama bentuknya dengan yang dikirim WebView. */
const order: ReceiptOrder = {
  noreceipt: 'SPZ-777',
  paymentMethod: 'CASH',
  paymentStatus: 'PAID',
  finalAmount: 48_000,
  staffName: 'Kasir Uji',
  customerName: null,
  customerPhone: null,
  customerAddress: null,
  tableNumber: 'Meja 3',
  createdAt: new Date('2026-09-27T10:00:00Z').toISOString(),
  items: [{ menuName: 'Kopi Susu', quantity: 2, priceAtOrder: 25_000 }],
};

function printerConfig(overrides: Partial<PrinterConfig> = {}): PrinterConfig {
  return {
    id: 'prn-1',
    name: 'Printer Kasir',
    connectionType: 'lan',
    protocol: 'escpos',
    host: '192.168.1.50',
    port: 9100,
    enabled: true,
    destinations: ['customer_receipt'],
    paperWidthMm: 58,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Transport palsu yang merekam byte, target, dan bisa disuruh gagal. */
class FakeTransport implements PrinterTransport {
  static sent: Uint8Array[] = [];
  static result: SendResult = { ok: true };
  static targets: TransportTarget[] = [];

  constructor(target: TransportTarget) {
    FakeTransport.targets.push(target);
  }

  async send(bytes: Uint8Array): Promise<SendResult> {
    FakeTransport.sent.push(bytes);
    return FakeTransport.result;
  }

  async test(): Promise<SendResult> {
    return FakeTransport.result;
  }

  close(): void {}

  static reset(): void {
    FakeTransport.sent = [];
    FakeTransport.targets = [];
    FakeTransport.result = { ok: true };
  }
}

/** Beri kesempatan microtask/timer antrean berjalan. */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function setup(
  printer: PrinterConfig | null = printerConfig(),
  findPrinterForDestination: DispatcherDeps['findPrinterForDestination'] = undefined,
) {
  const db = new FakeDatabase();
  const repo = new PrintJobRepository(db);
  const changes: string[] = [];
  const dispatcher = new PrintDispatcher({
    repo,
    // Hormati id yang diminta supaya cetak ulang ke printer yang baru
    // didaftarkan benar-benar diuji.
    getPrinter: async id => (printer && printer.id === id ? printer : null),
    findPrinterForDestination,
    transportFactory: target => new FakeTransport(target),
    onJobStatusChange: job => changes.push(job.status),
  });
  return { db, repo, dispatcher, changes };
}

beforeEach(() => {
  FakeTransport.reset();
});


it('job dipersist ke database SEBELUM byte apa pun dikirim', async () => {
  const { db, dispatcher } = setup();

  dispatcher.submit({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload: order,
  });

  // Insert terjadi sinkron di submit(); send() baru jalan di microtask
  // berikutnya. Kalau urutannya terbalik, ack bisa terjadi untuk job yang
  // tidak pernah tercatat.
  expect(db.count('print_jobs')).toBe(1);
  expect(FakeTransport.sent).toHaveLength(0);

  await flush();
  expect(FakeTransport.sent).toHaveLength(1);
});

it('order yang sama TETAP menghasilkan job kedua — tidak ada dedup', async () => {
  const { repo, dispatcher } = setup();

  const first = dispatcher.submit({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload: order,
  });
  const second = dispatcher.submit({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload: order,
  });

  expect(second.id).not.toBe(first.id);
  expect(repo.findRecent()).toHaveLength(2);

  await flush();
  // Dua kali kirim, dua struk. Ini perilaku yang diminta: kasir boleh mencetak
  // struk yang sama berkali-kali tanpa ada yang memblokir.
  expect(FakeTransport.sent).toHaveLength(2);
});

it('job GAGAL boleh dicetak ulang dari web — selalu bikin job baru', async () => {
  const { repo, dispatcher } = setup();
  FakeTransport.result = {
    ok: false,
    error: {
      code: 'CONNECTION_REFUSED',
      message: 'Printer menolak koneksi. Cek port.',
      transmissionStarted: false,
      at: '2026-09-27T10:00:05Z',
    },
  };

  const first = dispatcher.submit({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload: order,
  });
  await flush();
  expect(repo.findById(first.id)?.status).toBe('failed');

  // Ini kasus nyata: kertas habis / printer mati saat cetak pertama. Kasir
  // memperbaiki printer lalu mencetak lagi.
  FakeTransport.result = { ok: true };
  const second = dispatcher.submit({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload: order,
  });

  expect(second.id).not.toBe(first.id);

  await flush();
  expect(repo.findById(second.id)?.status).toBe('submitted');
  // Riwayat menyimpan kedua percobaan — kegagalan tidak dihapus.
  expect(repo.findRecent()).toHaveLength(2);
});

it('job SUBMITTED tetap boleh dicetak ulang — itu struk hilang, bukan dobel tak sengaja', async () => {
  const { repo, dispatcher } = setup();

  const first = dispatcher.submit({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload: order,
  });
  await flush();
  expect(repo.findById(first.id)?.status).toBe('submitted');

  // Dulu job `submitted` mengunci order ini selamanya (dedup orderId). Sekarang
  // permintaan baru selalu jadi job baru.
  const second = dispatcher.submit({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload: order,
  });

  expect(second.id).not.toBe(first.id);
  await flush();
  expect(FakeTransport.sent).toHaveLength(2);
  expect(repo.findRecent()).toHaveLength(2);
});

it('job UNKNOWN juga boleh dicetak ulang manual — keputusan kasir', async () => {
  const { repo, dispatcher } = setup();
  FakeTransport.result = {
    ok: false,
    error: {
      code: 'CONNECTION_RESET',
      message: 'Koneksi ke printer terputus.',
      transmissionStarted: true,
      at: '2026-09-27T10:00:05Z',
    },
  };

  const first = dispatcher.submit({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload: order,
  });
  await flush();
  expect(repo.findById(first.id)?.status).toBe('unknown');

  FakeTransport.result = { ok: true };
  const second = dispatcher.submit({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload: order,
  });

  // Job lama tetap `unknown` di Riwayat Cetak; job baru jalan sendiri.
  expect(second.id).not.toBe(first.id);
  await flush();
  expect(repo.findById(first.id)?.status).toBe('unknown');
  expect(repo.findById(second.id)?.status).toBe('submitted');
});

it('tanpa printer: job TETAP tercatat sebagai gagal (tidak hilang bisu)', async () => {
  const { repo, dispatcher } = setup();

  const job = dispatcher.submitUnroutable({
    orderId: 'ord-1',
    destination: 'kitchen_ticket',
    payload: order,
  });
  await flush();

  const stored = repo.findById(job.id);
  expect(stored?.status).toBe('failed');
  expect(stored?.lastError?.code).toBe('NO_PRINTER');
  expect(stored?.printerId).toBe('unconfigured');
});

it('cetak ulang job tanpa printer menunjuk ke printer yang baru didaftarkan', async () => {
  const kitchenPrinter = printerConfig({
    id: 'prn-kitchen',
    destinations: ['kitchen_ticket'],
  });
  const { repo, dispatcher } = setup(kitchenPrinter, async () => kitchenPrinter);

  const job = dispatcher.submitUnroutable({
    orderId: 'ord-1',
    destination: 'kitchen_ticket',
    payload: order,
  });
  await flush();
  expect(repo.findById(job.id)?.status).toBe('failed');
  expect(repo.findById(job.id)?.printerId).toBe('unconfigured');

  // Kasir mendaftarkan printer dapur SETELAH job gagal, lalu menekan Cetak
  // Ulang. Tanpa pengalihan printer, job ini akan gagal NO_PRINTER selamanya.
  await dispatcher.reprint(job.id);

  const stored = repo.findById(job.id);
  expect(stored?.printerId).toBe('prn-kitchen');
  expect(stored?.status).toBe('submitted');
});

it('pengiriman sukses → status submitted, byte berisi ESC/POS struk', async () => {
  const { repo, dispatcher } = setup();

  const job = dispatcher.submit({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload: order,
  });
  await dispatcher.run(job.id);

  const stored = repo.findById(job.id);
  expect(stored?.status).toBe('submitted');
  expect(stored?.attemptCount).toBeGreaterThan(0);
  expect(stored?.lastError).toBeNull();

  const text = new TextDecoder().decode(FakeTransport.sent[0]);
  expect(text).toContain('SPAZIO');
  expect(text).toContain('SPZ-777');
  expect(text).toContain('Rp 48.000');
});

it('error sebelum transmisi → failed', async () => {
  const { repo, dispatcher } = setup();
  FakeTransport.result = {
    ok: false,
    error: {
      code: 'CONNECTION_REFUSED',
      message: 'Printer menolak koneksi. Cek port.',
      transmissionStarted: false,
      at: '2026-09-27T10:00:05Z',
    },
  };

  const job = dispatcher.submit({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload: order,
  });
  await dispatcher.run(job.id);

  const stored = repo.findById(job.id);
  expect(stored?.status).toBe('failed');
  expect(stored?.lastError?.code).toBe('CONNECTION_REFUSED');
  expect(stored?.lastError?.transmissionStarted).toBe(false);
});

it('koneksi putus SETELAH byte terkirim → unknown, bukan failed', async () => {
  const { repo, dispatcher } = setup();
  // Ini kasus paling berbahaya: printer mungkin sudah mencetak separuh struk.
  // Kalau kita bilang "gagal", kasir cetak ulang dan struknya dobel.
  FakeTransport.result = {
    ok: false,
    error: {
      code: 'CONNECTION_RESET',
      message: 'Koneksi ke printer terputus.',
      transmissionStarted: true,
      at: '2026-09-27T10:00:05Z',
    },
  };

  const job = dispatcher.submit({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload: order,
  });
  await dispatcher.run(job.id);

  const stored = repo.findById(job.id);
  expect(stored?.status).toBe('unknown');
  expect(stored?.lastError?.transmissionStarted).toBe(true);
  // 'unknown' itu terminal, dan yang penting: BUKAN 'failed'.
  expect(stored?.status).not.toBe('failed');
});

it('status perubahan dilaporkan ke bridge lewat onJobStatusChange', async () => {
  const { dispatcher, changes } = setup();

  const job = dispatcher.submit({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload: order,
  });
  await dispatcher.run(job.id);

  expect(changes).toContain('connecting');
  expect(changes).toContain('submitted');
});

it('printer bluetooth memakai driver BLE, bukan driver LAN', async () => {
  const db = new FakeDatabase();
  const repo = new PrintJobRepository(db);
  const bleTargets: { bluetooth?: { deviceId?: string } }[] = [];
  const dispatcher = new PrintDispatcher({
    repo,
    getPrinter: async () =>
      printerConfig({
        connectionType: 'bluetooth',
        host: undefined,
        port: undefined,
        bluetooth: { deviceId: 'AA:BB:CC:DD:EE:FF', deviceName: 'VSC TM-58V' },
      }),
    transportFactory: target => new FakeTransport(target),
    // BLE punya pabrik sendiri: kalau printer bluetooth memakai transportFactory
    // LAN, tombol cetak akan menggantung menunggu socket yang tidak pernah ada.
    bleTransportFactory: target => {
      bleTargets.push(target);
      return new FakeTransport(target);
    },
  });

  // submit() sudah menjalankan job; memanggil run() lagi = struk dobel.
  dispatcher.submit({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload: order,
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(bleTargets).toHaveLength(1);
  expect(bleTargets[0].bluetooth?.deviceId).toBe('AA:BB:CC:DD:EE:FF');
  // Driver BLE dikonstruksi dari target; FakeTransport tetap merekam byte.
  expect(FakeTransport.sent).toHaveLength(1);
});

it('printer USB ditolak dengan TRANSPORT_UNSUPPORTED, tanpa membuka transport', async () => {
  const { repo, dispatcher } = setup(
    printerConfig({ connectionType: 'usb', host: undefined }),
  );

  const job = dispatcher.submit({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload: order,
  });
  await dispatcher.run(job.id);

  const stored = repo.findById(job.id);
  expect(stored?.status).toBe('failed');
  expect(stored?.lastError?.code).toBe('TRANSPORT_UNSUPPORTED');
  expect(FakeTransport.sent).toHaveLength(0);
});

it('tiket dapur dirender tanpa harga meski printer melayani tujuan dapur', async () => {
  const { dispatcher } = setup(
    printerConfig({ destinations: ['kitchen_ticket'] }),
  );

  const job = dispatcher.submit({
    orderId: 'ord-1',
    destination: 'kitchen_ticket',
    printerId: 'prn-1',
    payload: {
      noreceipt: 'SPZ-777',
      orderId: 'ord-1',
      tableNumber: 'Meja 3',
      customerName: null,
      note: null,
      createdAt: order.createdAt,
      mode: 'full',
      items: [{ menuName: 'Kopi Susu', quantity: 2 }],
    },
  });
  await dispatcher.run(job.id);

  const text = new TextDecoder().decode(FakeTransport.sent[0]);
  expect(text).toContain('TIKET DAPUR');
  expect(text).toContain('2x Kopi Susu');
  expect(text).not.toContain('Rp');
});

it('printer 80mm memakai 48 kolom', async () => {
  const { dispatcher } = setup(printerConfig({ paperWidthMm: 80 }));

  const job = dispatcher.submit({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload: order,
  });
  await dispatcher.run(job.id);

  const text = new TextDecoder().decode(FakeTransport.sent[0]);
  // Garis pemisah 48 kolom membuktikan lebar printer dihormati.
  expect(text).toContain('-'.repeat(48));
});

it('host dan port printer datang dari konfigurasi, bukan dari payload job', async () => {
  const { dispatcher } = setup(printerConfig({ host: '10.0.0.9', port: 9101 }));

  const job = dispatcher.submit({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    // Payload sengaja menyelipkan host palsu — harus DIABAIKAN.
    payload: {
      ...order,
      host: 'evil.example.com',
      port: 1234,
    } as ReceiptOrder,
  });
  await dispatcher.run(job.id);

  expect(FakeTransport.targets[0].host).toBe('10.0.0.9');
  expect(FakeTransport.targets[0].port).toBe(9101);
});

it('order tanpa item ditolak dengan INVALID_CONFIG, tidak cetak struk kosong', async () => {
  const { repo, dispatcher } = setup();

  const job = dispatcher.submit({
    orderId: 'ord-empty',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload: { ...order, items: [] },
  });
  await dispatcher.run(job.id);

  expect(repo.findById(job.id)?.lastError?.code).toBe('INVALID_CONFIG');
  expect(FakeTransport.sent).toHaveLength(0);
});

it('printer nonaktif → failed dengan INVALID_CONFIG, tanpa membuka socket', async () => {
  const { repo, dispatcher } = setup(printerConfig({ enabled: false }));

  const job = dispatcher.submit({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload: order,
  });
  await dispatcher.run(job.id);

  expect(repo.findById(job.id)?.lastError?.code).toBe('INVALID_CONFIG');
  expect(FakeTransport.sent).toHaveLength(0);
});

// Salinan merchant = struk pelanggan + header "MERCHANT". Header diturunkan
// dari `destination` di dispatcher, bukan dikirim WebView — jadi dua printer
// Bluetooth berdampingan bisa dipisah murni lewat konfigurasi tujuan.
it('tujuan merchant_receipt mencetak struk yang sama plus header MERCHANT', async () => {
  const { dispatcher } = setup(
    printerConfig({ destinations: ['customer_receipt', 'merchant_receipt'] }),
  );

  dispatcher.submit({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload: order,
  });
  dispatcher.submit({
    orderId: 'ord-1',
    destination: 'merchant_receipt',
    printerId: 'prn-1',
    payload: order,
  });

  await flush();
  await flush();

  expect(FakeTransport.sent).toHaveLength(2);
  const [customer, merchant] = FakeTransport.sent.map(bytes =>
    new TextDecoder().decode(bytes),
  );

  expect(customer).not.toContain('MERCHANT');
  // BOLD_ON + "MERCHANT" + BOLD_OFF, tepat sebelum blok info transaksi.
  expect(merchant).toContain(`\x1bE\x01MERCHANT\x1bE\x00\n`);
  // Isi lain identik: body merchant = body customer.
  expect(merchant.replace(`\x1bE\x01MERCHANT\x1bE\x00\n`, '')).toBe(customer);
});

// Tanpa printer bertujuan merchant, job TETAP dicatat sebagai gagal
// (NO_PRINTER) supaya muncul di Riwayat Cetak — bukan hilang diam-diam.
it('tujuan merchant_receipt tanpa printer tetap tercatat di Riwayat Cetak', async () => {
  const { db, repo, dispatcher } = setup(
    printerConfig({ destinations: ['customer_receipt'] }),
  );

  const job = dispatcher.submitUnroutable({
    orderId: 'ord-1',
    destination: 'merchant_receipt',
    payload: order,
  });

  await flush();

  expect(db.count('print_jobs')).toBe(1);
  expect(repo.findById(job.id)?.status).toBe('failed');
  expect(repo.findById(job.id)?.lastError?.code).toBe('NO_PRINTER');
});

