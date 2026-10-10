// src/networking/ApiClient.ts
// Klien HTTP ke PWA Spazio.
//
// KEPUTUSAN KEAMANAN (PRD §9.4): tidak ada API key di dalam APK. Aplikasi ini
// hanya memanggil endpoint yang memang publik. Semua panggilan yang butuh
// otentikasi DILAKUKAN DI DALAM WEBVIEW, memakai cookie sesi better-auth yang
// sudah ada di sana. Kunci yang ditanam di APK bisa dibongkar siapa pun yang
// punya file-nya, jadi tidak ada gunanya.

export const DEFAULT_ORIGIN = 'http://localhost:3000';

export type HealthResult = {
  ok: boolean;
  /** Latensi bolak-balik dalam ms. */
  latencyMs: number;
  status?: number;
  error?: string;
};

export class ApiClient {
  constructor(
    private readonly origin: string = DEFAULT_ORIGIN,
    private readonly timeoutMs = 8000,
  ) {}

  /** Cek apakah origin terjangkau. Satu-satunya panggilan native tanpa auth. */
  async health(): Promise<HealthResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.origin}/api/health`, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      return {
        ok: response.ok,
        latencyMs: Date.now() - started,
        status: response.status,
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
