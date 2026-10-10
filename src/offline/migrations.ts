// src/offline/migrations.ts
// Migrasi skema SQLite. Versi dinaikkan satu langkah setiap penambahan skema.
//
// PENTING: migrasi hanya boleh MENAMBAH. Data di HP kasir adalah satu-satunya
// salinan order offline sebelum tersinkron — DROP TABLE di sini berarti
// kehilangan penjualan yang belum pernah sampai ke server.

export type Migration = {
  version: number;
  statements: string[];
};

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS printers (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        connection_type TEXT NOT NULL,
        host TEXT,
        port INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1,
        destinations TEXT NOT NULL,
        paper_width_mm INTEGER NOT NULL DEFAULT 58,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,

      `CREATE TABLE IF NOT EXISTS print_jobs (
        id TEXT PRIMARY KEY NOT NULL,
        order_id TEXT NOT NULL,
        destination TEXT NOT NULL,
        printer_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        idempotency_key TEXT NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,

      // Satu order + tujuan + printer = satu job. Tanpa indeks unik ini,
      // double-tap tombol cetak menghasilkan dua struk.
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_print_jobs_idempotency
        ON print_jobs (idempotency_key);`,

      // Antrean selalu dibaca terurut per printer.
      `CREATE INDEX IF NOT EXISTS idx_print_jobs_printer_status
        ON print_jobs (printer_id, status, created_at);`,

      `CREATE TABLE IF NOT EXISTS local_orders (
        local_id TEXT PRIMARY KEY NOT NULL,
        server_order_id TEXT,
        payload TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        sync_attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error TEXT,
        noreceipt TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        synced_at TEXT
      );`,

      `CREATE INDEX IF NOT EXISTS idx_local_orders_sync
        ON local_orders (sync_status, next_attempt_at);`,

      `CREATE TABLE IF NOT EXISTS sync_outbox (
        id TEXT PRIMARY KEY NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL
      );`,

      `CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_outbox_entity
        ON sync_outbox (entity_type, entity_id, operation);`,

      `CREATE INDEX IF NOT EXISTS idx_sync_outbox_ready
        ON sync_outbox (next_attempt_at);`,
    ],
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
