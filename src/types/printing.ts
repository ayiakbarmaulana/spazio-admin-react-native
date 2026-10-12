// src/types/printing.ts
// Kontrak tipe untuk subsistem cetak. Murni tipe + konstanta — tanpa import
// React Native, supaya modul renderer/queue bisa diuji tanpa device.

export type PrinterConnectionType = 'lan' | 'bluetooth' | 'usb';

/**
 * Bahasa perintah printer. BUKAN properti koneksi — printer label 20×30mm
 * (mis. Blueprint BP-TR110) bicara TSPL/TSPL2, bukan ESC/POS, walau sama-sama
 * dikirim mentah lewat socket TCP. Salah pilih = printer mencetak teks mentah.
 */
export type PrinterProtocol = 'escpos' | 'tspl';

export type PrintDestination = 'customer_receipt' | 'kitchen_ticket' | 'label';

export type PaperWidthMm = 58 | 80;

/** Ukuran label thermal kecil (mm). BP-TR110 default 20×30. */
export const LABEL_WIDTH_MM = 20;
export const LABEL_HEIGHT_MM = 30;
/** Jarak antar-label untuk sensor gap. Harus cocok dengan label fisik. */
export const LABEL_GAP_MM = 2;

/**
 * Konfigurasi printer. Satu-satunya tempat host/port hidup — bridge WebView
 * TIDAK PERNAH mengirim host/port (PRD §5.2, §9.2).
 */
export type PrinterConfig = {
  id: string;
  name: string;
  connectionType: PrinterConnectionType;
  /**
   * Bahasa perintah printer. Default 'escpos' untuk printer lama tanpa field
   * ini (lihat migrasi di PrinterStore). Printer label 20×30mm pakai 'tspl'.
   */
  protocol: PrinterProtocol;
  /** Hanya untuk connectionType "lan". IPv4 dotted-quad. */
  host?: string;
  /** Hanya untuk "lan". Default 9100. */
  port?: number;
  /**
   * Hanya untuk "bluetooth". Konfigurasi minimal; kalau kosong, driver memilih
   * perangkat yang sudah dipasangkan di Android (lihat BlePrinterDriver).
   */
  bluetooth?: BluetoothTarget;
  enabled: boolean;
  /** Tujuan yang dilayani printer ini. Boleh lebih dari satu. */
  destinations: PrintDestination[];
  /** Lebar kertas. Menentukan W (kolom teks) di renderer. */
  paperWidthMm: PaperWidthMm;
  createdAt: string;
  updatedAt: string;
};

/**
 * Target BLE. SEMUA field opsional dengan sengaja: printer BLE murah hanya
 * menerima satu koneksi, jadi alamat fisik perangkat (MAC di Android, UUID
 * per-perangkat di iOS) tidak stabil antar HP. Kalau kosong, driver memilih
 * perangkat terpasang yang namanya cocok dengan `PRINTER_NAME_HINT`.
 *
 * `deviceId` TIDAK PERNAH datang dari WebView — hanya dari pemilihan pengguna
 * di layar Pengaturan Printer.
 */
