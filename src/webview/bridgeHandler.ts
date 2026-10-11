// src/webview/bridgeHandler.ts
// Menangani pesan dari WebView. Kelasnya sendiri (bukan hook) supaya bisa
// diuji tanpa merender WebView.

import type { PrintDispatcher } from '../printing/PrintDispatcher';
import { PrintJobRepository } from '../printing/PrintJobRepository';
import type { PrinterConfig } from '../types/printing';
import {
  type BridgeRequest,
  type BridgeResponse,
  type DeviceStatus,
  type PrintRequestPayload,
  errorResponse,
  okResponse,
  parseBridgeRequest,
  validatePrintRequest,
} from './bridgeProtocol';

export type BridgeDeps = {
  dispatcher: PrintDispatcher;
  repo: PrintJobRepository;
  listPrinters: () => Promise<PrinterConfig[]>;
  /** Printer aktif untuk sebuah tujuan. Dipakai kalau PWA tidak mengirim id. */
  findPrinterForDestination: (
    destination: PrinterConfig['destinations'][number],
  ) => Promise<PrinterConfig | null>;
  platform: string;
  appVersion: string;
  onJobStatusSubscribe: (
    requestId: string,
    jobIds: string[] | undefined,
  ) => void;
};

/** Peringatan yang selalu ikut di status — jangan dihapus (PRD §4.2C). */
export const CONNECTION_NOT_PRINTED_NOTICE =
  'Printer terhubung bukan berarti struk tercetak. Periksa kertas printer ' +
  'setelah mencetak.';

export class BridgeHandler {
  /** requestId yang sudah diproses → responsnya. Kunci dedup anti-struk-dobel. */
  private readonly processed = new Map<string, BridgeResponse>();

  constructor(private readonly deps: BridgeDeps) {}

  /**
   * Titik masuk tunggal. SELALU mengembalikan respons (tidak pernah null),
   * supaya WebView tidak menggantung menunggu balasan.
   */
  async handle(raw: string): Promise<BridgeResponse> {
    const request = parseBridgeRequest(raw);
    if (!request) {
      // requestId tidak bisa dipercaya di sini, jadi dipakai penanda tetap.
      return errorResponse(
        'unknown',
        'INVALID_REQUEST',
        'Permintaan tidak sah.',
      );
    }

    // Retry dari WebView setelah timeout harus mendapat respons yang SAMA,
    // bukan perintah cetak kedua.
    const cached = this.processed.get(request.requestId);
    if (cached) {
      return cached;
    }

    const response = await this.route(request);
    this.processed.set(request.requestId, response);
    // Batasi memori: 200 requestId terakhir sudah jauh lebih dari cukup.
    if (this.processed.size > 200) {
      const oldest = this.processed.keys().next().value;
      if (oldest !== undefined) {
        this.processed.delete(oldest);
      }
    }
    return response;
  }

  private async route(request: BridgeRequest): Promise<BridgeResponse> {
    switch (request.type) {
      case 'PING':
        return okResponse(request.requestId, { pong: true });
      case 'GET_DEVICE_STATUS':
        return okResponse(request.requestId, await this.deviceStatus());
      case 'GET_PRINTERS':
        return okResponse(request.requestId, await this.printerSummary());
      case 'PRINT_REQUEST':
        return await this.handlePrint(request);
      case 'CANCEL_PRINT_JOB':
        return this.handleCancel(request);
      case 'SUBSCRIBE_JOB_STATUS': {
        const payload = request.payload as { jobIds?: string[] } | undefined;
        this.deps.onJobStatusSubscribe(request.requestId, payload?.jobIds);
        return okResponse(request.requestId, { subscribed: true });
      }
    }
  }

  /** Hanya ringkasan printer — id, nama, tujuan. Host TIDAK dikirim ke WebView. */
  private async printerSummary(): Promise<
    { id: string; name: string; destinations: string[]; enabled: boolean }[]
  > {
    const printers = await this.deps.listPrinters();
    return printers.map(p => ({
      id: p.id,
      name: p.name,
      destinations: p.destinations,
      enabled: p.enabled,
    }));
  }

