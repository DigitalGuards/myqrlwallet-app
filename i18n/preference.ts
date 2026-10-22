import AsyncStorage from '@react-native-async-storage/async-storage';
import Logger from '../services/Logger';
import { i18n } from './index';
import { isLanguage } from './languages';

export const LANGUAGE_STORAGE_KEY = 'native_wallet_language';
let webRevision = 0;
let restore: Promise<void> | undefined;
let writes = Promise.resolve();

/** A live web report wins over a storage read that started earlier. */
export function restoreLanguagePreference(): Promise<void> {
  if (webRevision > 0) return Promise.resolve();
  if (restore) return restore;
  const revision = webRevision;
  restore = (async () => {
    try {
      const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (revision === webRevision && isLanguage(stored)) {
        await i18n.changeLanguage(stored);
      }
    } catch {
      Logger.warn('Language', 'Could not restore the native language preference');
    }
  })();
  return restore;
}

/** Called only after the bridge authenticates its document and validates the payload. */
export function applyWebLanguage(value: unknown): Promise<void> {
  if (!isLanguage(value)) return Promise.resolve();
  webRevision += 1;
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
