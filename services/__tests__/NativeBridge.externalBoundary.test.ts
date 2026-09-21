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

import { Linking, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import NativeBridge, { BridgeMessage } from '../NativeBridge';
import DAppConnectionStore from '../DAppConnectionStore';
import Logger from '../Logger';
import WebViewService from '../WebViewService';

const mockCanOpenUrl = Linking.canOpenURL as jest.MockedFunction<typeof Linking.canOpenURL>;
const mockOpenUrl = Linking.openURL as jest.MockedFunction<typeof Linking.openURL>;
const mockShare = Share.share as jest.MockedFunction<typeof Share.share>;
const mockSetStringAsync = Clipboard.setStringAsync as jest.MockedFunction<
  typeof Clipboard.setStringAsync
>;
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
const QIP55_ADDRESS = `Q${'aB'.repeat(64)}`;
const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';
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

  it.each([
    '',
    `Q${'12'.repeat(20)}`,
    `Q${'1'.repeat(127)}`,
    `Q${'1'.repeat(129)}`,
    `q${'1'.repeat(128)}`,
    `Q${'z'.repeat(128)}`,
  ])(
    'rejects a non-Q+128 DAPP_CONNECTED account %s',
    async (connectedAccount) => {
      await handleBridge({
        type: 'DAPP_CONNECTED',
        payload: {
          channelId: CHANNEL_ID,
          name: 'dApp',
          url: 'https://example.com',
          connectedAccount,
        },
      });

      expect(mockDAppConnected).not.toHaveBeenCalled();
    }
  );

  it('persists the exact Q+128 DAPP_CONNECTED account', async () => {
    const connectedAccount = QIP55_ADDRESS;
    await handleBridge({
      type: 'DAPP_CONNECTED',
      payload: {
        channelId: CHANNEL_ID,
        name: 'dApp',
        url: 'https://example.com',
        connectedAccount,
      },
    });

    expect(mockDAppConnected).toHaveBeenCalledWith(expect.objectContaining({ connectedAccount }));
  });

  it('copies the exact Q+128 address without display shortening', async () => {
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);

    await handleBridge({ type: 'COPY_TO_CLIPBOARD', payload: { text: QIP55_ADDRESS } });

    expect(mockSetStringAsync).toHaveBeenCalledWith(QIP55_ADDRESS);
    expect(send).toHaveBeenCalledWith({
      type: 'CLIPBOARD_SUCCESS',
      payload: { text: QIP55_ADDRESS },
    });
    send.mockRestore();
  });

  it('shares exact Q+128 address text and explorer URL', async () => {
    const explorerUrl = `https://zondscan.com/address/${QIP55_ADDRESS}`;
    mockShare.mockResolvedValue({ action: 'sharedAction' });

    await handleBridge({
      type: 'SHARE',
      payload: { title: 'QRL account', text: QIP55_ADDRESS, url: explorerUrl },
    });

    expect(mockShare).toHaveBeenCalledWith({
      title: 'QRL account',
      message: QIP55_ADDRESS,
      url: explorerUrl,
    });
  });

  it('returns the exact Q+128 QR payload once for the active scanner request', async () => {
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
    const scan = jest.fn();
    NativeBridge.onQRScanRequest(scan);
    await handleBridge({ type: 'SCAN_QR' });
    const request = scan.mock.calls[0][0];
    expect(NativeBridge.sendQRResult(QIP55_ADDRESS, request)).toBe(true);
    expect(NativeBridge.sendQRResult(QIP55_ADDRESS, request)).toBe(false);

    expect(send).toHaveBeenCalledWith({
      type: 'QR_RESULT',
      payload: { address: QIP55_ADDRESS },
    });
    send.mockRestore();
  });

  it.each(['lock', 'document', 'wipe', 'replacement'])('rejects late QR results after %s', async change => {
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
    const scan = jest.fn();
    NativeBridge.onQRScanRequest(scan);
    await handleBridge({ type: 'SCAN_QR' });
    const request = scan.mock.calls[0][0];
    if (change === 'lock') NativeBridge.invalidateAuthorization();
    if (change === 'document') NativeBridge.resetWebAppReady();
    if (change === 'wipe') NativeBridge.beginWalletClear();
    if (change === 'replacement') await handleBridge({ type: 'SCAN_QR' });
    expect(NativeBridge.sendQRResult('qrlconnect://?q=fixture', request)).toBe(false);
    expect(NativeBridge.sendQRCancelled(request)).toBe(false);
    expect(send.mock.calls.filter(([message]) => message.type === 'QR_RESULT')).toHaveLength(0);
    send.mockRestore();
  });

  it('delivers a cold dApp intent exactly once after initial reset, readiness and PIN unlock', async () => {
    NativeBridge.resetWebAppReady();
    expect(NativeBridge.queueDAppURI('qrlconnect://?q=cold-fixture')).toBe(true);
    NativeBridge.resetWebAppReady();
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
    await nativeHandle({ type: 'WEB_APP_READY', payload: { documentId: DOCUMENT_ID } });
    const challenge = send.mock.calls.find(([message]) => message.type === 'WEB_DOCUMENT_CHALLENGE')?.[0];
    await nativeHandle({ type: 'WEB_DOCUMENT_READY', payload: challenge?.payload });
    expect(send.mock.calls.filter(([message]) => message.type === 'DAPP_URI')).toHaveLength(0);
    NativeBridge.invalidateAuthorization({ preservePendingDAppIntent: true });
    NativeBridge.setNativeAuthorization(true);
    NativeBridge.setNativeAuthorization(true);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(send.mock.calls.filter(([message]) => message.type === 'DAPP_URI')).toEqual([[
      { type: 'DAPP_URI', payload: { uri: 'qrlconnect://?q=cold-fixture' } },
    ]]);
    send.mockRestore();
  });

  it.each(['lock', 'document', 'wipe', 'expiry'])('cancels a bound pending dApp intent on %s', change => {
    jest.useFakeTimers();
    NativeBridge.invalidateAuthorization();
    NativeBridge.queueDAppURI('qrlconnect://?q=pending-fixture');
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
    if (change === 'lock') NativeBridge.invalidateAuthorization();
    if (change === 'document') NativeBridge.resetWebAppReady();
    if (change === 'wipe') { NativeBridge.beginWalletClear(); NativeBridge.endWalletClear(); }
    if (change === 'expiry') jest.advanceTimersByTime(120000);
    NativeBridge.setNativeAuthorization(true);
    expect(send.mock.calls.filter(([message]) => message.type === 'DAPP_URI')).toHaveLength(0);
    NativeBridge.cancelPendingDAppIntent();
    send.mockRestore();
    jest.useRealTimers();
  });

  it('bounds the queue to the newest intent and coalesces duplicate pending arrivals', async () => {
    NativeBridge.invalidateAuthorization();
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
    NativeBridge.queueDAppURI('qrlconnect://?q=old-fixture');
    NativeBridge.queueDAppURI('qrlconnect://?q=new-fixture');
    NativeBridge.queueDAppURI('qrlconnect://?q=new-fixture');
    NativeBridge.setNativeAuthorization(true);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(send.mock.calls.filter(([message]) => message.type === 'DAPP_URI')).toEqual([[
      { type: 'DAPP_URI', payload: { uri: 'qrlconnect://?q=new-fixture' } },
    ]]);
    send.mockRestore();
  });

  it('waits for authorized wallet restore before delivering a queued dApp intent', async () => {
    NativeBridge.invalidateAuthorization();
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
    let releaseRestore!: () => void;
    NativeBridge.onWebAppReady(() => new Promise<void>(resolve => {
      releaseRestore = () => {
        NativeBridge.sendRestoreSeed(QIP55_ADDRESS, 'fixture ciphertext', 'TEST_NET_V3', 1);
        resolve();
      };
    }));
    try {
      NativeBridge.queueDAppURI('qrlconnect://?q=restore-fixture');
      NativeBridge.setNativeAuthorization(true);
      for (let i = 0; i < 20 && !releaseRestore; i++) await Promise.resolve();
      expect(send.mock.calls.filter(([message]) => message.type === 'DAPP_URI')).toHaveLength(0);
      releaseRestore();
      for (let i = 0; i < 20; i++) await Promise.resolve();
      const events = send.mock.calls.map(([message]) => message.type);
      expect(events.indexOf('RESTORE_SEED')).toBeGreaterThanOrEqual(0);
      expect(events.indexOf('DAPP_URI')).toBeGreaterThan(events.indexOf('RESTORE_SEED'));
    } finally {
      NativeBridge.onWebAppReady(async () => undefined);
      send.mockRestore();
    }
  });

  it('rejects insecure dApp metadata URLs', async () => {
    await handleBridge({
      type: 'DAPP_CONNECTED',
      payload: {
        channelId: '22222222-2222-4222-8222-222222222222',
        name: 'dApp',
        url: 'http://example.com',
        connectedAccount: QIP55_ADDRESS,
      },
    });
    expect(mockDAppConnected).not.toHaveBeenCalled();
  });

  it('rejects contact arrays beyond the native bridge budget', async () => {
    const contacts = Array.from({ length: 501 }, (_, index) => ({
      id: String(index),
      name: `Contact ${index}`,
      address: QIP55_ADDRESS,
      createdAt: index,
    }));
    await handleBridge({ type: 'CONTACTS_UPDATED', payload: { contacts } });
    expect(mockSaveContacts).not.toHaveBeenCalled();
  });

  it('prunes legacy contacts but keeps valid ones in the same update', async () => {
    const valid = {
      id: 'qip55-contact',
      name: 'Valid contact',
      address: QIP55_ADDRESS,
      createdAt: 2,
    };
    await handleBridge({
      type: 'CONTACTS_UPDATED',
      payload: {
        contacts: [
          {
            id: 'legacy-contact',
            name: 'Legacy contact',
            address: `Q${'12'.repeat(20)}`,
            createdAt: 1,
          },
          valid,
        ],
      },
    });

    expect(mockSaveContacts).toHaveBeenCalledWith(JSON.stringify([valid]));
  });

  it('rejects a contact carrying a legacy Q+40 address', async () => {
    await handleBridge({
      type: 'CONTACTS_UPDATED',
      payload: {
        contacts: [
          {
            id: 'legacy-contact',
            name: 'Legacy contact',
            address: `Q${'12'.repeat(20)}`,
            createdAt: 1,
          },
        ],
      },
    });

    expect(mockSaveContacts).not.toHaveBeenCalled();
  });

  it('forwards only an exact Q+128 seed restore address', () => {
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);

    NativeBridge.sendRestoreSeed(`Q${'12'.repeat(20)}`, 'legacy', 'TEST_NET_V3', 1);
    NativeBridge.sendRestoreSeed(QIP55_ADDRESS, 'legacy', 'TEST_NET', 1);
    NativeBridge.sendRestoreSeed(QIP55_ADDRESS, 'legacy', 'MAIN_NET', 1);
    expect(send).not.toHaveBeenCalled();

    NativeBridge.sendRestoreSeed(QIP55_ADDRESS, 'ciphertext', 'TEST_NET_V3', 1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ address: QIP55_ADDRESS }) }),
    );
    send.mockRestore();
  });
});
