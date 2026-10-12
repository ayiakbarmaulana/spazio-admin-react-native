// src/app/screens/PrinterFormScreen.tsx
// Form tambah/ubah printer. Validasi memakai aturan yang SAMA dengan yang
// dipakai store — tidak ada aturan kedua yang bisa berbeda.

import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  addPrinter,
  getPrinter,
  updatePrinter,
} from '../../printing/PrinterStore';
import { TRANSPORT_REGISTRY } from '../../printing/PrinterRegistry';
import { validatePrinterConfig } from '../../printing/validatePrinterConfig';
import { DEFAULT_LAN_PORT } from '../../types/printing';
import type {
  PaperWidthMm,
  PrintDestination,
  PrinterConnectionType,
  PrinterProtocol,
} from '../../types/printing';
import { Colors, FontSize, Spacing } from '../theme';
import { Body, Button, Card, Notice, Screen, SectionTitle } from '../ui';
import type { RootStackParamList } from '../navigation';

type FormState = {
  name: string;
  connectionType: PrinterConnectionType;
  /** Bahasa perintah printer: 'escpos' untuk struk, 'tspl' untuk label. */
  protocol: PrinterProtocol;
  host: string;
  port: string;
  /** Dipakai hanya saat connectionType === 'bluetooth'. Kosong = auto-pilih. */
  btDeviceId: string;
  btDeviceName: string;
  paperWidthMm: PaperWidthMm;
  destinations: PrintDestination[];
  enabled: boolean;
};

const INITIAL: FormState = {
  name: '',
  connectionType: 'lan',
  protocol: 'escpos',
  host: '',
  port: String(DEFAULT_LAN_PORT),
  btDeviceId: '',
  btDeviceName: '',
  paperWidthMm: 58,
  destinations: ['customer_receipt'],
  enabled: true,
};

