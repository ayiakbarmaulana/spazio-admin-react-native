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
- `ninja.exe` di `cmake/3.22.1/bin/` sudah diganti ke **1.13.2** (lihat catatan di bawah)
- `arm64-v8a` + `x86_64` (lihat catatan arsitektur di bawah)

### Batas path Windows — ninja 1.10.2 buggy

`react-native-safe-area-context` (sejak v5.x) dan `react-native-screens`
memakai `file(GLOB ...)` dengan path **absolut** di `android/src/main/jni/CMakeLists.txt`.
CMake menerjemahkannya jadi nama file objek ter-mangle
(`C__DEV_spazia-..._RNCSafeAreaViewShadowNode.cpp.o`, 190 char). Total path
objek ≈ 385 char:

```
ninja: error: Stat(safeareacontext_autolinked_build/.../RNCSafeAreaViewShadowNode.cpp.o):
Filename longer than 260 characters
```

Ini **bug ninja 1.10.2** (yang dipaketkan bareng CMake 3.22.1 di Android SDK),
bukan bug RN atau kode kita:

- `LongPathsEnabled=1` di registry **tidak menolong** — ninja pakai pemeriksaannya sendiri.
- `subst` drive letter **tidak cukup** — mangled name 190 char sudah > batas efektif 250.
- `assembleDebug` lolos hanya karena kebetulan memakai CMakeLists codegen legacy
  (relative path → nama objek pakai hash 32 char), sedangkan `assembleRelease`
  memakai CMakeLists `src/main/jni` (absolute path → mangled panjang).
- Muncul di `arm64-v8a` **dan** `x86_64`.

