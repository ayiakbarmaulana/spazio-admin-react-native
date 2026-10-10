// __tests__/unit/print-job-state-machine.test.ts
// Mesin status job cetak. Yang dijaga di sini: job yang koneksinya putus di
// tengah jalan TIDAK pernah dilaporkan 'failed' (kasir akan cetak ulang dan
// struknya dobel), melainkan 'unknown'.

import {
  canTransition,
  isTerminal,
  messageForError,
  printResult,
  statusForError,
  transition,
} from '../../src/printing/PrintJobStateMachine';
import {
  TRANSPORT_REGISTRY,
  isTransportSupported,
  transportSupport,
} from '../../src/printing/PrinterRegistry';
import type { PrintJobStatus } from '../../src/types/printing';

it('alur bahagia: queued → connecting → sending → submitted', () => {
  expect(canTransition('queued', 'connecting')).toBe(true);
  expect(canTransition('connecting', 'sending')).toBe(true);
  expect(canTransition('sending', 'submitted')).toBe(true);

  let s: PrintJobStatus = 'queued';
  s = transition(s, 'connecting');
  s = transition(s, 'sending');
  s = transition(s, 'submitted');
  expect(s).toBe('submitted');
});

it('transisi melompat ditolak — queued tidak bisa langsung submitted', () => {
  expect(canTransition('queued', 'submitted')).toBe(false);
  expect(canTransition('queued', 'sending')).toBe(false);
  expect(() => transition('queued', 'submitted')).toThrow(/tidak sah/);
});

it('gagal saat menyambung: connecting → failed (belum ada byte terkirim)', () => {
  expect(canTransition('connecting', 'failed')).toBe(true);
  expect(canTransition('connecting', 'unknown')).toBe(true);
});

it('status akhir tidak bisa berpindah lagi', () => {
  for (const terminal of [
    'submitted',
    'failed',
    'unknown',
    'cancelled',
  ] as PrintJobStatus[]) {
    expect(isTerminal(terminal)).toBe(true);
    expect(canTransition(terminal, 'queued')).toBe(false);
    expect(canTransition(terminal, 'sending')).toBe(false);
  }
});

it('job masih berjalan bukan status akhir', () => {
  expect(isTerminal('queued')).toBe(false);
  expect(isTerminal('connecting')).toBe(false);
  expect(isTerminal('sending')).toBe(false);
});

it('pembatalan hanya boleh sebelum transmisi dimulai', () => {
  expect(canTransition('queued', 'cancelled')).toBe(true);
  expect(canTransition('connecting', 'cancelled')).toBe(true);
  // Setelah byte mulai keluar, job tidak bisa dibatalkan begitu saja.
  expect(canTransition('sending', 'cancelled')).toBe(false);
});

// ── Inti keamanan: hasil ambigu tidak boleh jadi 'failed' ──────────────────
it('error setelah transmisi mulai → unknown, bukan failed', () => {
  expect(statusForError('CONNECTION_RESET', true)).toBe('unknown');
  expect(statusForError('WRITE_FAILED', true)).toBe('unknown');
  expect(statusForError('CONNECTION_LOST_DURING_SEND', true)).toBe('unknown');
});

it('error sebelum transmisi mulai → failed', () => {
  expect(statusForError('UNREACHABLE_HOST', false)).toBe('failed');
  expect(statusForError('CONNECTION_REFUSED', false)).toBe('failed');
  expect(statusForError('CONNECTION_TIMEOUT', false)).toBe('failed');
  expect(statusForError('INVALID_CONFIG', false)).toBe('failed');
});

it('transport tidak didukung langsung failed, tidak menggantung di queued', () => {
  expect(statusForError('TRANSPORT_UNSUPPORTED', false)).toBe('failed');
});

it('setiap kode error punya pesan bahasa Indonesia yang tidak kosong', () => {
  const codes = [
    'INVALID_CONFIG',
    'PERMISSION_DENIED',
    'UNREACHABLE_HOST',
    'CONNECTION_TIMEOUT',
    'CONNECTION_REFUSED',
    'CONNECTION_RESET',
    'CONNECTION_LOST_DURING_SEND',
    'WRITE_FAILED',
    'TRANSPORT_UNSUPPORTED',
    'UNKNOWN_TRANSPORT_ERROR',
  ] as const;

  for (const code of codes) {
    const message = messageForError(code);
    expect(message.length).toBeGreaterThan(0);
    // Pesan mentah kode error tidak boleh bocor ke kasir.
    expect(message).not.toBe(code);
  }
});

it('printResult menyertakan error lengkap saat ada kode error', () => {
  const ok = printResult('job-1', 'submitted');
  expect(ok.error).toBeUndefined();

  const bad = printResult('job-2', 'unknown', 'CONNECTION_RESET', true);
  expect(bad.jobId).toBe('job-2');
  expect(bad.status).toBe('unknown');
  expect(bad.error?.code).toBe('CONNECTION_RESET');
  expect(bad.error?.transmissionStarted).toBe(true);
  expect(bad.error?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

// ── Registry transport (PRD §20.18) ────────────────────────────────────────
it('hanya LAN yang didukung; BLE dan USB jujur dinyatakan tidak didukung', () => {
  expect(isTransportSupported('lan')).toBe(true);
  expect(isTransportSupported('bluetooth')).toBe(false);
  expect(isTransportSupported('usb')).toBe(false);
});

it('setiap entri transport punya alasan yang bisa ditampilkan ke pengguna', () => {
  expect(TRANSPORT_REGISTRY).toHaveLength(3);
  for (const entry of TRANSPORT_REGISTRY) {
    expect(entry.reason.length).toBeGreaterThan(10);
  }
  expect(transportSupport('bluetooth').reason).toMatch(/Belum didukung/);
});
