# Persistensi Lokal dan Sinkronisasi

## Apa yang disimpan, dan di mana

| Data | Tempat | Alasan |
| --- | --- | --- |
| Konfigurasi printer | AsyncStorage | Kecil, dibaca utuh saat start, tidak butuh query relasional |
| Preferensi cetak | AsyncStorage | Jumlahnya sedikit |
| Job cetak | SQLite | Butuh query (per status, per printer, terurut), dan harus tahan mati mendadak |
| Order offline | SQLite | Hanya salinan sebelum tersinkron |
| Antrean sinkronisasi | SQLite | Butuh indeks `next_attempt_at` |

## Migrasi

`src/offline/migrations.ts`. Versi disimpan di `PRAGMA user_version`.

**Aturan: migrasi hanya boleh MENAMBAH.** Data di HP kasir adalah satu-satunya
salinan order offline yang belum pernah sampai ke server. `DROP TABLE` di sini
berarti kehilangan penjualan.

Setiap langkah dibungkus transaksi. Migrasi yang putus di tengah akan
di-`ROLLBACK` dan versi tidak naik, sehingga percobaan berikutnya mengulang
langkah yang sama.

## Job cetak: alur status

```
queued ──▶ connecting ──▶ sending ──▶ submitted
   │            │             │
   │            ├──▶ failed   ├──▶ failed      (gagal sebelum byte keluar)
   │            ├──▶ unknown  ├──▶ unknown     (gagal setelah byte keluar)
   │            └──▶ cancelled
   └──▶ cancelled
```

`submitted`, `failed`, `unknown`, dan `cancelled` bersifat **terminal** — tidak
berpindah lagi tanpa tindakan kasir. Transisi tidak sah melempar error, bukan
diabaikan diam-diam: itu selalu indikasi bug di dispatcher.

### Pemulihan saat aplikasi dibuka

Job yang masih `connecting` atau `sending` lebih dari 60 detik berarti proses
sebelumnya berhenti di tengah. Job itu ditandai **`unknown`, bukan `failed`**.

Alasannya: kita benar-benar tidak tahu apakah printer sempat mencetak. Menandai
`failed` akan membuat kasir mencetak ulang dengan tenang, dan struknya dobel.

## Sinkronisasi order offline

### Kondisi saat ini

Fondasinya sudah ada (`local_orders`, `sync_outbox`, `backoff.ts`), tapi **order
offline belum diimplementasikan sebagai fitur**.

Alasannya bukan kelalaian: pembuatan order offline memerlukan idempotensi di
sisi server supaya order yang dikirim dua kali tidak menjadi dua transaksi.
Endpoint itu belum ada. Menghidupkan fitur ini tanpa itu akan menghasilkan
order dobel yang lebih buruk daripada tidak bisa order sama sekali.

### Rancangan yang akan dipakai

1. Order dibuat lokal dengan `local_id` (bukan id server) dan status `pending`.
2. Baris masuk ke `sync_outbox` dengan operasi `CREATE`.
3. `SyncEngine` mengirim berdasarkan `next_attempt_at`.
4. Server mengembalikan `server_order_id`. `local_orders` diperbarui, status
   menjadi `synced`.
5. Job cetak yang menunjuk `local_id` diperbarui agar menunjuk id server.

### Backoff

Eksponensial dengan jitter penuh (`src/networking/backoff.ts`):

```
delay = random() * min(base * 2^attempt, max)
```

Jitter bukan hiasan. Tanpa itu, semua kasir yang sinkronnya gagal bersamaan —
misalnya ketika WiFi resto baru kembali — akan menghantam server di detik yang
sama.

### Konflik

Belum ada penanganan konflik otomatis. Aturan yang akan dipakai: **server
menang** untuk order yang sudah tersinkron. Perubahan lokal pada order yang
sudah tersinkron ditolak dan dilaporkan ke kasir, bukan digabung diam-diam.
