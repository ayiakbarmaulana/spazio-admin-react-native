// __tests__/unit/print-queue.test.ts
// Antrean cetak: SERIAL per printer, PARALEL antar printer (PRD §6.3).
//
// Regresi yang dijaga: dua job ke printer yang sama tidak boleh saling sisip.
// Printer thermal tidak punya multiplexing — job yang tumpang tindih
// menghasilkan satu struk berisi campuran dua order.

import { PrintQueue } from '../../src/printing/PrintQueue';

/** Tunda `ms`, dipakai untuk mensimulasikan pekerjaan yang lama. */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

it('job ke printer yang sama dijalankan serial, sesuai urutan masuk', async () => {
  const queue = new PrintQueue();
  const order: string[] = [];

  const first = queue.enqueue('prn-A', 'j1', async () => {
    await delay(30);
    order.push('j1-start-end');
    return 'j1';
  });
  const second = queue.enqueue('prn-A', 'j2', async () => {
    order.push('j2');
    return 'j2';
  });
  const third = queue.enqueue('prn-A', 'j3', async () => {
    order.push('j3');
    return 'j3';
  });

  expect(queue.pendingCount('prn-A')).toBe(2);

  await Promise.all([first, second, third]);
  expect(order).toEqual(['j1-start-end', 'j2', 'j3']);
  expect(queue.pendingCount('prn-A')).toBe(0);
});

it('printer berbeda berjalan paralel, bukan saling menunggu', async () => {
  const queue = new PrintQueue();
  const log: string[] = [];

  const slow = queue.enqueue('prn-A', 'slow', async () => {
    log.push('A-start');
    await delay(40);
    log.push('A-end');
  });
  const fast = queue.enqueue('prn-B', 'fast', async () => {
    log.push('B-start');
    await delay(5);
    log.push('B-end');
  });

  await Promise.all([slow, fast]);

  // B selesai sebelum A — bukti tidak ada serialisasi lintas printer.
  expect(log).toEqual(['A-start', 'B-start', 'B-end', 'A-end']);
});

it('kegagalan satu job tidak menghentikan antrean printer itu', async () => {
  const queue = new PrintQueue();

  const failing = queue.enqueue('prn-A', 'bad', async () => {
    throw new Error('printer habis kertas');
  });
  const after = queue.enqueue('prn-A', 'good', async () => 'ok');

  await expect(failing).rejects.toThrow('habis kertas');
  await expect(after).resolves.toBe('ok');
});

it('promise selesai saat job itu selesai, bukan saat antrean kosong', async () => {
  const queue = new PrintQueue();

  const first = queue.enqueue('prn-A', 'j1', async () => {
    await delay(25);
    return 'first';
  });
  // Job kedua sengaja menggantung lama; kalau promise pertama menunggu antrean
  // kosong, test ini akan timeout.
  void queue.enqueue('prn-A', 'j2', async () => {
    await delay(5000);
  });

  await expect(first).resolves.toBe('first');
  queue.clear();
});

it('isBusy melaporkan pekerjaan yang sedang jalan dan menunggu', async () => {
  const queue = new PrintQueue();
  expect(queue.isBusy('prn-A')).toBe(false);

  const job = queue.enqueue('prn-A', 'j1', async () => {
    await delay(20);
  });
  expect(queue.isBusy('prn-A')).toBe(true);

  await job;
  expect(queue.isBusy('prn-A')).toBe(false);
});

it('clear membuang pekerjaan yang belum mulai dan mengembalikan jumlahnya', async () => {
  const queue = new PrintQueue();

  const running = queue.enqueue('prn-A', 'running', async () => {
    await delay(20);
    return 'running';
  });
  void queue.enqueue('prn-A', 'waiting-1', async () => 'w1');
  void queue.enqueue('prn-A', 'waiting-2', async () => 'w2');

  // Satu sedang jalan, dua menunggu.
  expect(queue.clear('prn-A')).toBe(2);
  // Yang sedang jalan tetap diselesaikan — bukan dibatalkan di tengah.
  await expect(running).resolves.toBe('running');
});
