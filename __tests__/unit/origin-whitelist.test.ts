// __tests__/unit/origin-whitelist.test.ts
// Pola originWhitelist untuk <WebView>.
//
// Bug yang dijaga test ini: entry `origin/*` bikin WebView menolak SEMUA
// halaman — termasuk halaman produksi — karena pembandingnya adalah origin
// tanpa path. Gejalanya bukan error, tapi spinner yang berputar selamanya.
//
// Fungsi di bawah adalah salinan persis
// node_modules/react-native-webview/src/WebViewShared.tsx. Kalau library-nya
// di-upgrade dan implementasinya berubah, test ini akan gagal — itu memang
// tujuannya.

import { toOriginWhitelist } from '../../src/security/originWhitelist';

const escapeStringRegexp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const originWhitelistToRegex = (entry: string): string =>
  `^${escapeStringRegexp(entry).replace(/\\\*/g, '.*')}`;

const extractOrigin = (url: string): string => {
  const result = /^[A-Za-z][A-Za-z0-9+\-.]+:(\/\/)?[^/]*/.exec(url);
  return result === null ? '' : result[0];
};

const passesWhitelist = (entries: readonly string[], url: string): boolean =>
  entries
    .map(originWhitelistToRegex)
    .some(re => new RegExp(re).test(extractOrigin(url)));

const ORIGINS = ['https://spazio.melvapos.com', 'http://localhost:3000'];

it('origin tanpa path dan origin dengan path sama-sama lolos', () => {
  const list = toOriginWhitelist(ORIGINS);

  // Yang tanpa path inilah yang dulu diblokir dan bikin spinner selamanya.
  expect(passesWhitelist(list, 'https://spazio.melvapos.com')).toBe(true);
  expect(passesWhitelist(list, 'https://spazio.melvapos.com/pos')).toBe(true);
  expect(passesWhitelist(list, 'http://localhost:3000')).toBe(true);
  expect(passesWhitelist(list, 'http://localhost:3000/pos')).toBe(true);
});

it('origin di luar daftar tetap ditolak', () => {
  const list = toOriginWhitelist(ORIGINS);

  const blocked = [
    'https://evil.example.com',
    'http://10.0.9.9:3000/pos',
    'http://localhost:4000/pos',
    'https://other-tenant.example.com',
  ];

  for (const url of blocked) {
    expect(passesWhitelist(list, url)).toBe(false);
  }
});

it('originWhitelist cocok lewat AWALAN, bukan kesetaraan penuh', () => {
  // Dua sifat bawaan react-native-webview yang harus disadari, karena
  // keduanya membuat originWhitelist TIDAK bisa dipakai sebagai pengaman.
  const list = toOriginWhitelist(ORIGINS);

  // 1. Host yang hanya menambahkan nama di belakang tetap cocok.
  expect(
    passesWhitelist(list, 'https://spazio.melvapos.com.evil.example.com'),
  ).toBe(true);

  // 2. Port apa pun ikut cocok — `*` memakan `:8443`.
  expect(passesWhitelist(list, 'https://spazio.melvapos.com:8443')).toBe(true);

  // Karena itu yang benar-benar menahan keduanya adalah isAllowedNavigation.
  const { isAllowedNavigation } = jest.requireActual<
    typeof import('../../src/security/originAllowlist')
  >('../../src/security/originAllowlist');
  expect(
    isAllowedNavigation('https://spazio.melvapos.com.evil.example.com/pos'),
  ).toBe(false);
  expect(isAllowedNavigation('https://spazio.melvapos.com:8443/pos')).toBe(
    false,
  );
});

it('bentuk `origin/*` memang salah — didokumentasikan sebagai test', () => {
  // Bukan saran pemakaian, melainkan pengunci regresi: kalau seseorang
  // mengubah toOriginWhitelist jadi menyisipkan '/', test ini yang gagal.
  const broken = ORIGINS.map(o => `${o}/*`);
  expect(passesWhitelist(broken, 'https://spazio.melvapos.com')).toBe(false);

  // Emulator dan localhost juga ikut mati, jadi bukan cuma produksi.
  expect(toOriginWhitelist(ORIGINS)).not.toEqual(broken);
});

it('duplikat dibuang dan urutan dipertahankan', () => {
  expect(toOriginWhitelist(['https://a.test', 'https://a.test'])).toEqual([
    'https://a.test*',
  ]);
  expect(toOriginWhitelist(['https://b.test', 'https://a.test'])).toEqual([
    'https://b.test*',
    'https://a.test*',
  ]);
});

it('allowlist nyata dari originAllowlist.ts bisa dimuat oleh WebView', () => {
  // Uji integrasi ringan: kombinasi yang benar-benar dipakai SpazioWebView.
  const { ALLOWED_ORIGINS, TRUSTED_NAVIGATION_ORIGINS } = jest.requireActual<
    typeof import('../../src/security/originAllowlist')
  >('../../src/security/originAllowlist');

  const list = toOriginWhitelist([
    ...ALLOWED_ORIGINS,
    ...TRUSTED_NAVIGATION_ORIGINS,
  ]);

  for (const origin of ALLOWED_ORIGINS) {
    expect(passesWhitelist(list, origin)).toBe(true);
  }
  for (const origin of TRUSTED_NAVIGATION_ORIGINS) {
    expect(passesWhitelist(list, origin)).toBe(true);
  }
});
