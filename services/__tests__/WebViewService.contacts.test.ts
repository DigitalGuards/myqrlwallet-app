jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    setItem: jest.fn(),
    getItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));
jest.mock('../Logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), error: jest.fn() },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import WebViewService from '../WebViewService';

const mockSet = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
const mockGet = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
const mockRemove = AsyncStorage.removeItem as jest.MockedFunction<typeof AsyncStorage.removeItem>;

describe('WebViewService contact wipe ordering', () => {
  it('queues a wipe behind an in-flight backup so contacts cannot be resurrected', async () => {
    let stored: string | null = null;
    let releaseWrite: (() => void) | undefined;
    mockSet.mockImplementationOnce(
      (_key, value) =>
        new Promise<void>((resolve) => {
          releaseWrite = () => {
            stored = value;
            resolve();
          };
        }),
    );
    mockGet.mockImplementation(async () => stored);
    mockRemove.mockImplementation(async () => {
      stored = null;
    });

    const save = WebViewService.saveContactsBackupStrict('[{"id":"contact"}]');
    for (let iteration = 0; iteration < 10 && !releaseWrite; iteration += 1) {
      await Promise.resolve();
    }
    expect(releaseWrite).toBeDefined();
    const clear = WebViewService.clearContactsBackupStrict();
    await Promise.resolve();
    expect(mockRemove).not.toHaveBeenCalled();

    releaseWrite?.();
    await save;
    await clear;
    expect(mockRemove).toHaveBeenCalledTimes(2);
    expect(stored).toBeNull();
  });

  it('stores v3 contacts separately and leaves the earlier backup intact', async () => {
    jest.clearAllMocks();
    const oldKey = '@MyQRLWallet:contactsBackup';
    const oldContacts = '[{"id":"legacy-contact"}]';
    const data = new Map([[oldKey, oldContacts]]);
    mockSet.mockImplementation(async (key, value) => { data.set(key, value); });
    mockGet.mockImplementation(async key => data.get(key) ?? null);
    mockRemove.mockImplementation(async key => { data.delete(key); });

    expect(await WebViewService.getContactsBackup()).toBeNull();
    await WebViewService.saveContactsBackupStrict('[{"id":"v3-contact"}]');
    expect(data.get(oldKey)).toBe(oldContacts);
    expect(data.get('@MyQRLWallet:v3:contactsBackup')).toBe('[{"id":"v3-contact"}]');
    await WebViewService.clearContactsBackupStrict();
    expect(data.size).toBe(0);
  });
});
