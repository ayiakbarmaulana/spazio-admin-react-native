# Kompatibilitas Printer

## Ringkasan jujur

**Belum ada printer yang diuji dengan aplikasi ini.** Semua perangkat keras di
bawah ini adalah perangkat yang *seharusnya* bekerja berdasarkan protokol yang
didukung, bukan perangkat yang sudah diverifikasi.

Menguji pada perangkat asli adalah item pertama di daftar pekerjaan yang belum
selesai. Lihat [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

## Bahasa perintah: ESC/POS vs TSPL vs ZPL

Printer thermal tidak semuanya bicara bahasa yang sama. Aplikasi ini mendukung
tiga protokol, dipilih eksplisit per printer di **Pengaturan Printer → Protokol
Printer**:

| Protokol | Untuk | Renderer | Koneksi |
| --- | --- | --- | --- |
| **ESC/POS** | Struk 58/80mm, tiket dapur | `src/printing/EscPosRenderer.ts` | LAN, Bluetooth |
| **TSPL/TSPL2** | Label produk 20×30mm | `src/printing/TsplTemplate.ts` | LAN |
| **ZPL/ZPL II** | Label produk 20×30mm | `src/printing/ZplTemplate.ts` | LAN |

Salah pilih protokol = printer meng-ack job tapi tidak ada kertas keluar
(job tampak "terkirim", label tetap kosong). Validasi
(`validatePrinterConfig`) menolak kombinasi yang pasti salah: tujuan `label`
tanpa protokol label, dan protokol label tanpa tujuan `label`.

### Cara memilih protokol yang benar

Protokol tertulis di **halaman konfigurasi printer** (biasanya dicetak dengan
menahan tombol feed saat printer dinyalakan). Ciri yang membedakan:

- Halaman konfigurasi/self-test menampilkan `TSPL` atau `TSPL2` → pilih TSPL.
- Menampilkan `ZPL`, `ZPL II`, atau model Zebra/Argox/TSC mode ZPL → pilih ZPL.
- Halaman konfigurasi tidak menyebut protokol sama sekali, tapi ada di daftar
  driver Windows sebagai "(TSPL)" atau "(ZPL)" → ikuti nama driver itu.

Kalau tetap ragu: cetak halaman uji dari **Uji Koneksi** dengan masing-masing
protokol label. Yang benar menghasilkan label tercetak; yang salah tidak
menghasilkan kertas apa pun (ZPL/TSPL yang tidak cocok diabaikan diam-diam).

## Printer label BP-TR110 (TSPL)

Blueprint BP-TR110 (driver `BP-TR110(TSPL)`) bicara **TSPL**, bukan ESC/POS —
walau sama-sama dikirim mentah lewat socket TCP port 9100. Yang dicetak: label
produk 20×30mm berisi nama produk, varian, dan notes order item.

Skrip yang dihasilkan `buildLabel()`:

```
SIZE 20 mm,30 mm
GAP 2 mm,0
DIRECTION 1
CLS
TEXT x,y,"3",0,1,1,"<nama produk>"
TEXT x,y,"2",0,1,1,"<varian>"
TEXT 4,y,"1",0,1,1,"<notes>"
TEXT 4,y,"1",0,1,1,"<noreceipt>"
PRINT 1,1
```

### Checklist uji fisik (tidak bisa diverifikasi dari kode)

- [ ] **`SIZE 20 mm,30 mm` cocok dengan label fisik.** Kalau tidak, isi label
      terpotong atau label terbuang.
- [ ] **`GAP 2 mm,0` cocok dengan sensor printer.** Kalau label beruntun tanpa
      gap (label kontinu), ganti baris ini dengan `BLACK MARK`/`GAP 0,0`
      sesuai manual printer.
- [ ] **Nomor order di bagian bawah label tidak terpotong.** Kalau terpotong,
      naikkan `LABEL_HEIGHT_MM` atau kecilkan font.
- [ ] **Notes panjang (>3 baris) tidak melimpah keluar label.** `buildLabel`
      membatasi maksimal 3 baris notes; sisanya dipotong.

> ⚠️ TSPL lewat Bluetooth **belum didukung** — jalur BLE masih ESC/POS. BP-TR110
> pakai LAN (atau USB, yang juga belum didukung aplikasi ini).

## Printer label ZPL (ZPL II)

Zebra, Argox dalam mode ZPL, TSC dalam mode ZPL, dan sebagian BP-TR110 dengan
firmware ZPL bicara **ZPL II** — bukan TSPL. Bedanya bukan cuma nama: ZPL
mengirim satu aliran perintah yang diawali `^XA` dan diakhiri `^XZ`, dan printer
langsung mencetak saat `^XZ` diterima (tidak ada baris "PRINT").

Skrip yang dihasilkan `buildLabel()` di `src/printing/ZplTemplate.ts`:

```
^XA
^CI28
^PW240
^LL160
^MNY
^PR4
^FO0,y^A0N,22,22^FB240,1,0,C,0^FD<nama produk>^FS
^FO0,y^A0N,18,18^FB240,1,0,C,0^FD<varian>^FS
^FO4,y^A0N,14,14^FB240,3,0,C,0^FD<notes>^FS
^FO4,y^A0N,14,14^FB240,1,0,C,0^FD<noreceipt>^FS
^XZ
```

> ⚠️ **Sumbu ZPL BP-TR110 kebalikan TSPL.** Media 20×30mm dimuat dengan sisi
> 30mm melintang kepala cetak, jadi `^PW` = 30mm (240 dots) dan `^LL` = 20mm
> (160 dots). TSPL memakai `SIZE 20 mm,30 mm` — jangan disamakan. Ini sudah
> diverifikasi di printer fisik: `^PW240 ^LL160` tegak & utuh; `^PW160 ^LL240`
> terbalik dan terpotong di tepi.

| Perintah | Arti |
| --- | --- |
| `^XA` / `^XZ` | Buka / tutup format — `^XZ` juga memicu cetak |
| `^CI28` | Code page UTF-8, supaya huruf non-ASCII tidak jadi sampah |
| `^PW240` / `^LL160` | Lebar cetak 30mm / panjang feed 20mm dalam dots @203dpi |
| `^MNY` | Media non-kontinu (label bergap) |
| `^PR4` | Kecepatan cetak sedang |
| `^FO x,y` | Titik awal field |
| `^A0N,h,w` | Font scalable A0 (device-independent), tinggi & lebar dalam dots |
| `^FB w,lines,,C,` | Blok teks: lebar, batas baris, perataan tengah (printer yang membungkus) |
| `^FD ... ^FS` | Isi field, lalu tutup |

### Checklist uji fisik (tidak bisa diverifikasi dari kode)

- [ ] **`^PW240`/`^LL160` cocok dengan label fisik** (sumbu ZPL kebalikan TSPL:
      lebar cetak 30mm, feed 20mm). Untuk printer 300dpi, kalikan dots dengan
      300/203 (354×236) — saat ini nilainya masih dipatok 203dpi.
- [ ] **`^MNY` (non-kontinu) cocok dengan media.** Untuk label kontinu, ganti
      jadi `^MNN` atau hapus barisnya sesuai manual printer.
- [ ] **Konten tidak menempel tepi atas/bawah.** Margin 20 dots di kedua sisi
      (`TOP_MARGIN_DOTS`/`BOTTOM_MARGIN_DOTS`); `noreceipt` ikut kursor, bukan
      dipatok dari dasar label.
- [ ] **Font `A0` benar-benar dirender.** Sebagian printer ZPL lama hanya punya
      font bitmap; kalau label kosong padahal `^XZ` terkirim, ganti `^A0N,h,w`
      menjadi font bitmap (`^A@N,h,w,<file>`) sesuai manual printer.
- [ ] **Notes panjang (>3 baris) tidak melimpah keluar label.** `^FB` dibatasi
      3 baris untuk notes; sisanya dibuang printer, bukan dicetak keluar label.

> ⚠️ ZPL lewat Bluetooth **belum didukung**, sama seperti TSPL — jalur BLE masih
> ESC/POS. Pakai LAN.

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
2. Izin `BLUETOOTH_CONNECT` / `BLUETOOTH_SCAN` **diminta aplikasi saat
   menjalankan Uji Koneksi atau mencetak** (Android 12 ke atas). Aplikasi
   memanggil `PermissionsAndroid.requestMultiple` lewat
   `src/printing/bluetoothPermissions.ts` sebelum menyentuh adaptor, karena
   `react-native-ble-plx` tidak meminta izin sendiri. Kalau ditolak, hasilnya
   `BLUETOOTH_PERMISSION_DENIED`; kalau ditolak permanen, pesannya mengarahkan
   ke **Pengaturan → Aplikasi → Spazio → Izin**.
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
| Blueprint BP-TR110 (TSPL) | 20×30mm label | | | _belum diuji_ |
| Zebra / ZPL II generic | 20×30mm label | | | _belum diuji_ |
