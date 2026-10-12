// src/printing/PrintJobRepository.ts
// Sumber kebenaran job cetak. Job ditulis ke SQLite SEBELUM dikembalikan ke
// pemanggil (PRD §8.2: persistence-before-ack).
//
// Konsekuensi yang diterima: kalau app mati tepat setelah insert tapi sebelum
// cetak, job tetap ada dan statusnya 'queued' — terlihat kasir, bisa dicetak
// ulang. Itu jauh lebih baik daripada ack "berhasil" untuk struk yang hilang.
//
// TIDAK ADA dedup di sini. Satu permintaan cetak = satu job baru, selamanya.
// Lihat `create()` untuk alasan dan di mana pengaman yang tersisa berada.

import type { Database, SqlValue } from '../offline/database';
import { getDatabase } from '../offline/database';
import type {
  KitchenTicketOrder,
  LabelOrder,
  PrintDestination,
  PrintJob,
  PrintJobError,
  PrintJobStatus,
  ReceiptOrder,
} from '../types/printing';
import { newId } from '../utils/id';

type JobRow = {
  id: string;
  order_id: string;
  destination: string;
  printer_id: string;
  status: string;
  payload: string;
  attempt_count: number;
  idempotency_key: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function toJob(row: JobRow): PrintJob {
  return {
    id: row.id,
    orderId: row.order_id,
    destination: row.destination as PrintDestination,
    printerId: row.printer_id,
    status: row.status as PrintJobStatus,
    payload: JSON.parse(row.payload) as
      | ReceiptOrder
      | KitchenTicketOrder
      | LabelOrder,
    attemptCount: Number(row.attempt_count),
    idempotencyKey: row.idempotency_key,
    lastError: row.last_error
      ? (JSON.parse(row.last_error) as PrintJobError)
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type CreateJobInput = {
  orderId: string;
  destination: PrintDestination;
  printerId: string;
  payload: ReceiptOrder | KitchenTicketOrder | LabelOrder;
};

export class PrintJobRepository {
  private readonly db: Database;

  constructor(db?: Database) {
    // Default dihitung malas: test selalu menyuntik FakeDatabase, jadi jalur
    // native tidak pernah disentuh dan tidak ada DB asli yang dibuka.
    this.db = db ?? getDatabase();
  }

  /**
   * Selalu membuat job BARU. Tidak ada pengecekan idempotency.
   *
   * Keputusan sadar (2026-10): kasir harus bisa mencetak struk yang sama
   * sebanyak yang dia mau — cetak ulang manual dari POS, struk hilang, tamu
   * minta salinan lagi. Dedup berbasis `orderId` mengunci order pertama
   * selamanya begitu satu job berstatus `submitted`, dan tidak ada UI di POS
   * yang bisa membukanya.
   *
   * Pengaman yang TERSISA ada di level permintaan, bukan level order:
   * `BridgeHandler.handle` menyimpan respons per `requestId`, jadi satu
   * perintah cetak yang di-retry setelah timeout (requestId sama) tidak
   * berubah jadi dua job. Double-tap tombol dari UI juga requestId-nya
   * berbeda, jadi itu memang menghasilkan dua struk — itu disengaja.
   *
   * `idempotency_key` tetap diisi unik per job: kolomnya NOT NULL dan masih
   * ada UNIQUE index di DB lama sampai migrasi v2 menghapusnya.
   */
  create(input: CreateJobInput): PrintJob {
    const now = new Date().toISOString();
    const job: PrintJob = {
      id: newId('job'),
      orderId: input.orderId,
      destination: input.destination,
      printerId: input.printerId,
      status: 'queued',
      payload: input.payload,
      attemptCount: 0,
      idempotencyKey: newId('key'),
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };

    this.db.execute(
      `INSERT INTO print_jobs (
        id, order_id, destination, printer_id, status, payload,
        attempt_count, idempotency_key, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        job.id,
        job.orderId,
        job.destination,
        job.printerId,
        job.status,
        JSON.stringify(job.payload),
        job.attemptCount,
        job.idempotencyKey,
        null,
        job.createdAt,
        job.updatedAt,
      ],
    );

    return job;
  }

  findById(id: string): PrintJob | null {
    const rows = this.db.query<JobRow>(
      'SELECT * FROM print_jobs WHERE id = ? LIMIT 1;',
      [id],
    );
    return rows.length > 0 ? toJob(rows[0]) : null;
  }

  /** Job yang masih bisa diproses, terurut FIFO per printer. */
  findPending(printerId?: string): PrintJob[] {
    const params: SqlValue[] = printerId ? [printerId] : [];
    const filter = printerId ? 'AND printer_id = ? ' : '';
    const rows = this.db.query<JobRow>(
      `SELECT * FROM print_jobs
       WHERE status IN ('queued', 'connecting', 'sending') ${filter}
       ORDER BY created_at ASC;`,
      params,
    );
    return rows.map(toJob);
  }

  /**
   * Job dengan status; dipakai layar Riwayat Cetak.
   * `limit` dipaksa ada supaya tabel yang sudah ribuan baris tidak ditarik
   * seluruhnya ke memori.
   */
  findByStatus(status: PrintJobStatus, limit = 50): PrintJob[] {
    const rows = this.db.query<JobRow>(
      `SELECT * FROM print_jobs WHERE status = ?
       ORDER BY created_at DESC LIMIT ?;`,
      [status, limit],
    );
    return rows.map(toJob);
  }

  /** N job terbaru, lintas status. */
  findRecent(limit = 50): PrintJob[] {
    const rows = this.db.query<JobRow>(
      'SELECT * FROM print_jobs ORDER BY created_at DESC LIMIT ?;',
      [limit],
    );
    return rows.map(toJob);
  }

  updateStatus(
    id: string,
    status: PrintJobStatus,
    error: PrintJobError | null = null,
    incrementAttempt = false,
  ): void {
    const now = new Date().toISOString();
    this.db.execute(
      `UPDATE print_jobs
       SET status = ?, last_error = ?, updated_at = ?,
           attempt_count = attempt_count + ?
       WHERE id = ?;`,
      [
        status,
        error ? JSON.stringify(error) : null,
        now,
        incrementAttempt ? 1 : 0,
        id,
      ],
    );
  }

  /** Alihkan job ke printer lain — dipakai saat cetak ulang job tanpa printer. */
  updatePrinterId(id: string, printerId: string): void {
    this.db.execute(
      'UPDATE print_jobs SET printer_id = ?, updated_at = ? WHERE id = ?;',
      [printerId, new Date().toISOString(), id],
    );
  }

  /** Naikkan percobaan tanpa mengubah status — dipakai saat retry manual. */
  incrementAttempt(id: string): void {
    this.db.execute(
      'UPDATE print_jobs SET attempt_count = attempt_count + 1, updated_at = ? WHERE id = ?;',
      [new Date().toISOString(), id],
    );
  }

  /** Job yang macet di status berjalan (app mati saat mengirim). */
  recoverStale(olderThanMs: number): PrintJob[] {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const rows = this.db.query<JobRow>(
      `SELECT * FROM print_jobs
       WHERE status IN ('connecting', 'sending') AND updated_at < ?;`,
      [cutoff],
    );
    return rows.map(toJob);
  }

  deleteOld(olderThanMs: number): number {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const counted = this.db.query<{ c: number }>(
      'SELECT COUNT(*) AS c FROM print_jobs WHERE updated_at < ?;',
      [cutoff],
    );
    this.db.execute('DELETE FROM print_jobs WHERE updated_at < ?;', [cutoff]);
    return Number(counted[0]?.c ?? 0);
  }
}

/**
 * Pemulihan saat start: job yang masih 'connecting'/'sending' berarti proses
 * sebelumnya berhenti di tengah. Kita tidak tahu printer sempat mencetak atau
 * tidak → tandai 'unknown' supaya kasir memutuskan, bukan kita menebak.
 */
export function recoverInterruptedJobs(
  repo: PrintJobRepository,
  olderThanMs = 60_000,
): number {
  const stale = repo.recoverStale(olderThanMs);
  for (const job of stale) {
    repo.updateStatus(job.id, 'unknown', {
      code: 'CONNECTION_LOST_DURING_SEND',
      message:
        'Aplikasi berhenti saat mengirim. Periksa kertas printer sebelum cetak ulang.',
      transmissionStarted: true,
      at: new Date().toISOString(),
    });
  }
  return stale.length;
}
