// __tests__/unit/print-job-repository.test.ts
// Repository job cetak. Yang dijaga: TIDAK ADA dedup (satu permintaan = satu
// job baru, berapa kali pun dipanggil), job macet dipulihkan jadi 'unknown'
// (bukan 'failed'), dan pembersihan tidak menghapus job yang masih hidup.

import { FakeDatabase } from '../helpers/fakeDatabase';
import {
  PrintJobRepository,
  recoverInterruptedJobs,
} from '../../src/printing/PrintJobRepository';
import type { ReceiptOrder } from '../../src/types/printing';

const payload: ReceiptOrder = {
  noreceipt: 'SPZ-1',
  paymentMethod: 'CASH',
  paymentStatus: 'PAID',
  finalAmount: 10_000,
  staffName: 'Kasir',
  customerName: null,
  customerPhone: null,
  customerAddress: null,
  tableNumber: null,
  createdAt: '2026-09-27T10:00:00.000Z',
  items: [{ menuName: 'Teh', quantity: 1, priceAtOrder: 10_000 }],
};

function makeRepo() {
  return new PrintJobRepository(new FakeDatabase());
}

it('create tidak pernah dedup — input identik berkali-kali = job berbeda semua', () => {
  const repo = makeRepo();
  const input = {
    orderId: 'ord-1',
    destination: 'customer_receipt' as const,
    printerId: 'prn-1',
    payload,
  };

  const first = repo.create(input);
  const second = repo.create(input);
  const third = repo.create(input);

  // Ini perilaku yang diminta: kasir boleh cetak struk sama sebanyak yang dia
  // mau. Tidak ada kunci orderId yang mengunci order setelah submit pertama.
  expect(new Set([first.id, second.id, third.id]).size).toBe(3);
  expect(repo.findRecent()).toHaveLength(3);
  // Status awal selalu queued — belum ada byte yang dikirim.
  expect(first.status).toBe('queued');
  expect(first.attemptCount).toBe(0);
});

it('tujuan atau printer berbeda menghasilkan job berbeda', () => {
  const repo = makeRepo();

  const receipt = repo.create({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload,
  });
  const kitchen = repo.create({
    orderId: 'ord-1',
    destination: 'kitchen_ticket',
    printerId: 'prn-1',
    payload,
  });
  const otherPrinter = repo.create({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-2',
    payload,
  });

  expect(new Set([receipt.id, kitchen.id, otherPrinter.id]).size).toBe(3);
});

it('payload bertahan utuh setelah bolak-balik lewat database', () => {
  const repo = makeRepo();
  const job = repo.create({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload,
  });

  const loaded = repo.findById(job.id);
  expect(loaded?.payload).toEqual(payload);
  expect(loaded?.lastError).toBeNull();
});

it('updateStatus menyimpan error lengkap beserta penanda transmisi', () => {
  const repo = makeRepo();
  const job = repo.create({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload,
  });

  repo.updateStatus(
    job.id,
    'unknown',
    {
      code: 'CONNECTION_RESET',
      message: 'Koneksi terputus.',
      transmissionStarted: true,
      at: '2026-09-27T10:00:09.000Z',
    },
    true,
  );

  const loaded = repo.findById(job.id);
  expect(loaded?.status).toBe('unknown');
  expect(loaded?.lastError?.code).toBe('CONNECTION_RESET');
  expect(loaded?.lastError?.transmissionStarted).toBe(true);
  expect(loaded?.attemptCount).toBe(1);
});

it('findPending hanya mengembalikan job yang belum selesai', () => {
  const repo = makeRepo();
  const a = repo.create({
    orderId: 'ord-a',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload,
  });
  const b = repo.create({
    orderId: 'ord-b',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload,
  });
  repo.updateStatus(a.id, 'submitted');

  const pending = repo.findPending('prn-1');
  expect(pending.map(j => j.id)).toEqual([b.id]);
});

it('job berstatus unknown tidak dianggap pending — kasir yang memutuskan cetak ulang', () => {
  const repo = makeRepo();
  const job = repo.create({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload,
  });
  repo.updateStatus(job.id, 'unknown', {
    code: 'CONNECTION_RESET',
    message: 'x',
    transmissionStarted: true,
    at: '2026-09-27T10:00:09.000Z',
  });

  expect(repo.findPending('prn-1')).toHaveLength(0);
});

it('recoverInterruptedJobs menandai job macet sebagai unknown, bukan failed', () => {
  const db = new FakeDatabase();
  const repo = new PrintJobRepository(db);
  const job = repo.create({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload,
  });
  // Pura-pura app mati saat mengirim, 2 menit lalu.
  repo.updateStatus(job.id, 'sending');
  db.tables.print_jobs.get(job.id)!.updated_at = new Date(
    Date.now() - 120_000,
  ).toISOString();

  const recovered = recoverInterruptedJobs(repo, 60_000);

  expect(recovered).toBe(1);
  const loaded = repo.findById(job.id);
  expect(loaded?.status).toBe('unknown');
  expect(loaded?.lastError?.transmissionStarted).toBe(true);
});

it('job yang baru mulai tidak dianggap macet', () => {
  const repo = makeRepo();
  const job = repo.create({
    orderId: 'ord-1',
    destination: 'customer_receipt',
    printerId: 'prn-1',
    payload,
  });
  repo.updateStatus(job.id, 'sending');

  expect(recoverInterruptedJobs(repo, 60_000)).toBe(0);
  expect(repo.findById(job.id)?.status).toBe('sending');
});
