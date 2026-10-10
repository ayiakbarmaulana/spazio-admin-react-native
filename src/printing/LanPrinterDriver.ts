// src/printing/LanPrinterDriver.ts
// Driver printer jaringan (ESC/POS over raw TCP, default port 9100).
//
// ATURAN YANG TIDAK BOLEH DILANGGAR (PRD §6.4, §10.2):
//  1. Setiap job membuka koneksi sendiri dan menutupnya sendiri. Tidak ada
//     koneksi yang dipegang lama — printer thermal murah memutus idle socket
//     tanpa memberi tahu, dan job berikutnya akan menulis ke socket mati.
//  2. Kedua fase (connect dan write) punya timeout sendiri. Tanpa itu, socket
//     ke IP yang tidak ada akan menggantung selamanya dan antrean berhenti.
//  3. 'submitted' berarti SEMUA byte sudah diserahkan ke socket dan socket
//     ditutup normal. Itu BUKAN bukti kertas tercetak (PRD §4.2C).

import type { PrintJobError } from '../types/printing';
import type {
  PrinterTransport,
  SendResult,
  TransportTarget,
} from './PrinterTransport';
import { TimeoutError, toJobError } from './transportErrors';

/**
 * Tipe minimal socket react-native-tcp-socket yang kami pakai. Ditulis tangan
 * supaya modul ini TIDAK meng-import paket native di top-level — driver hanya
 * di-import saat benar-benar mencetak, dan test bisa mengimpor file ini tanpa
 * menyalakan NativeEventEmitter.
 */
type TcpSocketInstance = {
  write: (data: Uint8Array, encoding?: string, cb?: (error?: Error) => void) => void;
  end: () => void;
  destroy: () => void;
  once: (event: 'error' | 'close', listener: (error?: Error) => void) => void;
  on: (event: 'error', listener: (error: Error) => void) => void;
};

type TcpSocketModule = {
  createConnection: (
    options: { host: string; port: number },
    callback: () => void,
  ) => TcpSocketInstance;
};

function loadTcpSocket(): TcpSocketModule {
  // require malas: mencegah modul native dievaluasi di lingkungan test.
  const mod = require('react-native-tcp-socket');
  return (mod.default ?? mod) as TcpSocketModule;
}

/** Perintah pulse kas laci — tidak dipakai sekarang, disediakan untuk nanti. */
const DRAWER_KICK = Uint8Array.of(0x1b, 0x70, 0x00, 0x19, 0xfa);

export class LanPrinterDriver implements PrinterTransport {
  private socket: TcpSocketInstance | null = null;
  private closed = false;

  constructor(private readonly target: TransportTarget) {}

  /** Buka koneksi dengan timeout connect. */
  private connect(): Promise<TcpSocketInstance> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        // Socket yang menggantung saat connect harus dibuang, bukan dibiarkan.
        try {
          socket.destroy();
        } catch {
          // destroy() pada socket yang sudah mati aman diabaikan.
        }
        reject(new TimeoutError('connect', this.target.connectTimeoutMs));
      }, this.target.connectTimeoutMs);

      const socket = loadTcpSocket().createConnection(
        { host: this.target.host, port: this.target.port },
        () => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          this.socket = socket;
          resolve(socket);
        },
      );

      socket.on('error', (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  /**
   * Tulis seluruh buffer. Resolve hanya setelah semua byte diserahkan ke
   * socket DAN socket ditutup normal — bukan setelah write() menerima callback,
   * karena callback itu cuma berarti "masuk buffer OS".
   */
  private write(socket: TcpSocketInstance, bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        finish(() => reject(new TimeoutError('write', this.target.writeTimeoutMs)));
      }, this.target.writeTimeoutMs);

      socket.once('error', error => finish(() => reject(error ?? new Error('socket error'))));
      socket.once('close', () => finish(resolve));

      try {
        // react-native-tcp-socket menerima Uint8Array apa adanya.
        socket.write(bytes, 'utf8', (error?: Error) => {
          if (error) {
            finish(() => reject(error));
            return;
          }
          // end() mengirim FIN; event 'close' menandakan printer sudah
          // menerima semuanya dan soket benar-benar bersih.
          socket.end();
        });
      } catch (error) {
        finish(() => reject(error));
      }
    });
  }

  async send(bytes: Uint8Array): Promise<SendResult> {
    if (this.closed) {
      return { ok: false, error: this.error('TRANSPORT_UNSUPPORTED') };
    }

    let transmissionStarted = false;
    let socket: TcpSocketInstance | null = null;

    try {
      socket = await this.connect();
      // Setelah titik ini, sebagian byte bisa saja sudah keluar kalau write
      // gagal di tengah → error berikutnya diklasifikasikan 'unknown'.
      transmissionStarted = true;
      await this.write(socket, bytes);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: toJobError(error, transmissionStarted),
      };
    } finally {
      this.closeSocket(socket);
    }
  }

  /**
   * Uji sambung. Hanya perintah inisialisasi + feed yang dikirim â€” cukup untuk
   * membuktikan ada sesuatu di ujung socket, dan tidak menghasilkan struk
   * kosong yang bikin bingung.
   */
  async test(): Promise<SendResult> {
    return this.send(Uint8Array.of(0x1b, 0x40, 0x0a, 0x0a));
  }

  private closeSocket(
    socket: TcpSocketInstance | null,
  ): void {
    if (!socket) {
      return;
    }
    try {
      socket.destroy();
    } catch {
      // Socket sudah tertutup — tidak ada yang perlu dilakukan.
    }
    if (this.socket === socket) {
      this.socket = null;
    }
  }

  close(): void {
    this.closed = true;
    this.closeSocket(this.socket);
  }

  private error(code: PrintJobError['code']): PrintJobError {
    return {
      code,
      message: 'Koneksi printer sudah ditutup.',
      transmissionStarted: false,
      at: new Date().toISOString(),
    };
  }
}

export { DRAWER_KICK };
