// src/printing/validatePrinterConfig.ts
// Validasi konfigurasi printer. Fungsi murni — dipakai store DAN form.
//
// Ini trust boundary: host/port yang salah tidak merusak apa pun, tapi alamat
// yang lolos ke driver TCP bisa bikin app menggantung sampai timeout. Lebih
// baik ditolak di form.

import type {
  PrintDestination,
  PrinterConfig,
  PrinterProtocol,
} from '../types/printing';
import { DEFAULT_LAN_PORT, isLabelProtocol } from '../types/printing';
import { isTransportSupported } from './PrinterRegistry';

export type ConfigInput = Pick<
  PrinterConfig,
  'name' | 'connectionType' | 'host' | 'port' | 'destinations'
> &
  /** Protokol opsional supaya pemanggil lama (tanpa protocol) tetap type-check. */
  Partial<Pick<PrinterConfig, 'protocol'>> &
  /** Bluetooth opsional supaya pemanggil lama (tanpa BT) tetap type-check. */
  Partial<Pick<PrinterConfig, 'bluetooth'>>;

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
/** Nama host LAN sederhana, mis. "printer-kasir" atau "epson.local". */
const HOSTNAME = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9-]+)*$/;
/** MAC address (id perangkat BLE di Android). */
const MAC = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
/** Id perangkat BLE iOS: UUID yang dibuat OS, bukan MAC. */
const IOS_DEVICE_UUID =
  /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

/** true kalau `deviceId` alamat perangkat BLE yang bentuknya dikenal. */
export function isValidBluetoothDeviceId(deviceId: string): boolean {
  return MAC.test(deviceId) || IOS_DEVICE_UUID.test(deviceId);
}

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
    errors.push('Pilih minimal satu tujuan cetak.');
  }

  const uniqueDestinations = new Set<PrintDestination>(input.destinations);
  if (uniqueDestinations.size !== input.destinations.length) {
    errors.push('Tujuan cetak tidak boleh duplikat.');
  }

  // Protokol menentukan bahasa perintah. Label 20×30mm butuh TSPL atau ZPL —
  // ESC/POS tidak punya mode label, jadi kombinasi ini PASTI salah cetak
  // (printer meng-ack job lalu tidak ada kertas keluar).
  const protocol: PrinterProtocol = input.protocol ?? 'escpos';
  const wantsLabel = input.destinations.includes('label');
  const labelProtocol = isLabelProtocol(protocol);
  if (wantsLabel && !labelProtocol) {
    errors.push(
      'Tujuan Label butuh protokol TSPL atau ZPL. Pilih TSPL (BP-TR110) atau ZPL (Zebra/Argox) di bagian Protokol.',
    );
  }
  if (labelProtocol && !wantsLabel) {
    errors.push(
      `Printer ${protocol.toUpperCase()} hanya melayani tujuan Label. Centang tujuan Label atau ubah protokol ke ESC/POS.`,
    );
  }
  // Printer label dikirim lewat LAN/USB. Jalur BLE dipakai untuk ESC/POS —
  // jangan janjikan jalan lewat Bluetooth.
  if (labelProtocol && input.connectionType === 'bluetooth') {
    errors.push(
      `Printer label ${protocol.toUpperCase()} belum didukung lewat Bluetooth. Gunakan LAN.`,
    );
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

  if (input.connectionType === 'bluetooth') {
    const deviceId = input.bluetooth?.deviceId?.trim();
    // deviceId opsional: kosong = driver memilih printer terpasang sendiri.
    // Yang wajib hanya bentuknya benar kalau diisi.
    if (deviceId && !isValidBluetoothDeviceId(deviceId)) {
      errors.push(
        `Alamat perangkat Bluetooth tidak sah: ${deviceId}. ` +
          'Contoh yang benar: AA:BB:CC:DD:EE:FF.',
      );
    }
    // Tujuan dapur butuh printer sendiri; satu printer BLE hanya melayani satu
    // koneksi — biarkan tetap boleh, tapi jangan pernah kosong.
    for (const uuid of [
      input.bluetooth?.serviceUuid,
      input.bluetooth?.characteristicUuid,
    ]) {
      if (uuid !== undefined && uuid.trim() !== '' && !IOS_DEVICE_UUID.test(uuid.trim())) {
        errors.push(`UUID Bluetooth tidak sah: ${uuid}`);
      }
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
