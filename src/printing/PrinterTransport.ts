// src/printing/PrinterTransport.ts
// Antarmuka transport cetak. Dispatcher hanya kenal interface ini, jadi driver
// LAN bisa diganti driver lain tanpa menyentuh antrean.

import type { PrintJobError } from '../types/printing';

export type SendResult =
  | { ok: true }
  | { ok: false; error: PrintJobError };

/**
 * `transmissionStarted` = minimal satu byte sudah keluar ke socket. Dispatcher
 * memakai fakta ini untuk memutuskan status akhir 'failed' vs 'unknown'.
 */
export type TransmissionError = {
  error: PrintJobError;
  transmissionStarted: boolean;
};

export type TransportTarget = {
  host: string;
  port: number;
  connectTimeoutMs: number;
  writeTimeoutMs: number;
};

export type PrinterTransport = {
  /** Kirim satu buffer utuh. Selalu menutup koneksi sebelum resolve. */
  send: (bytes: Uint8Array) => Promise<SendResult>;
  /** Uji sambung + kirim tanpa mencetak apa pun yang bisa dibaca. */
  test: () => Promise<SendResult>;
  /** Tutup koneksi yang masih terbuka (dipakai saat app masuk background). */
  close: () => void;
};
