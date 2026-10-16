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

import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  WebView,
  type WebViewMessageEvent,
  type WebViewNavigation,
} from 'react-native-webview';
import { Colors, FontSize, Radius, Spacing } from '../app/theme';
import {
  DEFAULT_ORIGIN,
  DEV_ORIGIN,
} from '../networking/ApiClient';
import {
  ALLOWED_ORIGINS,
  isAllowedBridgeOrigin,
  isAllowedNavigation,
  isExternalLink,
  TRUSTED_NAVIGATION_ORIGINS,
} from '../security/originAllowlist';
import { toOriginWhitelist } from '../security/originWhitelist';
import type { BridgeHandler } from './bridgeHandler';
import { BRIDGE_CHANNEL } from './bridgeProtocol';
import {
  INITIAL_LOAD_STATE,
  LOAD_TIMEOUT_MS,
  webViewLoadReducer,
} from './webViewLoadState';

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
  // Dev memakai server `spazio-dev`; rilis memakai PWA produksi. Dua-duanya
  // ada di `TRUSTED_NAVIGATION_ORIGINS` pada build yang sesuai, jadi tidak
  // ada halaman app sendiri yang salah dilempar ke browser.
  origin = __DEV__ ? DEV_ORIGIN : DEFAULT_ORIGIN,
  onBridgeError,
}: Props) {
  const webViewRef = useRef<React.ElementRef<typeof WebView>>(null);
  const [state, dispatch] = useReducer(
    webViewLoadReducer,
    INITIAL_LOAD_STATE,
  );
  const { loading, failed, reason } = state;
  // Naikkan untuk memaksa WebView dimuat ulang â€” satu-satunya cara andal
  // keluar dari halaman yang gagal tanpa mematikan app.
  const [reloadKey, setReloadKey] = useState(0);

  const source = useMemo(() => ({ uri: origin }), [origin]);

  // react-native-webview menyaring URL di sini SEBELUM
  // onShouldStartLoadWithRequest dipanggil, dan default library-nya adalah
  // ['http://*', 'https://*']. Bentuk pola harus persis seperti yang dipakai
  // library — itu diuji di origin-whitelist.test.ts, bukan ditebak di sini.
  const originWhitelist = useMemo(
    () =>
      toOriginWhitelist([...ALLOWED_ORIGINS, ...TRUSTED_NAVIGATION_ORIGINS]),
    [],
  );

  // Jaring pengaman terakhir. Kalau host tujuan tidak bisa dihubungi,
  // react-native-webview tidak memanggil onError sama sekali â€” hanya berhenti
  // diam. Timer ini yang mengubah "muter selamanya" jadi pesan yang bisa
  // ditindaklanjuti kasir.
  useEffect(() => {
    if (!loading) {
      return undefined;
    }
    const timer = setTimeout(() => dispatch({ type: 'timeout' }), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loading, reloadKey]);

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
        key={reloadKey}
        ref={webViewRef}
        source={source}
        injectedJavaScriptBeforeContentLoaded={INJECTED_BEFORE_LOAD}
        onMessage={handleMessage}
        onShouldStartLoadWithRequest={handleNavigation}
        onLoadStart={() => dispatch({ type: 'start' })}
        // onLoadEnd tidak selalu terpanggil saat PWA dilayani service worker
        // (navigasi pertama ditahan onShouldStartLoadWithRequest). Pakai
        // onLoadProgress sebagai sinyal utama; onLoad/onLoadEnd tetap dipasang
        // untuk jalur normal.
        onLoadProgress={event =>
          dispatch({ type: 'progress', progress: event.nativeEvent.progress })
        }
        onLoad={() => dispatch({ type: 'done' })}
        onLoadEnd={() => dispatch({ type: 'done' })}
        // Halaman error (404/500) TIDAK memicu onError. Tanpa onHttpError,
        // status itu tampil sebagai spinner abadi.
        onHttpError={event =>
          dispatch({
            type: 'fail',
            reason: `Server membalas ${event.nativeEvent.statusCode}.`,
          })
        }
        onError={event =>
          dispatch({ type: 'fail', reason: event.nativeEvent.description })
        }
        // Ini jalur LAN/localhost, bukan halaman publik.
        allowFileAccess={false}
        allowUniversalAccessFromFileURLs={false}
        // Cookie sesi harus ikut supaya kasir tidak login ulang tiap buka app.
        sharedCookiesEnabled
        thirdPartyCookiesEnabled={false}
        originWhitelist={originWhitelist}
        testID="spazio-webview"
      />
      {loading && !failed ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : null}
      {failed ? (
        <View style={styles.overlay}>
          <Text style={styles.failTitle}>Gagal memuat layar kasir</Text>
          {reason ? <Text style={styles.failReason}>{reason}</Text> : null}
          <Text style={styles.failOrigin}>{origin}</Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => setReloadKey(k => k + 1)}
            testID="spazio-webview-retry">
            <Text style={styles.retryLabel}>Coba lagi</Text>
          </Pressable>
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
  failTitle: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: '600',
    paddingHorizontal: Spacing.xl,
    textAlign: 'center',
  },
  failReason: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    textAlign: 'center',
  },
  failOrigin: {
    color: Colors.textFaint,
    fontSize: FontSize.xs,
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.xl,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    marginTop: Spacing.xl,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  retryLabel: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
});
