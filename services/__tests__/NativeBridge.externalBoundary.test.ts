jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
  Share: { share: jest.fn() },
  Platform: { OS: 'ios' },
  BackHandler: { exitApp: jest.fn() },
  Linking: { canOpenURL: jest.fn(), openURL: jest.fn() },
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(), getStringAsync: jest.fn() }));
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

import { BackHandler, Linking, Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import NativeBridge, { BridgeMessage } from '../NativeBridge';
import DAppConnectionStore from '../DAppConnectionStore';
import Logger from '../Logger';
import WebViewService from '../WebViewService';

const mockExitApp = BackHandler.exitApp as jest.MockedFunction<typeof BackHandler.exitApp>;
/** The mock above is a plain object, so the platform is just a field. */
const setPlatform = (os: string) => {
  (Platform as unknown as { OS: string }).OS = os;
};
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
const mockGetUserPreferences = WebViewService.getUserPreferences as jest.MockedFunction<
  typeof WebViewService.getUserPreferences
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
    setPlatform('ios');
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

  it.each([
    'https://qrlwallet.com/',
    'https://qrlwallet.com/terms',
    'https://www.qrlwallet.com/privacy',
    'https://QRLWallet.com/security',
    'https://qrlwallet.com./legal',
  ])('refuses to send the user to the hosted wallet at %s', async (url) => {
    // The embedded wallet routes every external link through OPEN_URL, so
    // this is where a link back to the live site would otherwise open a
    // browser on the page the app stopped depending on.
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => undefined);

    await handleBridge({ type: 'OPEN_URL', payload: { url } });

    expect(mockCanOpenUrl).not.toHaveBeenCalled();
    expect(mockOpenUrl).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({ type: 'ERROR', payload: { message: 'Invalid URL' } });
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

  it('refuses a DAPP_RETURN that names the wallet itself', async () => {
    setPlatform('android');

    await handleBridge({
      type: 'DAPP_RETURN',
      payload: { redirectUrl: 'https://qrlwallet.com/connect' },
    });

    expect(mockExitApp).not.toHaveBeenCalled();
    expect(mockOpenUrl).not.toHaveBeenCalled();
  });

  it('backgrounds the wallet for a validated DAPP_RETURN on Android', async () => {
    // Opening the URL made a new browser tab every time, and that tab loses
    // the connect SDK's cross-tab lock and goes silently DISCONNECTED, so the
    // user was left on a page the answer could never reach.
    setPlatform('android');
    const redirectUrl = 'https://dapp.example/return?bearer=do-not-log';

    await handleBridge({ type: 'DAPP_RETURN', payload: { redirectUrl } });

    expect(mockExitApp).toHaveBeenCalledTimes(1);
    expect(mockOpenUrl).not.toHaveBeenCalled();
    expect(JSON.stringify(mockWarn.mock.calls)).not.toContain('do-not-log');
    expect(JSON.stringify(mockError.mock.calls)).not.toContain('do-not-log');
  });

  it('does nothing for a DAPP_RETURN on iOS', async () => {
    // Safari opens a new tab with the same defect, and iOS has no public way
    // to move the app to the back.
    setPlatform('ios');

    await handleBridge({
      type: 'DAPP_RETURN',
      payload: { redirectUrl: 'https://dapp.example/return' },
    });

    expect(mockExitApp).not.toHaveBeenCalled();
    expect(mockOpenUrl).not.toHaveBeenCalled();
  });

  it('never backgrounds the wallet after a wallet-initiated disconnect', async () => {
    // The user is standing in the wallet's own session list.
    setPlatform('android');

    await handleBridge({
      type: 'DAPP_RETURN',
      payload: { redirectUrl: 'https://dapp.example/return', reason: 'disconnect' },
    });

    expect(mockExitApp).not.toHaveBeenCalled();
    expect(mockOpenUrl).not.toHaveBeenCalled();
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

  it.each(['invalidateAuthorization', 'beginWalletClear'] as const)(
    'sends APP_LOCKED to the page on %s',
    (lock) => {
      const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
      NativeBridge[lock]();
      expect(send).toHaveBeenCalledWith({ type: 'APP_LOCKED' });
      send.mockRestore();
    },
  );

  it('sanitizes a page-chosen message type before it reaches the logs', async () => {
    NativeBridge.invalidateAuthorization();
    await nativeHandle({
      type: 'X\nerror [Fake] forged entry' as never,
      payload: { documentId: DOCUMENT_ID },
    });
    const logged = mockWarn.mock.calls.map((call) => String(call[1])).join('|');
    expect(logged).toContain('Dropped X?error??Fake??forged?entry');
    expect(logged).not.toContain('\n');
    NativeBridge.setNativeAuthorization(true);
  });

  describe('dApp events received while the wallet is locked', () => {
    const connected = (name: string, channelId = CHANNEL_ID): BridgeMessage => ({
      type: 'DAPP_CONNECTED',
      payload: { channelId, name, url: 'https://example.com', connectedAccount: QIP55_ADDRESS },
    });
    const settle = async () => {
      for (let i = 0; i < 30; i++) await Promise.resolve();
    };

    it('holds DAPP_SHOW_WEBVIEW and DAPP_CONNECTED while locked and applies them after unlock', async () => {
      const show = jest.fn();
      NativeBridge.onDAppShowWebView(show);
      NativeBridge.invalidateAuthorization();

      await handleBridge(connected('first'));
      await handleBridge(connected('latest'));
      await handleBridge({ type: 'DAPP_SHOW_WEBVIEW' });
      expect(show).not.toHaveBeenCalled();
      expect(mockDAppConnected).not.toHaveBeenCalled();

      NativeBridge.setNativeAuthorization(true);
      await settle();
      expect(show).toHaveBeenCalledTimes(1);
      expect(mockDAppConnected).toHaveBeenCalledTimes(1);
      expect(mockDAppConnected).toHaveBeenCalledWith(expect.objectContaining({ name: 'latest' }));
      NativeBridge.onDAppShowWebView(jest.fn());
    });

    it('does not resurrect a session whose disconnect arrived while locked', async () => {
      const order: string[] = [];
      mockDAppConnected.mockImplementation(async () => {
        order.push('connected');
      });
      (DAppConnectionStore.onDisconnected as jest.Mock).mockImplementation(async () => {
        order.push('disconnected');
      });
      NativeBridge.invalidateAuthorization();
      await handleBridge(connected('ghost'));
      await handleBridge({
        type: 'DAPP_DISCONNECTED',
        payload: { channelId: CHANNEL_ID, explicit: true },
      });
      NativeBridge.setNativeAuthorization(true);
      await settle();
      expect(order).toEqual(['disconnected']);
    });

    it('lets a held DAPP_CONNECTED expire', async () => {
      jest.useFakeTimers();
      NativeBridge.invalidateAuthorization();
      await handleBridge(connected('stale'));
      jest.advanceTimersByTime(121000);
      NativeBridge.setNativeAuthorization(true);
      await settle();
      expect(mockDAppConnected).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('keeps one held record per channel and refuses a flood of channels', async () => {
      NativeBridge.invalidateAuthorization();
      for (let i = 0; i < 40; i++) {
        const channelId = `${i.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
        await handleBridge(connected(`dapp-${i}`, channelId));
      }
      NativeBridge.setNativeAuthorization(true);
      await settle();
      expect(mockDAppConnected.mock.calls.length).toBeGreaterThan(0);
      expect(mockDAppConnected.mock.calls.length).toBeLessThanOrEqual(16);
    });

    it('drops held events when the document is replaced or the wallet is cleared', async () => {
      const show = jest.fn();
      NativeBridge.onDAppShowWebView(show);
      NativeBridge.invalidateAuthorization();
      await handleBridge({ type: 'DAPP_SHOW_WEBVIEW' });
      await handleBridge(connected('stale'));
      NativeBridge.resetWebAppReady();
      const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
      await authenticateNextDocument('ad'.repeat(16), send);
      NativeBridge.setNativeAuthorization(true);
      await settle();
      expect(show).not.toHaveBeenCalled();
      expect(mockDAppConnected).not.toHaveBeenCalled();
      send.mockRestore();
      NativeBridge.onDAppShowWebView(jest.fn());
    });

    it('lets a held DAPP_SHOW_WEBVIEW expire', async () => {
      jest.useFakeTimers();
      const show = jest.fn();
      NativeBridge.onDAppShowWebView(show);
      NativeBridge.invalidateAuthorization();
      await handleBridge({ type: 'DAPP_SHOW_WEBVIEW' });
      jest.advanceTimersByTime(121000);
      NativeBridge.setNativeAuthorization(true);
      await settle();
      expect(show).not.toHaveBeenCalled();
      NativeBridge.onDAppShowWebView(jest.fn());
      jest.useRealTimers();
    });
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

  it.each(['lock', 'wipe', 'expiry'])('cancels a bound pending dApp intent on %s', change => {
    jest.useFakeTimers();
    NativeBridge.invalidateAuthorization();
    NativeBridge.queueDAppURI('qrlconnect://?q=pending-fixture');
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
    if (change === 'lock') NativeBridge.invalidateAuthorization();
    if (change === 'wipe') { NativeBridge.beginWalletClear(); NativeBridge.endWalletClear(); }
    if (change === 'expiry') jest.advanceTimersByTime(120000);
    NativeBridge.setNativeAuthorization(true);
    expect(send.mock.calls.filter(([message]) => message.type === 'DAPP_URI')).toHaveLength(0);
    NativeBridge.cancelPendingDAppIntent();
    send.mockRestore();
    jest.useRealTimers();
  });

  async function authenticateNextDocument(documentId: string, send: jest.SpyInstance): Promise<void> {
    await nativeHandle({ type: 'WEB_APP_READY', payload: { documentId } });
    const challenge = send.mock.calls.find(([message]) => message.type === 'WEB_DOCUMENT_CHALLENGE')?.[0];
    await nativeHandle({ type: 'WEB_DOCUMENT_READY', payload: challenge?.payload });
  }
  const sentUris = (send: jest.SpyInstance) =>
    send.mock.calls.filter(([message]) => message.type === 'DAPP_URI').map(([message]) => message.payload.uri);

  it('keeps a pending dApp intent across a document reset and delivers it to the next document after unlock', async () => {
    // iOS can kill the WebView content process while the user is in the dApp's browser.
    NativeBridge.invalidateAuthorization();
    expect(NativeBridge.queueDAppURI('qrlconnect://?q=reset-fixture')).toBe(true);
    NativeBridge.resetWebAppReady();
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
    await authenticateNextDocument('ab'.repeat(16), send);
    expect(sentUris(send)).toEqual([]);
    NativeBridge.setNativeAuthorization(true);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(sentUris(send)).toEqual(['qrlconnect://?q=reset-fixture']);
    send.mockRestore();
  });

  it('keeps the 120 s expiry after a document reset', async () => {
    jest.useFakeTimers();
    NativeBridge.invalidateAuthorization();
    NativeBridge.queueDAppURI('qrlconnect://?q=ttl-fixture');
    NativeBridge.resetWebAppReady();
    jest.advanceTimersByTime(120000);
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
    jest.useRealTimers();
    await authenticateNextDocument('ac'.repeat(16), send);
    NativeBridge.setNativeAuthorization(true);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(sentUris(send)).toEqual([]);
    send.mockRestore();
  });

  it('abandons a stuck authorized sync so a later attempt can deliver the intent', async () => {
    jest.useFakeTimers();
    NativeBridge.invalidateAuthorization();
    mockGetUserPreferences.mockImplementationOnce(() => new Promise(() => undefined));
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
    NativeBridge.queueDAppURI('qrlconnect://?q=stuck-fixture');
    NativeBridge.setNativeAuthorization(true);
    await jest.advanceTimersByTimeAsync(20000);
    expect(sentUris(send)).toEqual([]);
    await jest.advanceTimersByTimeAsync(11000);
    expect(mockError).toHaveBeenCalledWith('NativeBridge', expect.stringContaining('timed out'));
    NativeBridge.invalidateAuthorization({ preservePendingDAppIntent: true });
    NativeBridge.setNativeAuthorization(true);
    await jest.advanceTimersByTimeAsync(1000);
    expect(sentUris(send)).toEqual(['qrlconnect://?q=stuck-fixture']);
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

  describe('sensitive clipboard payloads', () => {
    const mockGetStringAsync = Clipboard.getStringAsync as jest.MockedFunction<
      typeof Clipboard.getStringAsync
    >;
    const seed = 'absent squirrel gallery pledge ancient scatter marble ribbon';

    beforeEach(() => {
      jest.useFakeTimers();
      mockSetStringAsync.mockResolvedValue(undefined as never);
      mockGetStringAsync.mockResolvedValue(seed);
    });
    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    });

    it('keeps seed material out of the reply and off the clipboard', async () => {
      // Keyboard apps with clipboard history, clipboard managers and the
      // Android clipboard preview all retain whatever is on it.
      const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => undefined);

      await handleBridge({ type: 'COPY_TO_CLIPBOARD', payload: { text: seed, sensitive: true } });

      expect(mockSetStringAsync).toHaveBeenCalledWith(seed);
      // No echo: the reply carries no payload at all.
      expect(send).toHaveBeenCalledWith({ type: 'CLIPBOARD_SUCCESS' });
      expect(JSON.stringify(send.mock.calls)).not.toContain(seed);

      mockSetStringAsync.mockClear();
      await jest.advanceTimersByTimeAsync(60000);
      expect(mockSetStringAsync).toHaveBeenCalledWith('');
      send.mockRestore();
    });

    it('leaves alone whatever the user copied since', async () => {
      const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => undefined);
      await handleBridge({ type: 'COPY_TO_CLIPBOARD', payload: { text: seed, sensitive: true } });

      mockGetStringAsync.mockResolvedValue('something the user copied later');
      mockSetStringAsync.mockClear();
      await jest.advanceTimersByTimeAsync(60000);
      expect(mockSetStringAsync).not.toHaveBeenCalled();
      send.mockRestore();
    });

    it('treats an ordinary copy as before', async () => {
      const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => undefined);
      await handleBridge({ type: 'COPY_TO_CLIPBOARD', payload: { text: 'Q0123', sensitive: false } });

      expect(send).toHaveBeenCalledWith({
        type: 'CLIPBOARD_SUCCESS',
        payload: { text: 'Q0123' },
      });
      mockSetStringAsync.mockClear();
      await jest.advanceTimersByTimeAsync(60000);
      expect(mockSetStringAsync).not.toHaveBeenCalled();
      send.mockRestore();
    });
  });
});
