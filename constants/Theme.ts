/**
 * QRL Blue: the native app's canonical color tokens.
 *
 * Mirrors the web wallet's "QRL Blue" palette (myqrlwallet-frontend
 * src/index.css). One deep navy surface family, QRL's sky blue as the
 * single action color, and a pale ice blue reserved for identity and
 * informational states. Sky blue acts, ice blue identifies.
 *
 * These are exported as plain hex strings (not HSL) because React Native's
 * StyleSheet does not resolve CSS custom properties or hsl() at runtime.
 * Several screens keep their own local `C` token object rather than
 * importing this module directly (an existing per-screen scoping
 * convention); when touching those, keep their values equal to the ones
 * below so the palette stays a single source of truth in practice.
 */
export const NativeTheme = {
  background: '#080C16',
  card: '#0E1320',
  // Elevated surface: pressed cards, secondary buttons, input wells.
  elevated: '#171D2B',
  border: '#1E2738',
  foreground: '#F2F5F8',
  mutedForeground: '#9BA6B5',
  // Neutral tertiary tone (chevrons, disabled labels), hue-aligned with
  // border/mutedForeground rather than the old warm gray.
  tertiary: '#69717D',

  // QRL sky blue: the single action color.
  primary: '#33ADE6',
  // Dark text/icon color used on top of primary (and other light accent)
  // fills so buttons and badges clear WCAG AA non-text contrast.
  primaryForeground: '#041725',
  // Brand accent token (rails, edges, badges), a sibling of primary used
  // where a screen wants a second, slightly different accent instead of
  // repeating primary everywhere.
  secondary: '#20A6E9',

  // Ice blue: the identity color and informational accent.
  identityAccent: '#A5D7E9',

  success: '#37BE7F',
  successForeground: '#042515',

  destructive: '#E56161',
  destructiveForeground: '#290A0A',

  // Desaturated, dark primary used for disabled primary buttons.
  disabledPrimary: '#213A45',
} as const;

export default NativeTheme;

/**
 * Every colour the native screens paint, as one table per resolved theme.
 * `NativeTheme` above is the dark table and stays byte for byte what it was;
 * `NativeThemeLight` is the "Ink and blue" set of the web wallet's light mode.
 */
export interface NativePalette {
  background: string;
  card: string;
  elevated: string;
  border: string;
  foreground: string;
  mutedForeground: string;
  tertiary: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  identityAccent: string;
  success: string;
  successForeground: string;
  destructive: string;
  destructiveForeground: string;
  disabledPrimary: string;
  /** Outline of an input box. The hairline is too faint to identify one on a white card. */
  inputBorder: string;
  /** Full-screen scrim behind a modal card. */
  scrim: string;
  /** Page colour at zero alpha, for gradients that fade into the page. */
  accentGlow: readonly [string, string, string];
  accentFloor: readonly [string, string];
  /** The 8% track under progress bars and the ember dots' base colour. */
  track: string;
  /** Dot and caret colour inside PIN boxes. */
  pinDot: string;
}

export const NativeThemeDark: NativePalette = {
  ...NativeTheme,
  inputBorder: '#1E2738',
  scrim: 'rgba(0, 0, 0, 0.7)',
  accentGlow: ['rgba(51, 173, 230, 0.14)', 'rgba(51, 173, 230, 0.04)', 'rgba(0, 0, 0, 0)'],
  accentFloor: ['rgba(0, 0, 0, 0)', 'rgba(165, 215, 233, 0.05)'],
  track: 'rgba(242, 245, 248, 0.08)',
  pinDot: '#F2F5F8',
};

export const NativeThemeLight: NativePalette = {
  background: '#F3F4F7', // hsl(220 20% 96%)
  card: '#FFFFFF',
  elevated: '#EAECF1', // hsl(220 20% 93%)
  border: '#D6D9E1', // hsl(220 16% 86%)
  foreground: '#0F1729', // hsl(222 47% 11%)
  mutedForeground: '#525A6B',
  tertiary: '#606876',
  primary: '#0967AE', // hsl(206 90% 36%)
  primaryForeground: '#FFFFFF',
  secondary: '#0967AE',
  identityAccent: '#0967AE',
  success: '#186240',
  successForeground: '#FFFFFF',
  destructive: '#9E1A1A', // hsl(0 72% 36%)
  destructiveForeground: '#FFFFFF',
  disabledPrimary: '#D6D9E1',
  inputBorder: '#7E8695',
  scrim: 'rgba(15, 23, 41, 0.45)',
  accentGlow: ['rgba(9, 103, 174, 0.10)', 'rgba(9, 103, 174, 0.03)', 'rgba(243, 244, 247, 0)'],
  accentFloor: ['rgba(243, 244, 247, 0)', 'rgba(9, 103, 174, 0.05)'],
  track: 'rgba(15, 23, 41, 0.10)',
  pinDot: '#0F1729',
};

export const nativePalettes = { dark: NativeThemeDark, light: NativeThemeLight } as const;
