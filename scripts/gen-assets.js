#!/usr/bin/env node
/**
 * Generate Android icon + splash resources dari assets yang
 * dideklarasikan di app.json.
 *
 * Sumber konfigurasi: app.json -> "assets"
 * Output: android/app/src/main/res/**  (di-overwrite, jangan edit manual)
 *
 * Jalankan: npm run assets
 *
 * File sumber yang diperlukan (lihat app.json untuk path persisnya):
 *   icon.png            ikon legacy (dipakai Android < 8 / API < 26)
 *   icon-foreground.png lapisan depan adaptive icon (Android 8+). Opsional —
 *                       kalau tidak ada, icon.png yang dipakai sebagai gantinya.
 *                       Untuk hasil terbaik: 1024x1024, transparan, logo
 *                       di dalam 66% area tengah (zona aman 66dp dari 108dp).
 *   splash.png          logo layar pembuka
 *
 * File sumber tidak perlu persegi 1:1 — skrip memuatnya utuh (fit contain),
 * jadi wordmark lebar pun tidak terpotong. Tapi ikon launcher Android
 * memang dirancang untuk bentuk persegi; wordmark akan tampak sebagai pita
 * tipis di tengah ikon.
 *
 * Kalau salah satu file belum ada, skrip memberi tahu dan melewatinya —
 * bukan gagal. Jadi kamu bisa menyiapkan asset satu per satu.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const cfg = require(path.join(ROOT, 'app.json')).assets || {};

/** Kepadatan layar Android -> kelipatan ukuran dp. */
const DENSITIES = [
  { dir: 'mipmap-mdpi', scale: 1 },
  { dir: 'mipmap-hdpi', scale: 1.5 },
  { dir: 'mipmap-xhdpi', scale: 2 },
  { dir: 'mipmap-xxhdpi', scale: 3 },
  { dir: 'mipmap-xxxhdpi', scale: 4 },
];

/** Adaptive icon resmi: kanvas 108dp, zona aman 66dp di tengah. */
const ICON_DP = 48;
const FOREGROUND_DP = 108;

/**
 * Splash: satu file, ditaruh di drawable-nodpi supaya Android tidak
 * menskalakan ulang per kepadatan. 512dp sudah lebih dari cukup untuk
 * semua layar; logo akan tampil tajam di HP apa pun.
 */
const SPLASH_DP = 512;

function warn(msg) {
  process.stdout.write('  ! ' + msg + '\n');
}

function info(msg) {
  process.stdout.write('  ' + msg + '\n');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** '#RRGGBB' -> objek RGBA sharp. Fallback putih kalau format tidak dikenali. */
function hexToRgba(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return { r: 255, g: 255, b: 255, alpha: 1 };
  const h = m[1];
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    alpha: 1,
  };
}

function resolveAsset(key) {
  const rel = cfg[key];
  if (!rel) {
    warn('app.json -> assets.' + key + ' belum diset, dilewati.');
    return null;
  }
  const abs = path.resolve(ROOT, rel);
  if (!fs.existsSync(abs)) {
    warn(rel + ' belum ada, dilewati.');
    return null;
  }
  return abs;
}

/**
 * Tulis PNG persegi ke tiap folder kepadatan.
 *
 * opts:
 *   fit        'cover' (crop penuh kanvas) | 'contain' (muat utuh, sisakan margin)
 *   padding    fraksi 0-1 dari kanvas yang dipakai logo saat fit='contain'.
 *              Menentukan seberapa besar logo. Lihat tabel pemakaian di main().
 *   background warna kanvas { r, g, b, alpha } — tanpa ini kanvas transparan.
 *   mask       'circle' memotong hasil jadi lingkaran (ic_launcher_round).
 */
async function writeMipmaps(src, baseName, dp, opts = {}) {
  const { mask, fit = 'cover', padding = 1, background } = opts;

  for (const { dir, scale } of DENSITIES) {
    const size = Math.round(dp * scale);
    // Saat contain, logo hidup di kotak inner x inner; sisanya jadi margin.
    const inner = Math.max(1, Math.round(size * padding));
    const offset = Math.round((size - inner) / 2);
    const outDir = path.join(RES, dir);
    ensureDir(outDir);

    const logo = await sharp(src, { density: 300 })
      .resize(inner, inner, {
        fit,
        position: 'centre',
        // Tanpa background eksplisit, sharp mengisi margin 'contain' dengan
        // piksel premultiplied ber-alpha kecil, bukan transparan penuh.
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .ensureAlpha()
      .png()
      .toBuffer();

    const canvas = sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: background || { r: 0, g: 0, b: 0, alpha: 0 },
      },
    });

    let buf = await canvas
      .composite([{ input: logo, top: offset, left: offset }])
      .png()
      .toBuffer();

    if (mask === 'circle') {
      // Masking lewat SVG: kanvas bulat, komposit dengan blend dest-in.
      const circle = Buffer.from(
        '<svg width="' + size + '" height="' + size + '" xmlns="http://www.w3.org/2000/svg">' +
          '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + size / 2 + '" fill="#fff"/>' +
          '</svg>',
      );
      buf = await sharp(buf)
        .composite([{ input: circle, blend: 'dest-in' }])
        .png()
        .toBuffer();
    }

    fs.writeFileSync(path.join(outDir, baseName + '.png'), buf);
    info(dir + '/' + baseName + '.png  ' + size + 'x' + size);
  }
}

