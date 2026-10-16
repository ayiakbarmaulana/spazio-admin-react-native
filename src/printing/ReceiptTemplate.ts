// src/printing/ReceiptTemplate.ts
// Template struk pelanggan. FUNGSI MURNI.
//
// Port dari `buildReceipt` di spazio-admin/lib/thermal-print.ts. Perilaku
// cetak untuk 32 kolom dipertahankan apa adanya; yang berubah hanya sumber
// lebar kolom (kini parameter, untuk dukung 80mm).
//
// ATURAN YANG TIDAK BOLEH DILANGGAR:
//  - Nominal TIDAK PERNAH dihitung ulang di sini. Semua angka datang dari
//    objek order (PRD §13.3, §8.4). Renderer hanya memformat.
//  - Field opsional yang kosong TIDAK dicetak sebagai "Rp 0" — struk tanpa
//    rincian hanya menampilkan TOTAL.

import {
  CMD,
  assemble,
  feed,
  padEnd,
  padStart,
  rupiah,
  separator,
  wrap,
} from './EscPosRenderer';
import { isComplimentary, paymentMethodLabel } from './paymentLabel';
import { queueLabel } from './queueNumber';
import type { ReceiptOrder } from '../types/printing';

/** Lebar kolom label di blok info transaksi. */
const INFO_LABEL_WIDTH = 14;

/**
 * Lebar kolom baris item: qty kiri, nama tengah (sisa), subtotal kanan 11
 * karakter. MIRROR konstanta QTY_W/SUBTOTAL_W di spazio-admin/lib/thermal-print.ts.
 */
const QTY_W = 4;
const SUBTOTAL_W = 11;

/** Ringkasan opsi: "Large, Extra Shot x2". MIRROR lib/order-item-label.ts. */
function optionsSummary(
  options?: { name: string; quantity: number }[] | null,
): string {
  if (!options || options.length === 0) return '';
  return options
    .map((o) => (o.quantity > 1 ? `${o.name} x${o.quantity}` : o.name))
    .join(', ');
}

/**
 * Zona waktu kalender bisnis. Jakarta tanpa DST → offset tetap aman.
 * Sama dengan JAKARTA_TZ di spazio-admin/lib/jakarta-date.ts.
 */
export const JAKARTA_TZ = 'Asia/Jakarta';

function formatJakartaDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', { timeZone: JAKARTA_TZ });
}

function formatJakartaTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', {
    timeZone: JAKARTA_TZ,
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Baris rincian setelah daftar item: subtotal, pajak, service fee, diskon,
 * sisa tagihan, uang diterima, kembalian.
 *
 * Dipisah dari `buildReceipt` supaya bisa diuji sendiri dan supaya blok
 * "Total & status" tetap terbaca.
 */
