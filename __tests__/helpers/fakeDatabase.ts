// __tests__/helpers/fakeDatabase.ts
// Implementasi Database in-memory untuk test. Tidak memakai SQLite sungguhan:
// yang diuji adalah repository plus dispatcher, bukan mesin SQL. Kueri yang
// dipakai repository jumlahnya kecil dan polanya tetap, jadi dicocokkan dengan
// regex dan dieksekusi di atas array biasa.
//
// ponytail: kalau kueri repository bertambah rumit, ganti ini dengan
// better-sqlite3 dan jalankan migrasi asli. Selama masih ~8 kueri tetap,
// ini lebih cepat dan tanpa dependensi native.

import type { Database, Row, SqlValue } from '../../src/offline/database';

type Table = Map<string, Row>;

export class FakeDatabase implements Database {
  readonly tables: Record<string, Table> = {};
  /** Jejak kueri — dipakai untuk memastikan urutan operasi (mis. insert dulu). */
  readonly log: string[] = [];

  private table(name: string): Table {
    if (!this.tables[name]) {
      this.tables[name] = new Map();
    }
    return this.tables[name];
  }

  execute(sql: string, params: SqlValue[] = []): void {
    this.log.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));

    const normalized = sql.replace(/\s+/g, ' ').trim();

    // PRAGMA dan transaksi diabaikan — tidak relevan untuk test in-memory.
    if (/^(PRAGMA|BEGIN|COMMIT|ROLLBACK)/i.test(normalized)) {
      return;
    }

    if (/^INSERT INTO print_jobs/i.test(normalized)) {
      const [
        id,
        orderId,
        destination,
        printerId,
        status,
        payload,
        attemptCount,
        idempotencyKey,
        lastError,
        createdAt,
        updatedAt,
      ] = params;
      const key = String(id);
      if (this.table('print_jobs').has(key)) {
        throw new Error(`UNIQUE constraint failed: print_jobs.id (${key})`);
      }
      // Meniru indeks UNIQUE pada idempotency_key (idx_print_jobs_idempotency).
      for (const row of this.table('print_jobs').values()) {
        if (row.idempotency_key === idempotencyKey) {
          throw new Error(
            `UNIQUE constraint failed: print_jobs.idempotency_key (${String(idempotencyKey)})`,
          );
        }
      }
      this.table('print_jobs').set(key, {
        id,
        order_id: orderId,
        destination,
        printer_id: printerId,
        status,
        payload,
        attempt_count: attemptCount,
        idempotency_key: idempotencyKey,
        last_error: lastError,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return;
    }

    if (/^UPDATE print_jobs SET status/i.test(normalized)) {
      const [status, lastError, updatedAt, increment, id] = params;
      const row = this.table('print_jobs').get(String(id));
      if (row) {
        row.status = status;
        row.last_error = lastError;
        row.updated_at = updatedAt;
        row.attempt_count = Number(row.attempt_count) + Number(increment);
      }
      return;
    }

    if (/^UPDATE print_jobs SET attempt_count/i.test(normalized)) {
      const [updatedAt, id] = params;
      const row = this.table('print_jobs').get(String(id));
      if (row) {
        row.attempt_count = Number(row.attempt_count) + 1;
        row.updated_at = updatedAt;
      }
      return;
    }

    if (/^UPDATE print_jobs SET printer_id/i.test(normalized)) {
      const [printerId, updatedAt, id] = params;
      const row = this.table('print_jobs').get(String(id));
      if (row) {
        row.printer_id = printerId;
        row.updated_at = updatedAt;
      }
      return;
    }

    if (/^DELETE FROM print_jobs WHERE updated_at/i.test(normalized)) {
      const [cutoff] = params;
      for (const [key, row] of this.table('print_jobs')) {
        if (String(row.updated_at) < String(cutoff)) {
          this.table('print_jobs').delete(key);
        }
      }
      return;
    }

    throw new Error(`FakeDatabase belum mendukung kueri: ${normalized}`);
  }

  query<T extends Row = Row>(sql: string, params: SqlValue[] = []): T[] {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    const all = [...this.table('print_jobs').values()];

    if (/COUNT\(\*\) AS c/i.test(normalized)) {
      const [cutoff] = params;
      const count = all.filter(r => String(r.updated_at) < String(cutoff)).length;
      return [{ c: count } as unknown as T];
    }

    if (/WHERE id = \?/i.test(normalized)) {
      const row = this.table('print_jobs').get(String(params[0]));
      return row ? [row as unknown as T] : [];
    }

    if (/WHERE idempotency_key = \?/i.test(normalized)) {
      const found = all.find(r => r.idempotency_key === params[0]);
      return found ? [found as unknown as T] : [];
    }

    if (/status IN \('queued', 'connecting', 'sending'\)/.test(normalized)) {
      const pending = all.filter(
        r =>
          ['queued', 'connecting', 'sending'].includes(String(r.status)) &&
          (params.length === 0 || r.printer_id === params[0]),
      );
      return pending.sort(
        (a, b) => String(a.created_at).localeCompare(String(b.created_at)),
      ) as unknown as T[];
    }

    if (/WHERE status = \?/i.test(normalized)) {
      const [status, limit] = params;
      const matched = all
        .filter(r => r.status === status)
        .sort((a, b) =>
          String(b.created_at).localeCompare(String(a.created_at)),
        );
      return matched.slice(0, Number(limit ?? 50)) as unknown as T[];
    }

    if (/WHERE status IN \('connecting', 'sending'\)/.test(normalized)) {
      const [cutoff] = params;
      const stale = all.filter(
        r =>
          ['connecting', 'sending'].includes(String(r.status)) &&
          String(r.updated_at) < String(cutoff),
      );
      return stale as unknown as T[];
    }

    if (/^SELECT \* FROM print_jobs ORDER BY created_at DESC/i.test(normalized)) {
      const [limit] = params;
      const sorted = [...all].sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at)),
      );
      return sorted.slice(0, Number(limit ?? 50)) as unknown as T[];
    }

    throw new Error(`FakeDatabase belum mendukung kueri: ${normalized}`);
  }

  close(): void {
    // Tidak ada resource yang perlu dilepas.
  }

  /** Jumlah baris di sebuah tabel — untuk asersi test. */
  count(table: string): number {
    return this.table(table).size;
  }
}
