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
import { parseBridgeMessage } from '../BridgeMessage';
import { i18n } from '../../i18n';
import { LANGUAGE_STORAGE_KEY } from '../../i18n/preference';
import { supportedLanguages } from '../../i18n/languages';

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
