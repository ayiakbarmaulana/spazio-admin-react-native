// src/networking/backoff.ts
// Backoff eksponensial dengan jitter. FUNGSI MURNI.
//
// Jitter wajib ada: tanpa itu, semua kasir yang sinkronnya gagal bersamaan
// (mis. saat wifi resto baru kembali) akan menghantam server di detik yang
// sama. Jitter menyebar percobaannya.

export type BackoffOptions = {
  baseMs: number;
  maxMs: number;
  /** Faktor pembatas laju. Default 2 (eksponensial). */
  factor?: number;
  /** Sumber acak — disuntik di test supaya hasilnya deterministik. */
  random?: () => number;
};

/**
 * Jeda sebelum percobaan ke-`attempt` (attempt dihitung dari 0).
 *
 * Hasilnya selalu < maxMs + jitter, dan tidak pernah < 0.
 */
export function backoffDelay(attempt: number, options: BackoffOptions): number {
  const { baseMs, maxMs, factor = 2, random = Math.random } = options;
  const exponential = Math.min(baseMs * Math.pow(factor, Math.max(0, attempt)), maxMs);
  // Jitter penuh: [0, exponential). Percobaan pertama jadi bisa sangat cepat —
  // itu memang disengaja untuk error sementara (socket basi).
  return Math.floor(random() * exponential);
}

/** Waktu ISO untuk percobaan berikutnya, siap disimpan di kolom next_attempt_at. */
export function nextAttemptAt(
  attempt: number,
  options: BackoffOptions,
  now: number = Date.now(),
): string {
  return new Date(now + backoffDelay(attempt, options)).toISOString();
}
