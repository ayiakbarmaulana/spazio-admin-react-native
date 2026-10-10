module.exports = {
  preset: '@react-native/jest-preset',
  testMatch: [
    '<rootDir>/__tests__/**/*.test.ts',
    '<rootDir>/__tests__/**/*.test.tsx',
  ],
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/__tests__/helpers/'],
  // react-native-tcp-socket dan op-sqlite dikirim sebagai ESM mentah; Babel
  // tetap perlu mentransformasinya agar bisa di-import dari CommonJS Jest.
  transformIgnorePatterns: [
    'node_modules/(?!(?:@react-native|react-native|react-native-webview|react-native-tcp-socket|@op-engineering/op-sqlite|@react-native-async-storage|@react-native-community)/)',
  ],
};
