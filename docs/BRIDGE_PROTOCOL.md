# Protokol Bridge

Kontrak antara PWA (di dalam WebView) dan aplikasi native.

## Bentuk pesan

Semua pesan adalah JSON dengan bentuk tetap:

```ts
type BridgeRequest = {
  type: 'PING'
      | 'GET_DEVICE_STATUS'
      | 'GET_PRINTERS'
      | 'PRINT_REQUEST'
      | 'CANCEL_PRINT_JOB'
      | 'SUBSCRIBE_JOB_STATUS';
  requestId: string;   // WAJIB, tidak boleh kosong
  payload?: unknown;
};

type BridgeResponse = {
  type: 'BRIDGE_RESPONSE' | 'JOB_STATUS_EVENT';
  requestId: string;
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
};
```

`requestId` bukan sekadar korelasi: **itu kunci dedup**. Native menyimpan
respons untuk 200 `requestId` terakhir. Permintaan ulang dengan `requestId`
yang sama mengembalikan respons lama tanpa membuat job baru. Karena itu PWA
**wajib** memakai `requestId` baru untuk setiap permintaan cetak yang benar-
benar baru, dan memakai ulang `requestId` lama saat melakukan retry.

## Sisi PWA

Native menyuntikkan `window.SpazioNative` sebelum halaman dimuat:

```js
// Kirim permintaan cetak.
const result = await window.SpazioNative.send('PRINT_REQUEST', {
  orderId: 'ord_abc123',
  destination: 'customer_receipt',   // atau 'kitchen_ticket'
  printerId: 'prn_xyz',              // opsional
  order: { /* objek order apa adanya */ },
});

// result: { jobId, status: 'queued', duplicate: false, notice: '...' }

// Pantau status job.
const unsubscribe = window.SpazioNative.onJobStatus(job => {
  // job.status: queued | connecting | sending | submitted | failed | unknown | cancelled
});
```

### Yang WAJIB diperhatikan PWA

`status: 'queued'` berarti **job tercatat di antrean**, bukan **struk tercetak**.
Tidak ada cara mengetahui kertas benar-benar keluar. UI PWA tidak boleh
menampilkan "Cetak berhasil" — gunakan "Sedang dikirim ke printer".

`duplicate: true` berarti order ini sudah pernah dikirim ke printer itu. Ini
mekanisme yang mencegah double-tap tombol cetak menghasilkan dua struk.

## Sisi native

Titik masuk: `BridgeHandler.handle(rawMessage: string)`.

Handler selalu mengembalikan respons — tidak pernah `null` — supaya WebView
tidak menggantung menunggu balasan yang tidak datang.

### Pemeriksaan keamanan sebelum pesan diproses

1. **Origin diperiksa lebih dulu** (`onMessage` di `SpazioWebView.tsx`). Pesan
   dari origin di luar allowlist dibuang tanpa dijawab. Tanpa cek ini, iframe
   pihak ketiga di dalam halaman bisa mengirim `PRINT_REQUEST`.
2. **Bentuk pesan divalidasi.** JSON rusak, `type` tidak dikenal, atau
   `requestId` kosong → ditolak.
3. **Payload `PRINT_REQUEST` divalidasi** sebelum menjadi job: `orderId` harus
   ada, `destination` harus salah satu nilai yang dikenal, `order` harus objek.

## Daftar permintaan

### `PING`
Respons: `{ pong: true }`. Dipakai PWA untuk memastikan bridge hidup.

### `GET_DEVICE_STATUS`
```json
{
  "bridgeReady": true,
  "platform": "android",
  "appVersion": "0.0.1",
  "hasPrinter": true,
  "printerCount": 2,
  "pendingJobCount": 0,
  "notice": "Printer terhubung bukan berarti struk tercetak. ..."
}
```

### `GET_PRINTERS`
Mengembalikan **ringkasan** printer: `id`, `name`, `destinations`, `enabled`.

**Host dan port sengaja TIDAK disertakan.** Halaman web tidak punya alasan
mengetahui alamat IP printer, dan menyembunyikannya berarti halaman yang
dibajak tidak bisa memetakan jaringan internal dari dalam aplikasi.

### `PRINT_REQUEST`
```json
{
  "orderId": "ord_abc123",
  "destination": "customer_receipt",
  "printerId": "prn_xyz",
  "order": { "...": "objek order" }
}
```

`printerId` hanya **menunjuk** printer mana yang dipakai. Alamat yang benar-
benar dihubungi dibaca dari konfigurasi lokal.

Kalau `printerId` tidak ada, respons `NO_PRINTER` — native tidak menebak.

Respons sukses:
```json
{
  "jobId": "job_...",
  "status": "queued",
  "duplicate": false,
  "notice": "Printer terhubung bukan berarti struk tercetak. ..."
}
```

### `CANCEL_PRINT_JOB`
```json
{ "jobId": "job_..." }
```

Hanya berhasil kalau job masih `queued`. Job yang sudah mulai mengirim tidak
bisa dibatalkan — membatalkannya akan meninggalkan setengah struk di buffer
printer, dan printer itu tidak punya cara membersihkan diri.

Kode error: `INVALID_PAYLOAD`, `JOB_NOT_FOUND`, `JOB_NOT_CANCELLABLE`.

### `SUBSCRIBE_JOB_STATUS`
```json
{ "jobIds": ["job_1", "job_2"] }
```
`jobIds` opsional; kosong berarti semua job.

## Kode error

| Kode | Arti |
| --- | --- |
| `INVALID_REQUEST` | Pesan tidak bisa diurai, atau `requestId` kosong |
| `INVALID_PAYLOAD` | Bentuk payload tidak sesuai kontrak |
| `NO_PRINTER` | Tidak ada `printerId` yang diberikan |

Kode error **cetak** (`CONNECTION_REFUSED`, `CONNECTION_TIMEOUT`, dst.) tidak
muncul sebagai respons `PRINT_REQUEST`. Respons itu dikirim sebelum transmisi
dimulai. Error cetak dilaporkan lewat `JOB_STATUS_EVENT` dan tersimpan di
riwayat cetak.
