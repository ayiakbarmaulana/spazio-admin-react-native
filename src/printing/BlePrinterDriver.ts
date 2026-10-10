// src/printing/BlePrinterDriver.ts
// Driver printer Bluetooth LE (ESC/POS over GATT).
//
// PORT DARI WEB: implementasi ini port dari spazio-admin/lib/thermal-print.ts,
// yang dulu mencetak lewat Web Bluetooth di PWA. Web Bluetooth mati di WebView
// Android, jadi jalur BLE dipindah ke native. Urutan langkah dan UUID-nya
// sengaja dibiarkan identik supaya perilakunya sama dengan yang sudah terbukti
// jalan di printer kasir nyata.
//
// ATURAN YANG TIDAK BOLEH DILANGGAR (PRD §6.4, §10.2):
//  1. Setiap job membuka koneksi sendiri dan menutupnya sendiri. Printer BLE
//     murah hanya menerima SATU koneksi — kalau dibiarkan terbuka, tombol cetak
//     berikutnya akan menggantung.
//  2. Kedua fase (connect dan write) punya timeout sendiri. BLE ke printer yang
//     bond-nya hilang bisa menggantung tanpa error di Android.
//  3. 'submitted' berarti SEMUA byte sudah diserahkan ke BLE stack dan koneksi
//     ditutup normal. Itu BUKAN bukti kertas tercetak (PRD §4.2C).

import type { BluetoothTarget, PrintJobError } from '../types/printing';
import {
  DEFAULT_BLUETOOTH_CONNECT_TIMEOUT_MS,
  DEFAULT_BLUETOOTH_WRITE_TIMEOUT_MS,
} from '../types/printing';
import {
  CANDIDATE_SERVICES,
  CHUNK_DELAY_MS,
  CHUNK_SIZE_BYTES,
  FALLBACK_CHUNK_SIZE_BYTES,
  ISSC_RX,
  PRINTER_NAME_HINT,
  REQUESTED_MTU,
} from './bleProfiles';
import type {
  PrinterTransport,
  SendResult,
  TransportTarget,
} from './PrinterTransport';
import { TimeoutError, toJobError } from './transportErrors';

/**
 * Tipe minimal react-native-ble-plx yang kami pakai. Ditulis tangan supaya
 * modul ini TIDAK meng-import paket native di top-level — driver hanya
 * di-import saat benar-benar mencetak, dan test bisa mengimpor file ini tanpa
 * menyalakan NativeEventEmitter. Bentuknya sengaja mencerminkan LanPrinterDriver.
 */
type BleCharacteristic = {
  uuid: string;
  serviceUUID: string;
  isWritableWithResponse: boolean;
  isWritableWithoutResponse: boolean;
};

type BleDevice = {
  id: string;
  name: string | null;
};

type BleManagerInstance = {
  state: () => Promise<string>;
  startDeviceScan: (
    uuids: string[] | null,
    options: unknown,
    listener: (error: Error | null, device: BleDevice | null) => void,
  ) => Promise<void>;
  stopDeviceScan: () => Promise<void>;
  connectToDevice: (deviceId: string) => Promise<BleDevice>;
  discoverAllServicesAndCharacteristicsForDevice: (
    deviceId: string,
  ) => Promise<BleDevice>;
  cancelDeviceConnection: (deviceId: string) => Promise<BleDevice>;
  requestMTUForDevice: (deviceId: string, mtu: number) => Promise<BleDevice>;
  characteristicsForDevice: (
    deviceId: string,
    serviceUUID: string,
  ) => Promise<BleCharacteristic[]>;
  writeCharacteristicWithoutResponseForDevice: (
    deviceId: string,
    serviceUUID: string,
    characteristicUUID: string,
    base64Value: string,
  ) => Promise<BleCharacteristic>;
  writeCharacteristicWithResponseForDevice: (
    deviceId: string,
    serviceUUID: string,
    characteristicUUID: string,
    base64Value: string,
  ) => Promise<BleCharacteristic>;
  destroy: () => Promise<void>;
};

type BlePlxModule = {
  BleManager: new (options?: unknown) => BleManagerInstance;
};

function loadBleManager(): BlePlxModule {
  // require malas: mencegah modul native dievaluasi di lingkungan test.
  const mod = require('react-native-ble-plx');
  return mod as BlePlxModule;
}

/** Target = target LAN + konfigurasi BLE opsional. */
export type BleTransportTarget = TransportTarget & {
  bluetooth?: BluetoothTarget;
};

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Base64 tanpa dependensi. ble-plx menerima nilai tulis dalam Base64; memakai
 * paket base64 hanya untuk ini berarti menambah dependency yang tetap harus
 * diaudit — 14 baris sudah cukup (ponytail).
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;

    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out +=
      b1 === undefined
        ? '='
        : BASE64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : BASE64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

export class BlePrinterDriver implements PrinterTransport {
  private manager: BleManagerInstance | null = null;
  private deviceId: string | null = null;
  private closed = false;

