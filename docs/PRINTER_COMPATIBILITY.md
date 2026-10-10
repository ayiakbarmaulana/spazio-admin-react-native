# Kompatibilitas Printer

## Ringkasan jujur

**Belum ada printer yang diuji dengan aplikasi ini.** Semua perangkat keras di
bawah ini adalah perangkat yang *seharusnya* bekerja berdasarkan protokol yang
didukung, bukan perangkat yang sudah diverifikasi.

Menguji pada perangkat asli adalah item pertama di daftar pekerjaan yang belum
selesai. Lihat [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

## Koneksi

| Jenis | Status | Alasan |
| --- | --- | --- |
| **LAN (TCP)** | ✅ Didukung | Socket TCP mentah ke port 9100. Jalur paling andal: tidak butuh pairing, tidak butuh driver, dan bisa dipakai beberapa perangkat sekaligus. |
| **Bluetooth (BLE)** | ✅ Didukung | ESC/POS lewat GATT. Port dari Web Bluetooth yang dulu dipakai PWA. Printer harus sudah dipasangkan (paired) di Android. |
| **USB (OTG)** | ❌ Belum didukung | Butuh driver USB host dan negosiasi endpoint per model printer. |
| **iOS** | ❌ Belum didukung | Direktori `ios/` masih ada dari template, tapi belum ada jalur cetak yang diimplementasikan. |

USB **tidak dibuatkan stub**. Tombol yang selalu gagal lebih
buruk daripada tombol yang tidak ada: kasir menghabiskan waktu mencoba, lalu
berhenti mempercayai menu pengaturan.

### Bluetooth LE — cara kerja

Jalur BLE adalah **port dari `spazio-admin/lib/thermal-print.ts`**. PWA dulu
mencetak lewat Web Bluetooth (`navigator.bluetooth`), yang bekerja di Chrome
Android tapi **tidak tersedia di WebView** — WebView tidak pernah mendukung Web
Bluetooth. Karena itu jalur yang sama dipindah ke native lewat
`react-native-ble-plx`. UUID, urutan langkah, dan ukuran potongan tulis dibiarkan
identik supaya perilakunya sama dengan yang sudah terbukti jalan di printer
kasir nyata.

Prasyarat di HP kasir:

1. **Printer harus dipasangkan (paired) dulu** di Pengaturan Bluetooth Android.
   Aplikasi ini tidak memasangkan printer; kalau pairing gagal di level
   Android, aplikasi tidak bisa menolong.
2. Izin `BLUETOOTH_CONNECT` / `BLUETOOTH_SCAN` diberikan saat sistem meminta
   (Android 12 ke atas). Menolaknya membuat pemindaian gagal dengan
   `BLUETOOTH_PERMISSION_DENIED`.
3. Isi **Nama perangkat** atau **Alamat perangkat** di form printer untuk
   mempercepat pemilihan. Dikosongkan juga boleh: driver akan memilih perangkat
   terpasang yang namanya cocok dengan pola nama printer umum.

Urutan karakteristik yang dicoba (lihat `src/printing/bleProfiles.ts`):

| Prioritas | UUID | Keterangan |
| --- | --- | --- |
| 1 | `49535343-8841-43f4-a8d4-ecbe34729bb3` | RX ISSC Transparent UART — paling umum di printer BLE murah |
| 2 | UUID dari konfigurasi printer | dipakai lebih dulu kalau diisi |
| 3 | Karakteristik tulis pertama di layanan kandidat | jalur terakhir sebelum menyerah |

Tulis memakai potongan 180 byte; kalau gagal, offset yang sama diulang dengan
potongan 20 byte (bukan dari awal — byte yang sudah masuk printer tidak boleh
terkirim dua kali).

## Kertas

| Lebar | Kolom teks | Status |
| --- | --- | --- |
| 58 mm | 32 kolom | Didukung, perlu uji fisik |
| 80 mm | 48 kolom | Didukung, perlu uji fisik |

Lebar kolom adalah bagian dari kontrak byte. Mengubah nilainya akan
memperbarui fixture uji byte dan memecahkan kecocokan dengan implementasi web.

## Perintah ESC/POS yang dipakai

| Perintah | Byte | Dipakai untuk |
| --- | --- | --- |
| `ESC @` | `1B 40` | Inisialisasi printer |
| `ESC a n` | `1B 61 n` | Perataan (kiri/tengah) |
| `ESC E n` | `1B 45 n` | Tebal hidup/mati |
| `LF` | `0A` | Baris baru |
| `ESC d n` | `1B 64 n` | Umpan n baris |
| `GS V B 0` | `1D 56 42 00` | Potong sebagian |

Semuanya ada di `src/printing/EscPosRenderer.ts` sebagai konstanta bernama.
Perintah `ESC p 0 25 250` (pulse laci kas) sudah didefinisikan tapi belum
dipakai.

## Perintah yang sengaja TIDAK dipakai

- **QR code / barcode** (`GS ( k`): belum ada kebutuhan, dan sebagian printer
  murah mengabaikannya dengan cara yang sulit didiagnosis.
- **Karakter nasional / code page** (`ESC R`): teks struk seluruhnya ASCII
  setelah transliterasi rapi. Mengaktifkan code page menambah risiko karakter
  rusak pada printer yang tabelnya berbeda-beda.
- **Cek status real-time** (`DLE EOT`): banyak printer murah tidak menjawab,
  dan aplikasi akan menggantung menunggu balasan yang tidak datang. Fitur ini
  juga tidak akan memberi tahu apakah kertas keluar.

## Cara menambah printer baru

1. Hubungkan printer dan HP ke WiFi yang sama.
2. Cetak halaman konfigurasi printer untuk melihat alamat IP-nya.
3. Di aplikasi: **Pengaturan Printer → Tambah Printer**, masukkan alamat IP.
4. Tekan **Uji Koneksi**. Kalau gagal:
   - Coba buka `http://<alamat-ip>` di browser HP. Kalau tidak terbuka juga,
     masalahnya di jaringan, bukan di aplikasi ini.
   - Coba port lain: 9100 (paling umum), 9101, atau 515.
   - Matikan lalu nyalakan ulang printer.
5. Cetak halaman uji dan **periksa apakah kertas benar-benar keluar**.

## Mencatat printer yang sudah diverifikasi

Setelah sebuah model diuji di perangkat asli, tambahkan barisnya ke tabel ini
beserta tanggal, versi firmware, dan hasilnya:

| Model | Lebar | Firmware | Tanggal | Hasil |
| --- | --- | --- | --- | --- |
| _(belum ada)_ | | | | |
