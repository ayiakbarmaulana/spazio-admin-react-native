// src/types/printing.ts
// Kontrak tipe untuk subsistem cetak. Murni tipe + konstanta — tanpa import
// React Native, supaya modul renderer/queue bisa diuji tanpa device.

export type PrinterConnectionType = 'lan' | 'bluetooth' | 'usb';

export type PrintDestination = 'customer_receipt' | 'kitchen_ticket';

export type PaperWidthMm = 58 | 80;

/**
 * Konfigurasi printer. Satu-satunya tempat host/port hidup — bridge WebView
 * TIDAK PERNAH mengirim host/port (PRD §5.2, §9.2).
 */
export type PrinterConfig = {
  id: string;
  name: string;
  connectionType: PrinterConnectionType;
  /** Hanya untuk connectionType "lan". IPv4 dotted-quad. */
  host?: string;
  /** Hanya untuk "lan". Default 9100. */
  port?: number;
  enabled: boolean;
  /** Tujuan yang dilayani printer ini. Boleh lebih dari satu. */
  destinations: PrintDestination[];
  /** Lebar kertas. Menentukan W (kolom teks) di renderer. */
  paperWidthMm: PaperWidthMm;
  createdAt: string;
  updatedAt: string;
};

/**
 * Status job. Urutan transisi dipaksa oleh `canTransition` (PRD §6.3).
 *
 * - queued     : sudah dipersist, menunggu diproses
 * - connecting : sedang membuka koneksi
 * - sending    : sedang mengirim byte
 * - submitted  : transmisi selesai menurut sinyal transport yang ada
 * - failed     : gagal SEBELUM submission terbukti
 * - unknown    : hasil ambigu (koneksi putus setelah sebagian byte terkirim)
 * - cancelled  : dibatalkan sebelum transmisi dimulai
 */
export type PrintJobStatus =
  | 'queued'
  | 'connecting'
  | 'sending'
  | 'submitted'
  | 'failed'
  | 'unknown'
  | 'cancelled';

/** Kategori error (PRD §10.1). */
export type PrintErrorCode =
  | 'INVALID_CONFIG'
  | 'PERMISSION_DENIED'
  | 'UNREACHABLE_HOST'
  | 'CONNECTION_TIMEOUT'
  | 'CONNECTION_REFUSED'
  | 'CONNECTION_RESET'
  | 'CONNECTION_LOST_DURING_SEND'
  | 'WRITE_FAILED'
  | 'TRANSPORT_UNSUPPORTED'
  | 'UNKNOWN_TRANSPORT_ERROR';

export type PrintJobError = {
  code: PrintErrorCode;
  /** Pesan siap tampil ke kasir (bahasa Indonesia). */
  message: string;
  /** true = sebagian byte sudah terkirim → hasil ambigu. */
  transmissionStarted: boolean;
  at: string;
};

/** Baris item pada struk. Harga WAJIB datang dari kalkulasi otoritatif. */
export type ReceiptItem = {
  menuName: string;
  quantity: number;
  priceAtOrder: number;
  note?: string | null;
};

/**
 * Data struk. Bentuknya SENGAJA sama dengan `ReceiptOrder` di
 * spazio-admin/lib/thermal-print.ts supaya WebView bisa meneruskan objek order
 * apa adanya — tanpa kalkulasi ulang (PRD §13.3, §8.4).
 */
export type ReceiptOrder = {
  noreceipt: string | null;
  paymentMethod: string;
  paymentStatus: string;
  status?: string;
  finalAmount: number;
  subTotalAmount?: number;
  taxAmount?: number;
  serviceFeeAmount?: number;
  discountAmount?: number;
  paidAmount?: number;
  receivedAmount?: number | null;
  changeAmount?: number | null;
  voucherTitle?: string | null;
  staffName: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  tableNumber: string | null;
  note?: string | null;
  createdAt: string;
  items: ReceiptItem[];
};

/**
 * Data tiket dapur. Bentuknya diturunkan dari `screens/kitchen/index.tsx`:
 * nomor order, meja/pelanggan, catatan, dan item — TANPA harga.
 */
export type KitchenTicketOrder = {
  noreceipt: string | null;
  /** Nama order/id pendek untuk header kalau noreceipt kosong. */
  orderId: string;
  tableNumber: string | null;
  customerName: string | null;
  note?: string | null;
  createdAt: string;
  /**
   * "full"     = seluruh item order (tiket awal)
   * "addition" = hanya item yang `addedAt` terisi (tiket tambahan)
   */
  mode: 'full' | 'addition';
  items: {
    menuName: string;
    quantity: number;
    note?: string | null;
    /** Terisi = baris tambahan yang masuk setelah tiket awal. */
    addedAt?: string | null;
  }[];
};

/** Hasil uji koneksi (PRD §6.6). */
export type ConnectionTestResult = {
  ok: boolean;
  /** true = TCP tersambung. Bukan bukti kertas tercetak. */
  connected: boolean;
  /** true = data terkirim. Bukan bukti kertas tercetak. */
  transmitted: boolean;
  error?: PrintJobError;
  at: string;
  /** Pesan eksplisit: koneksi ≠ tercetak (PRD §4.2C, §6.6). */
  notice: string;
};

export type PrintResult = {
  jobId: string;
  status: PrintJobStatus;
  error?: PrintJobError;
};

/** Job persisten. Cermin tabel `print_jobs` (PRD §8.3). */
export type PrintJob = {
  id: string;
  orderId: string;
  destination: PrintDestination;
  printerId: string;
  status: PrintJobStatus;
  /** Payload siap-render (ReceiptOrder atau KitchenTicketOrder). */
  payload: ReceiptOrder | KitchenTicketOrder;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  lastError: PrintJobError | null;
  /** Kunci dedup: orderId + destination + printerId. */
  idempotencyKey: string;
};

/**
 * Kolom teks untuk font A. 58mm = 32 kolom, 80mm = 48 kolom.
 * Nilai ini adalah bagian dari kontrak byte — jangan diubah tanpa
 * memperbarui fixture byte di __tests__/unit/escpos-renderer.test.ts.
 */
export const PAPER_COLUMNS: Record<PaperWidthMm, number> = {
  58: 32,
  80: 48,
};

/** Port default ESC/POS over TCP. Bisa diubah per printer (PRD §5.2). */
export const DEFAULT_LAN_PORT = 9100;

export const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
export const DEFAULT_WRITE_TIMEOUT_MS = 8000;
