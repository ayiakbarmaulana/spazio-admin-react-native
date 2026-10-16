// __tests__/unit/kitchen-ticket.test.ts
// Tiket dapur adalah fitur BARU (papan dapur di PWA hanya baca, tanpa cetak),
// jadi tidak ada check web untuk diport. Yang diuji di sini: tiket dapur tidak
// pernah memuat harga, item tambahan tidak bocor ke tiket penuh, dan qty
// menempel di depan nama.

import { buildKitchenTicket } from '../../src/printing/KitchenTicketTemplate';
import type { KitchenTicketOrder } from '../../src/types/printing';

const W = 32;
const W80 = 48;

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

function expectWidth(text: string, columns: number, label = 'tiket') {
  for (const line of lines(text)) {
    if (line.length > columns) {
      throw new Error(
        `baris ${label} ${line.length} karakter (> ${columns}): ${JSON.stringify(line)}`,
      );
    }
  }
}

const base: KitchenTicketOrder = {
  noreceipt: 'SPZ-042',
  orderId: 'ord_abc123',
  tableNumber: 'Meja 7',
  customerName: 'Budi',
  note: 'Pedas level 3',
  createdAt: new Date('2026-09-27T10:00:00Z').toISOString(),
  mode: 'full',
  items: [
    { menuName: 'Nasi Goreng', quantity: 2 },
    { menuName: 'Es Teh Manis', quantity: 3, note: 'tanpa gula' },
  ],
};

it('tiket dapur mencetak nomor order, meja, nama, dan catatan order', () => {
  const text = render(buildKitchenTicket(base, W));

  expect(text).toContain('TIKET DAPUR');
  expect(text).toContain('SPZ-042');
  expect(text).toContain('Meja 7');
  expect(text).toContain('Budi');
  expect(text).toContain('CATATAN: Pedas level 3');
  expect(text).toContain('2x Nasi Goreng');
  expect(text).toContain('3x Es Teh Manis');
  expect(text).toContain('>> tanpa gula');
});

it('tiket dapur TIDAK memuat harga dalam bentuk apa pun', () => {
  const text = render(buildKitchenTicket(base, W));

  // Dapur tidak butuh harga; mencetaknya cuma membocorkan nominal ke dapur.
  expect(text).not.toContain('Rp');
  expect(text).not.toContain('TOTAL');
  expect(text).not.toContain('Subtotal');
  expect(text).not.toContain('Tunai');
});

it('tiket dapur muat lebar kertas 58mm dan 80mm', () => {
  expectWidth(render(buildKitchenTicket(base, W)), W);
  expectWidth(render(buildKitchenTicket(base, W80)), W80, 'tiket 80mm');
});

it('mode "full" mencetak seluruh item, termasuk yang belum ada addedAt', () => {
  const order: KitchenTicketOrder = {
    ...base,
    items: [
      { menuName: 'Nasi Goreng', quantity: 1 },
      { menuName: 'Kerupuk', quantity: 1, addedAt: '2026-09-27T10:05:00Z' },
    ],
  };
  const text = render(buildKitchenTicket(order, W));

  expect(text).toContain('Nasi Goreng');
  expect(text).toContain('Kerupuk');
  // Mode full tidak menandai tambahan — seluruhnya satu batch.
  expect(text).not.toContain('tambahan');
});

it('mode "addition" hanya mencetak item dengan addedAt dan menandai jamnya', () => {
  const order: KitchenTicketOrder = {
    ...base,
    mode: 'addition',
    items: [
      { menuName: 'Nasi Goreng', quantity: 1 },
      { menuName: 'Kerupuk', quantity: 1, addedAt: '2026-09-27T10:05:00Z' },
    ],
  };
  const text = render(buildKitchenTicket(order, W));

  expect(text).toContain('TAMBAHAN');
  expect(text).toContain('Kerupuk');
  // Item lama tidak boleh tercetak ulang di tiket tambahan — dapur akan
  // masak dua kali.
  expect(text).not.toContain('Nasi Goreng');
  expect(text).toContain('tambahan');
});

it('tiket tanpa meja dan tanpa nama tidak mencetak undefined/null', () => {
  const sparse: KitchenTicketOrder = {
    ...base,
    noreceipt: null,
    tableNumber: null,
    customerName: null,
    note: null,
  };
  const text = render(buildKitchenTicket(sparse, W));

  expect(text).not.toContain('undefined');
  expect(text).not.toContain('null');
  // Fallback header: orderId dipakai saat noreceipt kosong.
  expect(text).toContain('ord_abc123');
  expect(text).not.toContain('Meja');
  expect(text).not.toContain('Nama');
});

it('nama menu panjang dibungkus, bukan dipotong', () => {
  const longName: KitchenTicketOrder = {
    ...base,
    items: [
      {
        menuName:
          'Nasi Goreng Spesial dengan Telur Mata Sapi dan Ayam Panggang Madu',
        quantity: 1,
      },
    ],
  };
  const text = render(buildKitchenTicket(longName, W));

  expect(text).toContain('Madu');
  // Kuantitas menempel di baris pertama saja.
  expect(text).toContain('1x Nasi');
  expectWidth(text, W, 'nama panjang');
});

it('varian tercetak sebagai sub-baris tepat di bawah nama menu', () => {
  const order: KitchenTicketOrder = {
    ...base,
    tableNumber: null,
    customerName: null,
    note: null,
    items: [
      {
        menuName: 'Es Kopi Susu',
        quantity: 1,
        options: [
          { name: 'Large', quantity: 1 },
          { name: 'Extra Shot', quantity: 2 },
        ],
        note: 'tanpa gula',
      },
      { menuName: 'Teh', quantity: 1 },
    ],
  };
  const rows = lines(render(buildKitchenTicket(order, W))).map(l => l.replace(/\s+$/, ''));

  // Nama dulu, varian mengekor di bawahnya, lalu catatan.
  const nameRow = rows.indexOf('1x Es Kopi Susu');
  expect(nameRow).toBeGreaterThan(-1);
  expect(rows[nameRow + 1]).toBe('   - Large, Extra Shot x2');
  expect(rows[nameRow + 2]).toBe('   >> tanpa gula');

  // Item tanpa opsi tidak dapat baris varian liar.
  expect(rows.some(l => /^\s*-\s/.test(l) && !/^-+$/.test(l) && !l.includes('Large'))).toBe(false);
  expectWidth(rows.join('\n'), W, 'tiket bervarian');
});

it('label salinan dapur tercetak kalau diberikan', () => {
  const text = render(buildKitchenTicket(base, W, 'BAR'));

  expect(text).toContain('BAR');
});
