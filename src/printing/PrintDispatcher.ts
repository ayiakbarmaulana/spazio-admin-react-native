// src/printing/PrintDispatcher.ts
// Orkestrasi: job → render byte → transport → status akhir.
//
// Inilah satu-satunya tempat status job berubah. Layar tidak boleh memanggil
// driver langsung, supaya tidak ada jalur cetak yang melewati antrean.

import type {
  KitchenTicketOrder,
  PrintDestination,
  PrintErrorCode,
  PrintJob,
  PrintJobError,
  PrintJobStatus,
  PrintResult,
  PrinterConfig,
  ReceiptOrder,
} from '../types/printing';
import {
  DEFAULT_BLUETOOTH_CONNECT_TIMEOUT_MS,
  DEFAULT_BLUETOOTH_WRITE_TIMEOUT_MS,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_WRITE_TIMEOUT_MS,
  PAPER_COLUMNS,
} from '../types/printing';
import { buildKitchenTicket } from './KitchenTicketTemplate';
import { BlePrinterDriver } from './BlePrinterDriver';
import { ensureBluetoothPermission } from './bluetoothPermissions';
import { LanPrinterDriver } from './LanPrinterDriver';
import { PrintJobRepository, type CreateJobInput } from './PrintJobRepository';
import { statusForError, messageForError } from './PrintJobStateMachine';
import { printQueue } from './PrintQueue';
import type { PrinterTransport, TransportTarget } from './PrinterTransport';
import { buildReceipt } from './ReceiptTemplate';
import { receiptCopies } from './receiptCopies';

/** Pabrik driver — bisa ditukar di test tanpa menyentuh jaringan. */
export type TransportFactory = (target: TransportTarget) => PrinterTransport;

/**
 * Penanda printer untuk job yang belum punya printer (tujuan tanpa konfigurasi).
 * `print_jobs.printer_id` NOT NULL, dan job begini tetap perlu tercatat di
 * Riwayat Cetak supaya tidak hilang diam-diam.
 */
export const UNCONFIGURED_PRINTER_ID = 'unconfigured';

export const lanTransportFactory: TransportFactory = target =>
  new LanPrinterDriver(target);

/** Target BLE = target LAN + blok `bluetooth` printer. */
export type BleTransportFactory = (
  target: TransportTarget & { bluetooth?: PrinterConfig['bluetooth'] },
) => PrinterTransport;

export const bleTransportFactory: BleTransportFactory = target =>
  new BlePrinterDriver(target);

export type DispatcherDeps = {
  repo: PrintJobRepository;
  getPrinter: (id: string) => Promise<PrinterConfig | null>;
  /** Cari printer aktif untuk sebuah tujuan (dipakai saat cetak ulang job tanpa printer). */
  findPrinterForDestination?: (
    destination: PrintDestination,
  ) => Promise<PrinterConfig | null>;
  transportFactory?: TransportFactory;
  /** Pabrik untuk printer BLE. Kosong = pakai bleTransportFactory. */
  bleTransportFactory?: BleTransportFactory;
  /** Dipanggil setiap status job berubah — dipakai bridge untuk push notifikasi. */
  onJobStatusChange?: (job: PrintJob) => void;
};

export type SubmitInput = {
  orderId: string;
  destination: PrintDestination;
  printerId: string;
  payload: ReceiptOrder | KitchenTicketOrder;
};

export class PrintDispatcher {
  private readonly transportFactory: TransportFactory;
  private readonly bleFactory: BleTransportFactory;

  constructor(private readonly deps: DispatcherDeps) {
    this.transportFactory = deps.transportFactory ?? lanTransportFactory;
    this.bleFactory = deps.bleTransportFactory ?? bleTransportFactory;
  }

