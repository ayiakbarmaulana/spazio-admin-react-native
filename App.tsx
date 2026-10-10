// App.tsx
// Titik masuk aplikasi: layanan dulu, baru navigasi.
//
// Urutannya penting — layar POS membaca daftar job dari database saat pertama
// kali dirender, jadi database harus sudah dimigrasi sebelum UI muncul.

import React from 'react';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppServicesProvider } from './src/app/AppServices';
import { RootNavigator } from './src/app/navigation';
import { Colors } from './src/app/theme';

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Colors.background,
    card: Colors.surface,
    text: Colors.text,
    border: Colors.border,
    primary: Colors.primary,
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <AppServicesProvider>
        <NavigationContainer theme={navigationTheme}>
          <RootNavigator />
        </NavigationContainer>
      </AppServicesProvider>
    </SafeAreaProvider>
  );
}

