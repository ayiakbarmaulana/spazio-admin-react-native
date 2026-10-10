// src/webview/SpazioWebView.tsx
// WebView yang memuat PWA Spazio + jembatan cetak.
//
// KEAMANAN (jangan diubah tanpa berpikir panjang):
//  - `onShouldStartLoadWithRequest` menahan SEMUA navigasi ke origin di luar
//    allowlist. Tanpa itu, halaman asing apa pun bisa memuat di WebView yang
//    memegang cookie sesi kasir.
//  - Pesan dari WebView HANYA diproses kalau `event.nativeEvent.url` ada di
//    allowlist. Tanpa cek itu, iframe pihak ketiga bisa mengirim PRINT_REQUEST.
//  - Tautan eksternal dibuka lewat Linking, TIDAK di dalam WebView.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
import {
  WebView,
  type WebViewMessageEvent,
  type WebViewNavigation,
} from 'react-native-webview';
import { Colors } from '../app/theme';
import {
  DEFAULT_ORIGIN,
} from '../networking/ApiClient';
import {
  isAllowedBridgeOrigin,
  isAllowedNavigation,
  isExternalLink,
} from '../security/originAllowlist';
import type { BridgeHandler } from './bridgeHandler';
import { BRIDGE_CHANNEL } from './bridgeProtocol';

type Props = {
  handler: BridgeHandler;
  origin?: string;
  onBridgeError?: (message: string) => void;
};

/**
 * Skrip yang disuntikkan SEBELUM halaman dimuat: menyediakan
 * `window.SpazioNative` untuk PWA dan meneruskan pesannya ke native.
 */
const INJECTED_BEFORE_LOAD = `
(function () {
  if (window.SpazioNative) { return; }
  var pending = {};
  var counter = 0;
  var listeners = [];

  function post(message) {
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }

  window.SpazioNative = {
    isAvailable: true,
    send: function (type, payload) {
      counter += 1;
      var requestId = 'req-' + Date.now() + '-' + counter;
      return new Promise(function (resolve, reject) {
        pending[requestId] = { resolve: resolve, reject: reject };
        post({ type: type, requestId: requestId, payload: payload });
      });
    },
    onJobStatus: function (listener) {
      listeners.push(listener);
      return function () {
        var index = listeners.indexOf(listener);
        if (index >= 0) { listeners.splice(index, 1); }
      };
    },
    _handle: function (message) {
      if (message.type === 'JOB_STATUS_EVENT') {
        listeners.forEach(function (listener) { listener(message.data); });
        return;
      }
      var entry = pending[message.requestId];
      if (!entry) { return; }
      delete pending[message.requestId];
      if (message.ok) { entry.resolve(message.data); }
      else { entry.reject(message.error || { code: 'UNKNOWN', message: 'Gagal' }); }
    }
  };
  true;
})();
true;
`;

export function SpazioWebView({
  handler,
  origin = DEFAULT_ORIGIN,
  onBridgeError,
}: Props) {
  const webViewRef = useRef<React.ElementRef<typeof WebView>>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const source = useMemo(() => ({ uri: origin }), [origin]);

  const handleMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      // Pesan dari origin yang tidak dipercaya dibuang tanpa dijawab.
      if (!isAllowedBridgeOrigin(event.nativeEvent.url)) {
        onBridgeError?.(
          `Pesan dari origin tidak dikenal ditolak: ${event.nativeEvent.url}`,
        );
        return;
      }

      const response = await handler.handle(event.nativeEvent.data);
      // Balasan dikirim lewat channel yang sama supaya PWA bisa mencocokkan
      // dengan requestId yang disimpannya.
      webViewRef.current?.injectJavaScript(
        `window.${BRIDGE_CHANNEL} && window.${BRIDGE_CHANNEL}.receive(${JSON.stringify(
          response,
        )}); true;`,
      );
    },
    [handler, onBridgeError],
  );

  const handleNavigation = useCallback((request: WebViewNavigation) => {
    if (isAllowedNavigation(request.url)) {
      return true;
    }
    // Tautan luar dibuka di browser; sisanya (tel:, whatsapp:) juga.
    if (isExternalLink(request.url) || !request.url.startsWith('http')) {
      void Linking.openURL(request.url).catch(() => {
        // Perangkat tanpa aplikasi yang cocok — diabaikan, bukan crash.
      });
    }
    return false;
  }, []);

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={source}
        injectedJavaScriptBeforeContentLoaded={INJECTED_BEFORE_LOAD}
        onMessage={handleMessage}
        onShouldStartLoadWithRequest={handleNavigation}
        onLoadStart={() => setLoading(true)}
        // onLoadEnd tidak selalu terpanggil saat PWA dilayani service worker
        // (navigasi pertama ditahan onShouldStartLoadWithRequest). Pakai
        // onLoadProgress sebagai sinyal utama; onLoad/onLoadEnd tetap dipasang
        // untuk jalur normal.
        onLoadProgress={event => {
          if (event.nativeEvent.progress >= 1) {
            setLoading(false);
          }
        }}
        onLoad={() => setLoading(false)}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
        // Ini jalur LAN/localhost, bukan halaman publik.
        allowFileAccess={false}
        allowUniversalAccessFromFileURLs={false}
        // Cookie sesi harus ikut supaya kasir tidak login ulang tiap buka app.
        sharedCookiesEnabled
        thirdPartyCookiesEnabled={false}
        originWhitelist={['https://*']}
        testID="spazio-webview"
      />
      {loading && !failed ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
});
