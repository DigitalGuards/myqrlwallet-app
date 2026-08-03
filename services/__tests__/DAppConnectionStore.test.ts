const mockAsyncData = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockAsyncData.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockAsyncData.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockAsyncData.delete(key);
  }),
}));
jest.mock('../Logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import DAppConnectionStore from '../DAppConnectionStore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockGetItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;

describe('DAppConnectionStore wallet boundary', () => {
  it('shares one AsyncStorage load across concurrent callers', async () => {
    let resolveLoad: ((value: string | null) => void) | undefined;
    mockGetItem.mockImplementationOnce(
      () => new Promise<string | null>((resolve) => {
        resolveLoad = resolve;
      }),
    );

    const first = DAppConnectionStore.load();
    const second = DAppConnectionStore.load();
    expect(mockGetItem).toHaveBeenCalledTimes(1);
    resolveLoad?.(null);
    await Promise.all([first, second]);
  });

  it('removes active dApp history when the wallet is cleared', async () => {
    await DAppConnectionStore.onConnected({
      channelId: '11111111-1111-4111-8111-111111111111',
      name: 'Old wallet dApp',
      url: 'https://example.test',
      connectedAccount: `Q${'12'.repeat(20)}`,
      connectedAt: 1,
    });
    expect(await DAppConnectionStore.activeCount()).toBe(1);

    await DAppConnectionStore.clear();

    expect(await DAppConnectionStore.getAll()).toEqual([]);
    expect([...mockAsyncData.values()]).toContain('[]');
  });

  it('rejects roadmap-length connected accounts before persistence', async () => {
    await expect(
      DAppConnectionStore.onConnected({
        channelId: '22222222-2222-4222-8222-222222222222',
        name: 'dApp',
        url: 'https://example.test',
        connectedAccount: `Q${'12'.repeat(32)}`,
        connectedAt: 2,
      })
    ).rejects.toThrow('Invalid dApp connected account');
  });

  it('does not downgrade an explicit disconnect with a late passive event', async () => {
    const channelId = '33333333-3333-4333-8333-333333333333';
    await DAppConnectionStore.onConnected({
      channelId,
      name: 'dApp',
      url: 'https://example.test',
      connectedAccount: `Q${'34'.repeat(20)}`,
      connectedAt: 3,
    });
    await DAppConnectionStore.onDisconnected(channelId, true);
    await DAppConnectionStore.onDisconnected(channelId, false);

    expect(await DAppConnectionStore.getAll()).toEqual([
      expect.objectContaining({ channelId, explicitlyDisconnected: true }),
    ]);
  });
});
