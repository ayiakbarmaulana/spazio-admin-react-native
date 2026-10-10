// src/printing/PrinterRegistry.ts
// Registry jenis koneksi. FUNGSI MURNI.
//
// PRD §20.18: Bluetooth/USB TIDAK dibuatkan stub yang berpura-pura jalan.
// Entri di bawah ini jujur menyatakan "unsupported" supaya UI bisa
// menyembunyikannya, bukan menampilkan tombol yang selalu gagal.

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
    supported: false,
    reason:
      'Belum didukung. Firmware printer BLE tidak menerima ESC/POS mentah ' +
      'dari Android tanpa handshake vendor.',
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
