import * as SecureStore from 'expo-secure-store';

import Logger from './Logger';

/**
 * One-time hygiene pass over the web storage an upgrading install inherits.
 *
 * Before this release the WebView loaded https://qrlwallet.com live. Its
 * localStorage, IndexedDB, service workers and HTTP cache live on the
 * qrlwallet.com origin, and the embedded document runs on that same origin so
 * that accounts survive the upgrade. That is the point, and it is also the
 * catch: everything the served page ever wrote is still there, written by code
 * the app no longer controls. A service worker is the sharpest edge, because a
 * registered one outlives the page that registered it and can answer fetches.
 *
 * So on the first embedded launch the app drops the parts that are caches or
 * sessions and keeps the parts that are the user's data:
 *
 *   - unregister every service worker and empty the Cache Storage API,
 *   - drop the WebView HTTP cache,
 *   - clear dApp pairing sessions, which are short-lived by design and are
 *     re-established by scanning again.
 *
 * Nothing that holds value is touched. Encrypted seeds, the PIN material and
 * the address book are left exactly as they are: this pass is not allowed to
 * be the reason someone loses an account.
 *
 * Still open, because each needs the web wallet to answer questions it has no
 * message for yet: verifying the seeds the page holds against the address and
 * ciphertext hash native recorded at SEED_STORED time, clearing qrlwallet.com
 * cookies (react-native-webview exposes no API for that without another
 * native dependency), and flagging the address book for the user to review.
 * They are tracked as follow-ups and are deliberately not faked here.
 */
const MIGRATION_KEY = 'embedded_web_storage_migration';
const MIGRATION_VERSION = '2';

/**
 * The message the page sends back once it has cleared its own state.
 *
 * It arrives over the bridge like any other message, so it carries the
 * document token and can only come from the document this app served. Until
 * it arrives the native marker is not written, so an install where the page
 * never acknowledged retries on the next launch rather than silently
 * considering itself migrated.
 */
export const MIGRATION_ACK_MESSAGE_TYPE = 'EMBEDDED_MIGRATION_DONE';

/**
 * True for the acknowledgement. Takes a plain string so the caller does not
 * have to widen the bridge's own message union, which this message is
 * deliberately not part of: it never reaches NativeBridge.
 */
export function isMigrationAcknowledgement(type: string): boolean {
  return type === MIGRATION_ACK_MESSAGE_TYPE;
}

/**
 * Runs inside the WebView. Carries no secret, so it is safe even though an
 * injected script runs in whatever document is loaded.
 *
 * Every step is wrapped: a WebView without service workers or without the
 * Cache API must not throw and leave the rest undone.
 */
export const EMBEDDED_STORAGE_MIGRATION_SCRIPT = `(function(){
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations().then(function (registrations) {
        registrations.forEach(function (registration) {
          try { registration.unregister(); } catch (e) {}
        });
      }).catch(function () {});
    }
  } catch (e) {}
  try {
    if (window.caches && caches.keys) {
      caches.keys().then(function (keys) {
        keys.forEach(function (key) {
          try { caches.delete(key); } catch (e) {}
        });
      }).catch(function () {});
    }
  } catch (e) {}
  try {
    var doomed = [];
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && (/dapp|qrlconnect/i.test(key) || key.indexOf('@qrlwallet/connect') === 0)) {
        doomed.push(key);
      }
    }
    doomed.forEach(function (key) {
      try { localStorage.removeItem(key); } catch (e) {}
    });
  } catch (e) {}
})();true;`;

/**
 * localStorage keys the migration removes.
 *
 * The pattern is not only "anything with dapp in the name". The connect SDK
 * stores its pairing under `@qrlwallet/connect:session`, which matches
 * neither `dapp` nor `qrlconnect`, and a restored pairing is exactly what
 * this pass exists to drop. Exported so a test pins the list.
 */
export function isSessionStorageKey(key: string): boolean {
  if (typeof key !== 'string') return false;
  return /dapp|qrlconnect/i.test(key) || key.startsWith('@qrlwallet/connect');
}

/** True when this install has not yet had the hygiene pass. */
export async function isStorageMigrationPending(): Promise<boolean> {
  try {
    const recorded = await SecureStore.getItemAsync(MIGRATION_KEY);
    return recorded !== MIGRATION_VERSION;
  } catch (error) {
    // A keychain read failure must not repeat a destructive pass forever, and
    // must not skip it either. Reporting pending is the safe answer: the pass
    // only clears caches and pairings, both of which regenerate.
    Logger.warn('EmbeddedStorageMigration', 'Cannot read the migration marker:', error);
    return true;
  }
}

/** Record that the hygiene pass has run for this install. */
export async function markStorageMigrationDone(): Promise<void> {
  try {
    await SecureStore.setItemAsync(MIGRATION_KEY, MIGRATION_VERSION);
  } catch (error) {
    Logger.warn('EmbeddedStorageMigration', 'Cannot record the migration marker:', error);
  }
}
