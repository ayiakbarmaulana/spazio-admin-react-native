// src/printing/bleProfiles.ts
// Profil BLE printer thermal. FUNGSI MURNI — tanpa import React Native.
//
// Port dari spazio-admin/lib/thermal-print.ts (§Konstanta BLE). Nilai UUID di
// bawah INI BERASAL DARI KODE YANG SUDAH TERBUKTI JALAN di PWA (Web Bluetooth)
// dengan printer kasir nyata — jangan diubah tanpa mencetak di perangkat.
//
// Kenapa BLE, bukan Bluetooth Classic SPP: PWA lama mencetak lewat
// navigator.bluetooth (Web Bluetooth), dan Web Bluetooth HANYA bisa BLE/GATT.
// Printer yang jalan di sana karena itu pasti printer BLE, bukan SPP.

/** UUID layanan ISSC "Transparent UART" — chip Beken, paling umum di printer thermal BLE murah. */
export const ISSC_SERVICE = '49535343-fe7d-4ae5-8fa9-9fafd205e455';
/** Karakteristik RX printer (arah tulis: app → printer). */
export const ISSC_RX = '49535343-8841-43f4-a8d4-ecbe34729bb3';
/** Karakteristik TX printer (notify: printer → app). */
export const ISSC_TX = '49535343-1e4d-4bd9-ba61-23c647249616';

/**
 * Layanan kandidat, urut dari yang paling sering ditemui. Dipakai saat mencari
 * karakteristik tulis kalau ISSC tidak ada.
 */
export const CANDIDATE_SERVICES: readonly string[] = [
  ISSC_SERVICE,
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000eee0-0000-1000-8000-00805f9b34fb',
];

/**
 * Ukuran MTU yang diminta setelah connect. 247 = hasil negosiasi yang biasanya
 * tercapai di Android; gagal requestMTU bukan error fatal.
 */
export const REQUESTED_MTU = 247;

/**
 * Ukuran potongan tulis. Mulai 180 byte (aman di bawah MTU 247 minus overhead
 * ATT); kalau gagal, turun ke 20 byte — ukuran bawaan BLE yang selalu diterima.
 */
export const CHUNK_SIZE_BYTES = 180;
export const FALLBACK_CHUNK_SIZE_BYTES = 20;
/** Jeda antar potongan. Printer murah kehilangan data kalau ditulis berturut-turut. */
export const CHUNK_DELAY_MS = 15;

/**
 * Nama yang biasanya dipakai printer thermal. Dipakai untuk memilih perangkat
 * yang sudah dipasangkan saat lebih dari satu perangkat terdeteksi.
 */
export const PRINTER_NAME_HINT = /printer|tm|pos|rpp|ep58|mtp/i;
