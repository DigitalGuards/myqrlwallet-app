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

import NativeBridge, { type BridgeMessage } from '../NativeBridge';
import SeedStorageService from '../SeedStorageService';
import DAppConnectionStore from '../DAppConnectionStore';
import * as Crypto from 'expo-crypto';
import type WebView from 'react-native-webview';

const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';
const mockGetDeviceCredential = jest.spyOn(SeedStorageService, 'getDeviceCredential');
const mockGetPendingWalletWipe = jest.spyOn(SeedStorageService, 'getPendingWalletWipe');
const mockOnDisconnected = jest.spyOn(DAppConnectionStore, 'onDisconnected');
const mockRandomBytes = jest.mocked(Crypto).getRandomBytes;
const DOCUMENT_ID = 'de'.repeat(16);
const nativeHandle = NativeBridge.handle.bind(NativeBridge);

async function authenticateDocument(): Promise<void> {
  const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
  await nativeHandle({ type: 'WEB_APP_READY', payload: { documentId: DOCUMENT_ID } });
  const challenge = send.mock.calls
    .map(([message]) => message)
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
  if (message.type === 'WEB_APP_READY') return authenticateDocument();
  return nativeHandle({
    ...message,
    payload: { ...(message.payload ?? {}), documentId: DOCUMENT_ID },
  });
}

function requestPayload(
  send: jest.SpiedFunction<typeof NativeBridge.sendToWeb>,
  type: string,
): Record<string, unknown> {
  const message = send.mock.calls
    .map(([value]) => value)
    .find((value) => value.type === type);
  if (!message?.payload) throw new Error(`${type} was not sent`);
  return message.payload;
}

