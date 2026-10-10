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
