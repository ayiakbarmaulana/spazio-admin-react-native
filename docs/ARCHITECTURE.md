# Arsitektur

## Batas sistem

```
┌────────────────────────────────────────────────────────────────┐
│ Aplikasi native (repo ini)                                     │
│                                                                │
│  ┌──────────────────────────┐      ┌───────────────────────┐   │
│  │ WebView                  │      │ Layar pengaturan      │   │
│  │ PWA Spazio (React)       │      │ Printer / Status /    │   │
│  │ • order, harga, bayar    │      │ Riwayat Cetak         │   │
│  │ • cookie sesi kasir      │      └───────────┬───────────┘   │
│  └────────────┬─────────────┘                  │               │
│               │ SpazioNative.send()            │               │
│               ▼                                ▼               │
│  ┌──────────────────────────┐      ┌───────────────────────┐   │
│  │ BridgeHandler            │      │ PrintDispatcher       │   │
│  │ • dedup requestId        │─────▶│ • validasi konfigurasi│   │
│  │ • validasi payload       │      │ • render ESC/POS/TSPL/ZPL │   │
│  └────────────┬─────────────┘      └───────────┬───────────┘   │
│               │                                │               │
│               ▼                                ▼               │
│  ┌──────────────────────────┐      ┌───────────────────────┐   │
│  │ PrintJobRepository       │      │ PrintQueue            │   │
│  │ (SQLite, sumber benar)   │      │ serial per printer    │   │
│  └──────────────────────────┘      └───────────┬───────────┘   │
│                                                │               │
│                                    ┌───────────▼───────────┐   │
│                                    │ LanPrinterDriver      │   │
│                                    │ TCP 9100, timeout ×2  │   │
│                                    ├───────────────────────┤   │
│                                    │ BlePrinterDriver      │   │
│                                    │ GATT, chunk 180→20 B  │   │
│                                    └───────────┬───────────┘   │
└────────────────────────────────────────────────┼───────────────┘
                                                 ▼
                                       Printer ESC/POS LAN
                                       (192.168.x.x:9100)
                                       atau printer label TSPL/ZPL
```

## Alur cetak satu struk

1. Kasir menekan "Cetak" di PWA.
2. PWA memanggil `window.SpazioNative.send('PRINT_REQUEST', {...})` dengan
   `requestId` unik.
3. `BridgeHandler` memvalidasi pesan dan memeriksa cache `requestId`. Kalau
   sudah pernah diproses, respons lama dikembalikan — **tidak ada job kedua**.
4. `PrintDispatcher.submit()` menulis job ke SQLite dengan status `queued`,
   **lalu** mengembalikan ack ke WebView.
5. Job masuk `PrintQueue` untuk printer itu. Antrean menjamin hanya satu job
   yang menyentuh satu printer pada satu waktu.
6. Saat gilirannya: `queued → connecting → sending`.
7. Driver sesuai jenis koneksi membuka jalur, mengirim seluruh buffer, menutup jalur:\n   LanPrinterDriver (socket TCP) atau BlePrinterDriver (GATT, potongan 180→20 byte).
8. Status akhir:
   - semua byte terkirim, socket ditutup normal → `submitted`
   - gagal sebelum byte pertama → `failed`
   - gagal setelah byte pertama → `unknown`

## Mengapa "persist dulu, ack kemudian"

Kalau ack dikirim sebelum job tercatat, matinya aplikasi di antara keduanya
menghasilkan struk yang tidak pernah tercetak dan tidak pernah tercatat —
kasir tidak punya cara mengetahuinya. Urutan sekarang memastikan setiap ack
punya baris database yang bisa diperiksa.

## Keputusan yang mudah disalahpahami

**Koneksi ditutup per job.** Bukan optimasi yang terlewat. Printer thermal
murah memutus socket idle tanpa memberi tahu, sehingga job berikutnya menulis
ke socket mati dan gagalnya tampak acak.

**Status `unknown` itu disengaja.** Klasifikasi biner berhasil/gagal membuat
koneksi yang putus di tengah dilaporkan "gagal". Kasir mencetak ulang, dan
struknya keluar dua kali.

**Host/port tidak pernah datang dari WebView.** Payload dari halaman web hanya
boleh *menunjuk* printer mana yang dipakai. Alamatnya sendiri dibaca dari
konfigurasi lokal, sehingga halaman yang dibajak tidak bisa mengarahkan cetakan
ke host lain.

**USB tidak dibuatkan stub.** Lihat `PrinterRegistry.ts`. Tombol
yang selalu gagal lebih buruk daripada tombol yang tidak ada.

**Bluetooth lewat BLE, bukan SPP.** WebView Android tidak punya
`navigator.bluetooth`, jadi jalur BLE yang dulu dipakai PWA (Web Bluetooth)
dipindah ke native memakai `react-native-ble-plx`. Driver-nya port dari
`spazio-admin/lib/thermal-print.ts` — UUID dan urutan langkahnya sama, supaya
tidak ada perilaku baru yang perlu ditemukan ulang saat uji di printer asli.
