import { buildReceipt } from './ReceiptTemplate';
import type { ReceiptOrder } from '../types/printing';

/**
 * Salinan struk yang dicetak per order pelanggan.
 * Port dari `printCustomerAndManagement` — dulu satu perintah BLE yang
 * menggabung 3 struk dalam satu buffer. Sekarang dikembalikan sebagai 3
 * Uint8Array terpisah supaya bisa dipisah ke printer berbeda dan supaya
 * kegagalan satu salinan tidak menghapus salinan lain dari antrean.
 */
export function receiptCopies(
  order: ReceiptOrder,
  columns: number,
): { label: string; bytes: Uint8Array }[] {
  return [
    { label: 'CUSTOMER', bytes: buildReceipt(order, columns, 'CUSTOMER') },
    { label: 'MANAGEMENT', bytes: buildReceipt(order, columns, 'MANAGEMENT') },
    { label: 'ARSIP', bytes: buildReceipt(order, columns, 'ARSIP') },
  ];
}
