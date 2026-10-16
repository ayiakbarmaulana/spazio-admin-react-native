// __tests__/unit/receipt-template.test.ts
// Port dari spazio-admin/lib/thermal-print.check.ts (9 kasus) + kasus 80mm.
//
// Konvensi repo web memakai `tsx file.check.ts` + node:assert. Di app native
// ini memakai Jest supaya suite native dan web punya satu runner yang sama.
// Isi asersinya dipertahankan apa adanya — termasuk string yang diperiksa —
// supaya regresi web ikut tertangkap di sini.

import { buildReceipt } from '../../src/printing/ReceiptTemplate';
import { receiptCopies } from '../../src/printing/receiptCopies';
import type { ReceiptOrder } from '../../src/types/printing';

/** Lebar struk 58mm — sama dengan konstanta W di lib/thermal-print.ts. */
const W = 32;
/** Lebar struk 80mm. */
const W80 = 48;

/**
 * Buang perintah ESC/POS, sisakan teks yang benar-benar tercetak.
 * Sama dengan `render()` di thermal-print.check.ts. `TextDecoder` tersedia di
 * Jest lewat lingkungan Node, jadi tidak perlu polyfill.
 */
function render(bytes: Uint8Array): string {
  return new TextDecoder()
    .decode(bytes)
    .replace(
      /\x1b\x64[\s\S]|\x1d\x56\x42\x00|\x1b\x61[\s\S]|\x1b\x45[\s\S]|\x1b\x40/g,
      '',
    );
}

function lines(text: string): string[] {
  return text.split('\n');
}

/** Posisi byte pertama urutan `needle` di `haystack`. -1 kalau tidak ada. */
function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    let matched = true;
    for (let k = 0; k < needle.length; k++) {
      if (haystack[i + k] !== needle[k]) {
        matched = false;
        break;
      }
    }
    if (matched) return i;
  }
  return -1;
}

/** Setiap baris struk harus muat lebar kertas. */
function expectWidth(text: string, columns: number, label = 'struk') {
  for (const line of lines(text)) {
    if (line.length > columns) {
      throw new Error(
        `baris ${label} ${line.length} karakter (> ${columns}): ${JSON.stringify(line)}`,
      );
    }
  }
}

/** Order dasar yang dipakai hampir semua kasus. */
const base: ReceiptOrder = {
  noreceipt: 'SPZ-001',
  paymentMethod: 'CASH',
  paymentStatus: 'PAID',
  finalAmount: 48_000,
  staffName: 'Kasir Uji',
  customerName: 'Pelanggan Uji',
  customerPhone: '08123456789',
  customerAddress: null,
  tableNumber: null,
  createdAt: new Date('2026-09-27T10:00:00Z').toISOString(),
  items: [{ menuName: 'Kopi Susu', quantity: 2, priceAtOrder: 25_000 }],
};

/** 50.000 + 5.500 + 2.500 - 10.000 = 48.000 */
const withVoucher: ReceiptOrder = {
  ...base,
  subTotalAmount: 50_000,
  taxAmount: 5_500,
  serviceFeeAmount: 2_500,
  discountAmount: 10_000,
  voucherTitle: 'Diskon 10rb',
};

// ── 1. Order dengan voucher: semua baris rincian ada ────────────────────────
it('PASS 1: struk mencetak Subtotal, PPN, Service, Diskon, TOTAL', () => {
  const text = render(buildReceipt(withVoucher, W));

  expect(text).toContain('Subtotal');
  expect(text).toContain('Rp 50.000');
  expect(text).toContain('Pajak PPN');
  expect(text).toContain('Rp 5.500');
  expect(text).toContain('Service Fee');
  expect(text).toContain('Rp 2.500');
  expect(text).toContain('Diskon Diskon 10rb');
  expect(text).toContain('-Rp 10.000');
  expect(text).toContain('TOTAL');
  expect(text).toContain('Rp 48.000');
});

// ── 2. Tanpa voucher: tidak ada baris Diskon ────────────────────────────────
it('PASS 2: tanpa diskon tidak ada baris Diskon', () => {
  const noDiscount: ReceiptOrder = {
    ...withVoucher,
    discountAmount: 0,
    voucherTitle: null,
    finalAmount: 58_000,
  };
  const text = render(buildReceipt(noDiscount, W));
  expect(text).not.toContain('Diskon');
  expect(text).toContain('Subtotal');
});

