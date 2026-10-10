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

it('flag allowlist bridge hanya berisi origin PWA', () => {
  expect(ALLOWED_ORIGINS).toEqual(['https://spazio.melvapos.com']);
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

it('semua origin navigasi terpercaya memakai https', () => {
  for (const origin of TRUSTED_NAVIGATION_ORIGINS) {
    expect(origin.startsWith('https://')).toBe(true);
  }
});
