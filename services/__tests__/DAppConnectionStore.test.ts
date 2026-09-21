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
const QIP55_ADDRESS = `Q${'aB'.repeat(64)}`;
const LEGACY_Q40_ADDRESS = `Q${'12'.repeat(20)}`;

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
    expect(mockGetItem).toHaveBeenCalledWith('@dapp_connection_history_v3');
  });

  it('removes active dApp history when the wallet is cleared', async () => {
    await DAppConnectionStore.onConnected({
      channelId: '11111111-1111-4111-8111-111111111111',
      name: 'Old wallet dApp',
      url: 'https://example.test',
      connectedAccount: QIP55_ADDRESS,
      connectedAt: 1,
    });
    expect(await DAppConnectionStore.activeCount()).toBe(1);

    await DAppConnectionStore.clear();

    expect(await DAppConnectionStore.getAll()).toEqual([]);
    expect([...mockAsyncData.values()]).toContain('[]');
  });

  it('rejects a legacy Q+40 connected account before persistence', async () => {
    await expect(
      DAppConnectionStore.onConnected({
        channelId: '22222222-2222-4222-8222-222222222222',
        name: 'dApp',
        url: 'https://example.test',
        connectedAccount: LEGACY_Q40_ADDRESS,
        connectedAt: 2,
      })
    ).rejects.toThrow('Invalid dApp connected account');
  });

  it('round-trips the exact Q+128 connected account without truncation', async () => {
    await DAppConnectionStore.clear();
    mockAsyncData.set('@dapp_connection_history', 'preserved legacy history');
    const channelId = '22222222-2222-4222-8222-222222222223';
    await DAppConnectionStore.onConnected({
      channelId,
      name: 'QIP-55 dApp',
      url: 'https://example.test',
      connectedAccount: QIP55_ADDRESS,
      connectedAt: 2,
    });

    expect(await DAppConnectionStore.getAll()).toEqual([
      expect.objectContaining({ channelId, connectedAccount: QIP55_ADDRESS }),
    ]);
    expect(JSON.parse(mockAsyncData.get('@dapp_connection_history_v3') || '[]')).toEqual([
      expect.objectContaining({ connectedAccount: QIP55_ADDRESS }),
    ]);
    expect(mockAsyncData.get('@dapp_connection_history')).toBe('preserved legacy history');
    await DAppConnectionStore.clear();
    expect(mockAsyncData.has('@dapp_connection_history')).toBe(false);
  });

  it('does not downgrade an explicit disconnect with a late passive event', async () => {
    await DAppConnectionStore.clear();
    const channelId = '33333333-3333-4333-8333-333333333333';
    await DAppConnectionStore.onConnected({
      channelId,
      name: 'dApp',
      url: 'https://example.test',
      connectedAccount: `Q${'34'.repeat(64)}`,
      connectedAt: 3,
    });
    await DAppConnectionStore.onDisconnected(channelId, true);
    await DAppConnectionStore.onDisconnected(channelId, false);

    expect(await DAppConnectionStore.getAll()).toEqual([
      expect.objectContaining({ channelId, explicitlyDisconnected: true }),
    ]);
  });
});
