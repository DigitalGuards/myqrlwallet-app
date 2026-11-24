/**
 * The vocabulary of the Theme setting, shared by the preference store, the
 * bridge and the screens. Every value that crosses a boundary (storage, a
 * bridge message) is checked with these guards and ignored otherwise.
 */
export const themePreferences = ['dark', 'light', 'system'] as const;
export type ThemePreference = (typeof themePreferences)[number];
export type ResolvedTheme = 'dark' | 'light';

/**
 * What a device that never chose uses. Nothing writes this to storage, so
 * changing it (to `system`, say) reaches everyone who has not chosen.
 */
export const DEFAULT_THEME: ThemePreference = 'dark';

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
