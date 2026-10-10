// src/security/originAllowlist.ts
// Allowlist origin untuk WebView. FUNGSI MURNI.
//
// Ini trust boundary terpenting di aplikasi: WebView memegang cookie sesi
// kasir. Kalau navigasi ke origin lain dibiarkan, halaman asing bisa memanggil
// bridge cetak DAN membaca apa pun yang bisa diakses cookie itu.

export const ALLOWED_ORIGINS: readonly string[] = [
  'https://spazio.melvapos.com',
];

/** Origin yang boleh dibuka di dalam app tapi TIDAK boleh menyentuh bridge. */
export const TRUSTED_NAVIGATION_ORIGINS: readonly string[] = [
  'https://spazio.melvapos.com',
  'https://accounts.google.com',
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
