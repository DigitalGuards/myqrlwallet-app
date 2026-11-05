jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
  Share: { share: jest.fn() },
  Platform: { OS: 'ios' },
  Linking: { canOpenURL: jest.fn(), openURL: jest.fn() },
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
  default: {
    onDisconnected: jest.fn().mockResolvedValue(undefined),
  },
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
import { i18n } from '../../i18n';
import * as preference from '../../i18n/preference';
import { LANGUAGE_STORAGE_KEY } from '../../i18n/preference';
import { supportedLanguages } from '../../i18n/languages';
import type WebView from 'react-native-webview';

const DOCUMENT_ID = 'de'.repeat(16);
const storage = jest.mocked(AsyncStorage);

async function authenticateDocument() {
  const send = jest.spyOn(NativeBridge, 'sendToWeb').mockReturnValue(true);
  await NativeBridge.handle({ type: 'WEB_APP_READY', payload: { documentId: DOCUMENT_ID } });
  const challenge = send.mock.calls.map(([message]) => message).find(
    message => message.type === 'WEB_DOCUMENT_CHALLENGE',
  );
  const challengeId = challenge?.payload?.challengeId;
  if (typeof challengeId !== 'string') throw new Error('Missing document challenge');
  await NativeBridge.handle({ type: 'WEB_DOCUMENT_READY', payload: { documentId: DOCUMENT_ID, challengeId } });
  send.mockRestore();
}

async function receive(raw: string) {
  const message = parseBridgeMessage(raw);
  if (message) await NativeBridge.handle(message);
}

beforeEach(async () => {
  NativeBridge.resetWebAppReady();
  NativeBridge.endWalletClear();
  NativeBridge.setNativeAuthorization(false);
  await authenticateDocument();
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
});

afterEach(() => { NativeBridge.resetWebAppReady(); });

it.each(supportedLanguages)('accepts and persists %s from the current document while locked', async language => {
  await receive(JSON.stringify({ type: 'LANGUAGE_CHANGED', payload: { language, documentId: DOCUMENT_ID } }));
  expect(i18n.language).toBe(language);
  expect(storage.setItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, language);
  expect(NativeBridge.captureSecurityContext().documentId).toBe(DOCUMENT_ID);
});

it.each([
  'not JSON', 'null', '[]',
  JSON.stringify({ type: 'LANGUAGE_CHANGED' }),
  ...[null, [], 'de', 3, true].map(payload => JSON.stringify({ type: 'LANGUAGE_CHANGED', payload })),
  ...[undefined, null, [], {}, 0, true, '', 'fr', 'de-DE', 'zh', 'zh-Hans', 'zh-cn', ' en'].map(
    language => JSON.stringify({ type: 'LANGUAGE_CHANGED', payload: { documentId: DOCUMENT_ID, language } }),
  ),
])('ignores invalid payloads and unknown language codes: %s', async raw => {
  await receive(raw);
  expect(i18n.language).toBe('en');
  expect(storage.setItem).not.toHaveBeenCalled();
});

it('ignores unknown message types', async () => {
  await receive(JSON.stringify({ type: 'SET_LANGUAGE', payload: { language: 'ru', documentId: DOCUMENT_ID } }));
  expect(i18n.language).toBe('en');
  expect(storage.setItem).not.toHaveBeenCalled();
});

it.each([undefined, 'ff'.repeat(16)])('ignores reports without the current document ID: %s', async documentId => {
  await receive(JSON.stringify({ type: 'LANGUAGE_CHANGED', payload: { language: 'de', documentId } }));
  expect(i18n.language).toBe('en');
  expect(storage.setItem).not.toHaveBeenCalled();
});

it('ignores a stale report after document reset', async () => {
  NativeBridge.resetWebAppReady();
  await receive(JSON.stringify({ type: 'LANGUAGE_CHANGED', payload: { language: 'de', documentId: DOCUMENT_ID } }));
  expect(i18n.language).toBe('en');
  expect(storage.setItem).not.toHaveBeenCalled();
});

it('switches again without resetting document or authorization state', async () => {
  NativeBridge.setNativeAuthorization(true);
  const context = NativeBridge.captureSecurityContext();
  await NativeBridge.handle({ type: 'LANGUAGE_CHANGED', payload: { language: 'de', documentId: DOCUMENT_ID } });
  await NativeBridge.handle({ type: 'LANGUAGE_CHANGED', payload: { language: 'es', documentId: DOCUMENT_ID } });
  expect(i18n.language).toBe('es');
  expect(NativeBridge.captureSecurityContext()).toEqual(context);
  expect(storage.setItem.mock.calls.map(call => call[1])).toEqual(['de', 'es']);
});

