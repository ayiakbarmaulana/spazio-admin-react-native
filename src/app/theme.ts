// src/app/theme.ts
// Token tampilan. Satu tempat — layar tidak boleh menulis warna hex langsung.

export const Colors = {
  background: '#0f1115',
  surface: '#181b22',
  surfaceAlt: '#21252e',
  border: '#2c313c',
  primary: '#2f7cf6',
  success: '#2ea86a',
  warning: '#d99a2b',
  danger: '#d9483b',
  text: '#f2f4f8',
  textMuted: '#98a2b3',
  textFaint: '#6b7280',
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const Radius = {
  sm: 6,
  md: 10,
  lg: 16,
} as const;

export const FontSize = {
  xs: 12,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 22,
  xxl: 28,
} as const;