export type BluetoothTarget = {
  /** id perangkat dari BLE stack OS. Android = MAC, iOS = UUID per-app. */
  deviceId?: string;
  /** Nama yang ditampilkan OS, mis. "VSC TM-58V". Membantu pemilihan otomatis. */
  deviceName?: string;
  /** Override layanan GATT. Kosong = pakai kandidat di bleProfiles.ts. */
  serviceUuid?: string;
  /** Override karakteristik tulis. Kosong = dicari otomatis. */
  characteristicUuid?: string;
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
  // ── Bluetooth ──────────────────────────────────────────────────────────
  /** Adaptor Bluetooth mati atau tidak ada di perangkat. */
  | 'BLUETOOTH_DISABLED'
  /** Izin runtime BLUETOOTH_CONNECT/BLUETOOTH_SCAN ditolak pengguna. */
  | 'BLUETOOTH_PERMISSION_DENIED'
  /** Tidak ada perangkat terpasang/terdeteksi yang cocok. */
  | 'DEVICE_NOT_FOUND'
  /** Perangkat hilang di tengah jalan (printer dimatikan / keluar jangkauan). */
  | 'DEVICE_DISCONNECTED'
  /** Terhubung, tapi tidak ada karakteristik tulis — printer tidak kompatibel. */
  | 'CHARACTERISTIC_NOT_FOUND'
  /**
   * Modul native BLE tidak ada di APK yang sedang berjalan. Terjadi kalau APK
   * dibangun sebelum `react-native-ble-plx` terpasang, atau instalasi rusak.
   * Tidak bisa diperbaiki dari aplikasi — wajib pasang ulang APK.
   */
  | 'PRINTING_MODULE_MISSING'
  /**
   * Belum ada printer yang dikonfigurasi untuk tujuan ini (mis. tiket dapur
   * saat printer dapur belum didaftarkan). Dicatat sebagai job gagal supaya
   * kelihatan di Riwayat Cetak, bukan hilang diam-diam.
   */
  | 'NO_PRINTER'
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
  /**
   * Nama kategori menu (mis. "Beverage"). Diteruskan apa adanya dari WebView;
   * dipakai WebView menyaring item label minuman, tidak dirender di struk.
   */
  categoryName?: string | null;
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

/**
 * Data satu label produk (nama + varian + notes order item).
 *
 * Satu job = satu label = satu order item. `variant` dan `note` dikirim apa
 * adanya dari WebView — renderer TIDAK menghitung apa pun, hanya menata teks
 * (aturan sama seperti struk: nominal & pilihan datang dari sumber otoritatif).
 */
export type LabelOrder = {
  noreceipt: string | null;
  /** Nama produk/menu. Dicetak paling besar. */
  menuName: string;
  /** Varian terpilih (mis. "Large", "Extra Shot"). Kosong = tidak dicetak. */
  variant?: string | null;
  /** Notes order item (mis. "tanpa gula"). Dibungkus ke beberapa baris. */
  note?: string | null;
  /** Kuantitas. Kalau > 1, dicetak sebagai penanda "x2". */
  quantity?: number;
  createdAt: string;
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
  /** Payload siap-render (ReceiptOrder, KitchenTicketOrder, atau LabelOrder). */
  payload: ReceiptOrder | KitchenTicketOrder | LabelOrder;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  lastError: PrintJobError | null;
  /** Sisa kolom skema v1. Tidak lagi dipakai untuk dedup — lihat `create()`. */
  idempotencyKey: string;
};

/**
 * Kolom teks untuk font A. 58mm = 32 kolom, 80mm = 48 kolom.
 * Nilai ini adalah bagian dari kontrak byte — 32 kolom dijaga byte-identik
 * dengan web oleh __tests__/unit/escpos-fixture.test.ts. Jangan diubah tanpa
 * memperbarui fixture di sana.
 */
export const PAPER_COLUMNS: Record<PaperWidthMm, number> = {
  58: 32,
  80: 48,
};

/** Port default ESC/POS over TCP. Bisa diubah per printer (PRD §5.2). */
export const DEFAULT_LAN_PORT = 9100;

export const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
export const DEFAULT_WRITE_TIMEOUT_MS = 8000;

/**
 * Batas waktu koneksi BLE. Lebih longgar dari LAN: BLE ke printer murah bisa
 * menggantung lama di Android kalau ikatan (bond) hilang.
 */
export const DEFAULT_BLUETOOTH_CONNECT_TIMEOUT_MS = 12000;
/** Batas waktu per potongan tulis BLE — bukan total; total = chunk × jeda. */
export const DEFAULT_BLUETOOTH_WRITE_TIMEOUT_MS = 10000;
