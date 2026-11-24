import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance, AppState } from 'react-native';
import * as SystemUI from 'expo-system-ui';
import Logger from '../services/Logger';
import { nativePalettes } from '../constants/Theme';
import { DEFAULT_THEME, isThemePreference, type ResolvedTheme, type ThemePreference, type ThemeSnapshot } from './themes';

/**
 * The native Theme setting, in the pattern of `i18n/preference.ts`: its own
 * storage key, a restore at start that a live change overrides, a failed read
 * meaning "nothing saved", and no write of the default.
 *
 * The shell leads the wallet it carries, so `system` is resolved here from the
 * OS appearance and the wallet is only told the outcome.
 */
export const THEME_STORAGE_KEY = 'native_wallet_theme';

type Listener = () => void;

let preference: ThemePreference = DEFAULT_THEME;
let saved: ThemePreference | undefined;
let liveRevision = 0;
let restore: Promise<void> | undefined;
let writes = Promise.resolve();
let osScheme: ResolvedTheme = 'dark';
let osStale = false;
let snapshot: ThemeSnapshot = { theme: DEFAULT_THEME, resolved: 'dark' };
let started = false;
const listeners = new Set<Listener>();

function schemeOf(value: unknown): ResolvedTheme {
  // An unknown OS appearance falls back to the default look.
  return value === 'light' ? 'light' : 'dark';
}

function resolve(): ResolvedTheme {
  return preference === 'system' ? osScheme : preference;
}

/** Make the platform follow: alerts, action sheets, the Android system bars and the root view. */
function applyToPlatform(resolved: ResolvedTheme) {
  try {
    // 'unspecified' hands the appearance back to the OS, so `system` keeps reading the real value.
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  } catch {
    Logger.warn('Theme', 'Could not set the platform appearance');
  }
  try {
    void Promise.resolve(SystemUI.setBackgroundColorAsync(nativePalettes[resolved].background)).catch(() => {
      Logger.warn('Theme', 'Could not set the root view colour');
    });
  } catch {
    Logger.warn('Theme', 'Could not set the root view colour');
  }
}

function publish() {
  const resolved = resolve();
  const changed = snapshot.theme !== preference || snapshot.resolved !== resolved;
  if (changed) snapshot = { theme: preference, resolved };
  applyToPlatform(resolved);
  if (changed) listeners.forEach((listener) => listener());
}

function readOsScheme() {
  try {
    return schemeOf(Appearance.getColorScheme());
  } catch {
    return osScheme;
  }
}

/**
 * iOS can flip the appearance for a moment while the app goes to the
 * background (the snapshot for the app switcher). Those flips are held until
 * the app is active again, when the real value is read.
 */
function start() {
  if (started) return;
  started = true;
  osScheme = readOsScheme();
  snapshot = { theme: preference, resolved: resolve() };
  // The effective choice (the default while nothing is chosen) drives the platform from the
  // start, so alerts and keyboards match the app. The OS value was read above, before this.
  // Nothing is written to storage.
  applyToPlatform(snapshot.resolved);
  try {
    Appearance.addChangeListener(({ colorScheme }) => {
      if (preference !== 'system') return;
      if (AppState.currentState !== 'active') {
        osStale = true;
        return;
      }
      osStale = false;
      const next = schemeOf(colorScheme);
      if (next === osScheme) return;
      osScheme = next;
      publish();
    });
    AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !osStale) return;
      osStale = false;
      if (preference !== 'system') return;
      const next = readOsScheme();
      if (next === osScheme) return;
      osScheme = next;
      publish();
    });
  } catch {
    Logger.warn('Theme', 'Could not watch the platform appearance');
  }
}

/** The current choice and what it resolves to. The same object until something changes. */
export function getThemeSnapshot(): ThemeSnapshot {
  start();
  return snapshot;
}

export function subscribeTheme(listener: Listener): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The theme this device has saved, once restoration has finished. A failed read counts as none. */
export function savedThemePreference(): ThemePreference | undefined {
  return saved;
}

/** A live change wins over a storage read that started earlier. */
export function restoreThemePreference(): Promise<void> {
  start();
  if (liveRevision > 0) return Promise.resolve();
  if (restore) return restore;
  const revision = liveRevision;
  restore = (async () => {
    try {
      const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      if (revision === liveRevision && isThemePreference(stored)) {
        saved = stored;
        preference = stored;
        if (stored === 'system') {
          // The start override must be released before the OS value can be read.
          try {
            Appearance.setColorScheme('unspecified');
          } catch {
            /* publish reports it */
          }
          osScheme = readOsScheme();
        }
        publish();
      }
    } catch {
      Logger.warn('Theme', 'Could not restore the native theme preference');
    }
  })();
  return restore;
}

/** The Settings screen's choice, or a report the bridge has authenticated and validated. */
export function applyTheme(value: unknown): Promise<void> {
  if (!isThemePreference(value)) return Promise.resolve();
  start();
  liveRevision += 1;
  if (saved === value && preference === value) return writes;
  saved = value;
  preference = value;
  // Handing the appearance back to the OS first, so the value read next is the OS's own.
  if (value === 'system') {
    try {
      Appearance.setColorScheme('unspecified');
    } catch {
      /* publish reports it */
    }
    osScheme = readOsScheme();
  }
  publish();
  writes = writes.then(async () => {
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, value);
    } catch {
      Logger.warn('Theme', 'Could not save the native theme preference');
    }
  });
  return writes;
}

/** Test seam: return the module to its first-start state. */
export function resetThemeForTests(): void {
  preference = DEFAULT_THEME;
  saved = undefined;
  liveRevision = 0;
  restore = undefined;
  writes = Promise.resolve();
  osScheme = 'dark';
  osStale = false;
  snapshot = { theme: DEFAULT_THEME, resolved: 'dark' };
  // Subscribers stay: the bridge subscribes once, for the life of the app.
  started = false;
}
