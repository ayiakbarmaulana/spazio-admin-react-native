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

import { queueLabel } from './queueNumber';
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

/**
 * Jarak aman dari tepi: konten tidak boleh menempel tepi label.
 *
 * 24 dots ≈ 3mm dari tiap tepi. Sebelum ada blok antrian + nama pelanggan,
 * angkanya 40 (5mm) dan pas; sekarang isi label bisa 5 baris (antrian, nama
 * 2 baris, varian, pelanggan) sehingga 40 akan mendorong baris terakhir keluar
 * `^LL160`. Terverifikasi cukup lega di printer fisik.
 */
const TOP_MARGIN_DOTS = 24;

/** Batas bawah kursor: baris terakhir tidak boleh lewat sini (24 dots dari tepi). */
const BOTTOM_MARGIN_DOTS = 24;

/**
 * Font scalable `A0` (device-independent). Glyph A0 ≈ ½ tinggi nominal per
 * karakter — cukup untuk label 20×30mm berisi 1–2 baris nama produk.
 */
const FONT_NAME = { height: 22, width: 22 };
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
 * Susunan (atas → bawah): nomor antrian (kalau `noreceipt` berpola
 * `INV-YYYYMMDD-N`), nama produk (font terbesar), varian, notes, nama
 * pelanggan. Lebar cetak 30mm = 240 dots, panjang feed 20mm = 160 dots
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

  // ── Antrian (opsional) ─────────────────────────────────────────────────────
  // Nomor datang dari `noreceipt` (INV-YYYYMMDD-N). Receipt gaya lama seperti
  // "SPZ-777" tidak cocok pola → blok hilang, bukan mencetak "#null".
  const antrian = queueLabel(order.noreceipt);
  if (antrian) {
    lines.push(field(0, y, FONT_NOTE, antrian, 1));
    y += FONT_NOTE.height + 6;
  }

  // ── Nama produk ────────────────────────────────────────────────────────────
  // Satu label = satu porsi: penanda "2x" sudah dihapus dari renderer. Kuantitas
  // di-expand di WebView (lib/label-items.ts) jadi label terpisah, jadi
  // `order.quantity` sengaja diabaikan di sini.
  const nameLines = wrapText(order.menuName, maxChars(FONT_NAME)).slice(0, 2);
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
  // Dibatasi 2 baris (^FB): tinggi `^LL160` sudah dipakai 5 baris lain.
  // ponytail: naikkan ke 3 kalau margin dikecilkan lagi / font nama diturunkan.
  if (order.note && order.note.trim()) {
    lines.push(field(4, y, FONT_NOTE, order.note.trim(), 2));
    // Blok notes bisa sampai 2 baris (^FB) — sisakan ruangnya di kursor bawah.
    y += FONT_NOTE.height * 2;
  }

  // ── Nama pelanggan ─────────────────────────────────────────────────────────
  // Guard kursor: ZPL diam saja kalau field keluar `^LL` (terpotong tanpa error),
  // jadi baris terakhir tidak pernah didorong lewat BOTTOM_MARGIN_DOTS.
  if (order.customerName && order.customerName.trim()) {
    const customerY = Math.min(y, ZPL_PRINT_LENGTH_DOTS - BOTTOM_MARGIN_DOTS);
    lines.push(field(0, customerY, FONT_NOTE, order.customerName.trim(), 1));
  }

  lines.push('^XZ');

  // ZPL tidak peduli baris: CRLF hanya demi keterbacaan log/diagnostik.
  return encoder.encode(lines.join('\r\n') + '\r\n');
}
