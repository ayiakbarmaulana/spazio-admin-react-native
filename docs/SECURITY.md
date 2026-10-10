# Keamanan

## Batas kepercayaan

| Zona | Dipercaya? | Catatan |
| --- | --- | --- |
| PWA di `spazio.melvapos.com` | Ya, untuk perintah cetak | Memegang cookie sesi kasir |
| WebView pada umumnya | **Tidak** | Origin apa pun bisa memuat di dalam WebView |
| Payload `PRINT_REQUEST` | **Tidak** | Divalidasi sebelum menjadi job |
| Konfigurasi printer lokal | Ya | Hanya bisa diubah pengguna lewat layar pengaturan |
| Jaringan lokal | **Tidak** | TCP mentah tanpa enkripsi (lihat di bawah) |

## Origin allowlist

`src/security/originAllowlist.ts`. Dua daftar terpisah:

- **`ALLOWED_ORIGINS`** — origin yang boleh memanggil bridge cetak. Hanya PWA
  Spazio.
- **`TRUSTED_NAVIGATION_ORIGINS`** — origin yang boleh dimuat di dalam WebView.
  PWA Spazio dan halaman login Google.

Pemisahan ini disengaja. Halaman login Google boleh muncul di WebView, tapi
**tidak boleh** memanggil `PRINT_REQUEST`.

Pemeriksaan memakai `new URL(url).origin`, bukan pencocokan string. Itu penting:
`https://spazio.melvapos.com@evil.example.com` berisi teks origin yang benar
tapi sebenarnya mengarah ke `evil.example.com`. Hanya parsing URL yang bisa
membedakannya.

### Origin dev terpisah dari produksi

Origin dev (`http://localhost:3000`, `http://10.0.2.2:3000`) dikunci di balik
`__DEV__`. Di bundel rilis daftarnya kosong, jadi tidak ada server lokal yang
bisa memanggil bridge cetak di HP kasir.

Jangan ganti mekanisme ini dengan flag env biasa: flag env gampang lupa
dimatikan, sedangkan `__DEV__` di-false-kan Metro secara otomatis saat
bundling rilis.

### Dua lapis, dan kenapa keduanya perlu

| Lapis | File | Tugas |
| --- | --- | --- |
| `originWhitelist` (WebView) | `src/security/originWhitelist.ts` | Menyaring URL **sebelum** halaman dimuat |
| `isAllowedNavigation` | `src/security/originAllowlist.ts` | Menahan navigasi ke origin di luar daftar |

`originWhitelist` **bukan** pengaman. Pola di situ dicocokkan sebagai awalan
regex, sehingga `https://spazio.melvapos.com.evil.example.com` dan
`https://spazio.melvapos.com:8443` sama-sama lolos. Yang benar-benar menahan
keduanya adalah `isAllowedNavigation`. Kedua sifat itu diuji di
`__tests__/unit/origin-whitelist.test.ts`.

Jangan menulis pola sendiri di komponen WebView — pakai `toOriginWhitelist()`,
dan sadari bentuk polanya harus `${origin}*`, bukan `${origin}/*`. Versi `/*`
tidak pernah cocok karena react-native-webview membandingkan terhadap origin
saja (tanpa path), dan kegagalannya berupa spinner tanpa pesan.

### Firewall saat dev

Windows Firewall memblokir `node.exe` inbound di profil Public. Membuka port
untuk LAN berarti mengekspos server dev ke seluruh jaringan. Jalur yang
disarankan: `adb reverse tcp:3000 tcp:3000`, lalu pakai `http://localhost:3000`
di HP. Lewat USB, tidak menyentuh firewall sama sekali.

Navigasi non-`http(s)` (`tel:`, `mailto:`, `whatsapp:`, `intent:`) selalu
ditolak di WebView dan diteruskan ke aplikasi lain lewat `Linking`.

## Tidak ada API key di dalam APK

`src/networking/ApiClient.ts` sengaja hanya memanggil `/api/health`, endpoint
publik tanpa autentikasi.

Kunci API yang ditanam di APK bisa diambil siapa pun yang punya file APK-nya —
cukup dengan membuka arsipnya. Menaruhnya di sana bukan pengamanan, hanya ilusi
pengamanan. Karena itu:

- Panggilan yang butuh autentikasi tetap dilakukan **di dalam WebView**, memakai
  cookie sesi better-auth yang sudah ada di sana.
- Aplikasi native tidak pernah menyimpan kredensial kasir.
- `react-native-keychain` terpasang sebagai dependensi tapi belum dipakai.
  Gunakan itu, bukan AsyncStorage, kalau suatu saat kredensial memang perlu
  disimpan di sisi native.

## Host printer tidak pernah keluar dari aplikasi

`GET_PRINTERS` mengembalikan id, nama, dan tujuan — bukan alamat.

Halaman web tidak punya alasan mengetahui alamat IP printer. Kalau halaman itu
dibajak, host yang tersembunyi membuat penyerang tidak bisa memetakan jaringan
internal lewat bridge. Dan `PRINT_REQUEST` hanya bisa **menunjuk** printer mana
yang dipakai; alamatnya dibaca native dari konfigurasi lokal.

## Lalu lintas cetak tidak terenkripsi

Printer ESC/POS kelas POS tidak mendukung TLS. Data struk dikirim sebagai TCP
mentah di LAN.

Sejauh mana ini dapat diterima: jaringan restoran umumnya jaringan privat, dan
yang bisa menyadap sudah berada di dalam jaringan itu. Yang **tidak** boleh
dikirim lewat jalur ini adalah kredensial, token, atau data pelanggan di luar
apa yang sudah tercetak di struk.

Jangan pernah mencoba menambal ini dengan "TLS di atas socket printer" — printer
tidak akan memahami handshake-nya.

## `usesCleartextTraffic`

Diaktifkan di `android/app/build.gradle`.

Android 9+ memblokir HTTP dan TCP mentah secara default. Memblokirnya berarti
cetak LAN mati total. Karena yang dihubungi hanya alamat privat di LAN, dan
tidak ada kredensial yang lewat jalur ini, nilainya dapat diterima.

Konsekuensi yang harus disadari: seluruh aplikasi juga boleh memakai HTTP
cleartext. Halaman WebView tetap dibatasi allowlist origin, sehingga halaman
luar tidak ikut memanfaatkan kelonggaran ini.

## Izin Android

| Izin | Alasan |
| --- | --- |
| `INTERNET` | Memuat PWA dan membuka socket TCP ke printer |
| `ACCESS_NETWORK_STATE` | Sudah tercakup INTERNET; dinyatakan eksplisit agar terlihat saat review |

Tidak ada izin lokasi, kamera, mikrofon, atau penyimpanan eksternal.

## Yang belum dikerjakan

- **Certificate pinning** untuk PWA. Belum ada; mengandalkan validasi sertifikat
  bawaan sistem.
- **Integritas aplikasi** (Play Integrity). Belum ada.
- **Enkripsi database.** SQLite saat ini tidak dienkripsi; `op-sqlite`
  mendukung SQLCipher kalau nanti diperlukan.
- **Rotasi `requestId`.** Cache dedup menyimpan 200 entri terakhir. PWA yang
  retry lebih lambat dari 200 permintaan akan mendapat job baru — bukan
  masalah keamanan, tapi perlu diketahui.
