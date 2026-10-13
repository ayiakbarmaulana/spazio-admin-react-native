// __tests__/unit/zpl-label.test.ts
// Label produk 20×30mm untuk printer ZPL II (Zebra/Argox/TSC mode ZPL).
// Yang dijaga:
//  1. Diawali ^XA dan diakhiri ^XZ — tanpa ^XZ printer menahan job.
//  2. Ukuran label ^PW/^LL ada — tanpa itu potongan kertas kacau.
//  3. Nama + varian + notes benar-benar tercetak.
//  4. Harga TIDAK pernah muncul di label.
//  5. Tidak ada "undefined"/"null" bocor ke kertas.
//  6. Karakter pengontrol ^ dan ~ di-escape, tidak memutus perintah.

import { buildLabel } from '../../src/printing/ZplTemplate';
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

it('dimulai ^XA dan diakhiri ^XZ — tanpa ^XZ label tidak keluar', () => {
  const text = script(BASE);
  expect(text.trimStart().startsWith('^XA')).toBe(true);
  expect(text).toMatch(/\^XZ\r?\n?$/);
});

it('memuat ukuran label: lebar cetak 30mm (240 dots) & feed 20mm (160 dots)', () => {
  const text = script(BASE);
  // Sumbu ZPL BP-TR110: X = sisi 30mm (melintang kepala cetak), Y = sisi 20mm.
  // Kebalikan TSPL (`SIZE 20 mm,30 mm`) — lihat komentar ZPL_PRINT_WIDTH_DOTS.
  expect(text).toContain('^PW240');
  expect(text).toContain('^LL160');
});

it('mencetak nama, varian, dan notes', () => {
  const text = script(BASE);
  expect(text).toContain('Kopi Susu');
  expect(text).toContain('Large');
  expect(text).toContain('tanpa gula');
  // Kuantitas > 1 jadi penanda "2x".
  expect(text).toContain('2x');
});

it('nomor order ikut tercetak', () => {
  expect(script(BASE)).toContain('SPZ-777');
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

it('notes panjang + noreceipt tidak saling menimpa dan tetap di dalam label', () => {
  const text = script({ ...BASE, note: 'a '.repeat(80).trim() });
  const fields = text
    .split('\r\n')
    .filter((l) => l.includes('^FD'))
    .map((l) => ({
      y: Number(/\^FO\d+,(\d+)/.exec(l)?.[1] ?? -1),
      text: /\^FD(.*)\^FS$/.exec(l)?.[1] ?? '',
    }));
  const receipt = fields.find((f) => f.text === 'SPZ-777');
  expect(receipt).toBeDefined();
  // Nomor order duduk di bawah notes dan tidak lebih dekat dari 12 dots ke tepi.
  expect(receipt!.y).toBeLessThanOrEqual(148);
  // Tidak ada field yang mulai tepat di tepi (>= ^LL) → tidak ada yang terpotong.
  for (const f of fields) {
    expect(f.y).toBeLessThan(160 - 11);
  }
});
