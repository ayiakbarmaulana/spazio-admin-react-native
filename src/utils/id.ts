// src/utils/id.ts
// Pembuat id. Pakai crypto kalau tersedia (Hermes punya lewat polyfill RN),
// fallback ke waktu + acak supaya tetap jalan di lingkungan Jest/Node lama.

let counter = 0;

export function newId(prefix = 'id'): string {
  counter = (counter + 1) % 0xffff;
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}_${time}${counter.toString(36)}${rand}`;
}

/**
 * Kunci dedup job cetak. Satu order + satu tujuan + satu printer hanya boleh
 * menghasilkan satu job. Dipakai baik oleh dispatcher native maupun bridge
 * WebView (PRD §8.4, §9.3).
 */
export function printJobKey(
  orderId: string,
  destination: string,
  printerId: string,
): string {
  return `${orderId}::${destination}::${printerId}`;
}
