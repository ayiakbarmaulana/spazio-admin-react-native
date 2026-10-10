// src/printing/paymentLabel.ts
// Label metode pembayaran. Port dari spazio-admin/lib/payment-label.ts.
//
// Label sengaja pendek: kolom nilai struk thermal hanya `columns - 15` karakter
// (32 - 15 = 17). Label panjang akan terpotong ke baris berikutnya, bukan
// salah cetak — tapi tetap jelek. Jangan munculkan teks mentah seperti
// "COMPLIMENTARY" di struk yang dibaca tamu.

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Tunai',
  EDC: 'EDC',
  QRIS: 'QRIS',
  E_WALLET: 'E-Wallet',
  VIRTUAL_ACCOUNT: 'Virtual Account',
  ONLINE: 'Online',
  OPEN_BILL: 'Bayar Nanti',
  COMPLIMENTARY: 'Gratis',
};

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method;
}

/** Order gratis: tidak ada uang masuk, finalAmount 0. */
export function isComplimentary(method: string): boolean {
  return method === 'COMPLIMENTARY';
}
