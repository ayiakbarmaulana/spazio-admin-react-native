// __tests__/unit/origin-allowlist.test.ts
// Allowlist origin WebView. Ini trust boundary terpenting: WebView memegang
// cookie sesi kasir, jadi origin yang salah bisa memanggil bridge cetak dan
// membaca data sesi.

import {
  ALLOWED_ORIGINS,
  isAllowedBridgeOrigin,
  isAllowedNavigation,
  isExternalLink,
  TRUSTED_NAVIGATION_ORIGINS,
} from '../../src/security/originAllowlist';
import { DEFAULT_ORIGIN } from '../../src/networking/ApiClient';

it('DEFAULT_ORIGIN yang dimuat WebView memang boleh dimuat', () => {
  // Pernah kejadian: DEFAULT_ORIGIN diubah ke IP LAN, tapi allowlist tidak.
  // Akibatnya halaman pertama diblokir dan spinner berputar tanpa pesan apa
  // pun. Test ini mengikat kedua sumber itu supaya tidak bisa berbeda lagi.
  expect(ALLOWED_ORIGINS).toContain(DEFAULT_ORIGIN);
  expect(isAllowedNavigation(`${DEFAULT_ORIGIN}/pos`)).toBe(true);
});

it('origin PWA boleh memanggil bridge', () => {
  expect(isAllowedBridgeOrigin('https://spazio.melvapos.com')).toBe(true);
  expect(
    isAllowedBridgeOrigin('https://spazio.melvapos.com/pos/success-dialog'),
  ).toBe(true);
});

it('origin lain TIDAK boleh memanggil bridge', () => {
  const blocked = [
    'https://evil.example.com',
    'https://spazio.melvapos.com.evil.example.com',
    'http://spazio.melvapos.com',
    'https://sub.spazio.melvapos.com',
    'file:///android_asset/index.html',
    'javascript:alert(1)',
    'about:blank',
    '',
    'bukan-url',
  ];

  for (const url of blocked) {
    expect(isAllowedBridgeOrigin(url)).toBe(false);
  }
});

it('origin dengan userinfo atau port berbeda tidak lolos', () => {
  // Trik klasik: "spazio.melvapos.com@evil.com" sebenarnya mengarah ke evil.com.
  expect(
    isAllowedBridgeOrigin('https://spazio.melvapos.com@evil.example.com'),
  ).toBe(false);
  expect(isAllowedBridgeOrigin('https://spazio.melvapos.com:8443')).toBe(false);
});

it('flag allowlist bridge memuat origin PWA, plus origin dev saat __DEV__', () => {
  expect(ALLOWED_ORIGINS).toContain('https://spazio.melvapos.com');
  // Jest menjalankan preset RN dengan __DEV__ = true, jadi jalur dev aktif di
  // sini. Jalur produksi diuji terpisah di test "produksi" di bawah.
  if (__DEV__) {
    expect(ALLOWED_ORIGINS).toContain('http://localhost:3000');
    expect(ALLOWED_ORIGINS).toContain('http://10.0.2.2:3000');
  } else {
    expect(ALLOWED_ORIGINS).toEqual(['https://spazio.melvapos.com']);
  }
});

it('navigasi http(s) ke origin terpercaya diizinkan', () => {
  expect(isAllowedNavigation('https://spazio.melvapos.com/pos')).toBe(true);
  expect(isAllowedNavigation('https://accounts.google.com/o/oauth2')).toBe(
    true,
  );
});

it('skema non-http ditolak di WebView — harus dilempar ke aplikasi lain', () => {
  const schemes = [
    'tel:+628123456789',
    'mailto:kasir@spazio.test',
    'whatsapp://send?phone=628123456789',
    'intent://scan/#Intent;scheme=zxing;end',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
  ];

  for (const url of schemes) {
    expect(isAllowedNavigation(url)).toBe(false);
  }
});

it('tautan luar dikenali untuk dibuka di browser', () => {
  expect(isExternalLink('https://google.com')).toBe(true);
  expect(isExternalLink('https://spazio.melvapos.com')).toBe(false);
  expect(isExternalLink('https://accounts.google.com')).toBe(false);
  // Bukan URL → bukan tautan luar yang bisa ditangani Linking.
  expect(isExternalLink('bukan-url')).toBe(false);
});

it('origin navigasi terpercaya memakai https, kecuali origin dev saat __DEV__', () => {
  for (const origin of TRUSTED_NAVIGATION_ORIGINS) {
    if (__DEV__ && origin.startsWith('http://')) {
      // Hanya origin dev yang boleh cleartext, dan hanya di build debug.
      // Daftar dev sengaja sempit: hanya host yang memang kita pakai.
      expect(['http://localhost:3000', 'http://10.0.2.2:3000']).toContain(
        origin,
      );
      continue;
    }
    expect(origin.startsWith('https://')).toBe(true);
  }
});

it('origin dev tidak bocor ke produksi', () => {
  // Modul membaca __DEV__ sekali saat init, jadi jalur produksi hanya bisa
  // diuji dengan memuat ulang modul di bawah __DEV__ = false.
  const devOrigins = ALLOWED_ORIGINS.filter(o => o.startsWith('http://'));
  if (__DEV__) {
    expect(devOrigins.length).toBeGreaterThan(0);
  }

  const previous = __DEV__;
  try {
    (global as unknown as { __DEV__: boolean }).__DEV__ = false;
    jest.resetModules();
    const prod = jest.requireActual<typeof import('../../src/security/originAllowlist')>(
      '../../src/security/originAllowlist',
    );

    expect(prod.ALLOWED_ORIGINS).toEqual(['https://spazio.melvapos.com']);
    expect(prod.TRUSTED_NAVIGATION_ORIGINS).toEqual([
      'https://spazio.melvapos.com',
      'https://accounts.google.com',
    ]);
    // Inti keamanannya: server apa pun di HP kasir tidak bisa memanggil bridge.
    for (const origin of devOrigins) {
      expect(prod.isAllowedBridgeOrigin(origin)).toBe(false);
      expect(prod.isAllowedNavigation(`${origin}/pos`)).toBe(false);
    }
  } finally {
    (global as unknown as { __DEV__: boolean }).__DEV__ = previous;
    jest.resetModules();
  }
});
