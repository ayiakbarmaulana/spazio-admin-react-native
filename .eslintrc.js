module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      // Test memeriksa byte ESC/POS mentah, jadi regex kontrol (\x1b, \x1d)
      // memang perlu. "javascript:" juga diuji justru untuk memastikan DITOLAK.
      files: ['__tests__/**/*.ts'],
      rules: {
        'no-control-regex': 'off',
        'no-script-url': 'off',
      },
    },
    {
      // Skrip build dijalankan Node langsung (bukan bundel Metro), jadi
      // global Node seperti Buffer dan require tersedia apa adanya.
      files: ['scripts/**/*.js'],
      env: { node: true },
    },
  ],
};
