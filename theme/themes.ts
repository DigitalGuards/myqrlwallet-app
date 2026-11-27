/**
 * The vocabulary of the Theme setting, shared by the preference store, the
 * bridge and the screens. Every value that crosses a boundary (storage, a
 * bridge message) is checked with these guards and ignored otherwise.
 */
export const themePreferences = ['dark', 'light', 'system'] as const;
export type ThemePreference = (typeof themePreferences)[number];
export type ResolvedTheme = 'dark' | 'light';

/**
 * What a device that never chose uses: the phone's own appearance. Nothing writes this to
 * storage, so changing it reaches everyone who has not chosen.
 *
 * The native splash screen follows the OS appearance too (a dark and a light variant in the
 * splash plugin configuration), so a never-chosen device sees one theme from the first frame.
 * A user who chose a theme that differs from the OS sees the OS splash first and then their
 * theme; the splash is painted before JavaScript can read the choice.
 */
export const DEFAULT_THEME: ThemePreference = 'system';

export function isThemePreference(value: unknown): value is ThemePreference {
  return themePreferences.some((theme) => theme === value);
}

export function isResolvedTheme(value: unknown): value is ResolvedTheme {
  return value === 'dark' || value === 'light';
}

export interface ThemeSnapshot {
  readonly theme: ThemePreference;
  readonly resolved: ResolvedTheme;
}