  /**
   * Persist job, lalu antre. Job DIKEMBALIKAN sebelum transmisi mulai.
   *
   * Itu keputusan sadar: WebView menunggu ack cepat supaya UI tidak menggantung
   * selama timeout 5 detik. Hasil akhirnya diambil lewat langganan status job.
   */
  submit(input: SubmitInput): { job: PrintJob; created: boolean } {
    const { job, created } = this.deps.repo.createOrGet(
      input as CreateJobInput,
    );
    if (created) {
      // Sengaja tidak di-await: keputusan untuk antre sudah final, dan antrean
      // sendiri yang mengatur urutannya.
      void this.run(job.id);
    }
    return { job, created };
  }

  /**
   * Catat job untuk tujuan yang belum punya printer (`NO_PRINTER`), lalu
   * langsung tandai gagal.
   *
   * Alasan ini ada: kalau kita tolak permintaan sebelum menyimpan apa pun,
   * tiket dapur yang gagal terkirim hilang tanpa jejak — tidak muncul di
   * Riwayat Cetak, tidak ada tombol Cetak Ulang, dan kasir tidak pernah tahu.
   * Dengan sentinel `UNCONFIGURED_PRINTER_ID`, job tetap tercatat dan bisa
   * dicetak ulang setelah printer didaftarkan.
   */
  submitUnroutable(
    input: Omit<SubmitInput, 'printerId'>,
  ): { job: PrintJob; created: boolean } {
    const { job, created } = this.deps.repo.createOrGet({
      ...input,
      printerId: UNCONFIGURED_PRINTER_ID,
    } as CreateJobInput);
    if (created) {
      void this.run(job.id);
    }
    return { job, created };
  }

  /** Jalankan job yang sudah ada (cetak ulang). */
  async run(jobId: string): Promise<PrintResult> {
    const job = this.deps.repo.findById(jobId);
    if (!job) {
      return { jobId, status: 'failed' };
    }
    return printQueue.enqueue(job.printerId, job.id, () => this.execute(job));
  }

  /**
   * Cetak ulang. Kalau job dulu gagal karena belum ada printer, cari printer
   * untuk tujuan itu sekarang — kasir biasanya mencetak ulang SETELAH
   * mendaftarkan printernya, jadi memakai sentinel yang sama akan gagal lagi.
   */
  async reprint(jobId: string): Promise<PrintResult> {
    const job = this.deps.repo.findById(jobId);
    if (!job) {
      return { jobId, status: 'failed' };
    }

    if (job.printerId === UNCONFIGURED_PRINTER_ID) {
      const printer = await this.deps.findPrinterForDestination?.(
        job.destination,
      );
      if (printer) {
        this.deps.repo.updatePrinterId(job.id, printer.id);
      }
    }

    return this.run(jobId);
  }

