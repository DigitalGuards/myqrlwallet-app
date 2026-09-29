import * as SecureStore from 'expo-secure-store';

import {
  EMBEDDED_STORAGE_MIGRATION_SCRIPT,
  MIGRATION_ACK_MESSAGE_TYPE,
  isMigrationAcknowledgement,
  isSessionStorageKey,
  isStorageMigrationPending,
  markStorageMigrationDone,
} from '../EmbeddedStorageMigration';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));
jest.mock('../Logger', () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const getItemAsync = SecureStore.getItemAsync as jest.Mock;
const setItemAsync = SecureStore.setItemAsync as jest.Mock;

describe('inherited web storage migration', () => {
  beforeEach(() => jest.clearAllMocks());

  it('runs once per install', async () => {
    getItemAsync.mockResolvedValue(null);
    expect(await isStorageMigrationPending()).toBe(true);
    await markStorageMigrationDone();
    expect(setItemAsync).toHaveBeenCalledWith('embedded_web_storage_migration', '2');

    getItemAsync.mockResolvedValue('2');
    expect(await isStorageMigrationPending()).toBe(false);
  });

  it('re-runs rather than skipping when the marker cannot be read', async () => {
    // The pass only drops caches and pairings, both of which regenerate, so
    // repeating it is safer than silently leaving a service worker in place.
    getItemAsync.mockRejectedValue(new Error('keychain unavailable'));
    expect(await isStorageMigrationPending()).toBe(true);
  });

  it('treats an older marker version as pending', async () => {
    for (const recorded of ['0', '1']) {
      getItemAsync.mockResolvedValue(recorded);
      expect(await isStorageMigrationPending()).toBe(true);
    }
  });

  it('recognises the acknowledgement the page sends when it has cleared itself', () => {
    // The marker is written only on this message, so a launch where the page
    // never acknowledged retries instead of considering itself migrated.
    expect(isMigrationAcknowledgement(MIGRATION_ACK_MESSAGE_TYPE)).toBe(true);
    for (const type of ['WEB_APP_READY', 'SEED_STORED', '', 'embedded_migration_done']) {
      expect(isMigrationAcknowledgement(type)).toBe(false);
    }
  });

  it('clears pairing sessions and leaves everything of value alone', () => {
    for (const key of [
      'dappSessions',
      'qrlwallet:v3:dapp-connect',
      'QRLCONNECT_LAST',
      'DAppSessionStore',
      // The connect SDK's own key matches neither dapp nor qrlconnect, and a
      // restored pairing is exactly what this pass exists to drop.
      '@qrlwallet/connect:session',
    ]) {
      expect(isSessionStorageKey(key)).toBe(true);
    }
    for (const key of [
      'qrlwallet:v3:wallets',
      'encryptedSeed',
      'addressBook',
      'contacts',
      'pin_exists',
      'walletSettings',
    ]) {
      expect(isSessionStorageKey(key)).toBe(false);
    }
  });

  it('carries no secret, because an injected script runs in every document', () => {
    expect(EMBEDDED_STORAGE_MIGRATION_SCRIPT).not.toMatch(/[0-9a-f]{64}/);
    expect(EMBEDDED_STORAGE_MIGRATION_SCRIPT).toContain('serviceWorker');
    expect(EMBEDDED_STORAGE_MIGRATION_SCRIPT).toContain('caches');
    // Nothing may remove storage wholesale.
    expect(EMBEDDED_STORAGE_MIGRATION_SCRIPT).not.toContain('localStorage.clear');
    expect(EMBEDDED_STORAGE_MIGRATION_SCRIPT).not.toContain('indexedDB.deleteDatabase');
  });

  it('is a script the WebView can evaluate without a DOM it does not have', () => {
    // Every branch is guarded, so a WebView without service workers or the
    // Cache API runs the rest instead of throwing.
    const removed: string[] = [];
    const win = {
      navigator: {},
      localStorage: {
        length: 3,
        keys: [
          'qrlwallet:v3:dappSessions',
          '@qrlwallet/connect:session',
          'qrlwallet:v3:wallets',
        ],
        key(index: number) {
          return this.keys[index];
        },
        removeItem(key: string) {
          removed.push(key);
        },
      },
    } as unknown as Record<string, unknown>;
    // eslint-disable-next-line no-new-func
    new Function(
      'window',
      'navigator',
      'localStorage',
      EMBEDDED_STORAGE_MIGRATION_SCRIPT,
    )(win, win.navigator, win.localStorage);
    expect(removed).toEqual(['qrlwallet:v3:dappSessions', '@qrlwallet/connect:session']);
  });
});
