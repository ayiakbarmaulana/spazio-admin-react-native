// src/app/screens/PosScreen.tsx
// Layar utama: WebView PWA + tombol akses pengaturan cetak.
//
// Tombol pengaturan diletakkan sebagai FAB, bukan di header, supaya tetap bisa
// ditekan di layar kecil dan tidak tertutup header WebView.

import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SpazioWebView } from '../../webview/SpazioWebView';
import { useAppServices } from '../AppServices';
import { Colors, FontSize, Radius, Spacing } from '../theme';
import type { RootStackParamList } from '../navigation';

export function PosScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { bridge, jobStatusListeners } = useAppServices();
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  // Penghitung job menunggu: memberi tahu kasir bahwa masih ada antrean tanpa
  // harus membuka Riwayat Cetak.
  useEffect(() => {
    const listener = () => {
      void bridge.deviceStatus().then(status => {
        setPendingCount(status.pendingJobCount);
      });
    };
    jobStatusListeners.add(listener);
    listener();
    return () => {
      jobStatusListeners.delete(listener);
    };
  }, [bridge, jobStatusListeners]);

  const handleBridgeError = useCallback((message: string) => {
    // Ditampilkan sekali, tidak dipanggil berulang supaya tidak mengganggu.
    setBridgeError(message);
  }, []);

  return (
    <View style={styles.container}>
      <SpazioWebView handler={bridge} onBridgeError={handleBridgeError} />

      {bridgeError ? (
        <Pressable
          style={styles.bannerDanger}
          onPress={() => setBridgeError(null)}>
          <Text style={styles.bannerText}>{bridgeError}</Text>
        </Pressable>
      ) : null}

      <Pressable
        style={styles.fab}
        accessibilityRole="button"
        accessibilityLabel="Pengaturan cetak"
        testID="open-print-settings"
        onPress={() => navigation.navigate('PrinterList')}>
        <Text style={styles.fabIcon}>🖨</Text>
        {pendingCount > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{pendingCount}</Text>
          </View>
        ) : null}
      </Pressable>

      <Pressable
        style={styles.deviceButton}
        accessibilityRole="button"
        testID="open-device-status"
        onPress={() => navigation.navigate('DeviceStatus')}>
        <Text style={styles.deviceButtonText}>Status</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    bottom: Spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabIcon: { fontSize: 24 },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: Colors.warning,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: Colors.background,
    fontSize: FontSize.xs,
    fontWeight: '700',
  },
  deviceButton: {
    position: 'absolute',
    left: Spacing.lg,
    bottom: Spacing.xl,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  deviceButtonText: { color: Colors.text, fontSize: FontSize.sm },
  bannerDanger: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.danger,
    padding: Spacing.md,
  },
  bannerText: { color: Colors.text, fontSize: FontSize.sm },
});
