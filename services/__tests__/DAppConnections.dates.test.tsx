import { act, type ReactElement, type useEffect } from 'react';
import type { ReactTestRenderer } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DAppConnectionsScreen from '../../app/dapp-connections';
import DAppConnectionStore, { type DAppConnectionRecord } from '../DAppConnectionStore';
import { i18n, t } from '../../i18n';
import { supportedLanguages } from '../../i18n/languages';

const { create } = jest.requireActual<{
  create: (element: ReactElement) => Promise<ReactTestRenderer>;
}>('@react-native/jest-preset/jest/renderer');

jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  useNavigation: () => ({ setOptions: jest.fn() }),
  useFocusEffect: (callback: () => () => void) => {
    jest.requireActual<{ useEffect: typeof useEffect }>('react').useEffect(callback, [callback]);
  },
}));
jest.mock('../NativeBridge', () => ({ requestDAppDisconnect: jest.fn() }));
jest.mock('../Logger', () => ({ error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const record: DAppConnectionRecord = {
  channelId: '11111111-1111-4111-8111-111111111111',
  name: 'Example dApp',
  url: 'https://example.test',
  connectedAccount: `Q${'ab'.repeat(64)}`,
  connectedAt: 9007199254740991,
  disconnectedAt: null,
  explicitlyDisconnected: false,
};

function freshStore(): typeof DAppConnectionStore {
  let store: typeof DAppConnectionStore | undefined;
  jest.isolateModules(() => {
    store = jest.requireActual<typeof import('../DAppConnectionStore')>('../DAppConnectionStore').default;
  });
  if (!store) throw new Error('Missing connection store');
  return store;
}

describe.each(supportedLanguages)('connection timestamps in %s', (language) => {
  let screen: ReactTestRenderer | undefined;

  beforeEach(async () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 22, 12).getTime() });
    jest.clearAllMocks();
    await i18n.changeLanguage(language);
    jest.spyOn(DAppConnectionStore, 'remove');
    jest.spyOn(DAppConnectionStore, 'clear');
  });

  afterEach(async () => {
    await act<undefined>(() => { screen?.unmount(); });
    screen = undefined;
    await i18n.changeLanguage('en');
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each([9007199254740991, NaN, Infinity, -Infinity, -9007199254740991])(
    'keeps active and recent rows with invalid timestamp %s', async (timestamp) => {
      const active = { ...record, connectedAt: timestamp };
      const recent = { ...record, channelId: '22222222-2222-4222-8222-222222222222', disconnectedAt: timestamp };
      jest.spyOn(DAppConnectionStore, 'getActive').mockResolvedValue([active]);
      jest.spyOn(DAppConnectionStore, 'getRecent').mockResolvedValue([recent]);
      screen = await create(<DAppConnectionsScreen />);

      const rendered = JSON.stringify(screen.toJSON());
      expect(rendered).toContain(t('dapps.connected', { time: '-' }));
      expect(rendered).toContain(t('dapps.disconnected', { time: '-' }));
      expect(rendered.match(/Example dApp/g)).toHaveLength(2);
      expect(rendered).toContain(t('common.disconnect'));
      expect(rendered).toContain(t('common.remove'));
      expect(jest.mocked(DAppConnectionStore).remove.mock.calls).toHaveLength(0);
      expect(jest.mocked(DAppConnectionStore).clear.mock.calls).toHaveLength(0);
      expect(active.connectedAt).toBe(timestamp);
      expect(recent.disconnectedAt).toBe(timestamp);
    },
  );

  it('retains an out-of-range timestamp through storage and reload', async () => {
    await AsyncStorage.clear();
    const writer = freshStore();
    await writer.onConnected(record);
    const reader = freshStore();
    const restored = await reader.getActive();
    expect(restored).toEqual([record]);
    jest.spyOn(DAppConnectionStore, 'getActive').mockResolvedValue(restored);
    jest.spyOn(DAppConnectionStore, 'getRecent').mockResolvedValue([]);
    screen = await create(<DAppConnectionsScreen />);
    expect(JSON.stringify(screen.toJSON())).toContain(t('dapps.connected', { time: '-' }));
    expect(await reader.getActive()).toEqual([record]);
    expect(await freshStore().getActive()).toEqual([record]);
  });

  it.each([-8640000000000000, 8640000000000000])('renders the valid Date limit %s', async (timestamp) => {
    jest.spyOn(DAppConnectionStore, 'getActive').mockResolvedValue([{ ...record, connectedAt: timestamp }]);
    jest.spyOn(DAppConnectionStore, 'getRecent').mockResolvedValue([]);
    screen = await create(<DAppConnectionsScreen />);
    const rendered = JSON.stringify(screen.toJSON());
    expect(rendered).toContain('Example dApp');
    expect(rendered).not.toContain(t('dapps.connected', { time: '-' }));
  });

  it('renders valid dates and preserves the English date and time copy', async () => {
    jest.spyOn(DAppConnectionStore, 'getActive').mockResolvedValue([
      { ...record, connectedAt: new Date(2020, 0, 2, 3, 4).getTime() },
      { ...record, channelId: '22222222-2222-4222-8222-222222222222', connectedAt: new Date(2026, 0, 2, 3, 4).getTime() },
    ]);
    jest.spyOn(DAppConnectionStore, 'getRecent').mockResolvedValue([]);
    screen = await create(<DAppConnectionsScreen />);
    const rendered = JSON.stringify(screen.toJSON());
    expect(rendered.match(/Example dApp/g)).toHaveLength(2);
    expect(rendered).toContain('2020');
    expect(rendered).toContain('03:04');
    expect(rendered).not.toContain(t('dapps.connected', { time: '-' }));
    if (language === 'en') {
      expect(rendered).toContain('Connected Jan 2, 2020 at 03:04');
      expect(rendered).toContain('Connected Jan 2 at 03:04');
    }
  });
});
