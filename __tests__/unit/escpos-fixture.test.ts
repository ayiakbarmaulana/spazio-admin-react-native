// __tests__/unit/escpos-fixture.test.ts
// Penjaga klaim "byte-identik dengan web" di header EscPosRenderer.ts.
//
// Golden string di bawah DIRENDER oleh implementasi web asli
// (`spazio-admin/lib/thermal-print.ts`), bukan dikarang tangan:
//
//   cd spazio-admin
//   npx tsx -e 'import {buildReceipt} from "./lib/thermal-print";
//     const o={noreceipt:"SPZ-001",paymentMethod:"CASH",paymentStatus:"PAID",
//       finalAmount:48000,staffName:"Kasir Uji",customerName:"Pelanggan Uji",
//       customerPhone:"08123456789",customerAddress:null,tableNumber:null,
//       subTotalAmount:50000,taxAmount:5500,serviceFeeAmount:2500,
//       discountAmount:10000,voucherTitle:"Diskon 10rb",paidAmount:20000,
//       receivedAmount:100000,changeAmount:52000,
//       createdAt:"2026-09-27T10:00:00.000Z",
//       items:[{menuName:"Kopi Susu",quantity:2,priceAtOrder:25000}]};
//     console.log(JSON.stringify(new TextDecoder().decode(buildReceipt(o,"INVOICE"))))'
//
// Catatan: `noreceipt: "SPZ-001"` TIDAK cocok pola `INV-YYYYMMDD-N`, jadi blok
// antrian tidak tercetak di fixture ini. Kasus antrian punya fixture sendiri di
// receipt-template.test.ts (bentuk noreceipt-nya beda dari web).
//
// Regresi yang dijaga: `columns = 32` harus menghasilkan byte yang sama untuk
// perintah dan string yang terlihat. Beda satu CMD.LF pun ketahuan — lihat
// kasus 3 (separator blok rincian tidak didahului baris kosong).

import { buildReceipt } from '../../src/printing/ReceiptTemplate';
import type { ReceiptOrder } from '../../src/types/printing';

/** Lebar struk 58mm — nilai W di web. Fixture ini hanya sah untuk 32. */
const W = 32;

/** Order acuan: seluruh field opsional terisi supaya semua cabang tercetak. */
const order: ReceiptOrder = {
  noreceipt: 'SPZ-001',
  paymentMethod: 'CASH',
  paymentStatus: 'PAID',
  finalAmount: 48_000,
  subTotalAmount: 50_000,
  taxAmount: 5_500,
  serviceFeeAmount: 2_500,
  discountAmount: 10_000,
  voucherTitle: 'Diskon 10rb',
  paidAmount: 20_000,
  receivedAmount: 100_000,
  changeAmount: 52_000,
  staffName: 'Kasir Uji',
  customerName: 'Pelanggan Uji',
  customerPhone: '08123456789',
  customerAddress: null,
  tableNumber: null,
  createdAt: '2026-09-27T10:00:00.000Z',
  items: [{ menuName: 'Kopi Susu', quantity: 2, priceAtOrder: 25_000 }],
};

/** Urutan perintah ESC/POS yang harus sama antara web dan native. */
const EXPECTED_COMMANDS = [
  [0x1b, 0x40], // INIT
  [0x1b, 0x61, 0x01], // ALIGN_C
  [0x1b, 0x45, 0x01], // BOLD_ON
  [0x1b, 0x45, 0x00], // BOLD_OFF
  [0x1b, 0x45, 0x01], // label salinan
  [0x1b, 0x45, 0x00],
  [0x1b, 0x61, 0x00], // ALIGN_L — mulai blok info
  [0x1b, 0x45, 0x01], // TOTAL
  [0x1b, 0x45, 0x00],
  [0x1b, 0x61, 0x01], // ALIGN_C — blok status
  [0x1b, 0x45, 0x01], // LUNAS
  [0x1b, 0x45, 0x00],
  [0x1b, 0x64, 0x03], // feed(3)
  [0x1d, 0x56, 0x42, 0x00], // CUT
];

function commandsOf(bytes: Uint8Array): string {
  // Normalisasi: buang spasi trailing per baris. `padEnd` di web mengisi baris
  // sampai lebar penuh, jadi teks layar tidak pernah memuatnya. Beda pada
  // karakter terlihat (bukan padding) tetap tertangkap.
  return new TextDecoder()
    .decode(bytes)
    .replace(/\x1b\x64[\s\S]|\x1d\x56\x42\x00|\x1b\x61[\s\S]|\x1b\x45[\s\S]|\x1b\x40/g, '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n');
}

