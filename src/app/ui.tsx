// src/app/ui.tsx
// Komponen tampilan dasar. Dipakai semua layar supaya tampilannya konsisten —
// tidak ada layar yang merakit StyleSheet sendiri dari nol.

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { Colors, FontSize, Radius, Spacing } from './theme';

export function Screen({ children }: { children: React.ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Body({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <Text style={muted ? styles.bodyMuted : styles.body}>{children}</Text>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}>
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

/**
 * Peringatan yang HARUS terlihat (PRD §4.2C). Sengaja mencolok: pesan ini
 * mencegah kasir mengira struk sudah keluar padahal belum.
 */
export function Notice({
  children,
  tone = 'warning',
}: {
  children: React.ReactNode;
  tone?: 'warning' | 'danger' | 'info';
}) {
  return (
    <View
      style={[
        styles.notice,
        tone === 'warning' && styles.noticeWarning,
        tone === 'danger' && styles.noticeDanger,
        tone === 'info' && styles.noticeInfo,
      ]}>
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  );
}

export function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  return (
    <View
      style={[
        styles.pill,
        tone === 'neutral' && styles.pillNeutral,
        tone === 'success' && styles.pillSuccess,
        tone === 'warning' && styles.pillWarning,
        tone === 'danger' && styles.pillDanger,
      ]}>
      <Text style={styles.pillLabel}>{label}</Text>
    </View>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={Colors.primary} />
      <Text style={styles.loadingLabel}>{label}</Text>
    </View>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: Spacing.lg,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: '600',
    marginBottom: Spacing.sm,
  },
  body: { color: Colors.text, fontSize: FontSize.md, lineHeight: 21 },
  bodyMuted: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    lineHeight: 19,
  },
  button: {
    borderRadius: Radius.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  buttonPrimary: { backgroundColor: Colors.primary },
  buttonSecondary: {
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  buttonDanger: { backgroundColor: Colors.danger },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.75 },
  buttonLabel: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  notice: {
    borderRadius: Radius.sm,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderLeftWidth: 3,
  },
  noticeWarning: {
    backgroundColor: '#2a2317',
    borderLeftColor: Colors.warning,
  },
  noticeDanger: {
    backgroundColor: '#2b1a18',
    borderLeftColor: Colors.danger,
  },
  noticeInfo: {
    backgroundColor: '#17202b',
    borderLeftColor: Colors.primary,
  },
  noticeText: { color: Colors.text, fontSize: FontSize.sm, lineHeight: 19 },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  pillNeutral: { backgroundColor: Colors.surfaceAlt },
  pillSuccess: { backgroundColor: '#14361f' },
  pillWarning: { backgroundColor: '#3a2f14' },
  pillDanger: { backgroundColor: '#3a1a17' },
  pillLabel: { color: Colors.text, fontSize: FontSize.xs, fontWeight: '600' },
  loading: {
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  loadingLabel: { color: Colors.textMuted, fontSize: FontSize.sm },
  empty: { padding: Spacing.xl, alignItems: 'center' },
  emptyText: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    textAlign: 'center',
  },
});