function buildDetailLines(
  order: ReceiptOrder,
  columns: number,
): (Uint8Array | string)[] {
  // Tanpa baris Diskon, jumlah baris item tidak pernah sama dengan TOTAL, dan
  // struknya tidak menjelaskan selisihnya ke mana.
  const detail: [string, string][] = [];
  if (typeof order.subTotalAmount === 'number') {
    detail.push(['Subtotal', rupiah(order.subTotalAmount)]);
  }
  if (typeof order.taxAmount === 'number') {
    detail.push(['Pajak PPN', rupiah(order.taxAmount)]);
  }
  if (typeof order.serviceFeeAmount === 'number') {
    detail.push(['Service Fee', rupiah(order.serviceFeeAmount)]);
  }
  if (order.discountAmount && order.discountAmount > 0) {
    // Order gratis: nominal penuh digratiskan. Tanpa label sendiri, struk
    // gratis terbaca seperti order berdiskon voucher.
    const discountLabel = isComplimentary(order.paymentMethod)
      ? 'Komplimen (Gratis)'
      : order.voucherTitle
        ? `Diskon ${order.voucherTitle}`
        : 'Diskon Voucher';
    detail.push([discountLabel, `-${rupiah(order.discountAmount)}`]);
  }

  // Bill belum lunas yang sudah menerima uang: tanpa dua baris ini, TOTAL
  // (nominal penuh) terbaca seolah semuanya sudah dibayar.
  const paidAmount = order.paidAmount ?? 0;
  // Order batal: uangnya sudah dikembalikan → tidak ada "sisa tagihan".
  if (
    order.status !== 'CANCELLED' &&
    order.paymentStatus !== 'PAID' &&
    paidAmount > 0
  ) {
    detail.push(['Sudah Dibayar', `-${rupiah(paidAmount)}`]);
    detail.push(['SISA TAGIHAN', rupiah(order.finalAmount - paidAmount)]);
  }

  // Uang diterima kasir. Tanpa ini, kasir yang menerima 100rb untuk tagihan
  // 48rb tidak punya bukti kembaliannya 52rb di struk.
  if (order.receivedAmount != null) {
    detail.push(['Uang Diterima', rupiah(order.receivedAmount)]);
    const change = Math.round(order.changeAmount ?? 0);
    // Kembalian 0 cuma jadi noise.
    if (change > 0) {
      detail.push(['Kembalian', rupiah(change)]);
    }
  }

  // Tanpa CMD.LF di depan separator: persis seperti web
  // (thermal-print.ts:512), supaya baris item terakhir dan garis pemisahnya
  // tidak dipisah baris kosong. Dijaga __tests__/unit/escpos-fixture.test.ts.
  const out: (Uint8Array | string)[] = [separator(columns), CMD.LF];
  for (const [label, value] of detail) {
    // Kolom label = columns - 12, nominal rata kanan 12 (muat tanda minus).
    const labelLines = wrap(label, columns - 12);
    out.push(
      padEnd(labelLines[0], columns - 12),
      padStart(value, 12),
      CMD.LF,
    );
    // Judul voucher panjang turun ke baris sendiri supaya nominalnya tidak
    // ikut terpotong.
    for (const rest of labelLines.slice(1)) {
      out.push(padEnd(rest, columns), CMD.LF);
    }
  }
  return out;
}

/**
 * Bangun byte struk pelanggan.
 *
 * @param order   data order — nominal dipakai apa adanya.
 * @param columns lebar kolom teks (32 untuk 58mm, 48 untuk 80mm).
 * @param label   label salinan opsional ("CUSTOMER", "MANAGEMENT").
 */
