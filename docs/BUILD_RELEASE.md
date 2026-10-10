# Build dan Rilis

## Prasyarat

| Alat | Versi | Catatan |
| --- | --- | --- |
| Node.js | **22.13+** atau 24.x | RN 0.87 mensyaratkan ini. Terverifikasi di Node 24.21.0. |
| JDK | 17 | Terverifikasi di Temurin 17.0.17 |
| Android SDK | `platforms;android-37.0` | Butuh `ANDROID_HOME` |
| Android build-tools | **37.0.0** | RN 0.87 pin versi ini |
| Android NDK | **27.1.12297006** | Pin persis. NDK 30 TIDAK akan dipakai. |
| cmdline-tools | latest | Untuk `sdkmanager` |

## Kondisi mesin pengembangan saat ini

Semua sudah terpasang dan `assembleDebug` **sudah lolos**:

- `ANDROID_HOME` = `C:\Users\WorkPlus\AppData\Local\Android\Sdk` (set di User env)
- `android/local.properties` sudah dibuat (di-gitignore)
- `platforms/android-37.0`, `build-tools/37.0.0`, `ndk/27.1.12297006` terpasang
- Node 24.21.0, JDK 17.0.17
- `arm64-v8a` + `x86_64` (lihat catatan arsitektur di bawah)

### Catatan arsitektur — batas path Windows

`android/gradle.properties` memakai `reactNativeArchitectures=arm64-v8a,x86_64`,
**bukan** empat arsitektur default. Alasannya batasan Windows, bukan pilihan:
ninja menolak nama file objek CMake yang melewati 260 karakter.

```
ninja: error: Stat(...RNCSafeAreaViewShadowNode.cpp.o):
Filename longer than 260 characters
```

`LongPathsEnabled=1` di registry **tidak menolong** — ninja memakai
pemeriksaannya sendiri. Path proyek ini (63 char) + node_modules + prefix objek
CMake sudah melewati batas untuk `armeabi-v7a`.

Kembalikan keempat arsitektur kalau proyek dipindah ke path pendek, atau kalau
build dijalankan di CI Linux/macOS.

### Kalau SDK perlu dipasang ulang dari nol

`sdkmanager` **tidak bisa** dipanggil dari PowerShell dengan argumen yang
mengandung `;` — PowerShell memecahnya dan hasilnya `Package build-tools not
found`. Bungkus dengan `cmd /c`:

```powershell
$env:ANDROID_HOME='C:\Users\WorkPlus\AppData\Local\Android\Sdk'
$sm="$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat"
& cmd /c "`"$sm`" `"build-tools;37.0.0`" `"ndk;27.1.12297006`""
```

## Android

### Debug

```bash
npm install
npx react-native start          # terminal terpisah
npx react-native run-android
```

Atau langsung dari Gradle:

```bash
cd android
./gradlew.bat assembleDebug          # Windows
./gradlew assembleDebug              # macOS/Linux
```

APK hasil: `android/app/build/outputs/apk/debug/app-debug.apk`

### Release

Release memerlukan keystore. Buat sekali, simpan dengan aman:

```bash
cd android/app
keytool -genkeypair -v -storetype PKCS12 \
  -keystore spazio-release.keystore \
  -alias spazio \
  -keyalg RSA -keysize 2048 -validity 10000
```

Tambahkan `android/gradle.properties` (jangan di-commit):

```properties
SPAZIO_UPLOAD_STORE_FILE=spazio-release.keystore
SPAZIO_UPLOAD_KEY_ALIAS=spazio
SPAZIO_UPLOAD_STORE_PASSWORD=********
SPAZIO_UPLOAD_KEY_PASSWORD=********
```

Lalu hubungkan di `android/app/build.gradle` bagian `signingConfigs.release`,
dan build:

```bash
cd android
./gradlew.bat bundleRelease
```

AAB hasil: `android/app/build/outputs/bundle/release/app-release.aab`

## iOS

Belum diimplementasikan. Direktori `ios/` masih dari template dan tidak ada
jalur cetak di dalamnya. Lihat [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

## Variabel build

Aplikasi ini **tidak punya** URL server atau kunci API yang bisa dikonfigurasi
saat build:

- Origin PWA di-hardcode di `src/networking/ApiClient.ts` dan
  `src/security/originAllowlist.ts`. Kalau kedua tempat itu berbeda, bridge
  akan menolak pesan dari halaman yang justru dimuat — jadi keduanya harus
  diubah bersamaan.
- Host printer dikonfigurasi pengguna saat runtime, tidak pernah saat build.
- Tidak ada API key. Lihat [SECURITY.md](SECURITY.md).

## Daftar periksa sebelum rilis

- [ ] `npm run typecheck` lolos
- [ ] `npm run lint` tanpa error
- [ ] `npm test` lolos semua
- [ ] Versi dinaikkan di `package.json` dan `android/app/build.gradle`
      (`versionCode` **dan** `versionName`)
- [ ] Versi di `APP_VERSION` (`src/app/AppServices.tsx`) ikut dinaikkan
- [ ] `usesCleartextTraffic` masih `true` (cetak LAN tidak akan jalan tanpa itu)
- [ ] Keystore release tercadang di luar repo
- [ ] Uji fisik dari [TESTING.md](TESTING.md) sudah dijalankan
- [ ] APK/AAB dipasang di perangkat bersih, login, dan cetak satu struk

## Pemecahan masalah build

**`ANDROID_HOME` tidak ditemukan**
Setel ke instalasi Android SDK, misalnya
`C:\Users\<nama>\AppData\Local\Android\Sdk`, lalu buka ulang terminal.

**`Failed to install the app`**
Pastikan ada emulator berjalan atau perangkat terhubung
(`adb devices`).

**Gradle kehabisan memori**
Tambahkan ke `android/gradle.properties`:
`org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m`

**Modul native tidak ditemukan setelah `npm install`**
Jalankan ulang `npx react-native run-android` — autolinking baru dijalankan saat
build, bukan saat install.
