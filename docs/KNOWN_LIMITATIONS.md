# Batasan yang Diketahui

Dokumen ini mencatat apa yang **belum** bisa dilakukan aplikasi ini. Semuanya
disengaja atau diketahui, bukan kelalaian yang tidak disadari.

## Belum ada printer yang diuji

Ini batasan terbesar. Seluruh kode cetak berjalan di atas protokol ESC/POS
standar dan diuji lewat byte-level fixture, tapi **belum pernah dijalankan pada
printer fisik**.

Menguji pada perangkat asli adalah pekerjaan pertama setelah dokumen ini
ditulis. Rencana pengujiannya ada di [TESTING.md](TESTING.md).

## Terhubung ≠ tercetak

Tidak ada printer thermal kelas POS yang melaporkan balik bahwa kertas benar-
benar keluar. Status `submitted` berarti seluruh byte sudah diserahkan ke
socket dan socket ditutup normal. Itu batas atas dari apa yang bisa diketahui.

Konsekuensi yang harus dihadapi:

- Aplikasi tidak bisa menampilkan "Cetak berhasil" dengan jujur.
- Kasir harus memeriksa kertas setelah mencetak.
- Status `unknown` bukan kelemahan yang bisa diperbaiki dengan kode yang lebih
  baik di sisi aplikasi. Itu sifat transportnya.

## Fitur yang tidak didukung

| Fitur | Alasan |
| --- | --- |
| BLE di luar profil ISSC | Driver mencoba ISSC Transparent UART lalu karakteristik tulis pertama; printer dengan handshake vendor khusus masih bisa gagal dengan `CHARACTERISTIC_NOT_FOUND` |
| Printer label (TSPL/ZPL) lewat Bluetooth | Jalur BLE masih ESC/POS saja; label dikirim lewat LAN |
| Printer label 300dpi | Dots ZPL/TSPL dipatok 203dpi (8 dots/mm); label 300dpi akan berukuran ⅔ dari seharusnya |
| BLE tanpa izin runtime Android 12+ | Aplikasi meminta `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT` lewat `src/printing/bluetoothPermissions.ts` saat Uji Koneksi atau mencetak. Kalau ditolak, `BLUETOOTH_PERMISSION_DENIED` |
| USB / OTG | Butuh driver USB host dan negosiasi endpoint per model |
| iOS | Belum ada jalur cetak; `ios/` masih dari template |
| Barcode / QR di struk | Belum ada kebutuhan; sebagian printer murah mengabaikannya dengan cara yang sulit didiagnosis |
| Cek status printer (`DLE EOT`) | Banyak printer murah tidak menjawab, dan aplikasi akan menggantung |
| Order offline | Butuh idempotensi di sisi server yang belum ada |
| Sinkronisasi otomatis | Kerangkanya ada (`backoff.ts`, tabel), engine-nya belum |
| Halaman kamar / billiard | Belum diintegrasikan |

## Bergantung pada perubahan di repo PWA

`spazio-admin/next.config.ts` semula mengirim `X-Frame-Options: DENY` pada semua
respons, yang secara harfiah berarti "jangan pernah tampilkan halaman ini di
dalam frame mana pun" — dan WebView dihitung sebagai frame.

**Sudah diperbaiki dan sudah ter-deploy.** Header `X-Frame-Options` diganti
dengan CSP `frame-ancestors 'self' https://spazio.melvapos.com`:

```
content-security-policy: frame-ancestors 'self' https://spazio.melvapos.com
```

Diverifikasi pada respons produksi `https://spazio.melvapos.com` (Oktober 2026):
`X-Frame-Options` sudah tidak dikirim.

**Yang belum terbukti: apakah WebView Android benar-benar menghormatinya.**
WebView di aplikasi ini tidak punya origin `https:` sendiri, sehingga `'self'`
tidak cocok untuknya. Yang menyelamatkan adalah entri eksplisit
`https://spazio.melvapos.com` di daftar. Harus diuji di perangkat asli — ini
item pertama di daftar uji fisik.

## Service worker bukan jalur offline

`spazio-admin/public/sw.js` berisi 59 byte tanpa cache:

```js
addEventListener("fetch", () => {})
```

Artinya **PWA tidak punya cache offline sama sekali**, dan tidak akan punya
sampai itu diimplementasikan. Aplikasi native tidak bisa menambal ini dari
luarnya.

Yang ada: layar offline untuk status perangkat, daftar job, dan pengaturan
printer — semuanya dilayani dari data lokal, jadi tetap berfungsi tanpa
internet. Yang tidak ada: mengisi order baru saat internet mati.

## Nomor struk dibuat di server

`noreceipt` dihasilkan server (`spazio-admin/lib/generate-noreceipt.ts`). Order
yang dibuat offline tidak akan punya nomor sampai tersinkron. Karena order
offline sendiri belum diimplementasikan, ini belum menjadi masalah nyata — tapi
akan menjadi masalah pertama begitu fitur itu dihidupkan.