// ── 3. Pemanggil lama tanpa field rincian: TOTAL saja, bukan Rp 0 ───────────
it('PASS 3: order tanpa field rincian tetap dapat TOTAL', () => {
  const text = render(buildReceipt(base, W));
  expect(text).not.toContain('Subtotal');
  expect(text).not.toContain('Rp 0');
  expect(text).toContain('TOTAL');
  expect(text).toContain('Rp 48.000');
});

// ── 4. Judul voucher panjang: nominal tidak terpotong, lebar tetap 32 ───────
it('PASS 4: judul voucher panjang tetap muat 32 karakter', () => {
  const longTitle: ReceiptOrder = {
    ...withVoucher,
    voucherTitle: 'Promo Kemerdekaan Spesial 17 Agustus',
  };
  const text = render(buildReceipt(longTitle, W));

  expect(text).toContain('Diskon Promo');
  expect(text).toContain('Agustus');
  expect(text).toContain('-Rp 10.000');
  expect(text).toContain('Rp 48.000');
  expectWidth(text, W);
});

// ── 5. Semua baris struk muat lebar kertas, kasus normal ────────────────────
it('PASS 5: lebar struk tidak melebihi 32 karakter', () => {
  expectWidth(render(buildReceipt(withVoucher, W, 'INVOICE')), W);
});

// ── 6. Catatan order tercetak; hilang kalau kosong; panjang di-wrap ─────────
it('PASS 6: catatan order tercetak dan muat lebar struk', () => {
  const withNote: ReceiptOrder = {
    ...base,
    note: 'Bawa pulang, tanpa sambal',
  };
  const text = render(buildReceipt(withNote, W));
  expect(text).toContain('Catatan');
  expect(text).toContain('tanpa sambal');

  expect(render(buildReceipt(base, W))).not.toContain('Catatan');

  const longNote: ReceiptOrder = {
    ...base,
    note: 'Tolong bungkus terpisah semua lauk dan sausnya jangan sampai tumpah ya',
  };
  expectWidth(render(buildReceipt(longNote, W)), W, 'catatan');
});

// ── 7. Uang diterima & kembalian tercetak di struk ──────────────────────────
it('PASS 7: uang diterima & kembalian tercetak, uang pas tidak', () => {
  // Tagihan 48.000, kasir menerima 50.000 → kembalian 2.000.
  const text = render(
    buildReceipt({ ...base, receivedAmount: 50_000, changeAmount: 2_000 }, W),
  );
  expect(text).toContain('Uang Diterima');
  expect(text).toContain('Rp 50.000');
  expect(text).toContain('Kembalian');
  expect(text).toContain('Rp 2.000');

  // Uang pas: tidak ada baris Kembalian (Rp 0 cuma jadi noise).
  const exact = render(
    buildReceipt({ ...base, receivedAmount: 48_000, changeAmount: 0 }, W),
  );
  expect(exact).toContain('Uang Diterima');
  expect(exact).not.toContain('Kembalian');

  // Non-tunai / order lama: tidak dicetak sama sekali.
  for (const receivedAmount of [null, undefined]) {
    const nonCash = render(buildReceipt({ ...base, receivedAmount }, W));
    expect(nonCash).not.toContain('Uang Diterima');
  }

  expectWidth(text, W);
});

// ── 8. Order gratis (COMPLIMENTARY): label GRATIS, tanpa uang diterima ──────
it('PASS 8: struk order gratis berlabel GRATIS, tanpa uang diterima', () => {
  // 58.000 digratiskan: discountAmount = totalAmount, finalAmount 0.
  const comp: ReceiptOrder = {
    ...base,
    paymentMethod: 'COMPLIMENTARY',
    subTotalAmount: 50_000,
    taxAmount: 5_500,
    serviceFeeAmount: 2_500,
    discountAmount: 58_000,
    finalAmount: 0,
    paidAmount: 0,
  };
  const text = render(buildReceipt(comp, W));

  expect(text).toContain('GRATIS');
  expect(text).not.toContain('COMPLIMENTARY');
  expect(text).toContain('Komplimen (Gratis)');
  expect(text).not.toContain('Uang Diterima');
  expect(text).not.toContain('Kembalian');
  expect(text).toContain('LUNAS');
  expectWidth(text, W, 'struk gratis');
});

