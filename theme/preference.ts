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

/**
 * Make the platform follow: alerts, action sheets, the Android system bars and the root view.
 * Nothing native is touched before `startThemePlatform()` ran: the module is imported while the
 * bundle evaluates, which is the start-up window kept free of native calls.
 */
function applyToPlatform(resolved: ResolvedTheme) {
  if (!started) return;
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
/**
 * The first native calls of the theme code: read the OS appearance, apply the effective choice
 * to the platform and watch for appearance changes. The boot sequence calls this where it runs its
 * other deferred native steps; until then the store only holds JavaScript state.
 *
 * The OS value read here happens BEFORE the platform override is applied, and it is the one
 * used for `system` from then on. It is never read again right after releasing an override,
 * because the native release lands later and a read in between returns the forced value; the
 * `appearanceChanged` event corrects the value afterwards.
 */
export function startThemePlatform() {
  if (started) return;
  started = true;
  osScheme = readOsScheme();
  const resolved = resolve();
  // The effective choice (the default while nothing is chosen) drives the platform from the
  // start, so alerts and keyboards match the app. Nothing is written to storage.
  applyToPlatform(resolved);
  const changed = snapshot.theme !== preference || snapshot.resolved !== resolved;
  if (changed) {
    snapshot = { theme: preference, resolved };
    listeners.forEach((listener) => listener());
  }
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
  return snapshot;
}

export function subscribeTheme(listener: Listener): () => void {
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
  if (liveRevision > 0) return Promise.resolve();
  if (restore) return restore;
  const revision = liveRevision;
  restore = (async () => {
    try {
      const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      if (revision === liveRevision && isThemePreference(stored)) {
        saved = stored;
        preference = stored;
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
  startThemePlatform();
  liveRevision += 1;
  if (saved === value && preference === value) return writes;
  saved = value;
  preference = value;
  // For `system`, publish hands the appearance back to the OS and uses the OS value read at
  // start. A later `appearanceChanged` event corrects it if the OS moved while an override held.
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

/** How long the document and the splash wait for the stored choice before they go on without it. */
export const THEME_RESTORE_DEADLINE_MS = 1500;

/**
 * The restore, raced against one shared deadline. A read that never settles must not hold the
 * splash, the wallet document or the handshake back. After the deadline the store still takes the
 * stored value when it arrives, and the change reaches the native screens and the wallet.
 */
export function restoreThemeWithinDeadline(): Promise<void> {
  return new Promise<void>((resolveDeadline) => {
    const timer = setTimeout(resolveDeadline, THEME_RESTORE_DEADLINE_MS);
    void restoreThemePreference().finally(() => {
      clearTimeout(timer);
      resolveDeadline();
    });
  });
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
