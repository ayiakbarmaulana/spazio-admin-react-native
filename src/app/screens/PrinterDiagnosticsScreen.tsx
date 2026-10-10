// src/app/screens/PrinterDiagnosticsScreen.tsx
// Uji koneksi printer (PRD §6.6).
//
// HAL PENTING: layar ini melaporkan DUA fakta terpisah — tersambung dan
// terkirim — dan secara eksplisit menolak mengklaim "tercetak". Tidak ada
// cara mengetahui kertas keluar dari sisi aplikasi.

import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { getPrinter } from '../../printing/PrinterStore';
import { LanPrinterDriver } from '../../printing/LanPrinterDriver';
import { buildReceipt } from '../../printing/ReceiptTemplate';
import type { PrintJobError, PrinterConfig } from '../../types/printing';
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_WRITE_TIMEOUT_MS,
  PAPER_COLUMNS,
} from '../../types/printing';
import { Colors, FontSize, Spacing } from '../theme';
import {
  Body,
  Button,
  Card,
  Loading,
  Notice,
  Screen,
  SectionTitle,
  StatusPill,
} from '../ui';
import type { RootStackParamList } from '../navigation';

type Outcome = {
  connected: boolean;
  transmitted: boolean;
  error?: PrintJobError;
};

/** Struk contoh untuk uji cetak — nomor jelas menandai ini bukan order asli. */
const SAMPLE_ORDER = {
  noreceipt: 'TES-PRINTER',
  paymentMethod: 'CASH',
  paymentStatus: 'PAID',
  finalAmount: 0,
  staffName: 'PENGUJIAN',
  customerName: null,
  customerPhone: null,
  customerAddress: null,
  tableNumber: null,
  note: 'Ini halaman uji. Bukan transaksi nyata.',
  createdAt: new Date().toISOString(),
  items: [{ menuName: 'Halaman Uji Printer', quantity: 1, priceAtOrder: 0 }],
};

export function PrinterDiagnosticsScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'PrinterDiagnostics'>>();
  const [printer, setPrinter] = useState<PrinterConfig | null>(null);
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // Muat printer sekali per id.
  if (printer === null && !testing && outcome === null) {
    void getPrinter(route.params.printerId).then(setPrinter);
  }

  const runTest = async (printSample: boolean) => {
    if (!printer) {
      return;
    }
    if (printer.connectionType !== 'lan') {
      setOutcome({
        connected: false,
        transmitted: false,
        error: {
          code: 'TRANSPORT_UNSUPPORTED',
          message: `Jenis koneksi "${printer.connectionType}" belum didukung.`,
          transmissionStarted: false,
          at: new Date().toISOString(),
        },
      });
      return;
    }

    setTesting(true);
    setOutcome(null);

    const driver = new LanPrinterDriver({
      host: printer.host ?? '',
      port: printer.port ?? 9100,
      connectTimeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
      writeTimeoutMs: DEFAULT_WRITE_TIMEOUT_MS,
    });

    const result = printSample
      ? await driver.send(
          buildReceipt(
            SAMPLE_ORDER as never,
            PAPER_COLUMNS[printer.paperWidthMm],
            'HALAMAN UJI',
          ),
        )
      : await driver.test();

    setOutcome(
      result.ok
        ? { connected: true, transmitted: true }
        : {
            connected: !result.error.transmissionStarted,
            transmitted: false,
            error: result.error,
          },
    );
    setTesting(false);
  };

  if (!printer) {
    return (
      <Screen>
        <Loading label="Membaca konfigurasi printer…" />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Notice>
          Aplikasi bisa memastikan data TERKIRIM ke printer. Aplikasi TIDAK bisa
          memastikan kertasnya keluar — tidak ada printer di pasar ini yang
          melaporkan balik. Periksa kertas printer setelah uji.
        </Notice>

        <Card>
          <SectionTitle>{printer.name}</SectionTitle>
          <Body muted>
            {printer.host ?? '-'}:{printer.port ?? 9100} · {printer.paperWidthMm}
            mm ({PAPER_COLUMNS[printer.paperWidthMm]} kolom)
          </Body>
        </Card>

        {testing ? (
          <Card>
            <Loading label="Menyambung ke printer…" />
          </Card>
        ) : null}

        {outcome ? (
          <Card>
            <SectionTitle>Hasil Uji</SectionTitle>

            <Row label="Koneksi tersambung">
              <StatusPill
                label={outcome.connected ? 'Ya' : 'Tidak'}
                tone={outcome.connected ? 'success' : 'danger'}
              />
            </Row>

            <Row label="Data terkirim">
              <StatusPill
                label={outcome.transmitted ? 'Ya' : 'Tidak'}
                tone={outcome.transmitted ? 'success' : 'danger'}
              />
            </Row>

            <Row label="Kertas tercetak">
              {/* Sengaja bukan pill hijau: kita tidak pernah tahu ini. */}
              <StatusPill label="Tidak diketahui" tone="warning" />
            </Row>

            {outcome.error ? (
              <Notice tone="danger">
                {outcome.error.message} ({outcome.error.code})
              </Notice>
            ) : null}

            {outcome.transmitted ? (
              <Body muted>
                Data sudah diterima printer. Kalau tidak ada kertas keluar,
                periksa: kertas habis, tutup printer belum rapat, atau printer
                sedang menampilkan lampu error.
              </Body>
            ) : null}
          </Card>
        ) : null}

        <Button
          label="Uji Sambung (tanpa cetak)"
          onPress={() => runTest(false)}
          disabled={testing}
          testID="test-connect"
        />
        <Button
          label="Cetak Halaman Uji"
          variant="secondary"
          onPress={() => runTest(true)}
          disabled={testing}
          testID="test-print-sample"
        />

        <Card>
          <SectionTitle>Kalau gagal</SectionTitle>
          <Body muted>
            • Pastikan HP dan printer di jaringan WiFi yang sama.
          </Body>
          <Body muted>
            • Pastikan alamat IP printer benar (cetak test page dari printer).
          </Body>
          <Body muted>
            • Coba buka alamat printer di browser HP untuk memastikan printer
            hidup.
          </Body>
          <Body muted>• Matikan lalu nyalakan ulang printer.</Body>
        </Card>
      </ScrollView>
    </Screen>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Body muted>{label}</Body>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    minHeight: FontSize.md + Spacing.lg,
  },
});