// ── 9. Catatan per-item mengekor item-nya, tanpa "* null" ───────────────────
it('PASS 9: catatan per-item tercetak mengekor itemnya', () => {
  const withNote: ReceiptOrder = {
    ...base,
    items: [
      {
        menuName: 'Kopi Susu',
        quantity: 1,
        priceAtOrder: 25_000,
        note: 'tanpa gula',
      },
      { menuName: 'Teh', quantity: 1, priceAtOrder: 15_000 },
    ],
  };
  const text = render(buildReceipt(withNote, W));
  expect(text).toContain('tanpa gula');
  expect(text).not.toContain('null');
  expectWidth(text, W, 'struk bercatatan');
});

// ═════════════════════════════════════════════════════════════════════════════
// Kasus tambahan khusus app native (tidak ada di check web).
// ═════════════════════════════════════════════════════════════════════════════

// ── 10. Printer 80mm: lebar 48 kolom, isi struk tidak berubah ───────────────
it('PASS 10: struk 80mm memakai 48 kolom dan tetap memuat seluruh rincian', () => {
  const text = render(buildReceipt(withVoucher, W80));

  expectWidth(text, W80, 'struk 80mm');
  // Isi harus sama — yang berbeda hanya padding.
  expect(text).toContain('Subtotal');
  expect(text).toContain('Rp 50.000');
  expect(text).toContain('Diskon Diskon 10rb');
  expect(text).toContain('-Rp 10.000');
  expect(text).toContain('TOTAL');
  expect(text).toContain('Rp 48.000');
});

// ── 11. 80mm benar-benar lebih lebar dari 58mm (padding ikut berubah) ───────
it('PASS 11: garis pemisah struk 80mm lebih panjang dari 58mm', () => {
  const sep58 = lines(render(buildReceipt(withVoucher, W))).find(l =>
    /^-+$/.test(l),
  );
  const sep80 = lines(render(buildReceipt(withVoucher, W80))).find(l =>
    /^-+$/.test(l),
  );

  expect(sep58).toBe('-'.repeat(W));
  expect(sep80).toBe('-'.repeat(W80));
});

// ── 12. Nama menu panjang dibungkus, bukan dipotong ────────────────────────
it('PASS 12: nama menu panjang dibungkus dan tetap muat lebar struk', () => {
  const longName: ReceiptOrder = {
    ...base,
    items: [
      {
        menuName:
          'Nasi Goreng Spesial dengan Telur Mata Sapi dan Ayam Panggang Madu',
        quantity: 1,
        priceAtOrder: 65_000,
      },
    ],
  };
  const text = render(buildReceipt(longName, W));

  expect(text).toContain('Madu');
  expect(text).toContain('Rp 65.000');
  expectWidth(text, W, 'nama panjang');
});

// ── 13. Alamat panjang dibungkus ke baris lanjutan dengan indentasi ────────
it('PASS 13: alamat panjang dibungkus dengan indentasi, tidak dipotong', () => {
  const longAddress: ReceiptOrder = {
    ...base,
    customerAddress:
      'Jl. Merdeka No. 123, RT 04 RW 05, Kelurahan Sukamaju, Kecamatan Cilandak',
  };
  const text = render(buildReceipt(longAddress, W));

  expectWidth(text, W, 'alamat panjang');
  expect(text).toContain('Alamat');
  expect(text).toContain('Cilandak');
  // Baris lanjutan tidak mengulang label.
  const addressLines = lines(text).filter(l => l.includes('Merdeka'));
  expect(addressLines).toHaveLength(1);
});

// ── 14. Order CANCELLED mencetak DIBATALKAN dan tanpa sisa tagihan ─────────
it('PASS 14: order dibatalkan mencetak DIBATALKAN tanpa SISA TAGIHAN', () => {
  const cancelled: ReceiptOrder = {
    ...base,
    status: 'CANCELLED',
    paymentStatus: 'PENDING',
    paidAmount: 20_000,
  };
  const text = render(buildReceipt(cancelled, W));

  expect(text).toContain('DIBATALKAN');
  expect(text).not.toContain('LUNAS');
  // Uangnya sudah dikembalikan → tidak ada sisa tagihan.
  expect(text).not.toContain('SISA TAGIHAN');
  expect(text).not.toContain('Sudah Dibayar');
});

