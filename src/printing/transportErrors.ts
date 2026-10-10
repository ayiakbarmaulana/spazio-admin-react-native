// src/printing/transportErrors.ts
// Terjemahkan error socket/BLE mentah jadi taksonomi error kita (PRD §10.1).
//
// Driver TCP tidak punya kode error yang seragam antar platform, jadi yang
// dipakai adalah pencocokan teks pesan. Rapuh, tapi lebih baik daripada
// menampilkan "Error: connect ECONNREFUSED" ke kasir.

import type { PrintErrorCode, PrintJobError } from '../types/printing';
import { messageForError } from './PrintJobStateMachine';

/** Cocokkan pesan error platform ke kode kita, berurutan dari yang spesifik. */
const PATTERNS: [RegExp, PrintErrorCode][] = [
  // ── BLE / Bluetooth ────────────────────────────────────────────────────
  // Ditaruh di depan: pesan BLE sering ikut memuat kata "timeout"/"denied" dan
  // akan salah klasifikasi kalau pola jaringan dicek lebih dulu.
  [/bluetooth.*(off|disabled|not (available|powered))|no bluetooth adapter/i, 'BLUETOOTH_DISABLED'],
  [/BLUETOOTH_(CONNECT|SCAN)|bluetooth.*permission|permission.*bluetooth/i, 'BLUETOOTH_PERMISSION_DENIED'],
  [/characteristic.*not found|no writable char|service.*not found/i, 'CHARACTERISTIC_NOT_FOUND'],
  [/device.*(not found|disappeared)|not in range|adapter is off/i, 'DEVICE_NOT_FOUND'],
  [/disconnect/, 'DEVICE_DISCONNECTED'],
  // ── Jaringan ───────────────────────────────────────────────────────────
  [/ECONNREFUSED|connection refused|refused/i, 'CONNECTION_REFUSED'],
  [/ETIMEDOUT|timeout|timed out/i, 'CONNECTION_TIMEOUT'],
  [/ENETUNREACH|EHOSTUNREACH|unreachable|no route/i, 'UNREACHABLE_HOST'],
  [/EPERM|EACCES|permission|denied/i, 'PERMISSION_DENIED'],
  [/ECONNRESET|reset by peer|broken pipe|EPIPE/i, 'CONNECTION_RESET'],
  [/unsupported|not implemented|not supported/i, 'TRANSPORT_UNSUPPORTED'],
];

/** Klasifikasi error jaringan jadi kode taksonomi. */
export function classifyTransportError(error: unknown): PrintErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  for (const [pattern, code] of PATTERNS) {
    if (pattern.test(message)) {
      return code;
    }
  }
  return 'UNKNOWN_TRANSPORT_ERROR';
}

/**
 * Bentuk PrintJobError dari error mentah.
 *
 * `transmissionStarted` wajib diberikan pemanggil — hanya dia yang tahu apakah
 * sudah ada byte yang keluar.
 */
export function toJobError(
  error: unknown,
  transmissionStarted: boolean,
): PrintJobError {
  const code = classifyTransportError(error);
  const raw = error instanceof Error ? error.message : String(error);
  return {
    code,
    // Pesan Indonesia yang siap dibaca kasir; detail teknis disimpan supaya
    // layar Diagnostik masih bisa menampilkannya.
    message:
      code === 'UNKNOWN_TRANSPORT_ERROR'
        ? `${messageForError(code)} (${raw})`
        : messageForError(code),
    transmissionStarted,
    at: new Date().toISOString(),
  };
}

/** Error batas waktu buatan sendiri, supaya klasifikasinya konsisten. */
export class TimeoutError extends Error {
  constructor(phase: 'connect' | 'write', ms: number) {
    super(`${phase} timeout after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}
