import { nativePalettes, type NativePalette } from '../../constants/Theme';

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

type ColorKey = {
  [K in keyof NativePalette]: NativePalette[K] extends string ? K : never;
}[keyof NativePalette];

// Text pairs need 4.5:1, outlines and glyphs 3:1.
const TEXT: [ColorKey, ColorKey][] = [
  ['foreground', 'background'], ['foreground', 'card'], ['foreground', 'elevated'],
  ['mutedForeground', 'background'], ['mutedForeground', 'card'], ['mutedForeground', 'elevated'],
  ['tertiary', 'background'], ['tertiary', 'card'],
  ['primaryForeground', 'primary'],
  ['primary', 'background'], ['primary', 'card'],
  ['destructive', 'background'], ['destructive', 'card'],
  ['success', 'card'],
];
const GRAPHICS: [ColorKey, ColorKey][] = [['inputBorder', 'card'], ['primary', 'card']];

// The dark table is the one the app already shipped and is pinned unchanged below.
// Its tertiary text and input outline sit under these bars today; that is recorded in
// the review notes, and this suite holds the new light table to them.
describe('the light palette', () => {
  const palette = nativePalettes.light;
  it.each(TEXT)('%s on %s reaches 4.5:1', (foreground, background) => {
    expect(contrast(palette[foreground], palette[background])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(GRAPHICS)('%s against %s reaches 3:1', (a, b) => {
    expect(contrast(palette[a], palette[b])).toBeGreaterThanOrEqual(3);
  });
});

it('keeps the dark table byte for byte what the app shipped', () => {
  expect(nativePalettes.dark).toMatchObject({
    background: '#080C16', card: '#0E1320', elevated: '#171D2B', border: '#1E2738',
    foreground: '#F2F5F8', mutedForeground: '#9BA6B5', tertiary: '#69717D',
    primary: '#33ADE6', primaryForeground: '#041725', secondary: '#20A6E9', identityAccent: '#A5D7E9',
    success: '#37BE7F', destructive: '#E56161', disabledPrimary: '#213A45',
  });
});

it('gives the light page the Ink and blue values', () => {
  expect(nativePalettes.light).toMatchObject({
    background: '#F3F4F7', card: '#FFFFFF', border: '#D6D9E1', foreground: '#0F1729',
    primary: '#0967AE', primaryForeground: '#FFFFFF', destructive: '#9E1A1A',
  });
});
