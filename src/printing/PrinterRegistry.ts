// src/printing/PrinterRegistry.ts
// Registry jenis koneksi. FUNGSI MURNI.
//
// PRD §20.18: USB TIDAK dibuatkan stub yang berpura-pura jalan. Entri di bawah
// ini jujur menyatakan "unsupported" supaya UI bisa menyembunyikannya, bukan
// menampilkan tombol yang selalu gagal.
//
// Bluetooth didukung lewat BLE/GATT (react-native-ble-plx). Jalur ini port dari
// Web Bluetooth yang dulu dipakai PWA — lihat bleProfiles.ts.

import type { PrinterConnectionType } from '../types/printing';

export type TransportSupport = {
  type: PrinterConnectionType;
  supported: boolean;
  /** Alasan singkat untuk UI (bahasa Indonesia). */
  reason: string;
};

export const TRANSPORT_REGISTRY: readonly TransportSupport[] = [
  {
    type: 'lan',
    supported: true,
    reason: 'Didukung lewat TCP ke port printer.',
  },
  {
    type: 'bluetooth',
    supported: true,
    reason:
      'Didukung lewat Bluetooth LE (GATT). Printer harus sudah dipasangkan ' +
      '(paired) di Pengaturan Bluetooth Android.',
  },
  {
    type: 'usb',
    supported: false,
    reason: 'Belum didukung. Butuh driver USB host per model printer.',
  },
];

export function isTransportSupported(type: PrinterConnectionType): boolean {
  return TRANSPORT_REGISTRY.some(t => t.type === type && t.supported);
}

export function transportSupport(type: PrinterConnectionType): TransportSupport {
  const found = TRANSPORT_REGISTRY.find(t => t.type === type);
  if (!found) {
    throw new Error(`Jenis koneksi tidak dikenal: ${type}`);
  }
  return found;
}
