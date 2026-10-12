// __tests__/unit/tspl-label.test.ts
// Label produk 20×30mm untuk printer TSPL (Blueprint BP-TR110). Yang dijaga:
//  1. Header ukuran label + GAP ada — tanpa SIZE, potongan kertas kacau.
//  2. PRINT 1,1 ada — tanpa itu printer menahan job sampai di-flush manual.
//  3. Nama + varian + notes benar-benar tercetak.
//  4. Notes panjang dibungkus, tidak hilang.
//  5. Harga TIDAK pernah muncul di label.
//  6. Tidak ada "undefined"/"null" bocor ke kertas.

import { buildLabel } from '../../src/printing/TsplTemplate';
import type { LabelOrder } from '../../src/types/printing';

function script(order: LabelOrder): string {
  return new TextDecoder().decode(buildLabel(order));
}

const BASE: LabelOrder = {
  noreceipt: 'SPZ-777',
  menuName: 'Kopi Susu',
  variant: 'Large',
  note: 'tanpa gula',
  quantity: 2,
  createdAt: new Date('2026-10-12T10:00:00Z').toISOString(),
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

it('mencetak nama, varian, dan notes', () => {
  const text = script(BASE);
  expect(text).toContain('Kopi Susu');
  expect(text).toContain('Large');
  expect(text).toContain('tanpa gula');
  // Kuantitas > 1 jadi penanda "x2".
  expect(text).toContain('2x');
});

it('nomor order ikut tercetak', () => {
  expect(script(BASE)).toContain('SPZ-777');
});

it('varian dan notes kosong tidak mengotori label', () => {
  const text = script({ ...BASE, variant: null, note: '   ' });
  expect(text).not.toContain('null');
  expect(text).not.toContain('undefined');
  // Hanya nama yang tersisa di blok teks.
  expect(text).toContain('Kopi Susu');
});

it('notes panjang dibungkus ke beberapa baris, tidak dipotong diam-diam', () => {
  const longNote =
    'es sedikit gula setengah tanpa whipped cream pakai oat milk';
  const text = script({ ...BASE, note: longNote });
  // Kata-kata awal harus utuh — wrapping tidak memotong di tengah kata.
  for (const word of ['es sedikit', 'gula', 'whipped', 'cream']) {
    expect(text).toContain(word);
  }
  // Beberapa baris TEXT berisi potongan notes → bukti wrapping.
  const noteLines = text
    .split('\r\n')
    .filter(l => l.includes('gula') || l.includes('whipped') || l.includes('cream'));
  expect(noteLines.length).toBeGreaterThan(1);
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
