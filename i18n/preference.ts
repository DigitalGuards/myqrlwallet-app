import AsyncStorage from '@react-native-async-storage/async-storage';
import Logger from '../services/Logger';
import { i18n } from './index';
import { isLanguage, type Language } from './languages';

export const LANGUAGE_STORAGE_KEY = 'native_wallet_language';
let liveRevision = 0;
let restore: Promise<void> | undefined;
let writes = Promise.resolve();
let saved: Language | undefined;

/**
 * The language this device has saved, once restoration has finished. A failed
 * read counts as none, so it can never push a default over a real choice.
 */
export function savedLanguagePreference(): Language | undefined {
  return saved;
}

/** A live change wins over a storage read that started earlier. */
export function restoreLanguagePreference(): Promise<void> {
  if (liveRevision > 0) return Promise.resolve();
  if (restore) return restore;
  const revision = liveRevision;
  restore = (async () => {
    try {
      const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (revision === liveRevision && isLanguage(stored)) {
        saved = stored;
        await i18n.changeLanguage(stored);
      }
    } catch {
      Logger.warn('Language', 'Could not restore the native language preference');
    }
  })();
  return restore;
}

/** The Settings screen's choice, or a report the bridge has authenticated and validated. */
export function applyLanguage(value: unknown): Promise<void> {
  if (!isLanguage(value)) return Promise.resolve();
  liveRevision += 1;
  saved = value;
  // Bundled resources make the visible change synchronous, independent of storage.
  void i18n.changeLanguage(value);
  writes = writes.then(async () => {
    try {
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, value);
    } catch {
      Logger.warn('Language', 'Could not save the native language preference');
    }
  });
  return writes;
}
