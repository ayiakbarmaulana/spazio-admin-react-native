// src/printing/ZplTemplate.ts
// Template label produk untuk printer ZPL II (Zebra, Argox ZPL mode, TSC ZPL,
// dsb) ukuran 20×30mm. FUNGSI MURNI — tanpa import React Native.
//
// Beda dari TsplTemplate: ZPL adalah satu aliran perintah diawali `^XA` dan
// diakhiri `^XZ`. Tidak ada baris "PRINT" — printer langsung mencetak saat
// `^XZ` diterima. Dikirim mentah lewat socket TCP port yang sama (9100).
//
// ATURAN: renderer tidak menghitung apa pun. Varian & notes datang apa adanya
// dari payload order. Satu job = satu label.

import type { LabelOrder } from '../types/printing';
import { LABEL_HEIGHT_MM, LABEL_WIDTH_MM } from '../types/printing';

/** Encoder UTF-8 (Hermes/RN & Jest Node menyediakan TextEncoder global). */
declare const TextEncoder: new (...args: unknown[]) => {
  encode(input?: string): Uint8Array;
};
const encoder = new TextEncoder();

/** ZPL menghitung dalam dots. 203dpi → 8 dots/mm. */
const DOTS_PER_MM = 8;

/**
 * Sumbu ZPL pada BP-TR110 berbeda dari TSPL. Media 20×30mm dimuat dengan sisi
 * 30mm **melintang kepala cetak**, jadi X = 30mm (lebar cetak = 240 dots) dan
 * Y = 20mm (panjang feed = 160 dots). TSPL memakai `SIZE 20 mm,30 mm` — jangan
 * disamakan dengan ZPL.
 *
 * Terverifikasi di printer fisik: label uji `^PW240 ^LL160` tegak, terbaca, dan
 * tidak terpotong; `^PW160 ^LL240` (kebalikannya) terbalik + terpotong.
 */
const ZPL_PRINT_WIDTH_DOTS = LABEL_HEIGHT_MM * DOTS_PER_MM;
const ZPL_PRINT_LENGTH_DOTS = LABEL_WIDTH_MM * DOTS_PER_MM;

/** Jarak aman dari tepi: konten tidak boleh menempel tepi label. */
const TOP_MARGIN_DOTS = 40;
const BOTTOM_MARGIN_DOTS = 40;

/**
 * Font scalable `A0` (device-independent). Glyph A0 ≈ ½ tinggi nominal per
 * karakter — cukup untuk label 20×30mm berisi 1–2 baris nama produk.
 */
const FONT_NAME = { height: 26, width: 26 };
const FONT_VARIANT = { height: 18, width: 18 };
const FONT_NOTE = { height: 14, width: 14 };

/** Escaping ZPL: `^` dan `~` adalah pengontrol, harus dilipat-gandakan. */
function zplField(value: string): string {
  return value.replace(/\^/g, '^^').replace(/~/g, '^~');
}

/** Batas karakter per baris untuk font scalable A0 (1 char ≈ ½ lebar nominal). */
function maxChars(font: { height: number; width: number }): number {
  return Math.max(1, Math.floor((ZPL_PRINT_WIDTH_DOTS - 8) / (font.width / 2)));
}

function wrapText(value: string, limit: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of value.split(/\s+/).filter(Boolean)) {
    if (line === '') {
      line = word;
    } else if (line.length + 1 + word.length <= limit) {
      line += ' ' + word;
    } else {
      out.push(line);
      line = word;
    }
    // Kata tunggal lebih panjang dari baris → pecah paksa.
    while (line.length > limit) {
      out.push(line.slice(0, limit));
      line = line.slice(limit);
    }
  }
  if (line !== '') {
    out.push(line);
  }
  return out;
}

/**
 * Field teks ZPL: `^FO` posisi, `^FB` blok terpusat dengan batas baris, lalu
 * `^FD` isi dan `^FS` penutup. `^FB` menangani wrapping & centering di printer,
 * jadi tidak ada perhitungan X di sisi app.
 */
function field(
  x: number,
  y: number,
  font: { height: number; width: number },
  text: string,
  maxLines: number,
): string {
  return (
    `^FO${x},${y}^A0N,${font.height},${font.width}` +
    `^FB${ZPL_PRINT_WIDTH_DOTS},${maxLines},0,C,0^FD${zplField(text)}^FS`
  );
}

/**
 * Bangun skrip ZPL untuk satu label produk.
 *
 * Susunan: nama produk (font besar, tengah), varian, notes, nomor order kecil
 * di dasar label. Lebar cetak 30mm = 240 dots, panjang feed 20mm = 160 dots
 * @203dpi (lihat ZPL_PRINT_WIDTH_DOTS).
 */
export function buildLabel(order: LabelOrder): Uint8Array {
  const lines: string[] = [
    '^XA',
    // UTF-8 supaya huruf non-ASCII tidak jadi sampah di kertas.
    '^CI28',
    `^PW${ZPL_PRINT_WIDTH_DOTS}`,
    `^LL${ZPL_PRINT_LENGTH_DOTS}`,
    // Sensor gap sama dengan label fisik (lihat LABEL_GAP_MM pada TSPL).
    '^MNY',
    '^PR4',
  ];

  // Top margin: konten tidak boleh menempel tepi atas label.
  let y = TOP_MARGIN_DOTS;

  // ── Nama produk ────────────────────────────────────────────────────────────
  const qty = order.quantity && order.quantity > 1 ? `${order.quantity}x ` : '';
  const nameLines = wrapText(qty + order.menuName, maxChars(FONT_NAME)).slice(0, 2);
  for (const line of nameLines) {
    lines.push(field(0, y, FONT_NAME, line, 1));
    y += FONT_NAME.height + 6;
  }

  // ── Varian ─────────────────────────────────────────────────────────────────
  if (order.variant && order.variant.trim()) {
    for (const line of wrapText(order.variant.trim(), maxChars(FONT_VARIANT)).slice(
      0,
      2,
    )) {
      lines.push(field(0, y, FONT_VARIANT, line, 1));
      y += FONT_VARIANT.height + 4;
    }
  }

  // ── Notes order item ───────────────────────────────────────────────────────
  if (order.note && order.note.trim()) {
    lines.push(field(4, y, FONT_NOTE, order.note.trim(), 3));
    // Blok notes bisa sampai 3 baris (^FB) — sisakan ruangnya di kursor bawah.
    y += FONT_NOTE.height * 3;
  }

  // ── Nomor order kecil di bawah (opsional) ──────────────────────────────────
  // Ikut kursor, bukan anchor dari dasar label: `^FO4,` tetap dari Y=0 membuat
  // teks bisa menempel tepi bawah dan menimpa notes. Dijaga BOTTOM_MARGIN_DOTS.
  // if (order.noreceipt) {
  //   const receiptY = Math.min(y, ZPL_PRINT_LENGTH_DOTS - BOTTOM_MARGIN_DOTS);
  //   lines.push(field(4, receiptY, FONT_NOTE, order.noreceipt, 1));
  // }

  lines.push('^XZ');

  // ZPL tidak peduli baris: CRLF hanya demi keterbacaan log/diagnostik.
  return encoder.encode(lines.join('\r\n') + '\r\n');
}
