// src/printing/settings.ts
// Preferensi cetak tingkat aplikasi. AsyncStorage, bukan SQLite — jumlahnya
// sedikit dan selalu dibaca utuh.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'spazio.printSettings.v1';

export type PrintSettings = {
  /** Cetak 3 salinan struk (customer/management/arsip) atau hanya 1. */
  receiptCopies: 1 | 3;
  /** Cetak tiket dapur otomatis saat order masuk. */
  autoPrintKitchenTicket: boolean;
  /** Cetak struk otomatis saat order lunas. */
  autoPrintReceipt: boolean;
  /** Batas percobaan ulang otomatis untuk job yang gagal. */
  maxAutoRetries: number;
};

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  receiptCopies: 3,
  autoPrintKitchenTicket: true,
  autoPrintReceipt: true,
  // 0 = tidak ada retry otomatis. Cetak ulang adalah keputusan kasir: printer
  // yang gagal karena habis kertas akan gagal lagi kalau diulang sendiri, dan
  // kasir tidak sadar struknya belum keluar.
  maxAutoRetries: 0,
};

export async function loadPrintSettings(): Promise<PrintSettings> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) {
    return { ...DEFAULT_PRINT_SETTINGS };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PrintSettings>;
    return { ...DEFAULT_PRINT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_PRINT_SETTINGS };
  }
}

export async function savePrintSettings(
  patch: Partial<PrintSettings>,
): Promise<PrintSettings> {
  const current = await loadPrintSettings();
  const next: PrintSettings = { ...current, ...patch };
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
