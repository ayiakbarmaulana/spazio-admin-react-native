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
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_WRITE_TIMEOUT_MS,
  PAPER_COLUMNS,
} from '../types/printing';
import { buildKitchenTicket } from './KitchenTicketTemplate';
import { LanPrinterDriver } from './LanPrinterDriver';
import { PrintJobRepository, type CreateJobInput } from './PrintJobRepository';
import { statusForError } from './PrintJobStateMachine';
import { printQueue } from './PrintQueue';
import type { PrinterTransport, TransportTarget } from './PrinterTransport';
import { buildReceipt } from './ReceiptTemplate';
import { receiptCopies } from './receiptCopies';

/** Pabrik driver — bisa ditukar di test tanpa menyentuh jaringan. */
export type TransportFactory = (target: TransportTarget) => PrinterTransport;

export const lanTransportFactory: TransportFactory = target =>
  new LanPrinterDriver(target);

export type DispatcherDeps = {
  repo: PrintJobRepository;
  getPrinter: (id: string) => Promise<PrinterConfig | null>;
  transportFactory?: TransportFactory;
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

  constructor(private readonly deps: DispatcherDeps) {
    this.transportFactory = deps.transportFactory ?? lanTransportFactory;
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

  /** Jalankan job yang sudah ada (cetak ulang). */
  async run(jobId: string): Promise<PrintResult> {
    const job = this.deps.repo.findById(jobId);
    if (!job) {
      return { jobId, status: 'failed' };
    }
    return printQueue.enqueue(job.printerId, job.id, () => this.execute(job));
  }

  /** Isi job dari awal sampai akhir. Serial per printer lewat antrean. */
  private async execute(job: PrintJob): Promise<PrintResult> {
    const printer = await this.deps.getPrinter(job.printerId);
    if (!printer || !printer.enabled) {
      return this.fail(
        job.id,
        'INVALID_CONFIG',
        'Printer tidak ditemukan atau sedang dinonaktifkan.',
      );
    }

    if (printer.connectionType !== 'lan') {
      // PRD §20.18: jangan pura-pura mencoba. Langsung gagal dengan alasan.
      return this.fail(
        job.id,
        'TRANSPORT_UNSUPPORTED',
        `Jenis koneksi "${printer.connectionType}" belum didukung.`,
      );
    }

    let bytes: Uint8Array;
    try {
      bytes = this.render(job, printer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.fail(job.id, 'INVALID_CONFIG', message);
    }

    const transport = this.transportFactory({
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
