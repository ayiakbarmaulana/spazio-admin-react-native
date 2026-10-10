// src/security/originWhitelist.ts
// Pola `originWhitelist` untuk <WebView>.
//
// KENAPA HARUS TERPISAH DARI originAllowlist.ts: react-native-webview
// mengevaluasi daftar ini SEBELUM `onShouldStartLoadWithRequest` dipanggil,
// terhadap `extractOrigin(url)` — yaitu skema + host + port SAJA, tanpa path.
// Salah satu entry tidak cocok → halaman tidak dimuat sama sekali, dan karena
// tidak ada event yang menyala, UI hanya akan menampilkan spinner selamanya.
// Karena itu bentuk polanya diuji langsung.

/**
 * Ubah daftar origin jadi pola `originWhitelist`.
 *
 * `*` berfungsi sebagai wildcard; TIDAK boleh ditulis `origin/*`. Alasannya:
 * nilai pembandingnya adalah origin (`https://host:port`), yang tidak punya
 * slash di belakang, sehingga `^https://host/.*` tidak pernah cocok.
 */
export function toOriginWhitelist(origins: readonly string[]): string[] {
  return Array.from(new Set(origins)).map(origin => `${origin}*`);
}
