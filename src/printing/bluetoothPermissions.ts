// src/printing/bluetoothPermissions.ts
// Izin runtime Bluetooth (Android 12 / API 31 ke atas).
//
// Deklarasi di AndroidManifest HANYA mendaftarkan izin; sejak targetSdk 31
// pengguna tetap harus memberi izin saat aplikasi berjalan. ble-plx tidak
// meminta izin sendiri, jadi tanpa berkas ini `createClient`/scan gagal dan
// pesan errornya tidak menyebut izin sama sekali.
//
// Inti klasifikasinya dipisah dari `PermissionsAndroid` supaya bisa diuji tanpa
// modul native (pola yang sama dengan BlePrinterDriver).

/** Izin yang dibutuhkan untuk mencetak lewat BLE di API 31+. */
export const BLUETOOTH_PERMISSIONS = [
  'android.permission.BLUETOOTH_SCAN',
  'android.permission.BLUETOOTH_CONNECT',
] as const;

export type PermissionCheck =
  | { ok: true }
  | { ok: false; message: string };

const DENIED_MESSAGE =
  'Izin Bluetooth belum diberikan. Izinkan Bluetooth, lalu coba lagi.';
const BLOCKED_MESSAGE =
  'Izin Bluetooth ditolak permanen. Buka Pengaturan → Aplikasi → Spazio → ' +
  'Izin, aktifkan Bluetooth, lalu coba lagi.';

/**
 * Putuskan hasil permintaan izin. Murni — tidak menyentuh modul native.
 *
 * `results` mengikuti `PermissionsAndroid.RESULTS`: 'granted' | 'denied' |
 * 'never_ask_again'.
 */
export function classifyPermissionResult(input: {
  os: string;
  apiLevel: number;
  results?: readonly string[];
}): PermissionCheck {
  // iOS memakai dialog izin BLE bawaan sistem; Android < 12 tidak punya izin
  // runtime ini (dulu cukup izin lokasi, dan manifest memakai neverForLocation).
  if (input.os !== 'android' || input.apiLevel < 31) {
    return { ok: true };
  }

  const results = input.results ?? [];
  if (results.length === 0) {
    return { ok: false, message: DENIED_MESSAGE };
  }
  if (results.every(r => r === 'granted')) {
    return { ok: true };
  }
  if (results.includes('never_ask_again')) {
    return { ok: false, message: BLOCKED_MESSAGE };
  }
  return { ok: false, message: DENIED_MESSAGE };
}

/**
 * Minta izin Bluetooth kalau memang dibutuhkan.
 *
 * Dipanggil di titik masuk (Uji Koneksi dan dispatcher), bukan di driver:
 * driver sengaja tidak meng-import paket native di top-level supaya bisa diuji.
 */
export async function ensureBluetoothPermission(): Promise<PermissionCheck> {
  // require malas: modul ini ikut ter-import di lingkungan test.
  const { Platform, PermissionsAndroid } = require('react-native') as {
    Platform: { OS: string; Version: number };
    PermissionsAndroid: {
      requestMultiple: (p: readonly string[]) => Promise<Record<string, string>>;
    };
  };

  if (Platform.OS !== 'android' || Platform.Version < 31) {
    return classifyPermissionResult({
      os: Platform.OS,
      apiLevel: Number(Platform.Version),
    });
  }

  try {
    const granted = await PermissionsAndroid.requestMultiple([
      ...BLUETOOTH_PERMISSIONS,
    ]);
    return classifyPermissionResult({
      os: Platform.OS,
      apiLevel: Number(Platform.Version),
      results: Object.values(granted),
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `Gagal meminta izin Bluetooth: ${error.message}`
          : DENIED_MESSAGE,
    };
  }
}
