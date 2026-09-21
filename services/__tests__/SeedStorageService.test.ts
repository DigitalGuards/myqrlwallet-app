jest.mock('expo-secure-store', () => ({
  __esModule: true,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('expo-crypto', () => ({
  __esModule: true,
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async (_algorithm: string, value: string) => {
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    return createHash('sha256').update(value).digest('hex');
  }),
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    multiSet: jest.fn(),
    getAllKeys: jest.fn(),
    multiRemove: jest.fn(),
    removeItem: jest.fn(),
    multiGet: jest.fn(),
  };
  return { __esModule: true, default: storage, ...storage };
});

jest.mock('../Logger', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import SeedStorageService from '../SeedStorageService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { createHash } from 'node:crypto';

const mockSecureGet = SecureStore.getItemAsync as jest.MockedFunction<
  typeof SecureStore.getItemAsync
>;
const mockSecureSet = SecureStore.setItemAsync as jest.MockedFunction<
  typeof SecureStore.setItemAsync
>;
const mockSecureDelete = SecureStore.deleteItemAsync as jest.MockedFunction<
  typeof SecureStore.deleteItemAsync
>;
const mockAsyncGetAllKeys = AsyncStorage.getAllKeys as jest.MockedFunction<
  typeof AsyncStorage.getAllKeys
>;
const mockAsyncMultiRemove = AsyncStorage.multiRemove as jest.MockedFunction<
  typeof AsyncStorage.multiRemove
>;
const mockAsyncGet = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
const mockAsyncSet = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
const mockAsyncMultiGet = AsyncStorage.multiGet as jest.MockedFunction<
  typeof AsyncStorage.multiGet
>;
const mockAsyncMultiSet = AsyncStorage.multiSet as jest.MockedFunction<
  typeof AsyncStorage.multiSet
>;
const mockAsyncRemove = AsyncStorage.removeItem as jest.MockedFunction<
  typeof AsyncStorage.removeItem
>;

const CANDIDATE = 'ab'.repeat(32);
const EXISTING = 'cd'.repeat(32);
const ADDRESS = `Q${'aB'.repeat(64)}`;
const LEGACY_Q40_ADDRESS = `Q${'12'.repeat(20)}`;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const HASH = hash('ciphertext');

let asyncData: Map<string, string>;

describe('SeedStorageService device credential escrow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSecureGet.mockReset();
    mockSecureGet.mockResolvedValue(null);
    asyncData = new Map();
    mockSecureSet.mockResolvedValue(undefined);
    mockSecureDelete.mockResolvedValue(undefined);
    mockAsyncGet.mockImplementation(async key => asyncData.get(key) ?? null);
    mockAsyncSet.mockImplementation(async (key, value) => {
      asyncData.set(key, value);
    });
    mockAsyncRemove.mockImplementation(async key => {
      asyncData.delete(key);
    });
    mockAsyncGetAllKeys.mockImplementation(async () => [...asyncData.keys()]);
    mockAsyncMultiGet.mockImplementation(async keys =>
      keys.map(key => [key, asyncData.get(key) ?? null] as [string, string | null]),
    );
    mockAsyncMultiSet.mockImplementation(async entries => {
      for (const [key, value] of entries) asyncData.set(key, value);
    });
    mockAsyncMultiRemove.mockImplementation(async keys => {
      for (const key of keys) asyncData.delete(key);
    });
  });

  it('stores a candidate with this-device-only accessibility and confirms it by reading back', async () => {
    mockSecureGet.mockResolvedValueOnce(null).mockResolvedValueOnce(CANDIDATE);

    await expect(SeedStorageService.getOrCreateDeviceCredential(CANDIDATE)).resolves.toBe(
      CANDIDATE,
    );
    expect(mockSecureSet).toHaveBeenCalledWith('wallet_device_credential_v3', CANDIDATE, {
      requireAuthentication: false,
      keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    });
    expect(mockSecureGet).toHaveBeenCalledTimes(2);
  });

  it('returns an existing credential without replacing it', async () => {
    mockSecureGet.mockResolvedValue(EXISTING);
    await expect(SeedStorageService.getOrCreateDeviceCredential(CANDIDATE)).resolves.toBe(EXISTING);
    expect(mockSecureSet).not.toHaveBeenCalled();
  });

  it('creates isolated v3 security state without reading or replacing earlier credentials', async () => {
    const secureData = new Map([
      ['wallet_device_credential_v1', EXISTING],
      ['wallet_pin', '9876'],
    ]);
    asyncData.set('biometric_enabled', 'true');
    asyncData.set('pin_exists', '1');
    asyncData.set('wallet_metadata', 'legacy metadata');
    mockSecureGet.mockImplementation(async key => secureData.get(key) ?? null);
    mockSecureSet.mockImplementation(async (key, value) => { secureData.set(key, value); });

    await expect(SeedStorageService.getDeviceCredential()).resolves.toBeNull();
    await expect(SeedStorageService.hasPinStored()).resolves.toBe(false);
    await expect(SeedStorageService.isBiometricEnabled()).resolves.toBe(false);
    await expect(SeedStorageService.getOrCreateDeviceCredential(CANDIDATE)).resolves.toBe(CANDIDATE);
    await SeedStorageService.storePinSecurely('1234');
    await SeedStorageService.setBiometricEnabled(true);
    await SeedStorageService.backupSeed(ADDRESS, 'ciphertext', 'TEST_NET_V3', 1, HASH);

    expect(secureData.get('wallet_device_credential_v1')).toBe(EXISTING);
    expect(secureData.get('wallet_pin')).toBe('9876');
    expect(secureData.get('wallet_device_credential_v3')).toBe(CANDIDATE);
    expect(secureData.get('wallet_pin_v3')).toBe('1234');
    expect(asyncData.get('wallet_metadata')).toBe('legacy metadata');
    expect(mockSecureGet.mock.calls.map(([key]) => key)).not.toContain('wallet_pin');
    expect(mockSecureGet.mock.calls.map(([key]) => key)).not.toContain('wallet_device_credential_v1');
  });

  it.each(['true', '{malformed', 'null'])('preserves earlier removal protection for %s', async setting => {
    asyncData.set('biometric_enabled', setting);
    asyncData.set('biometric_enabled_v3', 'false');
    await expect(SeedStorageService.requiresWalletRemovalAuthentication()).resolves.toBe(true);
    expect(mockSecureGet).not.toHaveBeenCalled();
  });

  it('requires removal authentication when either profile has Device Login enabled', async () => {
    asyncData.set('biometric_enabled', 'false');
    asyncData.set('biometric_enabled_v3', 'true');
    await expect(SeedStorageService.requiresWalletRemovalAuthentication()).resolves.toBe(true);
    asyncData.set('biometric_enabled_v3', 'false');
    await expect(SeedStorageService.requiresWalletRemovalAuthentication()).resolves.toBe(false);
  });

  it('fails closed when secure persistence cannot be confirmed', async () => {
    mockSecureGet.mockResolvedValueOnce(null).mockResolvedValueOnce(EXISTING);
    await expect(SeedStorageService.getOrCreateDeviceCredential(CANDIDATE)).rejects.toThrow(
      /persistence could not be confirmed/,
    );
  });

  it('does not overwrite a malformed stored credential', async () => {
    mockSecureGet.mockResolvedValue('not-a-key');
    await expect(SeedStorageService.getOrCreateDeviceCredential(CANDIDATE)).rejects.toThrow(
      /invalid format/,
    );
    expect(mockSecureSet).not.toHaveBeenCalled();
  });

  it('treats interaction-not-allowed as unavailable, never as confirmed absence', async () => {
    mockSecureGet.mockRejectedValueOnce(new Error('errSecInteractionNotAllowed (-25308)'));
    await expect(SeedStorageService.getOrCreateDeviceCredential(CANDIDATE)).rejects.toThrow(
      /temporarily unavailable/,
    );
    expect(mockSecureSet).not.toHaveBeenCalled();
  });

  it('does not report a PIN as missing when its existence check is temporarily unavailable', async () => {
    mockSecureGet.mockRejectedValueOnce(new Error('errSecInteractionNotAllowed (-25308)'));
    await expect(SeedStorageService.hasPinStored()).rejects.toThrow(/temporarily unavailable/);
    expect(asyncData.has('pin_exists_v3')).toBe(false);
  });

  it('stores the PIN as this-device-only and commits both existence markers', async () => {
    await SeedStorageService.storePinSecurely('1234');

    expect(mockSecureSet).toHaveBeenCalledWith('wallet_pin_v3', '1234', {
      requireAuthentication: false,
      keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    });
    expect(asyncData.get('pin_exists_v3')).toBe('1');
    expect(asyncData.get('pin_accessibility_version_v3')).toBe('v2');
  });

  it('treats a fresh install with no marker or keychain PIN as not configured', async () => {
    mockSecureGet.mockResolvedValue(null);

    await expect(SeedStorageService.hasPinStored()).resolves.toBe(false);
    await expect(SeedStorageService.needsPinAccessibilityMigration()).resolves.toBe(false);
    expect(asyncData.has('pin_exists_v3')).toBe(false);
    expect(mockSecureSet).not.toHaveBeenCalled();
  });

  it('repairs a missing marker for a legacy or reinstalled keychain PIN', async () => {
    mockSecureGet.mockResolvedValue('1234');

    await expect(SeedStorageService.hasPinStored()).resolves.toBe(true);
    expect(asyncData.get('pin_exists_v3')).toBe('1');
    await expect(SeedStorageService.needsPinAccessibilityMigration()).resolves.toBe(true);
  });

  it('uses a positive marker without probing unavailable secure storage while locked', async () => {
    asyncData.set('pin_exists_v3', '1');
    mockSecureGet.mockRejectedValue(new Error('errSecInteractionNotAllowed (-25308)'));

    await expect(SeedStorageService.hasPinStored()).resolves.toBe(true);
    expect(mockSecureGet).not.toHaveBeenCalled();
  });

  it('does not advance the accessibility marker when migration fails', async () => {
    asyncData.set('pin_exists_v3', '1');
    mockSecureSet.mockRejectedValueOnce(new Error('keychain write failed'));

    await expect(SeedStorageService.migratePinAccessibility('1234')).resolves.toBe(false);
    expect(asyncData.has('pin_accessibility_version_v3')).toBe(false);
    await expect(SeedStorageService.needsPinAccessibilityMigration()).resolves.toBe(true);
  });

  it('commits the migration marker only with a successful this-device-only rewrite', async () => {
    asyncData.set('pin_exists_v3', '1');

    await expect(SeedStorageService.migratePinAccessibility('1234')).resolves.toBe(true);
    expect(mockSecureSet).toHaveBeenCalledWith('wallet_pin_v3', '1234', {
      requireAuthentication: false,
      keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    });
    expect(asyncData.get('pin_accessibility_version_v3')).toBe('v2');
    await expect(SeedStorageService.needsPinAccessibilityMigration()).resolves.toBe(false);
  });

  it('stores and read-back confirms chain-scoped seed backup revisions', async () => {
    await expect(
      SeedStorageService.backupSeed(ADDRESS, 'ciphertext', 'TEST_NET_V3', 4, HASH),
    ).resolves.toMatchObject({
      address: ADDRESS,
      blockchain: 'TEST_NET_V3',
      revision: 4,
      ciphertextHash: HASH,
    });

    const backups = await SeedStorageService.getAllBackups();
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatchObject({
      address: ADDRESS,
      blockchain: 'TEST_NET_V3',
      revision: 4,
    });
    expect([...asyncData.keys()]).toContain(
      `seed_backup_v3_TEST_NET_V3_${ADDRESS.toLowerCase()}`,
    );
  });

  it.each([`q${'12'.repeat(64)}`, LEGACY_Q40_ADDRESS])(
    'rejects a non-Q+128 seed address before touching storage',
    async (address) => {
      await expect(
        SeedStorageService.backupSeed(address, 'ciphertext', 'TEST_NET_V3', 4, HASH),
      ).rejects.toThrow('Invalid QRL wallet address');
      expect(mockAsyncSet).not.toHaveBeenCalled();
    },
  );

  it('preserves pre-QIP-55 backups and reports them as a locked recovery gate', async () => {
    const legacyKey = `seed_backup_v2_TEST_NET_${LEGACY_Q40_ADDRESS.toLowerCase()}`;
    asyncData.set(
      legacyKey,
      JSON.stringify({
        address: LEGACY_Q40_ADDRESS,
        encryptedSeed: 'legacy-ciphertext',
        blockchain: 'TEST_NET',
        storedAt: 1,
        revision: 0,
      }),
    );

    await expect(SeedStorageService.hasWallet()).resolves.toBe(true);
    await expect(SeedStorageService.getRestoreSnapshot()).resolves.toMatchObject({
      backups: [],
      legacyAddressBackupCount: 1,
    });
    expect(asyncData.get(legacyKey)).toContain('legacy-ciphertext');

    await SeedStorageService.backupSeed(ADDRESS, 'ciphertext', 'TEST_NET_V3', 1, HASH);
    expect(asyncData.get(legacyKey)).toContain('legacy-ciphertext');
  });

  it('accepts only the qualified v3 network for new seed backups', async () => {
    await SeedStorageService.backupSeed(
      ADDRESS,
      'test-ciphertext',
      'TEST_NET_V3',
      1,
      hash('test-ciphertext'),
    );
    for (const network of ['TEST_NET', 'MAIN_NET', 'testnet', 'TEST_NET_V4']) {
      await expect(SeedStorageService.backupSeed(
        ADDRESS, 'other-ciphertext', network, 2, hash('other-ciphertext'),
      )).rejects.toThrow('Unsupported wallet blockchain');
    }

    const backups = await SeedStorageService.getAllBackups();
    expect(backups).toHaveLength(1);
    expect(new Set(backups.map(backup => backup.blockchain))).toEqual(
      new Set(['TEST_NET_V3']),
    );
  });

  it('does not delete another network legacy backup during scoped removal', async () => {
    const legacyKey = `seed_backup_${ADDRESS.toLowerCase()}`;
    asyncData.set(
      legacyKey,
      JSON.stringify({
        address: ADDRESS,
        encryptedSeed: 'legacy-mainnet',
        blockchain: 'MAIN_NET',
        storedAt: 1,
      }),
    );

    await SeedStorageService.removeBackup(ADDRESS, 'TEST_NET_V3');
    expect(asyncData.has(legacyKey)).toBe(true);

    await SeedStorageService.removeBackup(ADDRESS);
    expect(asyncData.has(legacyKey)).toBe(true);
    await expect(SeedStorageService.removeBackup(ADDRESS, 'MAIN_NET')).rejects.toThrow(
      'Unsupported wallet blockchain',
    );
  });

  it('rejects stale or conflicting revisions without overwriting the confirmed backup', async () => {
    await SeedStorageService.backupSeed(ADDRESS, 'newest', 'TEST_NET_V3', 8, hash('newest'));
    await expect(
      SeedStorageService.backupSeed(ADDRESS, 'stale', 'TEST_NET_V3', 7, hash('stale')),
    ).rejects.toThrow(/stale/);
    await expect(
      SeedStorageService.backupSeed(ADDRESS, 'conflict', 'TEST_NET_V3', 8, hash('conflict')),
    ).rejects.toThrow(/conflicts/);

    await expect(SeedStorageService.getBackup(ADDRESS, 'TEST_NET_V3')).resolves.toMatchObject({
      encryptedSeed: 'newest',
      revision: 8,
      ciphertextHash: hash('newest'),
    });
  });

  it('rejects a claimed hash that is not the native digest of the ciphertext', async () => {
    await expect(
      SeedStorageService.backupSeed(ADDRESS, 'ciphertext', 'TEST_NET_V3', 1, 'ab'.repeat(32)),
    ).rejects.toThrow(/hash does not match/);
    expect(mockAsyncSet).not.toHaveBeenCalled();
  });

  it('rejects malformed candidates before touching secure storage', async () => {
    await expect(SeedStorageService.getOrCreateDeviceCredential('abcd')).rejects.toThrow(
      /Invalid wallet device credential candidate/,
    );
    expect(mockSecureGet).not.toHaveBeenCalled();
    expect(mockSecureSet).not.toHaveBeenCalled();
  });

  it('deletes both PIN and device credential during an explicit wallet wipe', async () => {
    await SeedStorageService.clearWallet();
    expect(mockSecureDelete).toHaveBeenCalledWith('wallet_pin_v3');
    expect(mockSecureDelete).toHaveBeenCalledWith('wallet_device_credential_v3');
    expect(mockSecureDelete).toHaveBeenCalledWith('wallet_pin');
    expect(mockSecureDelete).toHaveBeenCalledWith('wallet_device_credential_v1');
  });

  it('does not let an in-flight bridge request resurrect a credential during wipe', async () => {
    let releaseKeys!: (keys: string[]) => void;
    mockAsyncGetAllKeys.mockReturnValueOnce(
      new Promise<string[]>((resolve) => {
        releaseKeys = resolve;
      }),
    );
    const clear = SeedStorageService.clearWallet();

    await expect(SeedStorageService.getOrCreateDeviceCredential(CANDIDATE)).rejects.toThrow(
      /clear is in progress/,
    );
    expect(mockSecureSet).not.toHaveBeenCalled();
    releaseKeys([]);
    await clear;
  });

  it('queues wipe behind an in-flight seed write and removes its completed output', async () => {
    let releaseWrite!: () => void;
    let writeStarted!: () => void;
    const started = new Promise<void>(resolve => {
      writeStarted = resolve;
    });
    mockAsyncSet.mockImplementationOnce(
      (key, value) =>
        new Promise<void>(resolve => {
          asyncData.set(key, value);
          writeStarted();
          releaseWrite = resolve;
        }),
    );

    const backup = SeedStorageService.backupSeed(ADDRESS, 'ciphertext', 'TEST_NET_V3', 1, HASH);
    await started;
    const clear = SeedStorageService.clearWallet();
    await expect(
      SeedStorageService.backupSeed(ADDRESS, 'late', 'TEST_NET_V3', 1, hash('late')),
    ).rejects.toThrow(/clear is in progress/);

    releaseWrite();
    await backup;
    await clear;
    expect([...asyncData.keys()].filter(key => key.startsWith('seed_backup_'))).toEqual([]);
  });

  it('treats a negative metadata cache as advisory when a valid seed exists', async () => {
    const backup = {
      address: ADDRESS,
      encryptedSeed: 'ciphertext',
      blockchain: 'TEST_NET_V3',
      storedAt: 1,
      revision: 1,
      ciphertextHash: HASH,
    };
    asyncData.set(
      'wallet_metadata_v3',
      JSON.stringify({ addresses: [], hasWallet: false, lastUpdated: 1 }),
    );
    asyncData.set(`seed_backup_v3_TEST_NET_V3_${ADDRESS.toLowerCase()}`, JSON.stringify(backup));

    await expect(SeedStorageService.hasWallet()).resolves.toBe(true);
    expect(JSON.parse(asyncData.get('wallet_metadata_v3') || '{}')).toEqual(
      expect.objectContaining({ hasWallet: true, addresses: [ADDRESS] }),
    );
  });

  it('persists a correlated wipe journal across the native storage deletion', async () => {
    const requestId = '12'.repeat(16);
    await expect(SeedStorageService.beginWalletWipe(requestId)).resolves.toEqual(
      expect.objectContaining({ version: 1, requestId }),
    );

    await SeedStorageService.clearWallet();
    await expect(SeedStorageService.getPendingWalletWipe()).resolves.toEqual(
      expect.objectContaining({ requestId }),
    );

    await expect(SeedStorageService.completeWalletWipe('34'.repeat(16))).rejects.toThrow(
      'does not match',
    );
    await SeedStorageService.completeWalletWipe(requestId);
    await expect(SeedStorageService.getPendingWalletWipe()).resolves.toBeNull();
  });

  it('fails closed on a malformed wipe journal', async () => {
    asyncData.set('wallet_wipe_pending_v1', '{"version":1,"requestId":"bad"}');
    await expect(SeedStorageService.getPendingWalletWipe()).rejects.toThrow(
      'Wallet wipe journal is invalid',
    );
    await expect(SeedStorageService.hasWallet()).rejects.toThrow('Wallet wipe journal is invalid');
  });
});
