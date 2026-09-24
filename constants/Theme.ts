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
