// src/security/originAllowlist.ts
// Allowlist origin untuk WebView. FUNGSI MURNI.
//
// Ini trust boundary terpenting di aplikasi: WebView memegang cookie sesi
// kasir. Kalau navigasi ke origin lain dibiarkan, halaman asing bisa memanggil
// bridge cetak DAN membaca apa pun yang bisa diakses cookie itu.

import { DEV_ORIGIN } from '../networking/ApiClient';

/**
 * Origin dev yang HANYA aktif di build debug.
 *
 *  - `localhost:3000` — server Next.js di laptop, dijangkau lewat
 *    `adb reverse tcp:3000 tcp:3000`. Ini jalur utama: lewat kabel USB,
 *    jadi tidak tersentuh firewall Windows dan tidak terpengaruh IP DHCP.
 *  - `10.0.2.2:3000` — alias host dari dalam emulator Android (AVD).
 *  - IP LAN laptop (mis. `192.168.1.9:3000`) — jalur cadangan tanpa kabel.
 *    Hanya jalan kalau Windows Firewall mengizinkan `node.exe` inbound;
 *    default-nya MEMBLOKIR di profil Public, jadi jangan andalkan ini.
 *    Jangan tulis IP tetap di kode yang dikirim: DHCP bisa mengubahnya.
 *
 * Entri ini boleh memanggil bridge cetak, jadi bahayanya nyata kalau ikut
 * terbawa ke APK rilis: siapa pun yang menjalankan server di port 3000 pada HP
 * itu bisa mengirim `PRINT_REQUEST`. Karena itu daftarnya dikunci `__DEV__`,
 * yang di-false-kan Metro saat bundling rilis. Jangan diganti jadi flag env
 * biasa — flag env gampang lupa dimatikan.
 */
const DEV_ORIGINS: readonly string[] = __DEV__
  ? ['http://localhost:3000', 'http://10.0.2.2:3000', DEV_ORIGIN]
  : [];

export const ALLOWED_ORIGINS: readonly string[] = [
  'https://spazio.melvapos.com',
  'https://spazio-dev.melvapos.com',
  ...DEV_ORIGINS,
];

/** Origin yang boleh dibuka di dalam app tapi TIDAK boleh menyentuh bridge. */
export const TRUSTED_NAVIGATION_ORIGINS: readonly string[] = [
  'https://spazio.melvapos.com',
  'https://spazio-dev.melvapos.com',
  'https://accounts.google.com',
  ...DEV_ORIGINS,
];

function normalize(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** true kalau URL boleh memanggil bridge cetak. */
export function isAllowedBridgeOrigin(url: string): boolean {
  const origin = normalize(url);
  return origin !== null && ALLOWED_ORIGINS.includes(origin);
}

/**
 * true kalau URL boleh dimuat DI DALAM WebView.
 *
 * Panggilan non-http(s) (tel:, mailto:, whatsapp:) selalu false — itu harus
 * dibuka oleh aplikasi lain lewat Linking.
 */
export function isAllowedNavigation(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return false;
  }
  return TRUSTED_NAVIGATION_ORIGINS.includes(parsed.origin);
}

/** Apakah URL ini tautan eksternal yang harus dibuka di browser? */
export function isExternalLink(url: string): boolean {
  const origin = normalize(url);
  if (origin === null) {
    return false;
  }
  return !TRUSTED_NAVIGATION_ORIGINS.includes(origin);
}
