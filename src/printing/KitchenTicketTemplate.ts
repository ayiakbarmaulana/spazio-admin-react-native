// src/printing/KitchenTicketTemplate.ts
// Template tiket dapur. FUNGSI MURNI — tidak ada import React Native.
//
// TIKET DAPUR ADALAH FITUR BARU. `screens/kitchen/index.tsx` di PWA hanya
// papan baca tanpa cetak. Template ini diturunkan dari bentuk data yang sudah
// dipakai papan itu: nomor order, meja, catatan, item. TIDAK ADA HARGA dan
// tidak ada nominal apa pun — dapur tidak butuh, dan harga di tiket dapur
// cuma menambah kebocoran informasi.

import {
  CMD,
  assemble,
  feed,
  padEnd,
  separator,
  wrap,
} from './EscPosRenderer';
import { JAKARTA_TZ } from './ReceiptTemplate';
import type { KitchenTicketOrder } from '../types/printing';

function formatJakartaTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', {
    timeZone: JAKARTA_TZ,
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Bangun byte tiket dapur.
 *
 * @param order   data order — item dengan `addedAt` terisi dianggap tambahan.
 * @param columns lebar kolom teks (32 untuk 58mm, 48 untuk 80mm).
 * @param copy    label salinan dapur opsional ("DAPUR", "BAR").
 */
export function buildKitchenTicket(
  order: KitchenTicketOrder,
  columns: number,
  copy?: string,
): Uint8Array {
  // Mode "addition" hanya mencetak baris yang punya `addedAt`. Kalau tidak ada
  // satu pun, tiketnya kosong — dan tiket dapur kosong lebih buruk daripada
  // tidak mencetak sama sekali.
  const items =
    order.mode === 'addition'
      ? order.items.filter(i => !!i.addedAt)
      : order.items;

  const parts: (Uint8Array | string)[] = [
    CMD.INIT,
    CMD.ALIGN_C,
    CMD.BOLD_ON,
    order.mode === 'addition' ? 'TAMBAHAN' : 'TIKET DAPUR',
    CMD.BOLD_OFF,
    CMD.LF,
    separator(columns),
    CMD.LF,
    CMD.ALIGN_L,
  ];

  parts.push(CMD.BOLD_ON, order.noreceipt ?? order.orderId, CMD.BOLD_OFF, CMD.LF);
  parts.push('Jam  : ', formatJakartaTime(order.createdAt), CMD.LF);
  // Meja dan pelanggan tidak selalu ada (take-away tanpa nama). Cetak yang ada.
  if (order.tableNumber) {
    parts.push('Meja : ', order.tableNumber, CMD.LF);
  }
  if (order.customerName) {
    parts.push('Nama : ', order.customerName, CMD.LF);
  }
  if (order.note) {
    for (const line of wrap(`CATATAN: ${order.note}`, columns)) {
      parts.push(CMD.BOLD_ON, padEnd(line, columns), CMD.BOLD_OFF, CMD.LF);
    }
  }
  parts.push(separator(columns), CMD.LF);

  // Porsi dicetak besar/ganda supaya dapur bisa membacanya dari jauh. Format
  // "2x NASI GORENG" menaruh angka di depan — mata menemukannya lebih cepat
  // daripada kalau kuantitas mengambang di kanan.
  for (const item of items) {
    const prefix = `${item.quantity}x `;
    for (const line of wrap(prefix + item.menuName, columns)) {
      parts.push(CMD.BOLD_ON, padEnd(line, columns), CMD.BOLD_OFF, CMD.LF);
    }
    if (item.note) {
      for (const line of wrap(`   >> ${item.note}`, columns)) {
        parts.push(padEnd(line, columns), CMD.LF);
      }
    }
    // Penanda tambahan: dapur perlu tahu mana yang baru masuk menyusul.
    if (order.mode === 'addition' && item.addedAt) {
      parts.push(
        padEnd(`   (tambahan ${formatJakartaTime(item.addedAt)})`, columns),
        CMD.LF,
      );
    }
  }

  if (copy) {
    parts.push(CMD.LF, CMD.ALIGN_C, CMD.BOLD_ON, copy, CMD.BOLD_OFF, CMD.LF);
  }

  parts.push(CMD.LF, feed(3), CMD.CUT);

  return assemble(parts);
}
