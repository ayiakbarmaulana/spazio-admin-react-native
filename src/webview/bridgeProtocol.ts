// src/webview/bridgeProtocol.ts
// Kontrak pesan antara WebView (PWA) dan app native.
//
// Semua pesan satu bentuk: { type, requestId, payload }. `requestId` WAJIB dan
// dikembalikan apa adanya di respons — itu kunci dedup: WebView yang retry
// karena timeout tidak boleh menghasilkan struk kedua.

export const BRIDGE_CHANNEL = 'SpazioBridge';

export type BridgeRequestType =
  | 'PING'
  | 'GET_DEVICE_STATUS'
  | 'GET_PRINTERS'
  | 'PRINT_REQUEST'
  | 'CANCEL_PRINT_JOB'
  | 'SUBSCRIBE_JOB_STATUS';

export type BridgeResponseType = 'BRIDGE_RESPONSE' | 'JOB_STATUS_EVENT';

export type BridgeRequest = {
  type: BridgeRequestType;
  requestId: string;
  payload?: unknown;
};

export type BridgeResponse = {
  type: BridgeResponseType;
  requestId: string;
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
};

/** Payload PRINT_REQUEST — dari PWA, tanpa host/port (PRD §5.2). */
export type PrintRequestPayload = {
  orderId: string;
  destination: 'customer_receipt' | 'kitchen_ticket' | 'label';
  /**
   * Opsional. Kalau kosong, printer pertama yang aktif dan melayani tujuan itu
   * yang dipakai. Host/port sengaja TIDAK ada di sini.
   */
  printerId?: string;
  order: unknown;
};

export type CancelPrintJobPayload = {
  jobId: string;
};

export type SubscribeJobStatusPayload = {
  /** Job yang mau dipantau. Kosong = semua job. */
  jobIds?: string[];
};

/** Status perangkat yang dipakai PWA untuk gating UI. */
export type DeviceStatus = {
  /** App native siap menerima perintah cetak. */
  bridgeReady: boolean;
  platform: string;
  appVersion: string;
  /** true kalau ada minimal satu printer aktif. */
  hasPrinter: boolean;
  printerCount: number;
  /** Job yang belum selesai (queued/connecting/sending). */
  pendingJobCount: number;
  /** Pesan eksplisit: koneksi ≠ tercetak (PRD §4.2C). */
  notice: string;
};

/** Validasi pesan masuk. Dipanggil SEBELUM payload apa pun dipakai. */
export function parseBridgeRequest(raw: string): BridgeRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const candidate = parsed as Partial<BridgeRequest>;
  if (typeof candidate.type !== 'string') {
    return null;
  }
  if (typeof candidate.requestId !== 'string' || candidate.requestId === '') {
    return null;
  }
  if (!isKnownRequestType(candidate.type)) {
    return null;
  }
  return {
    type: candidate.type,
    requestId: candidate.requestId,
    payload: candidate.payload,
  };
}

const KNOWN_TYPES: readonly BridgeRequestType[] = [
  'PING',
  'GET_DEVICE_STATUS',
  'GET_PRINTERS',
  'PRINT_REQUEST',
  'CANCEL_PRINT_JOB',
  'SUBSCRIBE_JOB_STATUS',
];

export function isKnownRequestType(value: string): value is BridgeRequestType {
  return (KNOWN_TYPES as readonly string[]).includes(value);
}

export function okResponse(
  requestId: string,
  data?: unknown,
): BridgeResponse {
  return { type: 'BRIDGE_RESPONSE', requestId, ok: true, data };
}

export function errorResponse(
  requestId: string,
  code: string,
  message: string,
): BridgeResponse {
  return {
    type: 'BRIDGE_RESPONSE',
    requestId,
    ok: false,
    error: { code, message },
  };
}

/**
 * Payload PRINT_REQUEST wajib memuat orderId, tujuan, dan objek order.
 * Divalidasi di sini supaya handler tidak perlu percaya apa pun dari WebView.
 */
export function validatePrintRequest(
  payload: unknown,
): { ok: true; value: PrintRequestPayload } | { ok: false; message: string } {
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, message: 'Payload cetak kosong.' };
  }
  const p = payload as Partial<PrintRequestPayload>;

  if (typeof p.orderId !== 'string' || p.orderId.trim() === '') {
    return { ok: false, message: 'orderId wajib diisi.' };
  }
  if (
    p.destination !== 'customer_receipt' &&
    p.destination !== 'kitchen_ticket' &&
    p.destination !== 'label'
  ) {
    return { ok: false, message: 'Tujuan cetak tidak dikenal.' };
  }
  if (typeof p.order !== 'object' || p.order === null) {
    return { ok: false, message: 'Data order kosong.' };
  }
  if (p.printerId !== undefined && typeof p.printerId !== 'string') {
    return { ok: false, message: 'printerId harus berupa teks.' };
  }

  return {
    ok: true,
    value: {
      orderId: p.orderId,
      destination: p.destination,
      printerId: p.printerId,
      order: p.order,
    },
  };
}
