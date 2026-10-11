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
