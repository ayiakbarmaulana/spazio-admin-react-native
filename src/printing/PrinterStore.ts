// src/printing/PrinterStore.ts
// Penyimpanan konfigurasi printer. AsyncStorage — bukan SQLite — karena isinya
// kecil, dibaca di setiap startup, dan tidak butuh query relasional.
//
// ATURAN KEAMANAN: host/port printer tidak pernah diambil dari bridge WebView.
// Hanya pengguna (lewat layar Pengaturan Printer) yang bisa mengubahnya.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PrinterConfig } from '../types/printing';
import { newId } from '../utils/id';
import { assertPrinterConfig } from './validatePrinterConfig';

const KEY = 'spazio.printers.v1';

/** Baca semua printer. Mengembalikan [] kalau belum ada / data rusak. */
export async function listPrinters(): Promise<PrinterConfig[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    // Data rusak dikembalikan sebagai kosong, bukan melempar — app harus tetap
    // bisa dibuka supaya pengguna bisa mendaftar ulang printernya.
    if (!Array.isArray(parsed)) {
      return [];
    }
    // Printer lama belum punya `protocol`. Tanpa default ini, dispatcher akan
    // melempar saat render karena `printer.protocol` undefined.
    return (parsed as PrinterConfig[]).map(p => ({
      ...p,
      protocol: p.protocol ?? 'escpos',
    }));
  } catch {
    return [];
  }
}

async function saveAll(printers: PrinterConfig[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(printers));
}

export async function getPrinter(id: string): Promise<PrinterConfig | null> {
  const all = await listPrinters();
  return all.find(p => p.id === id) ?? null;
}

/** Printer aktif untuk sebuah tujuan (struk / tiket dapur). */
export async function findPrinterForDestination(
  destination: PrinterConfig['destinations'][number],
): Promise<PrinterConfig | null> {
  const all = await listPrinters();
  return (
    all.find(p => p.enabled && p.destinations.includes(destination)) ?? null
  );
}

export type PrinterInput = Omit<PrinterConfig, 'id' | 'createdAt' | 'updatedAt'>;

/** Tambah printer. Validasi dulu, baru simpan. */
export async function addPrinter(input: PrinterInput): Promise<PrinterConfig> {
  assertPrinterConfig(input);
  const now = new Date().toISOString();
  const printer: PrinterConfig = {
    ...input,
    protocol: input.protocol ?? 'escpos',
    id: newId('prn'),
    createdAt: now,
    updatedAt: now,
  };
  const all = await listPrinters();
  await saveAll([...all, printer]);
  return printer;
}

/** Ubah printer. Melempar kalau id tidak ada. */
export async function updatePrinter(
  id: string,
  patch: Partial<PrinterInput>,
): Promise<PrinterConfig> {
  const all = await listPrinters();
  const index = all.findIndex(p => p.id === id);
  if (index === -1) {
    throw new Error(`Printer tidak ditemukan: ${id}`);
  }
  const merged: PrinterConfig = {
    ...all[index],
    ...patch,
    id,
    updatedAt: new Date().toISOString(),
  };
  assertPrinterConfig(merged);
  all[index] = merged;
  await saveAll(all);
  return merged;
}

export async function removePrinter(id: string): Promise<void> {
  const all = await listPrinters();
  await saveAll(all.filter(p => p.id !== id));
}