  constructor(private readonly target: BleTransportTarget) {}

  private ble(): BleManagerInstance {
    if (!this.manager) {
      try {
        this.manager = new (loadBleManager().BleManager)();
      } catch (error) {
        // Kasus paling umum: `NativeModules.BlePlx` null karena APK dibangun
        // tanpa modul native ini. Pesan aslinya ("Cannot read property
        // 'createClient' of null") tidak berarti apa-apa bagi kasir, jadi
        // ditulis ulang. Klasifikasi akhirnya tetap lewat transportErrors.
        const raw = error instanceof Error ? error.message : String(error);
        throw new Error(`BleManager.createClient of null: ${raw}`);
      }
    }
    return this.manager;
  }

  private get connectTimeoutMs(): number {
    return this.target.connectTimeoutMs || DEFAULT_BLUETOOTH_CONNECT_TIMEOUT_MS;
  }

  private get writeTimeoutMs(): number {
    return this.target.writeTimeoutMs || DEFAULT_BLUETOOTH_WRITE_TIMEOUT_MS;
  }

  /**
   * Cari perangkat yang mau dipakai:
   *  1. deviceId dari konfigurasi (paling pasti).
   *  2. Perangkat yang namanya cocok dan sedang advertise.
   *
   * Pemindaian dibatasi waktu supaya tidak menggantung — printer BLE murah
   * sering berhenti advertise setelah dipasangkan, jadi "tidak ketemu" harus
   * cepat dilaporkan, bukan menggantung sampai timeout Android.
   */
  private async resolveDeviceId(): Promise<string> {
    const configured = this.target.bluetooth?.deviceId?.trim();
    if (configured) {
      return configured;
    }

    const wantedName = this.target.bluetooth?.deviceName?.trim();
    const manager = this.ble();
    const wanted = wantedName
      ? new RegExp(wantedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      : null;

    return new Promise<string>((resolve, reject) => {
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        void manager.stopDeviceScan().catch(() => {});
        fn();
      };

      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        // Tanpa petunjuk nama, satu-satunya pilihan jujur adalah bilang tidak
        // ketemu — jangan menyambung ke perangkat acak.
        finish(() =>
          reject(
            new Error(
              wantedName
                ? `Bluetooth device not found: ${wantedName}`
                : 'Bluetooth device not found',
            ),
          ),
        );
      }, this.connectTimeoutMs);

      manager
        .startDeviceScan(null, null, (error, device) => {
          if (error) {
            finish(() => reject(error));
            return;
          }
          if (!device) {
            return;
          }
          const matches = wanted
            ? wanted.test(device.name ?? '')
            : PRINTER_NAME_HINT.test(device.name ?? '');
          if (matches) {
            const id = device.id;
            finish(() => resolve(id));
          }
        })
        .catch(error => finish(() => reject(error)));
    });
  }

  /** Buka koneksi + temukan karakteristik tulis. */
  private async connect(): Promise<BleCharacteristic> {
    const manager = this.ble();

    const state = await manager.state();
    if (state !== 'PoweredOn') {
      throw new Error(`Bluetooth adapter is ${state || 'disabled'}`);
    }

    const deviceId = await this.resolveDeviceId();
    this.deviceId = deviceId;

    await this.withTimeout(
      manager.connectToDevice(deviceId),
      'connect',
      this.connectTimeoutMs,
    );

    // WAJIB sebelum membaca karakteristik. `characteristicsForDevice` hanya
    // membaca cache GATT; cache itu kosong sampai discovery dijalankan, jadi
    // tanpa langkah ini hasilnya [] untuk SEMUA layanan dan driver berhenti
    // dengan "no writable characteristic" padahal printernya normal.
    // PWA tidak perlu ini karena `gatt.connect()` Web Bluetooth melakukan
    // discovery implisit — di native Android tidak ada padanannya.
    await this.withTimeout(
      manager.discoverAllServicesAndCharacteristicsForDevice(deviceId),
      'connect',
      this.connectTimeoutMs,
    );

    // Gagal requestMTU bukan error: potongan 20 byte tetap jalan, hanya lambat.
    await manager
      .requestMTUForDevice(deviceId, REQUESTED_MTU)
      .catch(() => undefined);

    const characteristic = await this.findWritableCharacteristic(deviceId);
    if (!characteristic) {
      throw new Error('No writable characteristic found on this device');
    }
    return characteristic;
  }

  /**
   * Cari karakteristik tulis. Urutan mengikuti PWA: karakteristik RX ISSC dulu
   * (paling umum), lalu kandidat layanan lain. Override dari konfigurasi menang.
   */
  private async findWritableCharacteristic(
    deviceId: string,
  ): Promise<BleCharacteristic | null> {
    const manager = this.ble();
    const overrideService = this.target.bluetooth?.serviceUuid?.trim();
    const overrideChar = this.target.bluetooth?.characteristicUuid?.trim();

    const services = overrideService
      ? [overrideService, ...CANDIDATE_SERVICES]
      : [...CANDIDATE_SERVICES];

    for (const serviceUUID of services) {
      let list: BleCharacteristic[];
      try {
        list = await manager.characteristicsForDevice(deviceId, serviceUUID);
      } catch (error) {
        // Layanan tidak ada di perangkat ini — lanjut ke kandidat berikutnya.
        // Tapi hanya kalau memang "tidak ada". Error lain (koneksi putus,
        // izin dicabut) HARUS naik: kalau ditelan, semuanya berakhir sebagai
        // "karakteristik tidak ditemukan" dan penyebab aslinya hilang.
        if (!/not found|no such|unknown|does not exist|service.*missing/i.test(
          error instanceof Error ? error.message : String(error),
        )) {
          throw error;
        }
        continue;
      }

      if (overrideChar) {
        const exact = list.find(c => c.uuid === overrideChar);
        if (exact) {
          return exact;
        }
      }

      const issc = list.find(c => c.uuid === ISSC_RX && this.isWritable(c));
      if (issc) {
        return issc;
      }

      const any = list.find(c => this.isWritable(c));
      if (any) {
        return any;
      }
    }
    return null;
  }

  private isWritable(c: BleCharacteristic): boolean {
    return c.isWritableWithResponse || c.isWritableWithoutResponse;
  }

  /**
   * Tulis seluruh buffer, dipotong-potong. Gagal di potongan besar → ulangi
   * offset yang SAMA dengan potongan kecil, bukan ulangi dari awal: byte yang
   * sudah masuk printer tidak boleh terkirim dua kali.
   */
  private async write(
    characteristic: BleCharacteristic,
    bytes: Uint8Array,
  ): Promise<void> {
    const manager = this.ble();
    const deviceId = this.deviceId as string;
    let chunkSize = CHUNK_SIZE_BYTES;
    let offset = 0;

    while (offset < bytes.length) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      try {
        await this.withTimeout(
          characteristic.isWritableWithoutResponse
            ? manager.writeCharacteristicWithoutResponseForDevice(
                deviceId,
                characteristic.serviceUUID,
                characteristic.uuid,
                bytesToBase64(chunk),
              )
            : manager.writeCharacteristicWithResponseForDevice(
                deviceId,
                characteristic.serviceUUID,
                characteristic.uuid,
                bytesToBase64(chunk),
              ),
          'write',
          this.writeTimeoutMs,
        );
      } catch (error) {
        if (chunkSize > FALLBACK_CHUNK_SIZE_BYTES) {
          chunkSize = FALLBACK_CHUNK_SIZE_BYTES;
          continue;
        }
        throw error;
      }
      offset += chunkSize;
      // Jeda kecil antar potongan — printer murah drop data kalau keburu.
      await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY_MS));
    }
  }

  async send(bytes: Uint8Array): Promise<SendResult> {
    if (this.closed) {
      return { ok: false, error: this.closedError() };
    }

    let transmissionStarted = false;
    try {
      const characteristic = await this.connect();
      // Setelah titik ini, sebagian byte bisa saja sudah keluar kalau write
      // gagal di tengah → error berikutnya diklasifikasikan 'unknown'.
      transmissionStarted = true;
      await this.write(characteristic, bytes);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: toJobError(error, transmissionStarted) };
    } finally {
      await this.disconnect();
    }
  }

  /**
   * Uji sambung. Hanya inisialisasi + feed — cukup membuktikan printer menerima
   * perintah, tanpa menghasilkan struk kosong yang membingungkan.
   */
  async test(): Promise<SendResult> {
    return this.send(Uint8Array.of(0x1b, 0x40, 0x0a, 0x0a));
  }

  private async disconnect(): Promise<void> {
    const deviceId = this.deviceId;
    this.deviceId = null;
    if (!deviceId || !this.manager) {
      return;
    }
    try {
      await this.manager.cancelDeviceConnection(deviceId);
    } catch {
      // Sudah putus / perangkat hilang — tidak ada yang bisa dibersihkan.
    }
  }

  close(): void {
    this.closed = true;
    void this.disconnect();
    if (this.manager) {
      const manager = this.manager;
      this.manager = null;
      // destroy() melepas resource native. Aman walau ada operasi tertunda:
      // BleManager sendiri yang membatalkannya.
      void manager.destroy().catch(() => {});
    }
  }

  private withTimeout<T>(
    promise: Promise<T>,
    phase: 'connect' | 'write',
    ms: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new TimeoutError(phase, ms));
      }, ms);
      promise.then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        error => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private closedError(): PrintJobError {
    return {
      code: 'TRANSPORT_UNSUPPORTED',
      message: 'Koneksi printer sudah ditutup.',
      transmissionStarted: false,
      at: new Date().toISOString(),
    };
  }
}