// ── 15. Bill belum lunas dengan DP: cetak Sudah Dibayar + SISA TAGIHAN ─────
it('PASS 15: bill belum lunas mencetak Sudah Dibayar dan SISA TAGIHAN', () => {
  const partial: ReceiptOrder = {
    ...base,
    paymentStatus: 'PENDING',
    paidAmount: 20_000,
  };
  const text = render(buildReceipt(partial, W));

  expect(text).toContain('Sudah Dibayar');
  expect(text).toContain('-Rp 20.000');
  expect(text).toContain('SISA TAGIHAN');
  expect(text).toContain('Rp 28.000');
  expect(text).toContain('BELUM DIBAYAR');
  expectWidth(text, W, 'bill DP');
});

// ── 16. Tiga salinan struk, masing-masing byte berbeda dan mandiri ─────────
it('PASS 16: receiptCopies menghasilkan 3 salinan berlabel berbeda', () => {
  const copies = receiptCopies(withVoucher, W);

  expect(copies.map(c => c.label)).toEqual(['CUSTOMER', 'MANAGEMENT', 'ARSIP']);
  // Setiap salinan punya header ESC/POS sendiri → bisa dikirim ke printer
  // berbeda dan gagal sendiri-sendiri.
  for (const copy of copies) {
    expect(copy.bytes[0]).toBe(0x1b);
    expect(copy.bytes[1]).toBe(0x40);
    expect(render(copy.bytes)).toContain(copy.label);
  }
  expect(copies[0].bytes).not.toEqual(copies[1].bytes);
});

// ── 17. Kasir kosong & noreceipt kosong tidak mencetak "undefined" ─────────
it('PASS 17: field kosong tidak pernah mencetak undefined/null', () => {
  const sparse: ReceiptOrder = {
    ...base,
    noreceipt: null,
    staffName: null,
    customerName: null,
    customerPhone: null,
  };
  const text = render(buildReceipt(sparse, W));

  expect(text).not.toContain('undefined');
  expect(text).not.toContain('null');
  expect(text).toContain('No. Receipt');
  expectWidth(text, W, 'struk sparse');
});

// ── 18. Nominal besar tidak merusak kolom ──────────────────────────────────
it('PASS 18: nominal besar tetap rata kanan dalam 11 kolom', () => {
  const bigAmount: ReceiptOrder = {
    ...base,
    finalAmount: 12_345_678,
    items: [
      { menuName: 'Paket Katering', quantity: 1, priceAtOrder: 12_345_678 },
    ],
  };
  const text = render(buildReceipt(bigAmount, W));

  // Kolom TOTAL tetap 11 lebar: nominal > 11 karakter dipotong dari KIRI oleh
  // padStart (bug lama, sama di web). Yang dijaga di sini: barisnya tidak
  // melebar melewati struk dan angka terakhir tetap terbaca.
  // Nominal > 11 karakter dipotong oleh padStart(11) — bug lama, sama di web.
  // Yang dijaga: baris tidak melebar melewati struk dan digit terakhir terbaca.
  const itemRow = lines(text).find(l => l.includes('Paket Katering')) as string;
  expect(itemRow).toHaveLength(W);
  expect(itemRow.endsWith('12.345.678')).toBe(true);
  expectWidth(text, W, 'nominal besar');
});

// ── 19. Nomor antrian menonjol: blok tebal, rata tengah, baris sendiri ─────
it('PASS 19: noreceipt pola antrian mencetak blok "Antrian #N"', () => {
  const order: ReceiptOrder = { ...base, noreceipt: 'INV-20261011-7' };
  const bytes = buildReceipt(order, W, 'INVOICE');
  const text = render(bytes);

  expect(text).toContain('Antrian #7');
  // Nomor hanya diambil dari noreceipt — tidak dihitung ulang dari tanggal.
  const rows = text.split('\n');
  const idx = rows.indexOf('Antrian #7');
  expect(idx).toBeGreaterThan(0);
  expect(rows[idx - 1]).toBe('-'.repeat(W));
  expect(rows[idx + 1]).toBe('-'.repeat(W));
  // Rata tengah di antara dua garis: perintah ALIGN_C langsung sebelum BOLD_ON.
  const needle = Uint8Array.of(0x1b, 0x61, 0x01, 0x1b, 0x45, 0x01);
  expect(indexOfBytes(bytes, needle)).toBeGreaterThan(-1);
  expectWidth(text, W, 'struk berantrian');
});

