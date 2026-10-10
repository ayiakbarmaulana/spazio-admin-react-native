// __tests__/unit/validation-and-backoff.test.ts
// Validasi konfigurasi printer (trust boundary sebelum alamat masuk ke driver
// TCP) dan backoff sinkronisasi. Keduanya fungsi murni.

import {
  isValidIpv4,
  validatePrinterConfig,
} from '../../src/printing/validatePrinterConfig';
import { backoffDelay, nextAttemptAt } from '../../src/networking/backoff';
import { classifyTransportError } from '../../src/printing/transportErrors';

// ── Validasi alamat ─────────────────────────────────────────────────────────
it('IPv4 sah diterima, termasuk hostname LAN sederhana', () => {
  expect(isValidIpv4('192.168.1.50')).toBe(true);
  expect(isValidIpv4('10.0.0.1')).toBe(true);
  expect(isValidIpv4('0.0.0.0')).toBe(true);
  expect(isValidIpv4('255.255.255.255')).toBe(true);
});

it('IPv4 tidak sah ditolak: oktet > 255, leading zero, dan teks bebas', () => {
  expect(isValidIpv4('256.1.1.1')).toBe(false);
  // "01" dibaca sebagian printer sebagai oktal → ditolak.
  expect(isValidIpv4('192.168.01.1')).toBe(false);
  expect(isValidIpv4('192.168.1')).toBe(false);
  expect(isValidIpv4('printer.local')).toBe(false);
  expect(isValidIpv4('')).toBe(false);
  expect(isValidIpv4('http://192.168.1.1')).toBe(false);
});

it('konfigurasi printer yang wajar tidak menghasilkan error', () => {
  expect(
    validatePrinterConfig({
      name: 'Printer Kasir',
      connectionType: 'lan',
      host: '192.168.1.50',
      port: 9100,
      destinations: ['customer_receipt'],
    }),
  ).toEqual([]);

  // Hostname LAN juga sah, tanpa port (default dipakai).
  expect(
    validatePrinterConfig({
      name: 'Printer Dapur',
      connectionType: 'lan',
      host: 'printer-dapur.local',
      port: undefined,
      destinations: ['kitchen_ticket'],
    }),
  ).toEqual([]);
});

it('host tidak sah ditolak dengan pesan yang menyebut nilainya', () => {
  const errors = validatePrinterConfig({
    name: 'Printer',
    connectionType: 'lan',
    host: 'http://192.168.1.50:9100',
    port: 9100,
    destinations: ['customer_receipt'],
  });

  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatch(/tidak sah/);
});

it('port di luar 1-65535 ditolak', () => {
  const base = {
    name: 'Printer',
    connectionType: 'lan' as const,
    host: '192.168.1.50',
    destinations: ['customer_receipt' as const],
  };

  expect(validatePrinterConfig({ ...base, port: 0 })).toHaveLength(1);
  expect(validatePrinterConfig({ ...base, port: 70000 })).toHaveLength(1);
  expect(validatePrinterConfig({ ...base, port: 9100 })).toEqual([]);
});

it('nama kosong dan tujuan kosong sama-sama ditolak', () => {
  const errors = validatePrinterConfig({
    name: '   ',
    connectionType: 'lan',
    host: '192.168.1.50',
    port: 9100,
    destinations: [],
  });

  expect(errors.some(e => /Nama printer/.test(e))).toBe(true);
  expect(errors.some(e => /minimal satu tujuan/.test(e))).toBe(true);
});

it('jenis koneksi yang tidak didukung ditolak, bukan disimpan diam-diam', () => {
  const errors = validatePrinterConfig({
    name: 'Printer BLE',
    connectionType: 'bluetooth',
    destinations: ['customer_receipt'],
  });

  expect(errors.some(e => /belum didukung/.test(e))).toBe(true);
});

// ── Backoff ─────────────────────────────────────────────────────────────────
it('backoff tumbuh eksponensial dan dibatasi maxMs', () => {
  // random() = 1 selalu → ambil batas atas, jadi pertumbuhannya terlihat.
  const alwaysMax = () => 0.999;

  const d0 = backoffDelay(0, { baseMs: 1000, maxMs: 60_000, random: alwaysMax });
  const d1 = backoffDelay(1, { baseMs: 1000, maxMs: 60_000, random: alwaysMax });
  const d2 = backoffDelay(2, { baseMs: 1000, maxMs: 60_000, random: alwaysMax });

  expect(d0).toBeLessThan(d1);
  expect(d1).toBeLessThan(d2);

  // Percobaan ke-20 tetap dibatasi maxMs.
  const far = backoffDelay(20, {
    baseMs: 1000,
    maxMs: 60_000,
    random: alwaysMax,
  });
  expect(far).toBeLessThan(60_000);
});

it('backoff memakai jitter — dua panggilan dengan acak berbeda hasilnya beda', () => {
  const low = backoffDelay(3, {
    baseMs: 1000,
    maxMs: 60_000,
    random: () => 0.1,
  });
  const high = backoffDelay(3, {
    baseMs: 1000,
    maxMs: 60_000,
    random: () => 0.9,
  });

  expect(low).toBeLessThan(high);
});

it('backoff tidak pernah negatif', () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const delay = backoffDelay(attempt, {
      baseMs: 100,
      maxMs: 5000,
      random: () => 0,
    });
    expect(delay).toBeGreaterThanOrEqual(0);
  }
});

it('nextAttemptAt menghasilkan waktu ISO di masa depan', () => {
  const now = Date.parse('2026-09-27T10:00:00.000Z');
  const next = nextAttemptAt(2, {
    baseMs: 1000,
    maxMs: 60_000,
    random: () => 0.5,
  }, now);

  expect(next).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(Date.parse(next)).toBeGreaterThan(now);
});

// ── Klasifikasi error transport ────────────────────────────────────────────
it('kode error socket diklasifikasikan ke taksonomi kita', () => {
  expect(classifyTransportError(new Error('connect ECONNREFUSED'))).toBe(
    'CONNECTION_REFUSED',
  );
  expect(classifyTransportError(new Error('connect ETIMEDOUT'))).toBe(
    'CONNECTION_TIMEOUT',
  );
  expect(classifyTransportError(new Error('write EPIPE'))).toBe(
    'CONNECTION_RESET',
  );
  expect(classifyTransportError(new Error('ENETUNREACH'))).toBe(
    'UNREACHABLE_HOST',
  );
  expect(classifyTransportError(new Error('socket EPIPE'))).toBe(
    'CONNECTION_RESET',
  );
  expect(classifyTransportError(new Error('sesuatu aneh'))).toBe(
    'UNKNOWN_TRANSPORT_ERROR',
  );
});

it('classifyTransportError juga menerima nilai non-Error', () => {
  expect(classifyTransportError('ECONNREFUSED')).toBe('CONNECTION_REFUSED');
  expect(classifyTransportError(null)).toBe('UNKNOWN_TRANSPORT_ERROR');
});
