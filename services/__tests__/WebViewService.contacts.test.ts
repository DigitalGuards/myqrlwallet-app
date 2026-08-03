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
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(stored).toBeNull();
  });
});
