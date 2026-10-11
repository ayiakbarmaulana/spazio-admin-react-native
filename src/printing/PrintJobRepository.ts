// src/printing/PrintJobRepository.ts
// Sumber kebenaran job cetak. Job ditulis ke SQLite SEBELUM dikembalikan ke
// pemanggil (PRD §8.2: persistence-before-ack).
//
// Konsekuensi yang diterima: kalau app mati tepat setelah insert tapi sebelum
// cetak, job tetap ada dan statusnya 'queued' — terlihat kasir, bisa dicetak
// ulang. Itu jauh lebih baik daripada ack "berhasil" untuk struk yang hilang.

import type { Database, SqlValue } from '../offline/database';
import { getDatabase } from '../offline/database';
import type {
  KitchenTicketOrder,
  PrintDestination,
  PrintJob,
  PrintJobError,
  PrintJobStatus,
  ReceiptOrder,
} from '../types/printing';
import { newId, printJobKey } from '../utils/id';

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
    payload: JSON.parse(row.payload) as ReceiptOrder | KitchenTicketOrder,
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
  payload: ReceiptOrder | KitchenTicketOrder;
};

/**
 * Boleh diulang dari POS tanpa konfirmasi tambahan?
 *
 * `failed`/`cancelled` = tidak ada byte yang keluar (atau dibatalkan sebelum
 * kirim) → aman diulang. `submitted`/`unknown` sengaja TIDAK boleh: struk
 * mungkin sudah tercetak, dan mengulangnya bikin struk dobel.
 */
function isRetryable(status: PrintJobStatus): boolean {
  return status === 'failed' || status === 'cancelled';
}

export class PrintJobRepository {
  private readonly db: Database;

  constructor(db?: Database) {
    // Default dihitung malas: test selalu menyuntik FakeDatabase, jadi jalur
    // native tidak pernah disentuh dan tidak ada DB asli yang dibuka.
    this.db = db ?? getDatabase();
  }

  /**
   * Buat job, atau kembalikan yang sudah ada kalau kunci dedup-nya sama.
   *
   * `created` membedakan "job baru" dari "sudah pernah dibuat" supaya caller
   * tidak mengantre dua kali untuk order yang sama.
   *
   * PENTING: dedup hanya berlaku selama job pendahulunya masih berarti.
   * Job yang sudah `failed`/`cancelled` boleh diulang — kalau tidak, order
   * yang struknya gagal (kertas habis, printer mati) terkunci selamanya di
   * kunci idempotency yang sama dan kasir tidak punya cara mencetak ulang
   * dari POS. `submitted` TIDAK boleh diulang (struk sudah keluar), dan
   * `unknown` TIDAK boleh diulang otomatis (printer mungkin sudah mencetak) —
   * keduanya harus lewat layar Riwayat Cetak dengan konfirmasi kasir.
   */
  createOrGet(input: CreateJobInput): { job: PrintJob; created: boolean } {
    const key = printJobKey(input.orderId, input.destination, input.printerId);
    const existing = this.findByIdempotencyKey(key);
    if (existing && !isRetryable(existing.status)) {
      return { job: existing, created: false };
    }

    const now = new Date().toISOString();
    const job: PrintJob = {
      id: newId('job'),
      orderId: input.orderId,
      destination: input.destination,
      printerId: input.printerId,
      status: 'queued',
      payload: input.payload,
      attemptCount: 0,
      // Percobaan ulang memakai kunci turunan supaya baris job lama (dan
      // riwayat kegagalannya) tetap ada, tanpa melanggar indeks unik di
      // idempotency_key.
      idempotencyKey:
        existing && isRetryable(existing.status)
          ? `${key}::retry-${newId('r')}`
          : key,
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

    return { job, created: true };
  }

  findById(id: string): PrintJob | null {
    const rows = this.db.query<JobRow>(
      'SELECT * FROM print_jobs WHERE id = ? LIMIT 1;',
      [id],
    );
    return rows.length > 0 ? toJob(rows[0]) : null;
  }

  findByIdempotencyKey(key: string): PrintJob | null {
    const rows = this.db.query<JobRow>(
      'SELECT * FROM print_jobs WHERE idempotency_key = ? LIMIT 1;',
      [key],
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
