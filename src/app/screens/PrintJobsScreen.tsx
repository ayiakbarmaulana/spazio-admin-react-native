// src/app/screens/PrintJobsScreen.tsx
// Riwayat cetak. Tujuan utamanya: membuat job 'unknown' dan 'failed' terlihat
// dan bisa dicetak ulang secara sadar, bukan tersembunyi.

import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { PrintJob } from '../../types/printing';
import { useAppServices } from '../AppServices';
import { Colors, FontSize, Spacing } from '../theme';
import {
  Body,
  Button,
  Card,
  EmptyState,
  Notice,
  Screen,
  StatusPill,
} from '../ui';

/** Label dan warna per status. 'unknown' sengaja kuning, bukan merah. */
const STATUS_META: Record<
  PrintJob['status'],
  { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }
> = {
  queued: { label: 'Menunggu', tone: 'neutral' },
  connecting: { label: 'Menyambung', tone: 'neutral' },
  sending: { label: 'Mengirim', tone: 'neutral' },
  submitted: { label: 'Terkirim', tone: 'success' },
  failed: { label: 'Gagal', tone: 'danger' },
  unknown: { label: 'Hasil Tidak Pasti', tone: 'warning' },
  cancelled: { label: 'Dibatalkan', tone: 'neutral' },
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PrintJobsScreen() {
  const { repo, dispatcher } = useAppServices();
  const [jobs, setJobs] = useState<PrintJob[]>([]);

  const reload = useCallback(() => {
    setJobs(repo.findRecent(50));
  }, [repo]);

  useFocusEffect(reload);

  const confirmReprint = (job: PrintJob) => {
    // Job 'unknown' bisa jadi SUDAH tercetak. Konfirmasi wajib — cetak ulang
    // otomatis di sini akan menghasilkan struk dobel.
    const warning =
      job.status === 'unknown'
        ? 'Printer mungkin sudah mencetak struk ini. Periksa kertas dulu. Lanjut cetak ulang?'
        : 'Cetak ulang job ini?';
    Alert.alert('Cetak Ulang', warning, [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Cetak Ulang',
        onPress: () => {
          void dispatcher.run(job.id).then(reload);
        },
      },
    ]);
  };

  const unknownCount = jobs.filter(j => j.status === 'unknown').length;
  const failedCount = jobs.filter(j => j.status === 'failed').length;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        {unknownCount > 0 ? (
          <Notice>
            {unknownCount} job berstatus "Hasil Tidak Pasti": koneksi terputus
            saat mengirim, jadi struknya mungkin sudah keluar. Periksa kertas
            printer sebelum mencetak ulang.
          </Notice>
        ) : null}
        {failedCount > 0 ? (
          <Notice tone="danger">
            {failedCount} job gagal terkirim. Tidak ada byte yang sampai ke
            printer, jadi aman untuk dicetak ulang.
          </Notice>
        ) : null}

        {jobs.length === 0 ? (
          <Card>
            <EmptyState message="Belum ada riwayat cetak." />
          </Card>
        ) : (
          jobs.map(job => {
            const meta = STATUS_META[job.status];
            return (
              <Card key={job.id}>
                <View style={styles.header}>
                  <Text style={styles.orderId}>{job.orderId}</Text>
                  <StatusPill label={meta.label} tone={meta.tone} />
                </View>
                <Body muted>
                  {job.destination === 'customer_receipt'
                    ? 'Struk Pelanggan'
                    : 'Tiket Dapur'}{' '}
                  · {formatTime(job.createdAt)} · percobaan {job.attemptCount}
                </Body>
                {job.lastError ? (
                  <Text style={styles.error}>{job.lastError.message}</Text>
                ) : null}
                {job.status !== 'queued' &&
                job.status !== 'connecting' &&
                job.status !== 'sending' ? (
                  <Button
                    label="Cetak Ulang"
                    variant="secondary"
                    testID={`reprint-${job.id}`}
                    onPress={() => confirmReprint(job)}
                  />
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  orderId: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '600',
    flexShrink: 1,
    marginRight: Spacing.sm,
  },
  error: {
    color: Colors.danger,
    fontSize: FontSize.sm,
    marginTop: Spacing.sm,
  },
});
