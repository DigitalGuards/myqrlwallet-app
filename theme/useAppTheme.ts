import { useSyncExternalStore } from 'react';
import { StyleSheet } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { LOGO_IMAGE, LOGO_IMAGE_LIGHT } from '../constants/Assets';
import { nativePalettes, type NativePalette } from '../constants/Theme';
import { getThemeSnapshot, subscribeTheme } from './preference';
import type { ResolvedTheme, ThemeSnapshot } from './themes';

/** The choice and the resolved theme. Re-renders on a new choice or, for `system`, a new OS appearance. */
export function useAppTheme(): ThemeSnapshot {
  return useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeSnapshot);
}

export function useResolvedTheme(): ResolvedTheme {
  return useAppTheme().resolved;
}

/** The colour table of the resolved theme. */
export function usePalette(): NativePalette {
  return nativePalettes[useResolvedTheme()];
}

/** The wordmark whose lettering reads on the resolved theme's background. */
export function useLogoSource(): ImageSourcePropType {
  return useResolvedTheme() === 'light' ? LOGO_IMAGE_LIGHT : LOGO_IMAGE;
}

/**
 * Build a value from the palette once per theme and hand the right one to the
 * component. Colour tables local to a screen use this:
 *
 *   const useC = createThemed((p) => ({ bg: p.background }));
 */
export function createThemed<T>(factory: (palette: NativePalette) => T): () => T {
  const cache: Partial<Record<ResolvedTheme, T>> = {};
  return function useThemed(): T {
    const resolved = useResolvedTheme();
    let value = cache[resolved];
    if (value === undefined) {
      value = factory(nativePalettes[resolved]);
      cache[resolved] = value;
    }
    return value;
  };
}

/**
 * Module-level `StyleSheet.create` cannot follow a theme. This builds each
 * theme's sheet once from a function of the palette:
 *
 *   const useStyles = createThemedStyles((p) => ({ root: { backgroundColor: p.background } }));
 *   const styles = useStyles();
 */
export function createThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (palette: NativePalette) => T,
): () => T {
  return createThemed((palette) => StyleSheet.create(factory(palette)));
}
