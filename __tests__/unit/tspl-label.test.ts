// __tests__/unit/tspl-label.test.ts
// Label produk 20×30mm untuk printer TSPL (Blueprint BP-TR110). Yang dijaga:
//  1. Header ukuran label + GAP ada — tanpa SIZE, potongan kertas kacau.
//  2. PRINT 1,1 ada — tanpa itu printer menahan job sampai di-flush manual.
//  3. Urutan baris: antrian → nama → varian → notes → nama pelanggan.
//  4. Nomor antrian dibaca dari noreceipt (INV-YYYYMMDD-N), bukan field sendiri.
//  5. Notes panjang dibungkus, tidak hilang.
//  6. Harga TIDAK pernah muncul di label.
//  7. Tidak ada "undefined"/"null" bocor ke kertas.

import { buildLabel } from '../../src/printing/TsplTemplate';
import type { LabelOrder } from '../../src/types/printing';

function script(order: LabelOrder): string {
  return new TextDecoder().decode(buildLabel(order));
}

/** Urutan nilai TEXT dari atas ke bawah — sumbu Y kecil dulu. */
function lineTexts(text: string): { y: number; text: string }[] {
  return text
    .split('\r\n')
    .flatMap((l) => {
      const m = /^TEXT \d+,(\d+),.*,"(.*)"$/.exec(l);
      return m ? [{ y: Number(m[1]), text: m[2] }] : [];
    })
    .sort((a, b) => a.y - b.y);
}

const BASE: LabelOrder = {
  noreceipt: 'INV-20261013-7',
  menuName: 'Kopi Susu',
  variant: 'Large',
  note: 'tanpa gula',
  quantity: 2,
  createdAt: new Date('2026-10-12T10:00:00Z').toISOString(),
  customerName: 'Budi',
};

it('memuat SIZE dan GAP 20×30mm — tanpa ini potongan kertas kacau', () => {
  const text = script(BASE);
  expect(text).toContain('SIZE 20 mm,30 mm');
  expect(text).toContain('GAP 2 mm,0');
});

it('diakhiri PRINT 1,1 supaya label langsung keluar', () => {
  const text = script(BASE);
  expect(text).toMatch(/PRINT 1,1\r?\n?$/);
});

it('mencetak antrian, nama, varian, notes, dan nama pelanggan', () => {
  const text = script(BASE);
  expect(text).toContain('Antrian #7');
  expect(text).toContain('Kopi Susu');
  expect(text).toContain('Large');
  expect(text).toContain('tanpa gula');
  expect(text).toContain('Budi');
});

// ── Satu label = satu porsi: TIDAK ada penanda kuantitas ────────────────────
// Bug asli: qty 2 dikirim sebagai satu label bertuliskan "2x Kopi Susu".
// Kuantitas kini di-expand WebView (lib/label-items.ts) jadi label terpisah.
it('tidak pernah mencetak penanda kuantitas "Nx" di label', () => {
  for (const quantity of [1, 2, 3, 12]) {
    const text = script({ ...BASE, quantity });
    expect(text).not.toContain('2x');
    expect(text).toContain('Kopi Susu');
    // Nama produk dicetak apa adanya, tanpa awalan qty.
    expect(text).toMatch(/"Kopi Susu"$/m);
  }
});

// ── Urutan yang diminta: Antrian # → Nama Item → Variant → Customer ─────────
it('urutan baris: Antrian #, Nama Item, Variant, Notes, Customer', () => {
  const texts = lineTexts(script(BASE)).map((f) => f.text);
  expect(texts[0]).toBe('Antrian #7');
  expect(texts[1]).toBe('Kopi Susu');
  expect(texts.indexOf('Large')).toBeLessThan(texts.indexOf('tanpa gula'));
  expect(texts.indexOf('tanpa gula')).toBeLessThan(texts.indexOf('Budi'));
});

it('customerName tercetak; null/kosong menghilangkan barisnya', () => {
  expect(script(BASE)).toContain('Budi');
  for (const customerName of [null, undefined, '   ', '']) {
    const text = script({ ...BASE, customerName });
    expect(text).not.toContain('null');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('Budi');
  }
});

// ── Nomor antrian: satu sumber kebenaran, bukan field tersendiri ────────────
it('noreceipt non-pola (SPZ-777) tidak mencetak blok antrian', () => {
  const text = script({ ...BASE, noreceipt: 'SPZ-777' });
  expect(text).not.toContain('Antrian');
  expect(text).not.toContain('SPZ-777');
  expect(text).not.toContain('#null');
});

it('noreceipt null/kosong tidak mencetak blok antrian', () => {
  for (const noreceipt of [null, '']) {
    const text = script({ ...BASE, noreceipt });
    expect(text).not.toContain('Antrian');
  }
});

it('varian dan notes kosong tidak mengotori label', () => {
  const text = script({ ...BASE, variant: null, note: '   ' });
  expect(text).not.toContain('null');
  expect(text).not.toContain('undefined');
  // Hanya nama yang tersisa di blok teks.
  expect(text).toContain('Kopi Susu');
});

it('notes panjang dibungkus ke beberapa baris, tidak dipotong di tengah kata', () => {
  const longNote = 'es sedikit gula setengah tanpa gula lagi';
  const text = script({ ...BASE, note: longNote });
  // Kata-kata awal harus utuh — wrapping tidak memotong di tengah kata.
  for (const word of ['es sedikit', 'setengah']) {
    expect(text).toContain(word);
  }
  // Beberapa baris TEXT berisi potongan notes → bukti wrapping.
  // ponytail: notes dibatasi 2 baris di renderer; naikkan kalau batasnya naik.
  const noteLines = text
    .split('\r\n')
    .filter(l => l.includes('TEXT 4,'));
  expect(noteLines.length).toBe(2);
});

it('tidak pernah membocorkan harga ke label', () => {
  const text = script(BASE);
  expect(text).not.toContain('Rp');
  expect(text).not.toContain('48000');
  expect(text).not.toContain('48.000');
});

it('tanda kutip di teks di-escape, tidak memutus field TSPL', () => {
  const text = script({ ...BASE, menuName: 'Kopi "Spesial" Susu' });
  expect(text).toContain('\\"Spesial\\"');
});

it('semua baris perintah valid: diawali kata kunci TSPL yang dikenal', () => {
  const known = ['SIZE', 'GAP', 'DIRECTION', 'CLS', 'TEXT', 'PRINT'];
  const lines = script(BASE).split('\r\n').filter(Boolean);
  for (const line of lines) {
    expect(known).toContain(line.split(' ')[0]);
  }
});