describe('NativeBridge correlation and generation boundaries', () => {
  beforeEach(async () => {
    NativeBridge.resetWebAppReady();
    NativeBridge.endWalletClear();
    NativeBridge.setNativeAuthorization(true);
    await authenticateDocument();
    jest.clearAllMocks();
    mockRandomBytes.mockImplementation(() => new Uint8Array(16).fill(1));
    mockGetPendingWalletWipe.mockResolvedValue(null);
    mockOnDisconnected.mockResolvedValue(undefined);
  });

  it('accepts only the matching PIN verification response', async () => {
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
    const verification = NativeBridge.verifyPin('1234');
    await Promise.resolve();
    const payload = requestPayload(send, 'VERIFY_PIN');
    const requestId = payload.requestId;

    let settled = false;
    void verification.then(() => {
      settled = true;
    });
    await handleBridge({
      type: 'PIN_VERIFIED',
      payload: { requestId: 'ff'.repeat(16), success: true },
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await handleBridge({ type: 'PIN_VERIFIED', payload: { requestId, success: true } });
    await expect(verification).resolves.toEqual({ success: true, error: undefined });
    send.mockRestore();
  });

  it('settles PIN verification on document reset and drops the late response', async () => {
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
    const verification = NativeBridge.verifyPin('1234');
    await Promise.resolve();
    const requestId = requestPayload(send, 'VERIFY_PIN').requestId;

    NativeBridge.resetWebAppReady();
    await expect(verification).resolves.toEqual({
      success: false,
      error: 'Web app document changed',
    });
    await handleBridge({ type: 'PIN_VERIFIED', payload: { requestId, success: true } });
    send.mockRestore();
  });

  it('does not inject an unlock PIN across a document generation', async () => {
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
    const staleContext = NativeBridge.captureSecurityContext();
    expect(NativeBridge.sendUnlockWithPinForContext('1234', staleContext)).toBe(true);

    NativeBridge.resetWebAppReady();
    NativeBridge.setNativeAuthorization(true);
    await handleBridge({ type: 'WEB_APP_READY' });
    send.mockClear();

    expect(NativeBridge.sendUnlockWithPinForContext('1234', staleContext)).toBe(false);
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UNLOCK_WITH_PIN' }));
    send.mockRestore();
  });

  it('settles a correlated disconnect when the document resets', async () => {
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
    const disconnect = NativeBridge.requestDAppDisconnect(CHANNEL_ID);
    await Promise.resolve();
    requestPayload(send, 'DAPP_DISCONNECT');

    NativeBridge.resetWebAppReady();
    await expect(disconnect).resolves.toEqual({
      success: false,
      error: 'Web app document changed',
    });
    send.mockRestore();
  });

  it('does not send a disconnect if native authorization changes while readiness is pending', async () => {
    NativeBridge.resetWebAppReady();
    NativeBridge.setNativeAuthorization(true);
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
    const disconnect = NativeBridge.requestDAppDisconnect(CHANNEL_ID);
    await Promise.resolve();

    NativeBridge.invalidateAuthorization();
    await nativeHandle({ type: 'WEB_APP_READY', payload: { documentId: DOCUMENT_ID } });
    const challengeId = requestPayload(send, 'WEB_DOCUMENT_CHALLENGE').challengeId;
    await nativeHandle({
      type: 'WEB_DOCUMENT_READY',
      payload: { documentId: DOCUMENT_ID, challengeId },
    });

    await expect(disconnect).resolves.toEqual({
      success: false,
      error: 'App authorization changed. Please try again.',
    });
    expect(
      send.mock.calls.some(
        ([message]) => message.type === 'DAPP_DISCONNECT',
      ),
    ).toBe(false);
    send.mockRestore();
  });

  it('reports disconnect success only after native persistence completes', async () => {
    let resolveWrite: (() => void) | undefined;
    mockOnDisconnected.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveWrite = resolve;
      }),
    );
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
    const disconnect = NativeBridge.requestDAppDisconnect(CHANNEL_ID);
    await Promise.resolve();
    const requestId = requestPayload(send, 'DAPP_DISCONNECT').requestId;

    let settled = false;
    void disconnect.then(() => {
      settled = true;
    });
    const response = handleBridge({
      type: 'DAPP_DISCONNECT_RESPONSE',
      payload: { requestId, channelId: CHANNEL_ID, success: true },
    });
    for (let iteration = 0; iteration < 10 && !resolveWrite; iteration += 1) {
      await Promise.resolve();
    }
    expect(settled).toBe(false);

    expect(resolveWrite).toBeDefined();
    resolveWrite?.();
    await response;
    await expect(disconnect).resolves.toEqual({ success: true, error: undefined });
    send.mockRestore();
  });

  it('drops privileged bridge requests while the native lock is active', async () => {
    NativeBridge.invalidateAuthorization();
    await handleBridge({
      type: 'DEVICE_CREDENTIAL_REQUEST',
      payload: { requestId: 'aa'.repeat(16), createIfMissing: false },
    });
    expect(mockGetDeviceCredential).not.toHaveBeenCalled();
  });

  it('records a dApp disconnect while the native lock is active', async () => {
    NativeBridge.invalidateAuthorization();
    await handleBridge({
      type: 'DAPP_DISCONNECTED',
      payload: { channelId: CHANNEL_ID, explicit: true },
    });
    expect(mockOnDisconnected).toHaveBeenCalledWith(CHANNEL_ID, true);
  });

  it('authenticates only the document that echoes its exact post-reset challenge', async () => {
    let randomByte = 2;
    mockRandomBytes.mockImplementation(() => new Uint8Array(16).fill(randomByte++));
    NativeBridge.resetWebAppReady();
    NativeBridge.setNativeAuthorization(true);
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);

    await nativeHandle({ type: 'WEB_APP_READY', payload: { documentId: DOCUMENT_ID } });
    const preResetChallenge = send.mock.calls
      .map(([message]) => message)
      .find((message) => message.type === 'WEB_DOCUMENT_CHALLENGE')?.payload?.challengeId;
    expect(typeof preResetChallenge).toBe('string');

    NativeBridge.resetWebAppReady();
    NativeBridge.setNativeAuthorization(true);
    send.mockClear();
    const staleDocumentId = 'aa'.repeat(16);
    const newDocumentId = 'bb'.repeat(16);
    await nativeHandle({ type: 'WEB_APP_READY', payload: { documentId: staleDocumentId } });
    await nativeHandle({ type: 'WEB_APP_READY', payload: { documentId: newDocumentId } });
    const challenges = send.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === 'WEB_DOCUMENT_CHALLENGE');
    const newChallenge = challenges.find(
      (message) => message.payload?.documentId === newDocumentId,
    )?.payload?.challengeId;
    expect(typeof newChallenge).toBe('string');

    await nativeHandle({
      type: 'WEB_DOCUMENT_READY',
      payload: {
        documentId: DOCUMENT_ID,
        challengeId: preResetChallenge,
      },
    });
    expect(NativeBridge.getIsWebAppReady()).toBe(false);

    await nativeHandle({
      type: 'WEB_DOCUMENT_READY',
      payload: { documentId: newDocumentId, challengeId: newChallenge },
    });
    expect(NativeBridge.getIsWebAppReady()).toBe(true);
    send.mockRestore();

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
    expect(
      NativeBridge.sendToWeb({ type: 'ERROR', payload: { message: 'bound message' } }),
    ).toBe(true);
    expect(injectJavaScript.mock.calls[0]?.[0]).toContain(newDocumentId);
  });

  it('coalesces duplicate ready signals and still rejects a well-formed wrong challenge', async () => {
    mockRandomBytes.mockImplementation(() => new Uint8Array(16).fill(20));
    NativeBridge.resetWebAppReady();
    NativeBridge.setNativeAuthorization(true);
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);

    await nativeHandle({ type: 'WEB_APP_READY', payload: { documentId: DOCUMENT_ID } });
    await nativeHandle({ type: 'WEB_APP_READY', payload: { documentId: DOCUMENT_ID } });
    const challenges = send.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === 'WEB_DOCUMENT_CHALLENGE');
    const challengeId = challenges[0]?.payload?.challengeId;
    expect(challenges[1]?.payload?.challengeId).toBe(challengeId);
    expect(mockRandomBytes).toHaveBeenCalledTimes(1);

    await nativeHandle({
      type: 'WEB_DOCUMENT_READY',
      payload: { documentId: DOCUMENT_ID, challengeId: 'ff'.repeat(16) },
    });
    expect(NativeBridge.getIsWebAppReady()).toBe(false);

    await nativeHandle({
      type: 'WEB_DOCUMENT_READY',
      payload: { documentId: DOCUMENT_ID, challengeId },
    });
    expect(NativeBridge.getIsWebAppReady()).toBe(true);
    send.mockClear();
    await nativeHandle({ type: 'WEB_APP_READY', payload: { documentId: DOCUMENT_ID } });
    expect(send).not.toHaveBeenCalled();
    send.mockRestore();
  });

  it('keeps a slow journal check live across the frontend readiness retry interval', async () => {
    let resolveJournalRead: ((value: null) => void) | undefined;
    mockGetPendingWalletWipe.mockImplementationOnce(
      () =>
        new Promise<null>((resolve) => {
          resolveJournalRead = resolve;
        }),
    );
    mockRandomBytes.mockImplementation(() => new Uint8Array(16).fill(40));
    NativeBridge.resetWebAppReady();
    NativeBridge.setNativeAuthorization(true);
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);

    await nativeHandle({ type: 'WEB_APP_READY', payload: { documentId: DOCUMENT_ID } });
    const firstChallenge = requestPayload(send, 'WEB_DOCUMENT_CHALLENGE').challengeId;
    const pendingEcho = nativeHandle({
      type: 'WEB_DOCUMENT_READY',
      payload: { documentId: DOCUMENT_ID, challengeId: firstChallenge },
    });
    for (let iteration = 0; iteration < 10 && !resolveJournalRead; iteration += 1) {
      await Promise.resolve();
    }
    expect(resolveJournalRead).toBeDefined();

    send.mockClear();
    await nativeHandle({ type: 'WEB_APP_READY', payload: { documentId: DOCUMENT_ID } });
    const retriedChallenge = requestPayload(send, 'WEB_DOCUMENT_CHALLENGE').challengeId;
    expect(retriedChallenge).toBe(firstChallenge);
    expect(mockRandomBytes).toHaveBeenCalledTimes(1);
    resolveJournalRead?.(null);
    await pendingEcho;
    expect(NativeBridge.getIsWebAppReady()).toBe(true);
    send.mockRestore();
  });
});
