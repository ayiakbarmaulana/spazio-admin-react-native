// __tests__/unit/ble-driver.test.ts
// Byte → Base64 dan pemotongan tulis BLE. Keduanya jalur yang mahal kalau salah:
// base64 salah = printer mencetak sampah; potongan salah = struk terpotong.

import { bytesToBase64 } from '../../src/printing/BlePrinterDriver';

// Buffer Node tersedia di Jest. Nilai acuan dari Buffer.toString('base64').
describe('bytesToBase64', () => {
  it('cocok dengan Buffer untuk berbagai panjang (termasuk padding)', () => {
    for (let length = 0; length < 40; length++) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + length) % 256);
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });

  it('byte ESC/POS khas terjaga', () => {
    // INIT (1B 40) + "ab" + CUT (1D 56 42 00)
    const bytes = Uint8Array.of(0x1b, 0x40, 0x61, 0x62, 0x1d, 0x56, 0x42, 0x00);
    expect(bytesToBase64(bytes)).toBe(
      Buffer.from(bytes).toString('base64'),
    );
  });
});
