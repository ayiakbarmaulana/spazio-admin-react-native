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
| **Bluetooth (BLE/SPP)** | ❌ Belum didukung | Printer BLE kelas POS umumnya memerlukan handshake vendor sebelum menerima ESC/POS mentah. Implementasinya berbeda per model, jadi tidak bisa dibuat generik. |
| **USB (OTG)** | ❌ Belum didukung | Butuh driver USB host dan negosiasi endpoint per model printer. |
| **iOS** | ❌ Belum didukung | Direktori `ios/` masih ada dari template, tapi belum ada jalur cetak yang diimplementasikan. |

Bluetooth dan USB **tidak dibuatkan stub**. Tombol yang selalu gagal lebih
buruk daripada tombol yang tidak ada: kasir menghabiskan waktu mencoba, lalu
berhenti mempercayai menu pengaturan.

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
