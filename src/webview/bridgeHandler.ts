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
        return this.handlePrint(request);
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
  private handlePrint(request: BridgeRequest): BridgeResponse {
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
    // dari konfigurasi lokal. Kalau kosong, tidak ada yang bisa dipilih.
    const printerId = payload.printerId;
    if (!printerId) {
      return errorResponse(
        request.requestId,
        'NO_PRINTER',
        'Tidak ada printer yang aktif untuk tujuan ini.',
      );
    }

    const { job, created } = this.deps.dispatcher.submit({
      orderId: payload.orderId,
      destination: payload.destination,
      printerId,
      payload: payload.order as never,
    });

    return okResponse(request.requestId, {
      jobId: job.id,
      status: job.status,
      // created=false artinya order ini memang sudah pernah dikirim — WebView
      // bisa membedakan double-tap dari permintaan baru.
      duplicate: !created,
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
