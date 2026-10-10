// src/app/screens/PrinterListScreen.tsx
// Daftar printer. Pintu masuk utama pengaturan cetak.

import { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, StyleSheet } from 'react-native';
import { useFocusEffect, type NavigationProp } from '@react-navigation/native';
import type { PrinterConfig } from '../../types/printing';
import { listPrinters, removePrinter, updatePrinter } from '../../printing/PrinterStore';
import { transportSupport } from '../../printing/PrinterRegistry';
import { Colors, FontSize, Spacing } from '../theme';
import {
  Body,
  Button,
  Card,
  EmptyState,
  Notice,
  Screen,
  SectionTitle,
  StatusPill,
} from '../ui';
import type { RootStackParamList } from '../navigation';

export function PrinterListScreen({
  navigation,
}: {
  navigation: NavigationProp<RootStackParamList>;
}) {
  const [printers, setPrinters] = useState<PrinterConfig[]>([]);

  const reload = useCallback(() => {
    void listPrinters().then(setPrinters);
  }, []);

  // Fokus dipakai (bukan useEffect) supaya daftar segar setelah kembali dari
  // form tambah/ubah printer.
  useFocusEffect(reload);

  const confirmDelete = (printer: PrinterConfig) => {
    Alert.alert(
      'Hapus printer?',
      `"${printer.name}" akan dihapus. Riwayat cetak lama tidak ikut terhapus.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: () => {
            void removePrinter(printer.id).then(reload);
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Notice tone="info">
          Printer dihubungkan lewat jaringan lokal (LAN) dengan kabel atau WiFi
          yang sama. Bluetooth dan USB belum didukung.
        </Notice>

        <Button
          label="+ Tambah Printer"
          testID="add-printer"
          onPress={() => navigation.navigate('PrinterForm', {})}
        />

        {printers.length === 0 ? (
          <Card>
            <EmptyState message="Belum ada printer. Tambahkan printer LAN untuk mulai mencetak struk." />
          </Card>
        ) : (
          printers.map(printer => (
            <Card key={printer.id}>
              <SectionTitle>{printer.name}</SectionTitle>
              <Text style={styles.meta}>
                {transportSupport(printer.connectionType).type === 'lan'
                  ? `${printer.host ?? '-'}:${printer.port ?? 9100}`
                  : printer.connectionType}
              </Text>
              <Text style={styles.meta}>
                {printer.paperWidthMm}mm ·{' '}
                {printer.destinations
                  .map(d =>
                    d === 'customer_receipt' ? 'Struk' : 'Tiket Dapur',
                  )
                  .join(', ')}
              </Text>

              <StatusPill
                label={printer.enabled ? 'Aktif' : 'Nonaktif'}
                tone={printer.enabled ? 'success' : 'neutral'}
              />

              <Button
                label={printer.enabled ? 'Nonaktifkan' : 'Aktifkan'}
                variant="secondary"
                onPress={() => {
                  void updatePrinter(printer.id, {
                    enabled: !printer.enabled,
                  }).then(reload);
                }}
              />
              <Button
                label="Uji Koneksi"
                variant="secondary"
                testID={`test-printer-${printer.id}`}
                onPress={() =>
                  navigation.navigate('PrinterDiagnostics', {
                    printerId: printer.id,
                  })
                }
              />
              <Button
                label="Ubah"
                variant="secondary"
                onPress={() =>
                  navigation.navigate('PrinterForm', { printerId: printer.id })
                }
              />
              <Button
                label="Hapus"
                variant="danger"
                onPress={() => confirmDelete(printer)}
              />
            </Card>
          ))
        )}

        <Body muted>
          Cetak otomatis tidak dilakukan kalau printer nonaktif. Job yang sudah
          tercatat tetap ada dan bisa dicetak ulang dari Riwayat Cetak.
        </Body>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    marginBottom: Spacing.xs,
  },
});