it('PASS 1: urutan perintah ESC/POS identik dengan web', () => {
  const bytes = buildReceipt(order, W, 'INVOICE');
  const seen: number[][] = [];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0x1b && bytes[i] !== 0x1d) {
      continue;
    }
    // CUT 4 byte, sisanya 2 atau 3 byte — dicek dari tabel, bukan ditebak.
    const match = EXPECTED_COMMANDS.find((c) =>
      c.every((b, k) => bytes[i + k] === b),
    );
    if (match) {
      seen.push([...match]);
      i += match.length - 1;
    }
  }
  expect(seen).toEqual(EXPECTED_COMMANDS);
});

it('PASS 2: teks struk 32 kolom identik dengan fixture web', () => {
  expect(commandsOf(buildReceipt(order, W, 'INVOICE'))).toBe(
    [
      'SPAZIO',
      'Invoice Penjualan',
      'INVOICE',
      '',
      '   No. Receipt SPZ-001',
      '       Tanggal 27/9/2026',
      '           Jam 17.00',
      '         Kasir Kasir Uji',
      '     Pelanggan Pelanggan Uji',
      '          Telp 08123456789',
      '         Bayar Tunai',
      '--------------------------------',
      'ITEM',
      '--------------------------------',
      '2   Kopi Susu          Rp 50.000',
      '--------------------------------',
      'Subtotal               Rp 50.000',
      'Pajak PPN               Rp 5.500',
      'Service Fee             Rp 2.500',
      'Diskon Diskon 10rb    -Rp 10.000',
      'Uang Diterima         Rp 100.000',
      'Kembalian              Rp 52.000',
      'TOTAL                  Rp 48.000',
      '',
      'LUNAS',
      '',
      'Terima kasih!',
      '',
    ].join('\n'),
  );
});

it('PASS 3: tidak ada baris kosong sebelum separator blok rincian', () => {
  const lines = commandsOf(buildReceipt(order, W, 'INVOICE')).split('\n');
  const itemRow = lines.indexOf('2   Kopi Susu          Rp 50.000');
  expect(itemRow).toBeGreaterThan(-1);
  // Web menempelkan separator langsung setelah baris item terakhir
  // (lib/thermal-print.ts buildReceipt) — baris kosong hanya dipasang DI ANTARA
  // item. Satu CMD.LF ekstra di sini = regresi.
  expect(lines[itemRow + 1]).toBe('-'.repeat(W));
  expect(lines[itemRow + 2]).toBe('Subtotal               Rp 50.000');
});

it('PASS 3b: layout varian & nama panjang identik dengan fixture web', () => {
  // Golden di bawah dirender web asli dengan order bervarian (perintah sama
  // seperti header, `items` diganti tiga baris: satu beropsi+catatan, satu nama
  // panjang, satu polos). Menjaga layout qty|nama|subtotal tetap byte-identik.
  const withVariants: ReceiptOrder = {
    ...order,
    items: [
      { menuName: 'Kopi Susu', quantity: 2, priceAtOrder: 25_000 },
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
      {
        menuName: 'Nasi Goreng Spesial Extra Pedas Sekali Ya',
        quantity: 1,
        priceAtOrder: 25_000,
      },
    ],
  };
  const rows = commandsOf(buildReceipt(withVariants, W, 'INVOICE')).split('\n');
  const itemStart = rows.indexOf('2   Kopi Susu          Rp 50.000');
  expect(itemStart).toBeGreaterThan(-1);
  expect(rows.slice(itemStart, itemStart + 10)).toEqual([
    '2   Kopi Susu          Rp 50.000',
    '',
    '1   Es Kopi Susu       Rp 25.000',
    '  - Large, Extra Shot x2',
    '  * tanpa gula',
    '',
    '1   Nasi Goreng        Rp 25.000',
    '    Spesial Extra',
    '    Pedas Sekali Ya',
    '--------------------------------',
  ]);
});

it('PASS 4: order lunas penuh tidak mencetak SISA TAGIHAN', () => {
  // Cermin PASS 2 tanpa `paidAmount`/`receivedAmount`: web hanya mencetak
  // baris "Sudah Dibayar"/"SISA TAGIHAN" kalau ada uang masuk di bill terbuka.
  const paidInFull: ReceiptOrder = {
    ...order,
    paidAmount: undefined,
    receivedAmount: null,
    changeAmount: null,
  };
  const text = commandsOf(buildReceipt(paidInFull, W, 'INVOICE'));
  expect(text).not.toContain('Sudah Dibayar');
  expect(text).not.toContain('SISA TAGIHAN');
  expect(text).not.toContain('Uang Diterima');
  // Nominal TOTAL tetap tagihan penuh.
  expect(text).toContain('TOTAL                  Rp 48.000');
  // 32 kolom, bukan 31/33 — nilai W web.
  expect(text.split('\n').every((l) => l.length <= W)).toBe(true);
});
