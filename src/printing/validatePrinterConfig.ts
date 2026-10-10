// src/printing/validatePrinterConfig.ts
// Validasi konfigurasi printer. Fungsi murni — dipakai store DAN form.
//
// Ini trust boundary: host/port yang salah tidak merusak apa pun, tapi alamat
// yang lolos ke driver TCP bisa bikin app menggantung sampai timeout. Lebih
// baik ditolak di form.

import type { PrintDestination, PrinterConfig } from '../types/printing';
import { DEFAULT_LAN_PORT } from '../types/printing';
import { isTransportSupported } from './PrinterRegistry';

export type ConfigInput = Pick<
  PrinterConfig,
  'name' | 'connectionType' | 'host' | 'port' | 'destinations'
>;

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
/** Nama host LAN sederhana, mis. "printer-kasir" atau "epson.local". */
const HOSTNAME = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9-]+)*$/;

/** true kalau `host` alamat IPv4 yang sah (setiap oktet 0-255). */
export function isValidIpv4(host: string): boolean {
  const m = host.match(IPV4);
  if (!m) {
    return false;
  }
  return m.slice(1).every(part => {
    const n = Number(part);
    // "01" dan "007" ditolak: beberapa printer/OS membacanya sebagai oktal.
    return String(n) === part && n >= 0 && n <= 255;
  });
}

/**
 * Kumpulkan masalah konfigurasi. Array kosong = sah.
 * Dikembalikan sebagai daftar pesan (bukan boolean) supaya form bisa
 * menampilkan tepat apa yang salah.
 */
export function validatePrinterConfig(input: ConfigInput): string[] {
  const errors: string[] = [];

  if (!input.name || input.name.trim().length === 0) {
    errors.push('Nama printer wajib diisi.');
  }
  if (input.name && input.name.trim().length > 40) {
    errors.push('Nama printer maksimal 40 karakter.');
  }

  if (!isTransportSupported(input.connectionType)) {
    errors.push(
      `Jenis koneksi "${input.connectionType}" belum didukung. Gunakan LAN.`,
    );
  }

  if (input.destinations.length === 0) {
    errors.push('Pilih minimal satu tujuan cetak (struk atau tiket dapur).');
  }

  const uniqueDestinations = new Set<PrintDestination>(input.destinations);
  if (uniqueDestinations.size !== input.destinations.length) {
    errors.push('Tujuan cetak tidak boleh duplikat.');
  }

  if (input.connectionType === 'lan') {
    const host = (input.host ?? '').trim();
    if (!host) {
      errors.push('Alamat IP printer wajib diisi.');
    } else if (!isValidIpv4(host) && !HOSTNAME.test(host)) {
      errors.push(`Alamat printer tidak sah: ${host}`);
    }

    const port = input.port ?? DEFAULT_LAN_PORT;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push('Port harus bilangan bulat antara 1 dan 65535.');
    }
  }

  return errors;
}

/** Lempar kalau konfigurasi tidak sah. Dipakai sebelum menyimpan. */
export function assertPrinterConfig(input: ConfigInput): void {
  const errors = validatePrinterConfig(input);
  if (errors.length > 0) {
    throw new Error(`Konfigurasi printer tidak sah: ${errors.join(' ')}`);
  }
}
