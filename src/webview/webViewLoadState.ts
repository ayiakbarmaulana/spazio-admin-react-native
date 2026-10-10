// src/webview/webViewLoadState.ts
// Status pemuatan WebView. FUNGSI MURNI.
//
// KENAPA ADA: react-native-webview TIDAK selalu memanggil `onError` saat
// halaman gagal dimuat. Kalau host tujuan tidak bisa dihubungi (server mati,
// port salah, firewall memblokir), Chromium menyerah di level navigasi dan
// yang menyala hanya `onLoadProgress` dengan progress < 1 â€” tidak pernah 1.
//
// Akibatnya spinner berputar selamanya tanpa pesan apa pun. Itu bukan skenario
// teoretis: itu yang terjadi waktu server dev mati. Karena `onError` tidak bisa
// diandalkan, satu-satunya jaring pengaman adalah batas waktu.

export type WebViewLoadState = {
  /** Spinner tampil. */
  loading: boolean;
  /** Halaman gagal dimuat; UI harus menampilkan alasan + tombol coba lagi. */
  failed: boolean;
  /** Alasan yang ditampilkan ke kasir, kalau ada. */
  reason?: string;
};

export const INITIAL_LOAD_STATE: WebViewLoadState = {
  loading: true,
  failed: false,
};

/**
 * Batas waktu memuat halaman, dalam ms.
 *
 * 20 detik: cukup longgar untuk bundel Next.js pertama kali di jaringan toko
 * yang lambat, cukup pendek supaya kasir tidak menatap spinner sampai dia
 * mengira app-nya hang.
 */
export const LOAD_TIMEOUT_MS = 20000;

export type WebViewLoadEvent =
  /** Navigasi baru mulai â€” reset total, termasuk kegagalan sebelumnya. */
  | { type: 'start' }
  /** Ada kemajuan; hanya berlaku kalau belum gagal. */
  | { type: 'progress'; progress: number }
  /** Halaman selesai dimuat. */
  | { type: 'done' }
  /** Kegagalan yang dilaporkan native (onError / onHttpError). */
  | { type: 'fail'; reason?: string }
  /** Batas waktu habis â€” jaring pengaman terakhir. */
  | { type: 'timeout' };

/**
 * Ambang progress untuk menganggap halaman selesai.
 *
 * React Native WebView kadang melaporkan 0.99 karena satu subresource yang
 * tidak pernah selesai. Menunggu tepat 1.0 membuat spinner nyangkut walau
 * halaman sudah tampil dan bisa dipakai.
 */
const PROGRESS_DONE_THRESHOLD = 0.99;

export function webViewLoadReducer(
  state: WebViewLoadState,
  event: WebViewLoadEvent,
): WebViewLoadState {
  switch (event.type) {
    case 'start':
      return { loading: true, failed: false };

    case 'progress':
      // Jangan bangunkan kembali spinner kalau sudah dinyatakan gagal; beberapa
      // WebView mengirim progress sisa setelah error.
      if (state.failed) {
        return state;
      }
      if (event.progress >= PROGRESS_DONE_THRESHOLD) {
        return { loading: false, failed: false };
      }
      return state;

    case 'done':
      return { loading: false, failed: false };

    case 'fail':
      return { loading: false, failed: true, reason: event.reason };

    case 'timeout':
      // Kegagalan native sudah punya alasan lebih spesifik â€” jangan ditimpa.
      if (state.failed) {
        return state;
      }
      return {
        loading: false,
        failed: true,
        reason: 'Halaman tidak merespons dalam 20 detik.',
      };
  }
}