export function buildReceipt(
  order: ReceiptOrder,
  columns: number,
  label?: string,
): Uint8Array {
  const parts: (Uint8Array | string)[] = [
    CMD.INIT,
    CMD.ALIGN_C,
    CMD.BOLD_ON,
    'SPAZIO',
    CMD.BOLD_OFF,
    CMD.LF,
    'Invoice Penjualan',
    CMD.LF,
  ];
  if (label) {
    parts.push(CMD.BOLD_ON, label, CMD.BOLD_OFF, CMD.LF);
  }

  // ── Blok antrian pelanggan. Dibaca dari jauh, jadi tebal + rata tengah +
  // baris sendiri. SENGAJA TIDAK memakai `GS !` (perbesar font): hanya
  // INIT/LF/ALIGN/BOLD yang terbukti jalan di printer BLE murah yang dipakai —
  // byte tak dikenal bisa tercetak sebagai karakter sampah.
  // ponytail: kalau nanti benar-benar perlu nomor raksasa, ukur dulu di
  // hardware nyata, jangan tebak.
  const antrian = queueLabel(order.noreceipt);
  if (antrian) {
    parts.push(
      separator(columns),
      CMD.LF,
      CMD.ALIGN_C,
      CMD.BOLD_ON,
      antrian,
      CMD.BOLD_OFF,
      CMD.LF,
      separator(columns),
      CMD.LF,
    );
  }

  // ── Info transaksi ────────────────────────────────────────────────────────
  const rows: [string, string][] = [
    ['No. Receipt', order.noreceipt ?? '-'],
    ['Tanggal', formatJakartaDate(order.createdAt)],
    ['Jam', formatJakartaTime(order.createdAt)],
    ['Kasir', order.staffName ?? '-'],
  ];
  if (order.customerName) {
    rows.push(['Pelanggan', order.customerName]);
  }
  if (order.customerPhone) {
    rows.push(['Telp', order.customerPhone]);
  }
  if (order.customerAddress) {
    rows.push(['Alamat', order.customerAddress]);
  }
  if (order.tableNumber) {
    rows.push(['Meja', order.tableNumber]);
  }
  if (order.note) {
    rows.push(['Catatan', order.note]);
  }
  rows.push(['Bayar', paymentMethodLabel(order.paymentMethod)]);

  // Indent lanjutan = lebar label + 1 spasi pemisah.
  const valueWidth = columns - INFO_LABEL_WIDTH - 1;

  parts.push(CMD.ALIGN_L, CMD.LF);
  for (const [key, raw] of rows) {
    const labelCol = padStart(key, INFO_LABEL_WIDTH);
    const value = raw && raw.trim() ? raw : '-';
    // Nilai panjang (mis. alamat) dibungkus ke baris lanjutan, bukan dipotong.
    wrap(value, valueWidth).forEach((line, i) => {
      parts.push(
        i === 0
          ? `${labelCol} ${line}`
          : `${' '.repeat(INFO_LABEL_WIDTH + 1)}${line}`,
        CMD.LF,
      );
    });
  }

  // ── Item ──────────────────────────────────────────────────────────────────
  parts.push(
    separator(columns),
    CMD.LF,
    'ITEM',
    CMD.LF,
    separator(columns),
    CMD.LF,
  );
  // Layout: `qty | nama | subtotal`, varian & catatan sebagai sub-baris indent
  // 2 spasi persis di bawah nama menu. TANPA baris kosong antar item — sama
  // dengan web (lib/thermal-print.ts), byte harus identik (escpos-fixture).
  order.items.forEach((item) => {
    const qty = `${item.quantity}`;
    const subtotal = rupiah(item.priceAtOrder * item.quantity);
    const nameLines = wrap(item.menuName, columns - QTY_W - SUBTOTAL_W);
    parts.push(
      padEnd(qty, QTY_W),
      padEnd(nameLines[0], columns - QTY_W - SUBTOTAL_W),
      padStart(subtotal, SUBTOTAL_W),
      CMD.LF,
    );
    // Nama panjang: baris lanjutan menjorok ke kolom nama (tidak mengulang qty).
    for (const line of nameLines.slice(1)) {
      parts.push(padEnd(' '.repeat(QTY_W) + line, columns), CMD.LF);
    }
    const variant = optionsSummary(item.options);
    if (variant) {
      for (const line of wrap(`- ${variant}`, columns - 2)) {
        parts.push(padEnd(`  ${line}`, columns), CMD.LF);
      }
    }
    // Catatan item mengekor item-nya. Item tanpa catatan tidak mencetak apa pun
    // (jangan sampai muncul baris "* null" yang bikin dapur bingung).
    if (item.note) {
      for (const line of wrap(`* ${item.note}`, columns - 2)) {
        parts.push(padEnd(`  ${line}`, columns), CMD.LF);
      }
    }
  });

  parts.push(...buildDetailLines(order, columns));

  // ── Total & status ────────────────────────────────────────────────────────
  parts.push(
    CMD.BOLD_ON,
    padEnd('TOTAL', columns - 11),
    padStart(rupiah(order.finalAmount), 11),
    CMD.BOLD_OFF,
    CMD.LF,
    CMD.LF,
    CMD.ALIGN_C,
    CMD.BOLD_ON,
    order.status === 'CANCELLED'
      ? 'DIBATALKAN'
      : order.paymentStatus === 'PAID'
        ? 'LUNAS'
        : 'BELUM DIBAYAR',
    CMD.BOLD_OFF,
    CMD.LF,
    ...(isComplimentary(order.paymentMethod)
      ? (['GRATIS', CMD.LF] as (Uint8Array | string)[])
      : []),
    CMD.LF,
    'Terima kasih!',
    CMD.LF,
    feed(3),
    CMD.CUT,
  );

  return assemble(parts);
}
