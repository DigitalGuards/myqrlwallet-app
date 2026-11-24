type AppearanceListener = (preferences: { colorScheme: string | null }) => void;

const mockPlatform: { os: string; override: string | null; listener?: AppearanceListener } = {
  os: 'dark',
  override: null,
};

jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
  Share: { share: jest.fn() },
  Platform: { OS: 'ios' },
  Linking: { canOpenURL: jest.fn(), openURL: jest.fn() },
  AppState: { currentState: 'active', addEventListener: jest.fn() },
  Appearance: {
    getColorScheme: () => (mockPlatform.override && mockPlatform.override !== 'unspecified' ? mockPlatform.override : mockPlatform.os),
    setColorScheme: (value: string) => { mockPlatform.override = value; },
    addChangeListener: (listener: AppearanceListener) => { mockPlatform.listener = listener; },
  },
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ getRandomBytes: jest.fn(() => new Uint8Array(16).fill(1)) }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('../SeedStorageService', () => ({
  __esModule: true,
  default: {
    getPendingWalletWipe: jest.fn().mockResolvedValue(null),
    getDeviceCredential: jest.fn(),
    getOrCreateDeviceCredential: jest.fn(),
  },
}));
jest.mock('../DAppConnectionStore', () => ({
  __esModule: true,
  default: { onDisconnected: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../WebViewService', () => ({
  __esModule: true,
  default: {
    getUserPreferences: jest.fn(() => Promise.resolve({})),
    getContactsBackup: jest.fn().mockResolvedValue(null),
  },
}));
jest.mock('../Logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import NativeBridge from '../NativeBridge';
import SeedStorageService from '../SeedStorageService';
import { parseBridgeMessage } from '../BridgeMessage';
import type WebView from 'react-native-webview';
import * as preference from '../../theme/preference';
import { THEME_STORAGE_KEY } from '../../theme/preference';

const DOCUMENT_ID = 'de'.repeat(16);
const storage = jest.mocked(AsyncStorage);

type Sent = { type: string; payload?: Record<string, unknown> };
const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };
const themes = (send: jest.SpyInstance) =>
  send.mock.calls
    .map(([message]: [Sent]) => message)
    .filter(message => message.type === 'SET_THEME')
    .map(message => message.payload);

async function activate() {
  const send = jest.spyOn(NativeBridge, 'sendToWeb').mockReturnValue(true);
  await NativeBridge.handle({ type: 'WEB_APP_READY', payload: { documentId: DOCUMENT_ID } });
  const challengeId = send.mock.calls.map(([message]) => message).find(
    message => message.type === 'WEB_DOCUMENT_CHALLENGE',
  )?.payload?.challengeId;
  await NativeBridge.handle({ type: 'WEB_DOCUMENT_READY', payload: { documentId: DOCUMENT_ID, challengeId } });
  return send;
}
const report = (theme: unknown, ...documentId: unknown[]) =>
  NativeBridge.handle({
    type: 'THEME_CHANGED',
    payload: { theme, documentId: documentId.length > 0 ? documentId[0] : DOCUMENT_ID },
  });
async function receive(raw: string) {
  const message = parseBridgeMessage(raw);
  if (message) await NativeBridge.handle(message);
}

beforeEach(() => {
  preference.resetThemeForTests();
  mockPlatform.os = 'dark';
  mockPlatform.override = null;
  storage.getItem.mockResolvedValue(null);
  NativeBridge.resetWebAppReady();
  NativeBridge.endWalletClear();
  NativeBridge.setNativeAuthorization(false);
  jest.clearAllMocks();
});

afterEach(() => {
  NativeBridge.resetWebAppReady();
  jest.restoreAllMocks();
});

describe('the shell leads at a document start', () => {
  it('sends the default and its resolved value when nothing is saved, without writing it', async () => {
    const send = await activate();
    await flush();
    expect(themes(send)).toEqual([{ theme: 'dark', resolved: 'dark' }]);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('sends the saved choice once it has been restored', async () => {
    storage.getItem.mockResolvedValue('light');
    const send = await activate();
    await flush();
    expect(themes(send)).toEqual([{ theme: 'light', resolved: 'light' }]);
  });

  it('resolves a saved system choice from the OS appearance', async () => {
    mockPlatform.os = 'light';
    storage.getItem.mockResolvedValue('system');
    const send = await activate();
    await flush();
    expect(themes(send)).toEqual([{ theme: 'system', resolved: 'light' }]);
  });

  it('waits for a slow restore, so the wallet is never told the default over a saved choice', async () => {
    let finishRead: (value: string) => void = () => undefined;
    storage.getItem.mockReturnValue(new Promise(resolve => { finishRead = resolve; }));
    const send = await activate();
    await flush();
    expect(themes(send)).toEqual([]);
    finishRead('light');
    await flush();
    expect(themes(send)).toEqual([{ theme: 'light', resolved: 'light' }]);
  });

  it('does not tell a document that was replaced before the restore finished', async () => {
    let restored: () => void = () => undefined;
    jest.spyOn(preference, 'restoreThemePreference').mockReturnValue(new Promise<void>(resolve => { restored = resolve; }));
    const send = await activate();
    NativeBridge.resetWebAppReady();
    restored();
    await flush();
    expect(themes(send)).toEqual([]);
  });

  it('tells a document that starts with a pending wipe too, because the wipe empties the wallet storage', async () => {
    jest.spyOn(SeedStorageService, 'getPendingWalletWipe').mockResolvedValueOnce({
      version: 1,
      requestId: 'ab'.repeat(16),
      startedAt: 1,
    });
    jest.spyOn(NativeBridge, 'clearWalletDurably').mockResolvedValue();
    const send = await activate();
    await flush();
    expect(themes(send)).toEqual([{ theme: 'dark', resolved: 'dark' }]);
  });
});

describe('a change of the choice', () => {
  it('repaints the native views, saves, and tells the current document', async () => {
    const send = await activate();
    await flush();
    send.mockClear();
    await NativeBridge.setTheme('light');
    expect(preference.getThemeSnapshot()).toEqual({ theme: 'light', resolved: 'light' });
    expect(storage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'light');
    expect(themes(send)).toEqual([{ theme: 'light', resolved: 'light' }]);
  });

  it('sends the real message with the document envelope', async () => {
    await activate();
    await flush();
    jest.restoreAllMocks();
    const injectJavaScript = jest.fn((_script: string) => undefined);
    const webView: WebView = {
      injectJavaScript,
      goBack: jest.fn(),
      goForward: jest.fn(),
      reload: jest.fn(),
      stopLoading: jest.fn(),
      requestFocus: jest.fn(),
      postMessage: jest.fn(),
      clearCache: jest.fn(),
      props: {},
      state: {},
      context: undefined,
      setState: jest.fn(),
      forceUpdate: jest.fn(),
      render: jest.fn(() => null),
    };
    NativeBridge.setWebViewRef({ current: webView });
    await NativeBridge.setTheme('system');
    const script = injectJavaScript.mock.calls.at(-1)?.[0];
    expect(script).toContain('SET_THEME');
    expect(script).toContain(DOCUMENT_ID);
    expect(script).toContain('system');
    NativeBridge.setWebViewRef({ current: null });
  });

  it('keeps a choice made with no document and delivers it when one activates', async () => {
    await NativeBridge.setTheme('light');
    expect(storage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'light');
    const send = await activate();
    await flush();
    expect(themes(send)).toEqual([{ theme: 'light', resolved: 'light' }]);
  });

  it('sends nothing while no document is authenticated (no warning noise either)', async () => {
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockReturnValue(true);
    await NativeBridge.setTheme('light');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('the OS appearance', () => {
  it('under system, a change reaches the wallet as SET_THEME with the new resolved value', async () => {
    storage.getItem.mockResolvedValue('system');
    const send = await activate();
    await flush();
    send.mockClear();
    mockPlatform.os = 'light';
    mockPlatform.listener?.({ colorScheme: 'light' });
    expect(themes(send)).toEqual([{ theme: 'system', resolved: 'light' }]);
    mockPlatform.os = 'dark';
    mockPlatform.listener?.({ colorScheme: 'dark' });
    expect(themes(send).at(-1)).toEqual({ theme: 'system', resolved: 'dark' });
  });

  it('under a fixed choice, an OS change sends nothing', async () => {
    storage.getItem.mockResolvedValue('dark');
    const send = await activate();
    await flush();
    send.mockClear();
    mockPlatform.os = 'light';
    mockPlatform.listener?.({ colorScheme: 'light' });
    expect(themes(send)).toEqual([]);
  });
});

describe('THEME_CHANGED from the wallet', () => {
  let send: jest.SpyInstance;

  beforeEach(async () => {
    await activate();
    await flush();
    jest.restoreAllMocks();
    send = jest.spyOn(NativeBridge, 'sendToWeb').mockReturnValue(true);
    storage.setItem.mockClear();
  });

  it.each(['light', 'system'])('accepts %s from the current document while locked, saves it and answers with SET_THEME', async theme => {
    await receive(JSON.stringify({ type: 'THEME_CHANGED', payload: { theme, documentId: DOCUMENT_ID } }));
    expect(preference.getThemeSnapshot().theme).toBe(theme);
    expect(storage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, theme);
    expect(themes(send)).toEqual([{ theme, resolved: theme === 'system' ? 'dark' : theme }]);
  });

  it('answers a report equal to the current choice with SET_THEME every time, and does not save it', async () => {
    await report('dark');
    await report('dark');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(themes(send)).toEqual([
      { theme: 'dark', resolved: 'dark' },
      { theme: 'dark', resolved: 'dark' },
    ]);
    expect(preference.savedThemePreference()).toBeUndefined();
  });

  it('gives a stale wallet the resolved value of system', async () => {
    mockPlatform.os = 'light';
    await NativeBridge.setTheme('system');
    send.mockClear();
    storage.setItem.mockClear();
    await report('system');
    expect(themes(send)).toEqual([{ theme: 'system', resolved: 'light' }]);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('saves and answers a real change once; a repeat saves nothing and is answered again', async () => {
    await report('light');
    await report('light');
    expect(themes(send)).toHaveLength(2);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('follows a second genuine change after the first', async () => {
    await report('light');
    await report('dark');
    expect(themes(send)).toEqual([
      { theme: 'light', resolved: 'light' },
      { theme: 'dark', resolved: 'dark' },
    ]);
  });

  it.each([
    'not JSON', 'null', '[]',
    JSON.stringify({ type: 'THEME_CHANGED' }),
    ...[null, [], 'light', 3, true].map(payload => JSON.stringify({ type: 'THEME_CHANGED', payload })),
    ...[undefined, null, [], {}, 0, true, '', 'Light', 'LIGHT', 'auto', 'resolved', ' light', 'light '].map(
      theme => JSON.stringify({ type: 'THEME_CHANGED', payload: { documentId: DOCUMENT_ID, theme } }),
    ),
  ])('ignores invalid payloads and unknown values: %s', async raw => {
    await receive(raw);
    expect(preference.getThemeSnapshot().theme).toBe('dark');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(themes(send)).toEqual([]);
  });

  it.each([undefined, 'ff'.repeat(16)])('ignores reports without the current document ID: %s', async documentId => {
    await report('light', documentId);
    expect(preference.getThemeSnapshot().theme).toBe('dark');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('ignores a stale report after the document was reset', async () => {
    NativeBridge.resetWebAppReady();
    await report('light');
    expect(preference.getThemeSnapshot().theme).toBe('dark');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('does not take SET_THEME from the wallet as a request', async () => {
    await receive(JSON.stringify({ type: 'SET_THEME', payload: { theme: 'light', resolved: 'light', documentId: DOCUMENT_ID } }));
    expect(preference.getThemeSnapshot().theme).toBe('dark');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('keeps document and authorization state across a change', async () => {
    NativeBridge.setNativeAuthorization(true);
    const context = NativeBridge.captureSecurityContext();
    await report('light');
    expect(NativeBridge.captureSecurityContext()).toEqual(context);
  });
});
