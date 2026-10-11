// src/printing/queueNumber.ts
// Nomor antrian = urutan order pada hari bisnis itu (kalender Jakarta).
//
// TIDAK ADA kolom DB: nomornya sudah terkandung di `noreceipt`
// (`INV-YYYYMMDD-N`, lihat spazio-admin/lib/generate-noreceipt.ts) dan
// penghitungnya sudah di-reset per hari di sana. Menyimpannya lagi di sisi
// cetak akan jadi dua sumber kebenaran yang bisa berbeda.
//
// Cermin dari spazio-admin/lib/queue-number.ts. Keduanya harus menghasilkan
// label yang sama persis — struk web dan struk native adalah struk yang sama
// bagi pelanggan.

/**
 * N di `INV-YYYYMMDD-N` (lihat spazio-admin/lib/generate-noreceipt.ts).
 * `null` = bukan pola itu (noreceipt kosong, order lama, atau nomor struk
 * gaya lain seperti "SPZ-001").
 *
 * Sengaja mengikat pola penuh: tanpa itu nomor urut struk lama mana pun
 * (`SPZ-001`) ikut terbaca sebagai antrian #1 dan blok besar tercetak di
 * struk yang tidak punya antrian.
 */
export function queueNumberFromReceipt(
  noreceipt: string | null | undefined
): number | null {
  const m = /^INV-\d{8}-(\d+)$/.exec(noreceipt?.trim() ?? '');
  return m ? Number(m[1]) : null;
}

/** Label siap tampil: "Antrian #7". `null` = tidak ada nomor. */
export function queueLabel(
  noreceipt: string | null | undefined
): string | null {
  const n = queueNumberFromReceipt(noreceipt);
  return n === null ? null : `Antrian #${n}`;
}