async function writeSplash(src) {
  const outDir = path.join(RES, 'drawable-nodpi');
  ensureDir(outDir);
  await sharp(src, { density: 300 })
    .resize(SPLASH_DP, SPLASH_DP, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(path.join(outDir, 'splash_logo.png'));
  info('drawable-nodpi/splash_logo.png  ' + SPLASH_DP + 'x' + SPLASH_DP);
}

/**
 * Adaptive icon (Android 8+). Foreground digambar pada kanvas 108dp,
 * isi wajib di dalam zona aman 66dp di tengah — supaya logo tidak terpotong
 * saat launcher menerapkan mask bulat/squircle.
 */
function writeAdaptiveIcon() {
  const dir = path.join(RES, 'mipmap-anydpi-v26');
  ensureDir(dir);
  const xml = (extra) =>
    [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<!-- Dibuat oleh scripts/gen-assets.js. Jangan edit manual. -->',
      '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
      '    <background android:drawable="@color/ic_launcher_background"/>',
      '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>',
      extra,
      '</adaptive-icon>',
      '',
    ]
      .filter((line) => line !== '')
      .join('\n');
  fs.writeFileSync(path.join(dir, 'ic_launcher.xml'), xml(''));
  fs.writeFileSync(
    path.join(dir, 'ic_launcher_round.xml'),
    xml('    <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>'),
  );
  info('mipmap-anydpi-v26/ic_launcher.xml (+ round)');
}

/** colors.xml menampung warna latar icon & splash, dirujuk dari styles.xml. */
function writeColors() {
  const dir = path.join(RES, 'values');
  ensureDir(dir);
  const body = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!-- Dibuat oleh scripts/gen-assets.js. Jangan edit manual. -->',
    '<resources>',
    '    <color name="ic_launcher_background">' + (cfg.iconBackground || '#FFFFFF') + '</color>',
    '    <color name="splash_background">' + (cfg.splashBackground || '#FFFFFF') + '</color>',
    '</resources>',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'colors.xml'), body);
  info('values/colors.xml');
}

async function main() {
  process.stdout.write('gen-assets: menulis ke ' + path.relative(ROOT, RES) + '\n');

  writeColors();
  writeAdaptiveIcon();

  let didWork = false;

  const icon = resolveAsset('icon');
  if (icon) {
    const bg = hexToRgba(cfg.iconBackground || '#FFFFFF');
    // Wordmark lebar: contain + padding supaya utuh, latar warna brand
    // menggantikan ruang kosong yang tadinya putih polos.
    await writeMipmaps(icon, 'ic_launcher', ICON_DP, {
      fit: 'contain',
      padding: 0.86,
      background: bg,
    });
    await writeMipmaps(icon, 'ic_launcher_round', ICON_DP, {
      fit: 'contain',
      padding: 0.80,
      background: bg,
      mask: 'circle',
    });
    didWork = true;
  }

  const fg = resolveAsset('iconForeground');
  const foregroundSrc = fg || icon;
  if (foregroundSrc) {
    if (!fg && icon) {
      info('icon-foreground.png tidak ada — memakai icon.png sebagai foreground.');
    }
    // 0.72 = lebar logo 78dp dari kanvas 108dp. Kompromi: cukup besar untuk
    // terbaca, tapi masih utuh di mask squircle/rounded-square. Launcher
    // dengan mask bulat penuh akan memotong sedikit ujung kiri/kanan.
    // Foreground pakai warna asli dari assets/icon.png (tanpa recolor),
    // di atas latar putih tetap: kontras tinta merah sudah cukup.
    await writeMipmaps(foregroundSrc, 'ic_launcher_foreground', FOREGROUND_DP, {
      fit: 'contain',
      padding: 0.72,
    });
    didWork = true;
  }

  const splash = resolveAsset('splash');
  if (splash) {
    await writeSplash(splash);
    didWork = true;
  }

  if (!didWork) {
    process.stdout.write(
      '\nBelum ada asset yang digenerate.\n' +
        'Taruh file di assets/ sesuai app.json lalu jalankan lagi: npm run assets\n',
    );
    return;
  }

  process.stdout.write('\nSelesai. Bangun ulang APK: cd android; .\\gradlew.bat assembleRelease\n');
}

main().catch((err) => {
  process.stderr.write('gen-assets gagal: ' + err.message + '\n');
  process.exitCode = 1;
});
