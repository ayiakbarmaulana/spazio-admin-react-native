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
  ],
};