  async deviceStatus(): Promise<DeviceStatus> {
    const printers = await this.deps.listPrinters();
    return {
      bridgeReady: true,
      platform: this.deps.platform,
      appVersion: this.deps.appVersion,
      hasPrinter: printers.some(p => p.enabled),
      printerCount: printers.length,
      pendingJobCount: this.deps.repo.findPending().length,
      notice: CONNECTION_NOT_PRINTED_NOTICE,
    };
  }

  /**
   * Cetak. Job dipersist SEBELUM respons dikirim, jadi WebView boleh
   * memperlakukan ack sebagai "sudah tercatat", bukan "sudah tercetak".
   */
  private async handlePrint(request: BridgeRequest): Promise<BridgeResponse> {
    const validation = validatePrintRequest(request.payload);
    if (!validation.ok) {
      return errorResponse(
        request.requestId,
        'INVALID_PAYLOAD',
        validation.message,
      );
    }

    const payload: PrintRequestPayload = validation.value;
    // printerId dari WebView hanya boleh MENUNJUK printer mana; host/port tetap
    // dari konfigurasi lokal. PWA memang tidak mengirimnya (tidak tahu printer),
    // jadi kalau kosong native yang memilih printer aktif pertama untuk tujuan
    // itu — bukan menolak. Host/port tidak pernah sampai ke WebView.
    const printerId =
      payload.printerId ??
      (await this.deps.findPrinterForDestination(payload.destination))?.id;

    // Tanpa printer: JANGAN menolak sebelum menyimpan. Tiket dapur yang hilang
    // tanpa jejak adalah bug yang mahal — kasir tidak melihat apa pun di
    // Riwayat Cetak dan struk pelanggan tetap tercetak seolah semuanya normal.
    // Kita catat job-nya sebagai gagal (NO_PRINTER) supaya muncul + bisa
    // dicetak ulang setelah printer didaftarkan.
    const job = printerId
      ? this.deps.dispatcher.submit({
          orderId: payload.orderId,
          destination: payload.destination,
          printerId,
          payload: payload.order as never,
        })
      : this.deps.dispatcher.submitUnroutable({
          orderId: payload.orderId,
          destination: payload.destination,
          payload: payload.order as never,
        });

    return okResponse(request.requestId, {
      jobId: job.id,
      status: job.status,
      // SELALU false. Dulu diisi dari dedup orderId + destination + printerId,
      // tapi dedup itu sudah dihapus: kasir berhak mencetak struk yang sama
      // berkali-kali. Field dipertahankan supaya PWA lama tidak pecah.
      //
      // Pengaman yang TERSISA: `handle()` menyimpan respons per `requestId`,
      // jadi retry setelah timeout (requestId sama) bukan job kedua.
      duplicate: false,
      // Tanpa printer, job-nya PASTI gagal. Beri tahu WebView supaya tidak
      // menampilkan toast sukses.
      queued: Boolean(printerId),
      notice: CONNECTION_NOT_PRINTED_NOTICE,
    });
  }

  private handleCancel(request: BridgeRequest): BridgeResponse {
    const payload = request.payload as { jobId?: string } | undefined;
    const jobId = payload?.jobId;
    if (!jobId) {
      return errorResponse(request.requestId, 'INVALID_PAYLOAD', 'jobId wajib.');
    }

    const job = this.deps.repo.findById(jobId);
    if (!job) {
      return errorResponse(request.requestId, 'JOB_NOT_FOUND', 'Job tidak ada.');
    }
    if (job.status !== 'queued') {
      // Job yang sudah mulai mengirim tidak bisa dibatalkan; membatalkannya
      // akan meninggalkan setengah struk di buffer printer.
      return errorResponse(
        request.requestId,
        'JOB_NOT_CANCELLABLE',
        'Job sudah mulai dikirim dan tidak bisa dibatalkan.',
      );
    }

    this.deps.repo.updateStatus(jobId, 'cancelled');
    return okResponse(request.requestId, { jobId, status: 'cancelled' });
  }

  /** Untuk test: bersihkan cache requestId. */
  resetDedupeCache(): void {
    this.processed.clear();
  }
}
