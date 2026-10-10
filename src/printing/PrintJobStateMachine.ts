// src/printing/PrintJobStateMachine.ts
// Mesin status job cetak. FUNGSI MURNI.
//
// Alasan mesin ini ada: sampai byte benar-benar masuk ke socket, job belum
// terkirim. Kalau kita cuma punya "berhasil/gagal", job yang koneksinya putus
// di tengah jalan akan dilaporkan "gagal" — lalu kasir menekan cetak ulang dan
// struknya tercetak dua kali. Status `unknown` adalah jawabannya.

import type {
  PrintErrorCode,
  PrintJobStatus,
  PrintResult,
} from '../types/printing';

/** Transisi yang diizinkan. Terminal: submitted, failed, cancelled, unknown. */
const TRANSITIONS: Record<PrintJobStatus, readonly PrintJobStatus[]> = {
  queued: ['connecting', 'cancelled', 'failed'],
  connecting: ['sending', 'failed', 'unknown', 'cancelled'],
  sending: ['submitted', 'failed', 'unknown'],
  submitted: [],
  failed: [],
  unknown: [],
  cancelled: [],
};

/** Status akhir — tidak akan berubah lagi tanpa intervensi pengguna. */
export const TERMINAL_STATUSES: readonly PrintJobStatus[] = [
  'submitted',
  'failed',
  'unknown',
  'cancelled',
];

export function isTerminal(status: PrintJobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Boleh pindah dari `from` ke `to`? */
export function canTransition(
  from: PrintJobStatus,
  to: PrintJobStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Terapkan transisi. Melempar kalau tidak sah — transisi tidak sah berarti
 * ada bug di dispatcher, bukan kondisi runtime, jadi jangan diam-diam diabaikan.
 */
export function transition(
  from: PrintJobStatus,
  to: PrintJobStatus,
): PrintJobStatus {
  if (!canTransition(from, to)) {
    throw new Error(`Transisi status cetak tidak sah: ${from} → ${to}`);
  }
  return to;
}

/**
 * Status akhir untuk sebuah error (PRD §10.1).
 *
 * `transmissionStarted` adalah pertanyaan kuncinya: kalau sebagian byte sudah
 * dikirim, kita tidak tahu printer mencetak atau tidak.
 */
export function statusForError(
  code: PrintErrorCode,
  transmissionStarted: boolean,
): PrintJobStatus {
  if (transmissionStarted) {
    // Termasuk CONNECTION_RESET dan WRITE_FAILED setelah byte pertama keluar.
    return 'unknown';
  }
  // TRANSPORT_UNSUPPORTED tidak akan pernah berubah → failed, bukan queued.
  return 'failed';
}

const ERROR_MESSAGES: Record<PrintErrorCode, string> = {
  INVALID_CONFIG: 'Konfigurasi printer tidak lengkap.',
  PERMISSION_DENIED: 'Aplikasi tidak punya izin jaringan.',
  UNREACHABLE_HOST: 'Printer tidak ditemukan di jaringan.',
  CONNECTION_TIMEOUT: 'Printer tidak merespons (timeout).',
  CONNECTION_REFUSED: 'Printer menolak koneksi. Cek port.',
  CONNECTION_RESET: 'Koneksi ke printer terputus.',
  CONNECTION_LOST_DURING_SEND:
    'Koneksi terputus saat mengirim. Periksa kertas printer.',
  WRITE_FAILED: 'Gagal mengirim data ke printer.',
  TRANSPORT_UNSUPPORTED: 'Jenis koneksi ini belum didukung.',
  BLUETOOTH_DISABLED:
    'Bluetooth mati atau tidak tersedia. Nyalakan Bluetooth, lalu coba lagi.',
  BLUETOOTH_PERMISSION_DENIED:
    'Izin Bluetooth ditolak. Berikan izin lewat Pengaturan Android.',
  DEVICE_NOT_FOUND:
    'Printer Bluetooth tidak ditemukan. Pasangkan printernya dulu di ' +
    'Pengaturan Bluetooth Android, lalu nyalakan printer.',
  DEVICE_DISCONNECTED:
    'Koneksi Bluetooth terputus. Nyalakan ulang printer dan pastikan dalam ' +
    'jangkauan.',
  CHARACTERISTIC_NOT_FOUND:
    'Printer ini tidak menerima data cetak (karakteristik BLE tidak cocok). ' +
    'Coba printer lain atau gunakan koneksi LAN.',
  UNKNOWN_TRANSPORT_ERROR: 'Terjadi kesalahan cetak yang tidak dikenali.',
};

export function messageForError(code: PrintErrorCode): string {
  return ERROR_MESSAGES[code];
}

export function printResult(
  jobId: string,
  status: PrintJobStatus,
  code?: PrintErrorCode,
  transmissionStarted = false,
): PrintResult {
  if (!code) {
    return { jobId, status };
  }
  return {
    jobId,
    status,
    error: {
      code,
      message: messageForError(code),
      transmissionStarted,
      at: new Date().toISOString(),
    },
  };
}
