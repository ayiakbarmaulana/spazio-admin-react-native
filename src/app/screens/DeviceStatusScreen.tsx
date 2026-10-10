// src/app/screens/DeviceStatusScreen.tsx
// Status perangkat + pintu masuk ke pengaturan cetak.
//
// Peringatan "terhubung ≠ tercetak" ditaruh di ATAS, bukan sebagai catatan
// kaki: kesalahpahaman itu sumber keluhan paling mahal di POS.

import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { DeviceStatus } from '../../webview/bridgeProtocol';
import { useAppServices } from '../AppServices';
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

export function DeviceStatusScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { bridge, api } = useAppServices();
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [latency, setLatency] = useState<number | null>(null);

  const reload = useCallback(() => {
    void bridge.deviceStatus().then(setStatus);
  }, [bridge]);

  useFocusEffect(reload);

  const pingServer = () => {
    setLatency(null);
    void api.health().then(result => setLatency(result.latencyMs));
  };

  if (!status) {
    return (
      <Screen>
        <Loading label="Membaca status perangkat…" />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Notice>
          Printer terhubung BUKAN berarti struk tercetak. Tidak ada printer di
          pasar ini yang mengirim balik konfirmasi bahwa kertas benar-benar
          keluar. Selalu periksa kertas setelah mencetak.
        </Notice>

        <Card>
          <SectionTitle>Jembatan Cetak</SectionTitle>
          <Row label="Siap menerima perintah">
            <StatusPill
              label={status.bridgeReady ? 'Siap' : 'Belum siap'}
              tone={status.bridgeReady ? 'success' : 'danger'}
            />
          </Row>
          <Row label="Platform / versi">
            <Body>
              {status.platform} · v{status.appVersion}
            </Body>
          </Row>
          <Row label="Printer terdaftar">
            <Body>
              {status.printerCount} ({status.hasPrinter ? 'ada aktif' : 'tidak ada yang aktif'})
            </Body>
          </Row>
          <Row label="Job menunggu">
            <StatusPill
              label={String(status.pendingJobCount)}
              tone={status.pendingJobCount > 0 ? 'warning' : 'neutral'}
            />
          </Row>
        </Card>

        <Card>
          <SectionTitle>Koneksi Server</SectionTitle>
          {latency === null ? (
            <Body muted>Belum diuji.</Body>
          ) : (
            <Body>Latensi: {latency} ms</Body>
          )}
          <Button
            label="Uji Koneksi Server"
            variant="secondary"
            onPress={pingServer}
          />
          <Body muted>
            Uji ini hanya memanggil endpoint kesehatan publik. Sesi kasir tetap
            berjalan di dalam halaman web, tidak di aplikasi ini.
          </Body>
        </Card>

        <Card>
          <SectionTitle>Pintasan</SectionTitle>
          <Button
            label="Pengaturan Printer"
            onPress={() => navigation.navigate('PrinterList')}
          />
          <Button
            label="Riwayat Cetak"
            variant="secondary"
            onPress={() => navigation.navigate('PrintJobs')}
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
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
