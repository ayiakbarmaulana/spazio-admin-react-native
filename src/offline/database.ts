// src/offline/database.ts
// Buka database SQLite dan jalankan migrasi.
//
// Pakai @op-engineering/op-sqlite (penerus react-native-quick-sqlite yang sudah
// deprecated). Aksesnya sinkron lewat JSI, jadi tidak memblokir thread JS
// seperti react-native-sqlite-storage.
//
// ponytail: adapter sempit di bawah ini supaya repository bisa diuji dengan
// SQLite in-memory Node. Kalau butuh transaksi lintas-koneksi, ganti ke pool.

import { LATEST_VERSION, MIGRATIONS } from './migrations';
import type { DB } from '@op-engineering/op-sqlite';

export const DATABASE_NAME = 'spazio_pos.db';

export type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;

/** Permukaan database yang dipakai repository. Sengaja minimal. */
export type Database = {
  execute: (sql: string, params?: SqlValue[]) => void;
  query: <T extends Row = Row>(sql: string, params?: SqlValue[]) => T[];
  close: () => void;
};

let instance: Database | null = null;

/** Jalankan migrasi yang belum diterapkan. Idempoten. */
export function runMigrations(db: Database): void {
  db.execute('PRAGMA journal_mode = WAL;');
  db.execute('PRAGMA foreign_keys = ON;');

  const versionRows = db.query<{ user_version: number }>(
    'PRAGMA user_version;',
  );
  const current = Number(versionRows[0]?.user_version ?? 0);

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) {
      continue;
    }
    // Setiap langkah dibungkus transaksi: migrasi yang putus di tengah tidak
    // meninggalkan skema setengah jadi.
    db.execute('BEGIN;');
    try {
      for (const statement of migration.statements) {
        db.execute(statement);
      }
      db.execute(`PRAGMA user_version = ${migration.version};`);
      db.execute('COMMIT;');
    } catch (error) {
      db.execute('ROLLBACK;');
      throw error;
    }
  }
}

/** Adapter tipis di atas driver op-sqlite. Memakai jalur Sync: repository
 * dipanggil dari jalur cetak yang tidak boleh di-await berkali-kali, dan
 * `execute()` async di driver ini tetap memblokir JSI di belakang layar. */
function adaptDB(raw: DB): Database {
  return {
    execute: (sql, params) => {
      raw.executeSync(sql, params);
    },
    query: <T extends Row = Row>(sql: string, params?: SqlValue[]) => {
      const result = raw.executeSync(sql, params);
      return (result.rows ?? []) as T[];
    },
    close: () => raw.close(),
  };
}

/** Koneksi aplikasi (singleton). */
export function getDatabase(): Database {
  if (!instance) {
    // `require` (bukan import statis) supaya modul ini tetap bisa di-import di
    // Jest tanpa menarik native module op-sqlite.
    const { open } = require('@op-engineering/op-sqlite') as typeof import('@op-engineering/op-sqlite');
    const raw = open({ name: DATABASE_NAME });
    const adapted = adaptDB(raw);
    runMigrations(adapted);
    instance = adapted;
  }
  return instance;
}

/** Untuk test — pasang database buatan sendiri. */
export function setDatabase(db: Database | null): void {
  instance = db;
}

export { LATEST_VERSION };
