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
  NotificationFeedbackType: {
    Success: 'success',
    Warning: 'warning',
    Error: 'error',
  },
}));
jest.mock('../SeedStorageService', () => ({
  __esModule: true,
  default: {
    getPendingWalletWipe: jest.fn(async () => null),
  },
}));
jest.mock('../DAppConnectionStore', () => ({
  __esModule: true,
  default: {
    onConnected: jest.fn(async () => undefined),
    onDisconnected: jest.fn(async () => undefined),
  },
}));
jest.mock('../WebViewService', () => ({
  __esModule: true,
  default: {
    saveContactsBackupStrict: jest.fn(async () => undefined),
    getUserPreferences: jest.fn(async () => ({})),
    getContactsBackup: jest.fn(async () => null),
  },
}));
jest.mock('../Logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { Linking } from 'react-native';
import * as Haptics from 'expo-haptics';
import NativeBridge, { BridgeMessage } from '../NativeBridge';
import DAppConnectionStore from '../DAppConnectionStore';
import Logger from '../Logger';
import WebViewService from '../WebViewService';

const mockCanOpenUrl = Linking.canOpenURL as jest.MockedFunction<typeof Linking.canOpenURL>;
const mockOpenUrl = Linking.openURL as jest.MockedFunction<typeof Linking.openURL>;
const mockImpactAsync = Haptics.impactAsync as jest.MockedFunction<typeof Haptics.impactAsync>;
const mockNotificationAsync = Haptics.notificationAsync as jest.MockedFunction<
  typeof Haptics.notificationAsync
>;
const mockDAppConnected = DAppConnectionStore.onConnected as jest.MockedFunction<
  typeof DAppConnectionStore.onConnected
>;
const mockWarn = Logger.warn as jest.MockedFunction<typeof Logger.warn>;
const mockError = Logger.error as jest.MockedFunction<typeof Logger.error>;
const mockSaveContacts = WebViewService.saveContactsBackupStrict as jest.MockedFunction<
  typeof WebViewService.saveContactsBackupStrict
>;
const DOCUMENT_ID = 'de'.repeat(16);
const nativeHandle = NativeBridge.handle.bind(NativeBridge);

async function authenticateDocument(): Promise<void> {
  const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
  await nativeHandle({ type: 'WEB_APP_READY', payload: { documentId: DOCUMENT_ID } });
  const challenge = send.mock.calls
    .map(([message]) => message as { type?: string; payload?: Record<string, unknown> })
    .find((message) => message.type === 'WEB_DOCUMENT_CHALLENGE');
  const challengeId = challenge?.payload?.challengeId;
  if (typeof challengeId !== 'string') throw new Error('Document challenge was not sent');
  await nativeHandle({
    type: 'WEB_DOCUMENT_READY',
    payload: { documentId: DOCUMENT_ID, challengeId },
  });
  send.mockRestore();
}

async function handleBridge(message: BridgeMessage): Promise<void> {
  return nativeHandle({
    ...message,
    payload: { ...(message.payload ?? {}), documentId: DOCUMENT_ID },
  });
}

describe('NativeBridge hosted WebView boundaries', () => {
  beforeEach(async () => {
    NativeBridge.resetWebAppReady();
    NativeBridge.endWalletClear();
    NativeBridge.setNativeAuthorization(true);
    await authenticateDocument();
    jest.clearAllMocks();
    mockCanOpenUrl.mockResolvedValue(true);
    mockOpenUrl.mockResolvedValue(undefined);
  });

  it.each([
    'javascript:alert(1)',
    'intent://wallet/#Intent;scheme=qrl;end',
    'tel:+15551234567',
    'qrlconnect://pair',
    'custom-wallet://open',
    'http://example.com/private',
    'http://localhost.evil/private',
    'http://127.0.0.2/private',
    'https://user:password@example.com/private',
    'https://[::1',
  ])('rejects unsafe OPEN_URL input %s before Linking', async (url) => {
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => undefined);

    await handleBridge({ type: 'OPEN_URL', payload: { url } });

    expect(mockCanOpenUrl).not.toHaveBeenCalled();
    expect(mockOpenUrl).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({
      type: 'ERROR',
      payload: { message: 'Invalid URL' },
    });
    send.mockRestore();
  });

  it('opens a parsed HTTPS URL without credentials', async () => {
    const url = 'https://example.com/wallet/help?network=testnet#setup';

    await handleBridge({ type: 'OPEN_URL', payload: { url } });

    expect(mockCanOpenUrl).toHaveBeenCalledWith(url);
    expect(mockOpenUrl).toHaveBeenCalledWith(url);
  });

  it.each([
    'http://localhost:3000/help',
    'http://wallet.localhost:3000/help',
    'http://127.0.0.1:3000/help',
    'http://[::1]:3000/help',
  ])('allows explicit HTTP loopback URL %s', async (url) => {
    await handleBridge({ type: 'OPEN_URL', payload: { url } });

    expect(mockCanOpenUrl).toHaveBeenCalledWith(url);
    expect(mockOpenUrl).toHaveBeenCalledWith(url);
  });

  it('does not log a rejected OPEN_URL query when native cannot open it', async () => {
    const url = 'https://example.com/?bearer=do-not-log';
    mockCanOpenUrl.mockResolvedValue(false);

    await handleBridge({ type: 'OPEN_URL', payload: { url } });

    expect(JSON.stringify(mockWarn.mock.calls)).not.toContain('do-not-log');
    expect(JSON.stringify(mockError.mock.calls)).not.toContain('do-not-log');
  });

  it.each([
    'qrlconnect://?q=bearer-secret',
    'javascript:alert(1)',
    'https://user:password@example.com/private',
  ])('rejects unsafe DAPP_RETURN input without logging it: %s', async (redirectUrl) => {
    await handleBridge({
      type: 'DAPP_RETURN',
      payload: { redirectUrl },
    });

    expect(mockOpenUrl).not.toHaveBeenCalled();
    expect(JSON.stringify(mockWarn.mock.calls)).not.toContain(redirectUrl);
    expect(JSON.stringify(mockError.mock.calls)).not.toContain(redirectUrl);
  });

  it('opens a validated HTTPS DAPP_RETURN URL without logging its query', async () => {
    const redirectUrl = 'https://dapp.example/return?bearer=do-not-log';

    await handleBridge({
      type: 'DAPP_RETURN',
      payload: { redirectUrl },
    });

    expect(mockOpenUrl).toHaveBeenCalledWith(redirectUrl);
    expect(JSON.stringify(mockWarn.mock.calls)).not.toContain('do-not-log');
    expect(JSON.stringify(mockError.mock.calls)).not.toContain('do-not-log');
  });

  it('emits exactly one haptic event for one DAPP_HAPTIC message', async () => {
    await handleBridge({ type: 'DAPP_HAPTIC', payload: { style: 'success' } });

    expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mockNotificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );
    expect(mockImpactAsync).not.toHaveBeenCalled();
  });

  it('rejects a mixed-case custom scheme at the final native forwarding boundary', () => {
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);

    expect(NativeBridge.sendDAppURI('QrLcOnNeCt://?q=ABC')).toBe(false);
    expect(send).not.toHaveBeenCalled();
    send.mockRestore();
  });

  it.each(['', `Q${'11'.repeat(32)}`, `Q${'zz'.repeat(20)}`])(
    'rejects non-Q+40 DAPP_CONNECTED account %s',
    async (connectedAccount) => {
      await handleBridge({
        type: 'DAPP_CONNECTED',
        payload: {
          channelId: 'channel-id',
          name: 'dApp',
          url: 'https://example.com',
          connectedAccount,
        },
      });

      expect(mockDAppConnected).not.toHaveBeenCalled();
    }
  );

  it('persists a Q+40 DAPP_CONNECTED account', async () => {
    const connectedAccount = `Q${'12'.repeat(20)}`;
    await handleBridge({
      type: 'DAPP_CONNECTED',
      payload: {
        channelId: '11111111-1111-4111-8111-111111111111',
        name: 'dApp',
        url: 'https://example.com',
        connectedAccount,
      },
    });

    expect(mockDAppConnected).toHaveBeenCalledWith(expect.objectContaining({ connectedAccount }));
  });

  it('rejects insecure dApp metadata URLs', async () => {
    await handleBridge({
      type: 'DAPP_CONNECTED',
      payload: {
        channelId: '22222222-2222-4222-8222-222222222222',
        name: 'dApp',
        url: 'http://example.com',
        connectedAccount: `Q${'12'.repeat(20)}`,
      },
    });
    expect(mockDAppConnected).not.toHaveBeenCalled();
  });

  it('rejects contact arrays beyond the native bridge budget', async () => {
    const contacts = Array.from({ length: 501 }, (_, index) => ({
      id: String(index),
      name: `Contact ${index}`,
      address: `Q${'12'.repeat(20)}`,
      createdAt: index,
    }));
    await handleBridge({ type: 'CONTACTS_UPDATED', payload: { contacts } });
    expect(mockSaveContacts).not.toHaveBeenCalled();
  });
});
