# Pengujian

## Ringkasan

| Lapis | Perintah | Jumlah | Status |
| --- | --- | --- | --- |
| Tipe | `npm run typecheck` | — | Lolos |
| Lint | `npm run lint` | — | 0 error |
| Uji | `npm test` | 99 | Lolos |
| Uji fisik printer | — | — | **Belum dilakukan** |

## Menjalankan

```bash
npm test                      # semua
npm test -- receipt-template  # satu berkas
npm test -- --watch           # mode pantau
```

## Peta berkas uji

### `__tests__/unit/`

| Berkas | Yang dijaga |
| --- | --- |
| `receipt-template.test.ts` | 18 kasus. 9 pertama adalah port dari `spazio-admin/lib/thermal-print.check.ts` — memastikan struk native tidak menyimpang dari struk web. Sisanya: 80mm, nominal besar, order dibatalkan, DP, tiga salinan. |
| `kitchen-ticket.test.ts` | Tiket dapur tidak pernah memuat harga; mode `addition` tidak mencetak ulang item lama. |
| `print-job-state-machine.test.ts` | Transisi status; `unknown` untuk transmisi yang terputus. |
| `print-queue.test.ts` | Serial per printer, paralel antar printer; kegagalan tidak menghentikan antrean. |
| `print-job-repository.test.ts` | Dedup idempotency; pemulihan job macet. |
| `origin-allowlist.test.ts` | Origin palsu (`@evil.com`, port berbeda) ditolak. |
| `validation-and-backoff.test.ts` | Validasi IPv4 (termasuk leading zero); backoff dengan jitter; klasifikasi error socket. |

### `__tests__/integration/`

| Berkas | Yang dijaga |
| --- | --- |
| `print-dispatcher.test.ts` | Job dipersist sebelum byte pertama dikirim; dedup; host dari konfigurasi bukan payload. |
| `bridge-handler.test.ts` | `requestId` sama tidak mencetak dua kali; host printer tidak bocor ke WebView; payload cacat ditolak. |

### `__tests__/helpers/`

`fakeDatabase.ts` — implementasi `Database` in-memory. Uji tidak memakai SQLite
sungguhan: yang diuji adalah repository dan dispatcher, bukan mesin SQL.

**Batasannya:** kalau kueri repository bertambah rumit, helper ini harus
diganti dengan SQLite sungguhan (`better-sqlite3`) yang menjalankan migrasi
asli. Selama kueri masih berupa pola tetap, helper ini lebih cepat dan tidak
butuh kompilasi native.

## Menguji tanpa printer

Semua uji memakai `FakeTransport` — tidak ada socket yang dibuka.

```ts
const dispatcher = new PrintDispatcher({
  repo,
  getPrinter: async () => printerConfig(),
  transportFactory: target => new FakeTransport(target),
});
```

Transport palsu merekam byte yang dikirim, jadi uji bisa memeriksa isi struk
sungguhan lewat `TextDecoder` tanpa printer.

## Uji fisik yang WAJIB dilakukan sebelum dipakai

Tidak ada satu pun dari ini yang bisa digantikan uji otomatis.

### Persiapan
- [ ] Printer dan HP di WiFi yang sama
- [ ] Alamat IP printer benar
- [ ] Kertas terpasang, tutup printer rapat

### Dasar
- [ ] **Uji Koneksi** di aplikasi berhasil
- [ ] **Cetak Halaman Uji** mengeluarkan kertas (periksa fisik!)
- [ ] Struk pelanggan memuat: nomor, tanggal, kasir, item, TOTAL
- [ ] Tiket dapur memuat nomor, meja, item — dan **tidak ada harga**
- [ ] Teks tidak terpotong di lebar 32 kolom
- [ ] Teks tidak terpotong di lebar 48 kolom

### Kasus yang mudah terlewat
- [ ] Order dengan diskon voucher: baris "Diskon ..." tercetak
- [ ] Order gratis: tercetak "GRATIS", bukan "COMPLIMENTARY"
- [ ] Order tunai: "Uang Diterima" dan "Kembalian" tercetak
- [ ] Order dengan catatan panjang: catatan dibungkus, tidak dipotong
- [ ] Nama menu panjang: dibungkus, tidak terpotong

### Kegagalan
- [ ] **Cabut kabel LAN printer, lalu cetak.** Job harus berstatus `Gagal`.
- [ ] **Matikan printer saat sedang mencetak.** Job harus berstatus **Hasil
      Tidak Pasti**, bukan Gagal.
- [ ] Cetak ulang job yang gagal: struk keluar sekali, bukan dua kali
- [ ] Tekan tombol cetak dua kali cepat: hanya satu struk yang keluar
- [ ] Matikan aplikasi saat ada job mengantre, lalu buka lagi: job masih ada
      dan berstatus `unknown`

### Beban
- [ ] Cetak 10 struk berturut-turut: tidak ada yang terpotong atau tercampur
- [ ] Cetak struk dan tiket dapur bersamaan ke dua printer: keduanya utuh

## Melaporkan hasil

Catat printer yang diuji di
[PRINTER_COMPATIBILITY.md](PRINTER_COMPATIBILITY.md) — model, lebar, versi
firmware, tanggal, dan hasil. Ini satu-satunya cara klaim kompatibilitas
menjadi kenyataan.