Rekonsiliasi `local_id` ↔ `server_order_id` belum ada.

## Cache dedup bridge terbatas

`BridgeHandler` menyimpan 200 `requestId` terakhir. PWA yang melakukan retry
setelah lebih dari 200 permintaan lain akan mendapat job baru alih-alih respons
lama.

Dalam praktiknya tidak akan terjadi: retry terjadi dalam hitungan detik, bukan
setelah ratusan permintaan. Batas ini mencegah kebocoran memori pada aplikasi
yang berjalan berhari-hari.

## Modul native BLE bisa hilang dari APK

Gejala: **Uji Koneksi** printer Bluetooth gagal dengan
`Terjadi kesalahan cetak yang tidak dikenali.(Cannot read property
'createClient' of null)`. Sudah diperbaiki di sisi pesan — sekarang muncul
sebagai `PRINTING_MODULE_MISSING` dengan instruksi pasang ulang — tapi
**penyebabnya bukan di kode JS**.

Penyebabnya: APK yang sedang berjalan dibangun **sebelum
`react-native-ble-plx` terpasang** (atau sebelum ada perubahan native lain).
`NativeModules.BlePlx` bernilai null, lalu `react-native-ble-plx` memanggil
`BleModule.createClient(...)` dan melempar `Cannot read property 'createClient'
of null`.

Perbaikannya bukan mengubah kode, melainkan membangun ulang:

```
cd android
./gradlew clean
cd ..
npx react-native run-android
```

Pelajaran: setiap kali dependensi bernative berubah (`package.json`), APK lama
tidak akan bisa memakainya. `npx react-native run-android` yang memakai bundle
Metro akan tampak "segar" padahal bagian native-nya basi — gejalanya justru
error aneh yang terlihat seperti bug kode.

## Tidak ada enkripsi database

SQLite disimpan tanpa enkripsi. `op-sqlite` mendukung SQLCipher kalau nanti
diperlukan.

Yang tersimpan di sana: payload order (nama menu, jumlah, nominal) dan riwayat
job cetak. Tidak ada kredensial — kredensial hidup di WebView, dan tidak ada
API key di aplikasi ini.

## Tidak ada retry otomatis

Job yang gagal **tidak** dicoba ulang sendiri (`maxAutoRetries = 0`).

Itu keputusan, bukan kelalaian. Printer yang gagal karena habis kertas akan
gagal lagi kalau diulang otomatis, sementara kasir tidak sadar struknya belum
keluar. Cetak ulang adalah keputusan kasir, dan aplikasi memastikan
keputusannya berbasis informasi: gagal berarti tidak ada byte yang sampai, jadi
aman dicetak ulang.

## Spinner WebView butuh batas waktu

`react-native-webview` tidak selalu memanggil `onError` saat halaman gagal
dimuat. Kalau host tujuan tidak bisa dihubungi — server mati, port salah,
firewall memblokir — Chromium menyerah di level navigasi dan yang menyala hanya
`onLoadProgress` dengan progress di bawah 1, tidak pernah 1. Tanpa pengaman,
spinner berputar selamanya tanpa pesan apa pun.

Karena itu `src/webview/webViewLoadState.ts` memasang batas waktu 20 detik dan
`SpazioWebView.tsx` menampilkan layar gagal berisi alasan, origin yang dipakai,
dan tombol **Coba lagi**. Batas waktu 20 detik dipilih supaya bundel Next.js
pertama kali masih sempat selesai di jaringan lambat.

Konsekuensinya: halaman yang butuh lebih dari 20 detik untuk memuat akan
menampilkan layar gagal, padahal sebenarnya hanya lambat. Kalau itu terjadi di
lapangan, naikkan `LOAD_TIMEOUT_MS` — jangan hapus timernya.

## Node 20 tidak didukung

`npm install` memunculkan peringatan `EBADENGINE`. Tooling Metro dan Babel
React Native 0.87 menuntut Node 22.13+. Mesin pengembangan proyek ini memakai
Node 20.20.0.

Yang berjalan: `tsc`, `eslint`, `jest` — semuanya sudah diverifikasi lolos.
Yang berisiko: `react-native start` dan build Metro.

## Empat layar pengaturan, bukan lima

PRD §16 menyebut lima layar. Yang dibuat ada empat: Status Perangkat, Daftar
Printer, Form Printer, Riwayat Cetak.

Uji Koneksi tidak dibuat sebagai layar tersendiri karena halaman form sudah
memuatnya sebagai tombol. Memecahnya menjadi layar kelima berarti kasir harus
berpindah layar untuk menjalankan aksi yang sama, tanpa mendapat informasi
tambahan.
