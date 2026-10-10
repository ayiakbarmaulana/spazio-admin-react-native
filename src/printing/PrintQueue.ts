// src/printing/PrintQueue.ts
// Antrean cetak: SERIAL per printer, PARALEL antar printer (PRD §6.3).
//
// Alasan serial per printer: printer thermal ESC/POS tidak punya multiplexing.
// Dua job yang menulis bersamaan akan saling menyisip di buffer printer dan
// menghasilkan satu struk yang isinya campur dua order.
//
// Antrean ini murni in-memory dan hanya mengatur *urutan eksekusi*. Sumber
// kebenaran status tetap SQLite — kalau app mati, antreannya hilang tapi
// job-nya tidak.

export type JobRunner<T> = () => Promise<T>;

type Chain = {
  running: boolean;
  queue: { id: string; run: JobRunner<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void }[];
};

export class PrintQueue {
  private readonly chains = new Map<string, Chain>();

  private chainFor(printerId: string): Chain {
    let chain = this.chains.get(printerId);
    if (!chain) {
      chain = { running: false, queue: [] };
      this.chains.set(printerId, chain);
    }
    return chain;
  }

  /**
   * Antre satu pekerjaan ke printer `printerId`. Promise-nya selesai saat
   * pekerjaan itu sendiri selesai — bukan saat antrean printer kosong.
   */
  enqueue<T>(printerId: string, id: string, run: JobRunner<T>): Promise<T> {
    const chain = this.chainFor(printerId);
    return new Promise<T>((resolve, reject) => {
      chain.queue.push({
        id,
        run: run as JobRunner<unknown>,
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      void this.drain(printerId);
    });
  }

  private async drain(printerId: string): Promise<void> {
    const chain = this.chainFor(printerId);
    if (chain.running) {
      return;
    }
    chain.running = true;
    try {
      // Ambil satu per satu. Job berikutnya tidak mulai sebelum yang sekarang
      // selesai — termasuk sebelum koneksinya ditutup.
      while (chain.queue.length > 0) {
        const item = chain.queue.shift()!;
        try {
          item.resolve(await item.run());
        } catch (error) {
          item.reject(error);
        }
      }
    } finally {
      chain.running = false;
    }
  }

  /** Jumlah pekerjaan menunggu (tidak termasuk yang sedang jalan). */
  pendingCount(printerId: string): number {
    return this.chainFor(printerId).queue.length;
  }

  pendingCountAll(): number {
    let total = 0;
    for (const chain of this.chains.values()) {
      total += chain.queue.length;
    }
    return total;
  }

  isBusy(printerId: string): boolean {
    const chain = this.chains.get(printerId);
    return !!chain && (chain.running || chain.queue.length > 0);
  }

  /** Buang pekerjaan yang belum mulai. Yang sedang jalan tidak bisa dibatalkan. */
  clear(printerId?: string): number {
    let removed = 0;
    const targets = printerId ? [this.chainFor(printerId)] : [...this.chains.values()];
    for (const chain of targets) {
      removed += chain.queue.length;
      chain.queue = [];
    }
    return removed;
  }
}

/** Antrean proses-wide. */
export const printQueue = new PrintQueue();