// ── 20. Tanpa pola antrian: blok hilang, bukan placeholder ─────────────────
it('PASS 20: noreceipt non-pola tidak mencetak blok antrian', () => {
  const text = render(buildReceipt({ ...base, noreceipt: 'SPZ-001' }, W));
  expect(text).not.toContain('Antrian');
  // guard agar regex nomor tidak pernah menganggap id pendek sebagai nomor
  expect(text).not.toContain('Antrian #1');
});

// ── 21. Layout item: qty | nama | subtotal, varian jadi sub-baris "  - " ───
//      (blok item TANPA baris kosong antar item — lihat PASS 23) ─────────────
it('PASS 21: varian dan catatan jadi sub-baris indent di bawah nama menu', () => {
  const order: ReceiptOrder = {
    ...base,
    items: [
      {
        menuName: 'Es Kopi Susu',
        quantity: 1,
        priceAtOrder: 25_000,
        options: [
          { name: 'Large', quantity: 1 },
          { name: 'Extra Shot', quantity: 2 },
        ],
        note: 'tanpa gula',
      },
    ],
  };
  const rows = lines(render(buildReceipt(order, W)));

  const item = rows.find(l => l.includes('Es Kopi Susu')) as string;
  expect(item.startsWith('1   ')).toBe(true);
  expect(item.endsWith('Rp 25.000')).toBe(true);
  expect(item).toHaveLength(W);

  const variant = rows.find(l => l.includes('Large, Extra Shot x2')) as string;
  expect(variant.startsWith('  - ')).toBe(true);
  expect(variant).toHaveLength(W);

  const note = rows.find(l => l.includes('* tanpa gula')) as string;
  expect(note.startsWith('  * ')).toBe(true);
  expectWidth(rows.join('\n'), W, 'item bervarian');
});

// ── 22. Item tanpa opsi tidak meninggalkan baris varian liar ───────────────
it('PASS 22: item tanpa opsi tidak mencetak baris "  - "', () => {
  const order: ReceiptOrder = {
    ...base,
    items: [
      { menuName: 'Teh', quantity: 2, priceAtOrder: 15_000 },
      { menuName: 'Air Mineral', quantity: 1, priceAtOrder: 5_000, options: [] },
    ],
  };
  const rows = lines(render(buildReceipt(order, W)));

  expect(rows.some(l => /^\s*-\s/.test(l) && !/^-+$/.test(l))).toBe(false);
  expect(rows.find(l => l.includes('Teh'))).toHaveLength(W);
  expect(rows.find(l => l.includes('Air Mineral'))).toHaveLength(W);
});

// ── 23. Tidak ada baris kosong di blok item ─────────────────────────────────
it('PASS 23: tanpa baris kosong antar item, separator menempel item terakhir', () => {
  const order: ReceiptOrder = {
    ...base,
    items: [
      { menuName: 'Kopi Susu', quantity: 1, priceAtOrder: 25_000, options: [{ name: 'Hot', quantity: 1 }] },
      { menuName: 'Teh', quantity: 1, priceAtOrder: 15_000 },
      { menuName: 'Roti Bakar', quantity: 1, priceAtOrder: 10_000 },
    ],
  };
  const rows = lines(render(buildReceipt(order, W)));

  const firstItem = rows.findIndex(l => l.includes('Kopi Susu'));
  const lastItem = rows.findIndex(l => l.includes('Roti Bakar'));
  const detailSep = rows.findIndex((l, i) => i > lastItem && l === '-'.repeat(W));

  // Nol baris kosong: sub-baris varian/catatan sudah memberi jarak visual.
  const blanks = rows
    .slice(firstItem, detailSep)
    .filter(l => l.trim() === '').length;
  expect(blanks).toBe(0);

  // Item terakhir (dan sub-barisnya) menempel langsung ke separator rincian.
  expect(rows[detailSep]).toBe('-'.repeat(W));
  expect(rows.slice(lastItem + 1, detailSep).filter(l => l.trim() === '')).toHaveLength(0);
});