  /** Isi job dari awal sampai akhir. Serial per printer lewat antrean. */
  private async execute(job: PrintJob): Promise<PrintResult> {
    if (job.printerId === UNCONFIGURED_PRINTER_ID) {
      return this.finish(job.id, 'failed', {
        code: 'NO_PRINTER',
        message: messageForError('NO_PRINTER'),
        transmissionStarted: false,
        at: new Date().toISOString(),
      });
    }

    const printer = await this.deps.getPrinter(job.printerId);
    if (!printer || !printer.enabled) {
      return this.fail(
        job.id,
        'INVALID_CONFIG',
        'Printer tidak ditemukan atau sedang dinonaktifkan.',
      );
    }

    if (
      printer.connectionType !== 'lan' &&
      printer.connectionType !== 'bluetooth'
    ) {
      // PRD §20.18: jangan pura-pura mencoba. Langsung gagal dengan alasan.
      return this.fail(
        job.id,
        'TRANSPORT_UNSUPPORTED',
        `Jenis koneksi "${printer.connectionType}" belum didukung.`,
      );
    }

    if (printer.connectionType === 'bluetooth') {
      // Android 12+: izin runtime harus diberikan sebelum ble-plx menyentuh
      // adaptor. Kalau ditolak, tidak ada gunanya mencoba menghubung.
      const permission = await ensureBluetoothPermission();
      if (!permission.ok) {
        return this.fail(
          job.id,
          'BLUETOOTH_PERMISSION_DENIED',
          permission.message,
        );
      }
    }

    let bytes: Uint8Array;
    try {
      bytes = this.render(job, printer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.fail(job.id, 'INVALID_CONFIG', message);
    }

    const transport =
      printer.connectionType === 'bluetooth'
        ? this.bleFactory({
            // Field LAN tidak dipakai driver BLE, tapi tetap diisi supaya
            // bentuk target seragam dan log diagnostik sama.
            host: printer.host ?? '',
            port: printer.port ?? 9100,
            connectTimeoutMs: DEFAULT_BLUETOOTH_CONNECT_TIMEOUT_MS,
            writeTimeoutMs: DEFAULT_BLUETOOTH_WRITE_TIMEOUT_MS,
            bluetooth: printer.bluetooth,
          })
        : this.transportFactory({
            host: printer.host ?? '',
            port: printer.port ?? 9100,
            connectTimeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
            writeTimeoutMs: DEFAULT_WRITE_TIMEOUT_MS,
          });

    this.setStatus(job.id, 'connecting');
    const result = await transport.send(bytes);

    if (result.ok) {
      return this.succeed(job.id);
    }

    // Fase transmisi diambil dari driver: kalau byte sudah mulai keluar, kita
    // tidak boleh bilang "gagal" — kasir akan cetak ulang dan struknya dobel.
    const status = statusForError(
      result.error.code,
      result.error.transmissionStarted,
    );
    return this.finish(job.id, status, result.error);
  }

  /** Render byte sesuai tujuan job dan lebar kertas printer. */
  private render(job: PrintJob, printer: PrinterConfig): Uint8Array {
    const columns = PAPER_COLUMNS[printer.paperWidthMm];

    if (job.destination === 'kitchen_ticket') {
      return buildKitchenTicket(job.payload as KitchenTicketOrder, columns);
    }

    const order = job.payload as ReceiptOrder;
    if (!order.items || order.items.length === 0) {
      throw new Error('Order tidak punya item — tidak ada yang bisa dicetak.');
    }
    return buildReceipt(order, columns);
  }

  /**
   * Cetak N salinan struk sebagai N job terpisah ke printer yang sama.
   *
   * Dipisah jadi job masing-masing supaya kegagalan satu salinan tidak
   * menghapus salinan lain dari antrean.
   */
  submitReceiptCopies(
    orderId: string,
    printerId: string,
    payload: ReceiptOrder,
    columns: number,
  ): PrintJob[] {
    const jobs: PrintJob[] = [];
    receiptCopies(payload, columns).forEach(copy => {
      const { job } = this.deps.repo.createOrGet({
        // orderId turunan per salinan: tanpa itu, tiga salinan bertabrakan di
        // kunci idempotency dan hanya satu yang masuk antrean.
        orderId: `${orderId}#${copy.label}`,
        destination: 'customer_receipt',
        printerId,
        payload,
      });
      void this.run(job.id);
      jobs.push(job);
    });
    return jobs;
  }

  private setStatus(id: string, status: PrintJobStatus): void {
    this.deps.repo.updateStatus(id, status);
    this.emit(id);
  }

  private succeed(id: string): PrintResult {
    this.deps.repo.updateStatus(id, 'submitted', null, true);
    this.emit(id);
    return { jobId: id, status: 'submitted' };
  }

  private fail(
    id: string,
    code: PrintErrorCode,
    message: string,
  ): PrintResult {
    return this.finish(id, 'failed', {
      code,
      message,
      transmissionStarted: false,
      at: new Date().toISOString(),
    });
  }

  private finish(
    id: string,
    status: PrintJobStatus,
    error: PrintJobError | null,
  ): PrintResult {
    this.deps.repo.updateStatus(id, status, error, true);
    this.emit(id);
    return { jobId: id, status, error: error ?? undefined };
  }

  private emit(id: string): void {
    if (!this.deps.onJobStatusChange) {
      return;
    }
    const job = this.deps.repo.findById(id);
    if (job) {
      this.deps.onJobStatusChange(job);
    }
  }
}
