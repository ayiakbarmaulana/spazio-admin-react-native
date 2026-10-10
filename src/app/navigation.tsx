// src/app/navigation.tsx
// Navigasi root. Empat layar pengaturan + layar utama POS.
//
// Layar cetak sengaja diberi judul Indonesia dan selalu bisa dijangkau dari
// WebView lewat tombol di header — kasir yang struknya tidak keluar harus bisa
// masuk ke pengaturan tanpa keluar dari halaman POS.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Colors } from './theme';
import { PosScreen } from './screens/PosScreen';
import { DeviceStatusScreen } from './screens/DeviceStatusScreen';
import { PrinterListScreen } from './screens/PrinterListScreen';
import { PrinterFormScreen } from './screens/PrinterFormScreen';
import { PrinterDiagnosticsScreen } from './screens/PrinterDiagnosticsScreen';
import { PrintJobsScreen } from './screens/PrintJobsScreen';

export type RootStackParamList = {
  Pos: undefined;
  DeviceStatus: undefined;
  PrinterList: undefined;
  PrinterForm: { printerId?: string };
  PrinterDiagnostics: { printerId: string };
  PrintJobs: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Pos"
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTitleStyle: { color: Colors.text },
        headerTintColor: Colors.primary,
        contentStyle: { backgroundColor: Colors.background },
      }}>
      <Stack.Screen
        name="Pos"
        component={PosScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="DeviceStatus"
        component={DeviceStatusScreen}
        options={{ title: 'Status Perangkat' }}
      />
      <Stack.Screen
        name="PrinterList"
        component={PrinterListScreen}
        options={{ title: 'Pengaturan Printer' }}
      />
      <Stack.Screen
        name="PrinterForm"
        component={PrinterFormScreen}
        options={{ title: 'Printer' }}
      />
      <Stack.Screen
        name="PrinterDiagnostics"
        component={PrinterDiagnosticsScreen}
        options={{ title: 'Uji Printer' }}
      />
      <Stack.Screen
        name="PrintJobs"
        component={PrintJobsScreen}
        options={{ title: 'Riwayat Cetak' }}
      />
    </Stack.Navigator>
  );
}