describe('the saved language leads the wallet', () => {
  const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };
  const sent = (send: jest.SpyInstance, type: string) =>
    send.mock.calls
      .map(([message]: [{ type: string; payload?: Record<string, unknown> }]) => message)
      .filter(message => message.type === type)
      .map(message => message.payload?.language);

  async function activate() {
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockReturnValue(true);
    await NativeBridge.handle({ type: 'WEB_APP_READY', payload: { documentId: DOCUMENT_ID } });
    const challengeId = send.mock.calls.map(([message]) => message).find(
      message => message.type === 'WEB_DOCUMENT_CHALLENGE',
    )?.payload?.challengeId;
    await NativeBridge.handle({ type: 'WEB_DOCUMENT_READY', payload: { documentId: DOCUMENT_ID, challengeId } });
    return send;
  }
  const report = (language: string) =>
    NativeBridge.handle({ type: 'LANGUAGE_CHANGED', payload: { language, documentId: DOCUMENT_ID } });

  afterEach(() => { jest.restoreAllMocks(); });

  it('changes native views, saves the choice and tells the current document', async () => {
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockReturnValue(true);
    await NativeBridge.setLanguage('ru');
    expect(i18n.language).toBe('ru');
    expect(storage.setItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, 'ru');
    expect(sent(send, 'SET_LANGUAGE')).toEqual(['ru']);
  });

  it('sends the real message with the document envelope', async () => {
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
    await NativeBridge.setLanguage('de');
    const script = injectJavaScript.mock.calls.at(-1)?.[0];
    expect(script).toContain('SET_LANGUAGE');
    expect(script).toContain(DOCUMENT_ID);
    NativeBridge.setWebViewRef({ current: null });
  });

  it('keeps a choice made with no active document and delivers it on activation', async () => {
    NativeBridge.resetWebAppReady();
    await NativeBridge.setLanguage('es');
    expect(i18n.language).toBe('es');
    expect(storage.setItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, 'es');
    const send = await activate();
    await flush();
    expect(sent(send, 'SET_LANGUAGE')).toEqual(['es']);
    expect(sent(send, 'REQUEST_LANGUAGE')).toEqual([]);
  });

  it('asks the wallet when nothing is saved, and never sends a default', async () => {
    jest.spyOn(preference, 'savedLanguagePreference').mockReturnValue(undefined);
    await i18n.changeLanguage('zh-CN');
    NativeBridge.resetWebAppReady();
    const send = await activate();
    await flush();
    expect(sent(send, 'SET_LANGUAGE')).toEqual([]);
    expect(sent(send, 'REQUEST_LANGUAGE')).toHaveLength(1);
    await report('ru');
    expect(i18n.language).toBe('ru');
    expect(storage.setItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, 'ru');
  });

  it('does not sync a document with a pending wipe', async () => {
    jest.spyOn(SeedStorageService, 'getPendingWalletWipe').mockResolvedValueOnce({
      version: 1,
      requestId: 'ab'.repeat(16),
      startedAt: 1,
    });
    jest.spyOn(NativeBridge, 'clearWalletDurably').mockResolvedValue();
    NativeBridge.resetWebAppReady();
    const send = await activate();
    await flush();
    expect(sent(send, 'SET_LANGUAGE')).toEqual([]);
    expect(sent(send, 'REQUEST_LANGUAGE')).toEqual([]);
  });

  it('does not sync a document that was replaced before the language was ready', async () => {
    let restored: () => void = () => undefined;
    jest.spyOn(preference, 'restoreLanguagePreference').mockReturnValue(new Promise<void>(resolve => {
      restored = resolve;
    }));
    NativeBridge.resetWebAppReady();
    const send = await activate();
    NativeBridge.resetWebAppReady();
    restored();
    await flush();
    expect(sent(send, 'SET_LANGUAGE')).toEqual([]);
    expect(sent(send, 'REQUEST_LANGUAGE')).toEqual([]);
  });

  it('waits for restoration before it syncs a new document', async () => {
    let restored: () => void = () => undefined;
    jest.spyOn(preference, 'restoreLanguagePreference').mockReturnValue(new Promise<void>(resolve => {
      restored = resolve;
    }));
    jest.spyOn(preference, 'savedLanguagePreference').mockReturnValue('ru');
    NativeBridge.resetWebAppReady();
    const send = await activate();
    await flush();
    expect(sent(send, 'SET_LANGUAGE')).toEqual([]);
    restored();
    await flush();
    expect(sent(send, 'SET_LANGUAGE')).toEqual(['ru']);
  });

  describe('while a Settings choice waits for its echo', () => {
    beforeEach(() => { jest.spyOn(NativeBridge, 'sendToWeb').mockReturnValue(true); });

    it('ignores a stale echo of an earlier choice', async () => {
      await NativeBridge.setLanguage('de');
      await NativeBridge.setLanguage('es');
      jest.mocked(storage.setItem).mockClear();
      await report('de');
      expect(i18n.language).toBe('es');
      expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('ignores the wallet falling back to English', async () => {
      await NativeBridge.setLanguage('de');
      await report('en');
      expect(i18n.language).toBe('de');
      expect(storage.setItem).not.toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, 'en');
    });

    it('takes the echo without a second save, then accepts later reports', async () => {
      await NativeBridge.setLanguage('de');
      jest.mocked(storage.setItem).mockClear();
      await report('de');
      expect(storage.setItem).not.toHaveBeenCalled();
      await report('ru');
      expect(i18n.language).toBe('ru');
      expect(storage.setItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, 'ru');
    });

    it('stops waiting when the document is replaced', async () => {
      await NativeBridge.setLanguage('de');
      NativeBridge.resetWebAppReady();
      await activate();
      await flush();
      await report('ru');
      expect(i18n.language).toBe('ru');
    });
  });
});
