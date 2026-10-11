// src/printing/EscPosRenderer.ts
// Pembangun byte ESC/POS. FUNGSI MURNI — tanpa import React Native.
//
// Port dari spazio-admin/lib/thermal-print.ts (bagian ESC/POS builder).
// Perbedaan yang disengaja: lebar kolom kini parameter (`columns`) supaya
// printer 80mm (48 kolom) didukung, bukan hanya 58mm (32 kolom).
//
// Keluaran untuk 32 kolom WAJIB byte-identik dengan implementasi web lama —
// dijaga oleh __tests__/unit/escpos-fixture.test.ts (golden dari
// spazio-admin/lib/thermal-print.ts).

/** RUJUKAN: definisi command ESC/POS yang dipakai. */
const ESC = 0x1b;
const GS = 0x1d;

export const CMD = {
  INIT: Uint8Array.of(ESC, 0x40),
  LF: Uint8Array.of(0x0a),
  ALIGN_L: Uint8Array.of(ESC, 0x61, 0x00),
  ALIGN_C: Uint8Array.of(ESC, 0x61, 0x01),
  BOLD_ON: Uint8Array.of(ESC, 0x45, 0x01),
  BOLD_OFF: Uint8Array.of(ESC, 0x45, 0x00),
  /** Partial cut. Tidak semua printer mendukung (PRD §5.2). */
  CUT: Uint8Array.of(GS, 0x56, 0x42, 0x00),
} as const;

/** Feed n baris: ESC d n */
export function feed(n: number): Uint8Array {
  return Uint8Array.of(ESC, 0x64, n);
}

/** Encoder UTF-8. Hermes/RN menyediakan TextEncoder global; Jest di Node juga. */
declare const TextEncoder: new (...args: unknown[]) => {
  encode(input?: string): Uint8Array;
};

const encoder = new TextEncoder();

/** Gabung potongan byte/teks jadi satu Uint8Array. */
export function assemble(parts: (Uint8Array | string)[]): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'string') {
      out.push(...encoder.encode(p));
    } else {
      out.push(...p);
    }
  }
  return Uint8Array.from(out);
}

/** Pecah string jadi karakter — aman untuk multibyte. */
export function chars(s: string): string[] {
  return Array.from(s);
}

/**
 * Bungkus teks ke beberapa baris selebar `width`, tanpa memotong kata.
 * Kata tunggal yang lebih panjang dari baris dipecah paksa.
 */
export function wrap(s: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of s.split(/\s+/)) {
    if (line === '') {
      line = w;
    } else if (line.length + 1 + w.length <= width) {
      line += ' ' + w;
    } else {
      out.push(line);
      line = w;
    }
    if (line.length > width) {
      for (let i = 0; i < line.length; i += width) {
        out.push(line.slice(i, i + width));
      }
      line = '';
    }
  }
  if (line !== '') {
    out.push(line);
  }
  return out;
}

export function padEnd(s: string, n: number): string {
  const c = chars(s);
  return c.length >= n ? c.slice(0, n).join('') : s + ' '.repeat(n - c.length);
}

export function padStart(s: string, n: number): string {
  const c = chars(s);
  return c.length >= n
    ? c.slice(c.length - n).join('')
    : ' '.repeat(n - c.length) + s;
}

/** Format rupiah gaya struk: "Rp 48.000". */
export function rupiah(n: number): string {
  return 'Rp ' + n.toLocaleString('id-ID');
}

/** Garis pemisah selebar kolom. */
export function separator(columns: number): string {
  return '-'.repeat(columns);
}
