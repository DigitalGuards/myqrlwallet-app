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
import { runAsPromise } from '../runAsPromise';

const mockSet = jest.mocked(AsyncStorage.setItem);
const mockGet = jest.mocked(AsyncStorage.getItem);
const mockRemove = jest.mocked(AsyncStorage.removeItem);

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
    mockGet.mockImplementation(() => runAsPromise(() => stored));
    mockRemove.mockImplementation(() => runAsPromise(() => {
      stored = null;
    }));

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
    mockSet.mockImplementation((key, value) => runAsPromise(() => { data.set(key, value); }));
    mockGet.mockImplementation(key => runAsPromise(() => data.get(key) ?? null));
    mockRemove.mockImplementation(key => runAsPromise(() => { data.delete(key); }));

    expect(await WebViewService.getContactsBackup()).toBeNull();
    await WebViewService.saveContactsBackupStrict('[{"id":"v3-contact"}]');
    expect(data.get(oldKey)).toBe(oldContacts);
    expect(data.get('@MyQRLWallet:v3:contactsBackup')).toBe('[{"id":"v3-contact"}]');
    await WebViewService.clearContactsBackupStrict();
    expect(data.size).toBe(0);
  });
});
