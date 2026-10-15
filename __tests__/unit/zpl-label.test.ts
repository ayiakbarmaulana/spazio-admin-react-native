// __tests__/unit/zpl-label.test.ts
// Label produk 20×30mm untuk printer ZPL II (Zebra/Argox/TSC mode ZPL).
// Yang dijaga:
//  1. Diawali ^XA dan diakhiri ^XZ — tanpa ^XZ printer menahan job.
//  2. Ukuran label ^PW/^LL ada — tanpa itu potongan kertas kacau.
//  3. Urutan baris: antrian → nama → varian → notes → nama pelanggan.
//  4. Nomor antrian dibaca dari noreceipt (INV-YYYYMMDD-N), bukan field sendiri.
//  5. Harga TIDAK pernah muncul di label.
//  6. Tidak ada "undefined"/"null" bocor ke kertas.
//  7. Karakter pengontrol ^ dan ~ di-escape, tidak memutus perintah.

import { buildLabel } from '../../src/printing/ZplTemplate';
import type { LabelOrder } from '../../src/types/printing';

function script(order: LabelOrder): string {
  return new TextDecoder().decode(buildLabel(order));
}

/** Urutan nilai ^FD dari atas ke bawah — sumbu Y kecil dulu. */
function fieldTexts(text: string): { y: number; text: string }[] {
  return text
    .split('\r\n')
    .flatMap((l) => {
      const f = /^\^FO\d+,(\d+).*\^FD(.*)\^FS$/.exec(l);
      return f ? [{ y: Number(f[1]), text: f[2] }] : [];
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

it('dimulai ^XA dan diakhiri ^XZ — tanpa ^XZ label tidak keluar', () => {
  const text = script(BASE);
  expect(text.trimStart().startsWith('^XA')).toBe(true);
  expect(text).toMatch(/\^XZ\r?\n?$/);
});

// ── Perataan: rata kiri, sama seperti TSPL ─────────────────────────────────
// Parameter ke-4 `^FB` = arah perataan. `L` rata kiri; `C` (tengah) pernah
// dipakai dulu dan membuat teks melompat saat nama/varian panjangnya beda.
it('teks rata kiri: setiap field memakai ^FB ... L', () => {
  const blocks = script(BASE).match(/\^FB\d+,\d+,0,([A-Z]),0/g) ?? [];
  expect(blocks.length).toBeGreaterThan(0);
  for (const block of blocks) {
    expect(block).toMatch(/,L,0$/);
  }
});

it('memuat ukuran label: lebar cetak 30mm (240 dots) & feed 20mm (160 dots)', () => {
  const text = script(BASE);
  // Sumbu ZPL BP-TR110: X = sisi 30mm (melintang kepala cetak), Y = sisi 20mm.
  // Kebalikan TSPL (`SIZE 20 mm,30 mm`) — lihat komentar ZPL_PRINT_WIDTH_DOTS.
  expect(text).toContain('^PW240');
  expect(text).toContain('^LL160');
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
    expect(text).toMatch(/\^FDKopi Susu\^FS/);
  }
});

// ── Urutan yang diminta: Antrian # → Nama Item → Variant → Customer ─────────
it('urutan baris: Antrian #, Nama Item, Variant, Notes, Customer', () => {
  const texts = fieldTexts(script(BASE)).map((f) => f.text);
  expect(texts.indexOf('Antrian #7')).toBe(0);
  expect(texts.indexOf('Kopi Susu')).toBe(1);
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
  expect(text).not.toContain('#null');
  expect(text).not.toContain('#undefined');
});

it('noreceipt null/kosong tidak mencetak blok antrian', () => {
  for (const noreceipt of [null, '']) {
    const text = script({ ...BASE, noreceipt });
    expect(text).not.toContain('Antrian');
  }
});

it('noreceipt asli tetap tidak bocor mentah ke label (hanya antriannya)', () => {
  const text = script(BASE);
  expect(text).not.toContain('INV-20261013-7');
  expect(text).toContain('Antrian #7');
});

it('varian dan notes kosong tidak mengotori label', () => {
  const text = script({ ...BASE, variant: null, note: '   ' });
  expect(text).not.toContain('null');
  expect(text).not.toContain('undefined');
  expect(text).toContain('Kopi Susu');
});

it('tidak pernah membocorkan harga ke label', () => {
  const text = script(BASE);
  expect(text).not.toContain('Rp');
  expect(text).not.toContain('48000');
  expect(text).not.toContain('48.000');
});

it('karakter ^ dan ~ di-escape, tidak memutus perintah ZPL', () => {
  const text = script({ ...BASE, menuName: 'Es Teh ^ Spesial ~ Manis' });
  // Escaping terjadi pada field yang benar — perintah tetap utuh.
  expect(text).toContain('^~');
  expect(text).toContain('^^');
  // Jumlah ^FS tetap sama dengan jumlah ^FD: tidak ada field yang terpecah.
  expect(text.split('^FS').length).toBe(text.split('^FD').length);
});

it('setiap field teks ditutup ^FS dan tidak ada perintah menggantung', () => {
  const text = script(BASE);
  const fields = text.split('^FS').length - 1;
  const opened = text.split('^FD').length - 1;
  expect(fields).toBe(opened);
  expect(fields).toBeGreaterThan(0);
});

// ── Regresi: konten dulu menempel tepi bawah & terpotong ─────────────────────
// Bug asli: `noreceipt` dipatok di `^FO4,220` (dari ^LL240) → 20 dots dari tepi
// dan menimpa notes; plus `y` mulai di 6 sehingga blok nama naik mepet atas.
it('tidak ada field yang menempel tepi atas atau bawah label', () => {
  const text = script(BASE);
  const ys = [...text.matchAll(/\^FO\d+,(\d+)/g)].map((m) => Number(m[1]));
  expect(ys.length).toBeGreaterThan(0);
  // ^LL160 → Y adalah sisi 20mm. Semua field dalam rentang aman 12..148.
  expect(Math.min(...ys)).toBeGreaterThanOrEqual(12);
  expect(Math.max(...ys)).toBeLessThanOrEqual(148);
});

it('label paling padat (5 baris) tetap muat di ^LL160', () => {
  const text = script(BASE);
  const fields = fieldTexts(text);
  // Antrian, nama, varian, notes, customer — semuanya ikut kursor.
  expect(fields.length).toBe(5);
  for (const f of fields) {
    // Font terakhir (14 dots) + margin 24 harus tetap di dalam feed 20mm.
    expect(f.y + 14).toBeLessThanOrEqual(160 - 24);
  }
});

it('notes panjang + blok lengkap tidak saling menimpa dan tetap di dalam label', () => {
  const text = script({ ...BASE, note: 'a '.repeat(80).trim() });
  const fields = fieldTexts(text);
  expect(fields.length).toBeGreaterThan(0);
  // Tidak ada field yang mulai tepat di tepi (>= ^LL) → tidak ada yang terpotong.
  for (const f of fields) {
    expect(f.y).toBeLessThan(160 - 11);
  }
});