export function PrinterFormScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'PrinterForm'>>();
  const editingId = route.params?.printerId;

  const [form, setForm] = useState<FormState>(INITIAL);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    navigation.setOptions({
      title: editingId ? 'Ubah Printer' : 'Tambah Printer',
    });
    if (!editingId) {
      return;
    }
    void getPrinter(editingId).then(printer => {
      if (!printer) {
        return;
      }
      setForm({
        name: printer.name,
        connectionType: printer.connectionType,
        protocol: printer.protocol ?? 'escpos',
        host: printer.host ?? '',
        port: String(printer.port ?? DEFAULT_LAN_PORT),
        btDeviceId: printer.bluetooth?.deviceId ?? '',
        btDeviceName: printer.bluetooth?.deviceName ?? '',
        paperWidthMm: printer.paperWidthMm,
        destinations: printer.destinations,
        enabled: printer.enabled,
      });
    });
  }, [editingId, navigation]);

  const toggleDestination = (destination: PrintDestination) => {
    setForm(current => ({
      ...current,
      destinations: current.destinations.includes(destination)
        ? current.destinations.filter(d => d !== destination)
        : [...current.destinations, destination],
    }));
  };

  const submit = () => {
    // Port kosong → pakai default, bukan NaN.
    const port = form.port.trim() === '' ? DEFAULT_LAN_PORT : Number(form.port);
    const isLan = form.connectionType === 'lan';
    const input = {
      name: form.name.trim(),
      connectionType: form.connectionType,
      protocol: form.protocol,
      // Field yang tidak relevan dikirim undefined, bukan string kosong:
      // validasi LAN memakai `.trim()` dan host '' akan ditolak dengan benar.
      host: isLan ? form.host.trim() : undefined,
      port: isLan ? port : undefined,
      bluetooth: isLan
        ? undefined
        : {
            deviceId: form.btDeviceId.trim() || undefined,
            deviceName: form.btDeviceName.trim() || undefined,
          },
      destinations: form.destinations,
      enabled: form.enabled,
      paperWidthMm: form.paperWidthMm,
    };

    const validationErrors = validatePrinterConfig(input);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    const save = editingId
      ? updatePrinter(editingId, input)
      : addPrinter(input);
    void save
      .then(() => navigation.goBack())
      .catch((error: unknown) =>
        setErrors([error instanceof Error ? error.message : String(error)]),
      );
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {errors.length > 0 ? (
            <Notice tone="danger">
              {errors.map(error => `• ${error}`).join('\n')}
            </Notice>
          ) : null}

          <Card>
            <SectionTitle>Nama Printer</SectionTitle>

            <Text style={styles.label}>Nama printer</Text>
            <TextInput
              style={styles.input}
              value={form.name}
              onChangeText={name => setForm({ ...form, name })}
              placeholder="Printer Kasir"
              placeholderTextColor={Colors.textFaint}
              testID="printer-name"
            />
          </Card>

          <Card>
            <SectionTitle>Tujuan Cetak</SectionTitle>
            <Toggle
              label="Struk Pelanggan"
              value={form.destinations.includes('customer_receipt')}
              onChange={() => toggleDestination('customer_receipt')}
              testID="dest-receipt"
            />
            <Toggle
              label="Tiket Dapur"
              value={form.destinations.includes('kitchen_ticket')}
              onChange={() => toggleDestination('kitchen_ticket')}
              testID="dest-kitchen"
            />
            <Toggle
              label="Label Produk (nama + varian)"
              value={form.destinations.includes('label')}
              onChange={() => toggleDestination('label')}
              testID="dest-label"
            />

            <SectionTitle>Lebar Kertas</SectionTitle>
            <Toggle
              label="58mm (32 kolom)"
              value={form.paperWidthMm === 58}
              onChange={() => setForm({ ...form, paperWidthMm: 58 })}
              testID="width-58"
            />
            <Toggle
              label="80mm (48 kolom)"
              value={form.paperWidthMm === 80}
              onChange={() => setForm({ ...form, paperWidthMm: 80 })}
              testID="width-80"
            />

            <SectionTitle>Status</SectionTitle>
            <Toggle
              label="Printer aktif"
              value={form.enabled}
              onChange={() => setForm({ ...form, enabled: !form.enabled })}
              testID="printer-enabled"
            />
          </Card>

          <Card>
            <SectionTitle>Protokol Printer</SectionTitle>
            <Toggle
              label="ESC/POS (struk 58/80mm)"
              value={form.protocol === 'escpos'}
              onChange={() => setForm({ ...form, protocol: 'escpos' })}
              testID="protocol-escpos"
            />
            <Toggle
              label="TSPL (printer label 20×30mm)"
              value={form.protocol === 'tspl'}
              onChange={() => setForm({ ...form, protocol: 'tspl' })}
              testID="protocol-tspl"
            />
            <Body muted>
              Printer label seperti Blueprint BP-TR110 memakai TSPL, bukan
              ESC/POS. Pilih TSPL lalu centang tujuan Label Produk.
            </Body>
          </Card>

          <Card>
            <SectionTitle>Jenis Koneksi</SectionTitle>
            {TRANSPORT_REGISTRY.filter(t => t.supported).map(transport => (
              <Toggle
                key={transport.type}
                label={
                  transport.type === 'lan'
                    ? 'LAN (kabel/WiFi)'
                    : 'Bluetooth (BLE)'
                }
                value={form.connectionType === transport.type}
                onChange={() =>
                  setForm({ ...form, connectionType: transport.type })
                }
                testID={`transport-${transport.type}`}
              />
            ))}
            <Body muted>
              {TRANSPORT_REGISTRY.find(
                t => t.type === form.connectionType,
              )?.reason ?? ''}
            </Body>
          </Card>

          {form.connectionType === 'lan' ? (
            <Card>
              <SectionTitle>Alamat LAN</SectionTitle>

              <Text style={styles.label}>Alamat IP printer</Text>
              <TextInput
                style={styles.input}
                value={form.host}
                onChangeText={host => setForm({ ...form, host })}
                placeholder="192.168.1.50"
                placeholderTextColor={Colors.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                testID="printer-host"
              />
              <Body muted>
                Cek di menu printer: cetak test page untuk melihat alamat IP-nya.
              </Body>

              <Text style={styles.label}>Port</Text>
              <TextInput
                style={styles.input}
                value={form.port}
                onChangeText={port => setForm({ ...form, port })}
                placeholder={String(DEFAULT_LAN_PORT)}
                placeholderTextColor={Colors.textFaint}
                keyboardType="number-pad"
                testID="printer-port"
              />
              <Body muted>
                Default 9100. Sebagian printer memakai 9101 atau 515.
              </Body>
            </Card>
          ) : (
            <Card>
              <SectionTitle>Alamat Bluetooth</SectionTitle>

              <Text style={styles.label}>Nama perangkat (opsional)</Text>
              <TextInput
                style={styles.input}
                value={form.btDeviceName}
                onChangeText={btDeviceName => setForm({ ...form, btDeviceName })}
                placeholder="VSC TM-58V"
                placeholderTextColor={Colors.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                testID="printer-bt-name"
              />

              <Text style={styles.label}>Alamat perangkat (opsional)</Text>
              <TextInput
                style={styles.input}
                value={form.btDeviceId}
                onChangeText={btDeviceId => setForm({ ...form, btDeviceId })}
                placeholder="AA:BB:CC:DD:EE:FF"
                placeholderTextColor={Colors.textFaint}
                autoCapitalize="characters"
                autoCorrect={false}
                testID="printer-bt-id"
              />
              <Body muted>
                Kosongkan kalau tidak yakin — app akan memilih sendiri printer
                Bluetooth yang sudah dipasangkan. Alamat perangkat terlihat di
                Pengaturan Bluetooth Android.
              </Body>
            </Card>
          )}

          <Button label="Simpan" onPress={submit} testID="save-printer" />
          <Button
            label="Batal"
            variant="secondary"
            onPress={() => navigation.goBack()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Toggle({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: boolean;
  onChange: () => void;
  testID: string;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        testID={testID}
        value={value}
        onValueChange={onChange}
        trackColor={{ false: Colors.border, true: Colors.primary }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  label: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  input: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: FontSize.md,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
  },
  toggleLabel: { color: Colors.text, fontSize: FontSize.md },
});
