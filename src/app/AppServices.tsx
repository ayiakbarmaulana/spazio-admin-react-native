// src/app/AppServices.tsx
// Perakitan seluruh layanan. Satu tempat: layar mengambil yang dibutuhkan dari
// context, tidak ada layar yang membuat dispatcher atau membuka database
// sendiri.
//
// Urutan inisialisasi penting dan sengaja:
//  1. Pulihkan job yang macet (app mati saat mengirim) — SEBELUM layar apa pun
//     membaca daftar job, supaya statusnya tidak menyesatkan.
//  2. Baru buka UI.

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { getDatabase } from '../offline/database';
import { ApiClient } from '../networking/ApiClient';
import { PrintDispatcher } from '../printing/PrintDispatcher';
import {
  PrintJobRepository,
  recoverInterruptedJobs,
} from '../printing/PrintJobRepository';
import { findPrinterForDestination, listPrinters } from '../printing/PrinterStore';
import { BridgeHandler } from '../webview/bridgeHandler';
import { Colors } from './theme';
import { Loading } from './ui';

export const APP_VERSION = '0.0.1';

export type AppServices = {
  repo: PrintJobRepository;
  dispatcher: PrintDispatcher;
  bridge: BridgeHandler;
  api: ApiClient;
  /** Pemanggil status job dari bridge — dipakai untuk push ke WebView. */
  jobStatusListeners: Set<(job: unknown) => void>;
};

const ServicesContext = createContext<AppServices | null>(null);

export function useAppServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) {
    throw new Error('useAppServices dipakai di luar AppServicesProvider.');
  }
  return services;
}

export function AppServicesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);

  const services = useMemo<AppServices>(() => {
    const repo = new PrintJobRepository(getDatabase());
    const jobStatusListeners = new Set<(job: unknown) => void>();

    const dispatcher = new PrintDispatcher({
      repo,
      getPrinter: async id => {
        const all = await listPrinters();
        return all.find(p => p.id === id) ?? null;
      },
      onJobStatusChange: job => {
        jobStatusListeners.forEach(listener => listener(job));
      },
    });

    const bridge = new BridgeHandler({
      dispatcher,
      repo,
      listPrinters,
      findPrinterForDestination,
      platform: Platform.OS,
      appVersion: APP_VERSION,
      onJobStatusSubscribe: () => {
        // Langganan dikelola di sisi WebView lewat SkripBridge; di sini hanya
        // dicatat bahwa PWA berminat. Penanda requestId sudah cukup.
      },
    });

    return { repo, dispatcher, bridge, api: new ApiClient(), jobStatusListeners };
  }, []);

  useEffect(() => {
    // Pemulihan job macet: app bisa saja mati saat mengirim struk. Statusnya
    // jadi 'unknown', bukan 'failed' — kasir yang memutuskan cetak ulang.
    try {
      recoverInterruptedJobs(services.repo);
    } catch (error) {
      // Database belum siap (mis. migrasi pertama gagal). Jangan tahan app —
      // kasir tetap harus bisa membuka WebView.
      console.warn('[Spazio] Pemulihan job cetak gagal:', error);
    }
    setReady(true);
  }, [services]);

  if (!ready) {
    return (
      <View style={styles.boot}>
        <Loading label="Menyiapkan perangkat…" />
      </View>
    );
  }

  return (
    <ServicesContext.Provider value={services}>
      {children}
    </ServicesContext.Provider>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, backgroundColor: Colors.background },
});

export { findPrinterForDestination };
