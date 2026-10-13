// src/printing/TsplTemplate.ts
// Template label produk untuk printer label TSPL/TSPL2 (mis. Blueprint
// BP-TR110, 20×30mm). FUNGSI MURNI — tanpa import React Native.
//
// Beda mendasar dari EscPosRenderer: TSPL bukan stream byte ESC/POS, tapi
// skrip teks baris-perintah ("SIZE", "TEXT", "PRINT"), dikirim mentah lewat
// socket TCP yang sama. Karena itu renderer ini berdiri sendiri.
//
// ATURAN: renderer tidak menghitung apa pun. Varian & notes datang apa adanya
// dari payload order. Satu job = satu label.

import { queueLabel } from './queueNumber';
import type { LabelOrder } from '../types/printing';
import {
  LABEL_GAP_MM,
  LABEL_HEIGHT_MM,
  LABEL_WIDTH_MM,
} from '../types/printing';

/** Encoder UTF-8 (Hermes/RN & Jest Node menyediakan TextEncoder global). */
declare const TextEncoder: new (...args: unknown[]) => {
  encode(input?: string): Uint8Array;
};
const encoder = new TextEncoder();

/** Lebar pakai titik (dots) @203dpi. 1mm ≈ 8 dots pada BP-TR110. */
const DOTS_PER_MM = 8;
const LABEL_WIDTH_DOTS = LABEL_WIDTH_MM * DOTS_PER_MM;

/** Font TSPL: "1" (kecil) .. "5" (besar), terbatas ROM font printer. */
const FONT_NAME = '3';
const FONT_VARIANT = '2';
const FONT_NOTE = '1';
/** Lebar rata-rata glyph font "2"/"3" (dots) — untuk hitung margin kiri. */
const CHAR_W_NAME = 16;
const CHAR_W_VARIANT = 12;
const CHAR_W_NOTE = 8;

/** TSPL string field: tanda kutip di dalam teks harus di-escape backslash. */
function tsplString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Potong/isi teks ke lebar maxChars, tanpa memecah di tengah kata bila bisa. */
function wrapText(value: string, maxChars: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of value.split(/\s+/).filter(Boolean)) {
    if (line === '') {
      line = word;
    } else if (line.length + 1 + word.length <= maxChars) {
      line += ' ' + word;
    } else {
      out.push(line);
      line = word;
    }
    // Kata tunggal lebih panjang dari baris → pecah paksa.
    while (line.length > maxChars) {
      out.push(line.slice(0, maxChars));
      line = line.slice(maxChars);
    }
  }
  if (line !== '') {
    out.push(line);
  }
  return out;
}

/** X supaya teks terpusat selebar label. */
function centeredX(text: string, charWidth: number): number {
  const textWidth = text.length * charWidth;
  return Math.max(0, Math.floor((LABEL_WIDTH_DOTS - textWidth) / 2));
}

/**
 * Bangun skrip TSPL untuk satu label produk.
 *
 * Susunan (atas → bawah): nomor antrian (kalau `noreceipt` berpola
 * `INV-YYYYMMDD-N`), nama produk (font terbesar), varian, notes, nama
 * pelanggan. Tinggi label 30mm = 240 dots @203dpi. Varian/notes yang
 * kepanjangan dipotong di batas baris (TSPL tidak punya overflow otomatis).
 */
export function buildLabel(order: LabelOrder): Uint8Array {
  const lines: string[] = [
    `SIZE ${LABEL_WIDTH_MM} mm,${LABEL_HEIGHT_MM} mm`,
    `GAP ${LABEL_GAP_MM} mm,0`,
    'DIRECTION 1',
    'CLS',
  ];

  let y = 6;

  // ── Antrian (opsional) ─────────────────────────────────────────────────────
  // Nomor datang dari `noreceipt` (INV-YYYYMMDD-N). Receipt gaya lama seperti
  // "SPZ-777" tidak cocok pola → blok hilang, bukan mencetak "#null".
  const antrian = queueLabel(order.noreceipt);
  if (antrian) {
    lines.push(
      `TEXT ${centeredX(antrian, CHAR_W_NOTE)},${y},${tsplString(FONT_NOTE)},0,1,1,${tsplString(antrian)}`,
    );
    y += 16;
  }

  // ── Nama produk ────────────────────────────────────────────────────────────
  // Satu label = satu porsi: penanda "2x" sudah dihapus dari renderer. Kuantitas
  // di-expand di WebView (lib/label-items.ts) jadi label terpisah, jadi
  // `order.quantity` sengaja diabaikan di sini.
  const nameMax = Math.max(1, Math.floor((LABEL_WIDTH_DOTS - 8) / CHAR_W_NAME));
  const nameLines = wrapText(order.menuName, nameMax).slice(0, 2);
  for (const line of nameLines) {
    lines.push(
      `TEXT ${centeredX(line, CHAR_W_NAME)},${y},${tsplString(FONT_NAME)},0,1,1,${tsplString(line)}`,
    );
    y += 30;
  }

  // ── Varian ─────────────────────────────────────────────────────────────────
  if (order.variant && order.variant.trim()) {
    const variantMax = Math.max(
      1,
      Math.floor((LABEL_WIDTH_DOTS - 8) / CHAR_W_VARIANT),
    );
    for (const line of wrapText(order.variant.trim(), variantMax).slice(0, 2)) {
      lines.push(
        `TEXT ${centeredX(line, CHAR_W_VARIANT)},${y},${tsplString(FONT_VARIANT)},0,1,1,${tsplString(line)}`,
      );
      y += 22;
    }
  }

  // ── Notes order item ───────────────────────────────────────────────────────
  if (order.note && order.note.trim()) {
    const noteMax = Math.max(
      1,
      Math.floor((LABEL_WIDTH_DOTS - 8) / CHAR_W_NOTE),
    );
    // Dibatasi 2 baris: tinggi label 240 dots sudah dipakai antrian, nama,
    // varian, dan nama pelanggan.
    for (const line of wrapText(order.note.trim(), noteMax).slice(0, 2)) {
      lines.push(
        `TEXT 4,${y},${tsplString(FONT_NOTE)},0,1,1,${tsplString(line)}`,
      );
      y += 16;
    }
  }

  // ── Nama pelanggan ─────────────────────────────────────────────────────────
  if (order.customerName && order.customerName.trim()) {
    const customerMax = Math.max(
      1,
      Math.floor((LABEL_WIDTH_DOTS - 8) / CHAR_W_NOTE),
    );
    for (const line of wrapText(order.customerName.trim(), customerMax).slice(0, 2)) {
      lines.push(
        `TEXT ${centeredX(line, CHAR_W_NOTE)},${y},${tsplString(FONT_NOTE)},0,1,1,${tsplString(line)}`,
      );
      y += 16;
    }
  }

  lines.push('PRINT 1,1');

  // TSPL dikirim sebagai teks CRLF — printer membaca baris per baris.
  return encoder.encode(lines.join('\r\n') + '\r\n');
}
