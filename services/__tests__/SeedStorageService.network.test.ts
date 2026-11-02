// The whole file runs as a build with EXPO_PUBLIC_QRL_NETWORK_PROFILE=mainnet
// while the mainnet identity is still unset. The selector is read when the
// profile module loads, so it is set inside that module's factory.
jest.mock('../NativeWalletProfile', () => {
  process.env.EXPO_PUBLIC_QRL_NETWORK_PROFILE = 'mainnet';
  return jest.requireActual<object>('../NativeWalletProfile');
});
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
jest.mock('expo-secure-store', () => ({
  __esModule: true,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('../Logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { createHash } from 'node:crypto';
import SeedStorageService from '../SeedStorageService';
import { NATIVE_WALLET_BLOCKCHAIN } from '../NativeWalletProfile';

const ADDRESS = `Q${'aB'.repeat(64)}`;
const HASH = createHash('sha256').update('ciphertext').digest('hex');

describe('seed storage on a build whose network has no pinned identity', () => {
  it('has no seed blockchain', () => {
    expect(NATIVE_WALLET_BLOCKCHAIN).toBeNull();
  });

  it.each(['MAIN_NET_V3', 'TEST_NET_V3'])('refuses to store or read a %s backup', async (blockchain) => {
    await expect(
      SeedStorageService.backupSeed(ADDRESS, 'ciphertext', blockchain, 1, HASH),
    ).rejects.toThrow('Unsupported wallet blockchain');
    await expect(SeedStorageService.getBackup(ADDRESS, blockchain)).rejects.toThrow(
      'Unsupported wallet blockchain',
    );
    expect(jest.mocked(AsyncStorage.setItem)).not.toHaveBeenCalled();
    expect(jest.mocked(AsyncStorage.getItem)).not.toHaveBeenCalled();
    expect(jest.mocked(SecureStore.setItemAsync)).not.toHaveBeenCalled();
  });
});