Lihat [ninja-build/ninja#1900](https://github.com/ninja-build/ninja/issues/1900)
dan [appandflow/react-native-safe-area-context#654](https://github.com/appandflow/react-native-safe-area-context/issues/654).

**Perbaikan: ganti `ninja.exe` bawaan SDK dengan ninja ≥ 1.11.**
Fix dilakukan sekali saja per mesin. Backup yang lama dulu:

```powershell
$nj  = "$env:ANDROID_HOME\cmake\3.22.1\bin\ninja.exe"
$tmp = "$env:TEMP\ninja-win.zip"
Copy-Item $nj "$nj.1.10.2.bak" -Force
Invoke-WebRequest 'https://github.com/ninja-build/ninja/releases/latest/download/ninja-win.zip' -OutFile $tmp
Expand-Archive $tmp "$env:TEMP\ninja-new" -Force
Copy-Item "$env:TEMP\ninja-new\ninja.exe" $nj -Force
& $nj --version    # harus >= 1.11, mis. 1.13.2
```

Kembalikan `ninja.exe.1.10.2.bak` kalau perlu. Setelah ninja diperbarui, keempat
arsitektur default pun bisa dipakai — `reactNativeArchitectures` tidak lagi
dibatasi path.

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

### Release (APK sideload)

Untuk sideload tanpa Play Store, pakai `assembleRelease` (menghasilkan APK),
bukan `bundleRelease` (menghasilkan AAB untuk Play Store):

```bash
cd android
./gradlew.bat assembleRelease --console=plain
```

APK hasil: `android/app/build/outputs/apk/release/app-release.apk` (~48 MB).

Kalau belum ada keystore release, `signingConfigs.release` otomatis jatuh ke
`debug.keystore` (alias `androiddebugkey`, password `android`). APK-nya tetap
**signed dan bisa di-sideload**, tapi **tidak bisa** diunggah ke Play Store —
Play menolak sertifikat debug. Buat keystore release di atas sebelum rilis
sungguhan.

Verifikasi hasil build:

```powershell
$apksigner = "$env:ANDROID_HOME\build-tools\37.0.0\apksigner.bat"
& $apksigner verify --print-certs android/app/build/outputs/apk/release/app-release.apk
```

### Distribusi tanpa USB

APK tidak perlu `adb` atau perangkat terhubung. Kirim filenya lewat
Drive/Telegram/WhatsApp, lalu di HP:

1. Buka file APK dari aplikasi pengirim (jangan dari manajer file — sering
   diblokir).
2. Saat muncul peringatan, izinkan "Install unknown apps" untuk aplikasi
   pengirim itu (Settings → Apps → Special access → Install unknown apps).
3. Install, lalu buka `SpazioNativePOS`.

Android akan menolak install kalau `versionCode` di HP lebih tinggi dari APK,
atau kalau sertifikat penanda tangan berbeda. Naikkan `versionCode` di
`android/app/build.gradle` sebelum tiap distribusi ulang.

### Release (AAB untuk Play Store)

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

## Ikon dan layar pembuka

Ikon aplikasi dan layar pembuka (opening screen) **tidak** diatur lewat
`app.json` secara langsung — `app.json` hanya menyimpan *deklarasi* sumber
gambar, dan `scripts/gen-assets.js` yang menurunkannya menjadi resource
Android di `android/app/src/main/res/`.

### Menyiapkan gambar

Taruh tiga file di `assets/` (nama dan lokasi persisnya ada di `app.json`
pada kunci `assets`):

| File | Fungsi | Saran ukuran |
| --- | --- | --- |
| `icon.png` | Ikon aplikasi (Android < 8 dan ikon legacy) | 1024×1024 PNG, opak |
| `icon-foreground.png` | Lapisan depan adaptive icon (Android 8+) | 1024×1024 PNG, transparan, logo ≤ 60% kanvas |
| `splash.png` | Logo layar pembuka | 1024×1024 PNG, transparan |

`icon-foreground.png` bersifat opsional: kalau tidak ada, `icon.png` dipakai
sebagai foreground (akan terlihat terpotong pada launcher yang memakai mask
bulat, jadi sebaiknya tetap disiapkan).

Warna latar ikon dan layar pembuka diatur lewat `assets.iconBackground` dan
`assets.splashBackground` di `app.json` (format `#RRGGBB`).

### Menjalankan generator

```bash
npm run assets
```

Skrip menulis:

- `mipmap-{mdpi..xxxhdpi}/ic_launcher.png` — ikon 48–192 px
- `mipmap-{mdpi..xxxhdpi}/ic_launcher_round.png` — versi terpotong bulat
- `mipmap-{mdpi..xxxhdpi}/ic_launcher_foreground.png` — kanvas 108 dp
- `mipmap-anydpi-v26/ic_launcher.xml` + `ic_launcher_round.xml` — adaptive icon
- `drawable-nodpi/splash_logo.png` — logo layar pembuka 512 px
- `values/colors.xml` — warna latar ikon dan layar pembuka

File-file itu **hasil generate**; perubahannya akan hilang tiap kali skrip
dijalankan. Kalau butuh perubahan permanen, ubah `app.json` atau
`scripts/gen-assets.js`, bukan output-nya.

Bagian yang ditulis tangan dan tidak disentuh generator:
`res/drawable/splash_screen.xml` (susunan layar pembuka untuk Android < 12),
`res/values/styles.xml` dan `res/values-v31/styles.xml` (tema `SplashTheme`).

Kalau salah satu gambar belum ada, skrip melewatinya dengan peringatan dan
tetap selesai dengan kode keluar 0 — jadi generator bisa dijalankan bertahap.

Setelah mengubah gambar, bangun ulang APK supaya perubahannya ikut masuk:

```bash
cd android
./gradlew.bat assembleRelease
```


- [ ] `npm run typecheck` lolos
- [ ] `npm run lint` tanpa error
- [ ] `npm test` lolos semua
- [ ] Versi dinaikkan di `package.json` dan `android/app/build.gradle`
      (`versionCode` **dan** `versionName`)
- [ ] Versi di `APP_VERSION` (`src/app/AppServices.tsx`) ikut dinaikkan
- [ ] `usesCleartextTraffic` masih `true` (cetak LAN tidak akan jalan tanpa itu)
- [ ] Ikon dan layar pembuka sudah digenerate ulang (`npm run assets`) dan
      sumbernya di `assets/` ikut ter-commit
- [ ] Keystore release tercadang di luar repo
- [ ] Uji fisik dari [TESTING.md](TESTING.md) sudah dijalankan
- [ ] APK/AAB dipasang di perangkat bersih, login, dan cetak satu struk
- [ ] `assembleRelease` menghasilkan `app-release.apk`
      (`apksigner verify` lulus) sebelum dikirim ke HP

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
