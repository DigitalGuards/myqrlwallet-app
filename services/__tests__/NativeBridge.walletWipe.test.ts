jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
  Share: { share: jest.fn() },
  Platform: { OS: 'ios' },
  Linking: { canOpenURL: jest.fn(), openURL: jest.fn() },
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ getRandomBytes: jest.fn(() => new Uint8Array(16).fill(2)) }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('../SeedStorageService', () => ({
  __esModule: true,
  default: {
    getPendingWalletWipe: jest.fn(async () => null),
    beginWalletWipe: jest.fn(async (requestId: string) => ({
      version: 1,
      requestId,
      startedAt: 1,
    })),
    clearWallet: jest.fn(async () => undefined),
    completeWalletWipe: jest.fn(async () => undefined),
  },
}));
jest.mock('../DAppConnectionStore', () => ({
  __esModule: true,
  default: {
    clear: jest.fn(async () => undefined),
  },
}));
jest.mock('../WebViewService', () => ({
  __esModule: true,
  default: {
    clearContactsBackupStrict: jest.fn(async () => undefined),
    getUserPreferences: jest.fn(async () => ({})),
    getContactsBackup: jest.fn(async () => null),
  },
}));
jest.mock('../Logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import NativeBridge, { BridgeMessage } from '../NativeBridge';
import SeedStorageService from '../SeedStorageService';
import DAppConnectionStore from '../DAppConnectionStore';
import WebViewService from '../WebViewService';

const mockGetPending = SeedStorageService.getPendingWalletWipe as jest.MockedFunction<
  typeof SeedStorageService.getPendingWalletWipe
>;
const mockBegin = SeedStorageService.beginWalletWipe as jest.MockedFunction<
  typeof SeedStorageService.beginWalletWipe
>;
const mockClear = SeedStorageService.clearWallet as jest.MockedFunction<
  typeof SeedStorageService.clearWallet
>;
const mockComplete = SeedStorageService.completeWalletWipe as jest.MockedFunction<
  typeof SeedStorageService.completeWalletWipe
>;
const mockClearDApps = DAppConnectionStore.clear as jest.MockedFunction<
  typeof DAppConnectionStore.clear
>;
const mockClearContacts = WebViewService.clearContactsBackupStrict as jest.MockedFunction<
  typeof WebViewService.clearContactsBackupStrict
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

async function waitForClearRequest(send: jest.SpyInstance): Promise<Record<string, unknown>> {
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const message = send.mock.calls
      .map(([value]) => value as { type?: string; payload?: Record<string, unknown> })
      .find((value) => value.type === 'CLEAR_WALLET');
    if (message?.payload) return message.payload;
    await Promise.resolve();
  }
  throw new Error('CLEAR_WALLET was not sent');
}

describe('NativeBridge durable wallet wipe', () => {
  beforeEach(async () => {
    NativeBridge.resetWebAppReady();
    NativeBridge.endWalletClear();
    mockGetPending.mockResolvedValue(null);
    NativeBridge.setNativeAuthorization(true);
    await authenticateDocument();
    jest.clearAllMocks();
    mockGetPending.mockResolvedValue(null);
    mockBegin.mockImplementation(async (requestId: string) => ({
      version: 1,
      requestId,
      startedAt: 1,
    }));
    mockClear.mockResolvedValue(undefined);
    mockComplete.mockResolvedValue(undefined);
    mockClearDApps.mockResolvedValue(undefined);
    mockClearContacts.mockResolvedValue(undefined);
  });

  it('requires the exact hosted-wallet acknowledgement before completing the journal', async () => {
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
    const wipe = NativeBridge.clearWalletDurably();
    const request = await waitForClearRequest(send);
    const requestId = request.requestId as string;

    expect(mockBegin).toHaveBeenCalledWith(requestId);
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(mockClearContacts).toHaveBeenCalledTimes(1);
    expect(mockComplete).not.toHaveBeenCalled();

    await handleBridge({
      type: 'WALLET_CLEARED',
      payload: { requestId: 'ff'.repeat(16), success: true },
    });
    expect(mockComplete).not.toHaveBeenCalled();

    await handleBridge({
      type: 'WALLET_CLEARED',
      payload: { requestId, success: true },
    });
    await expect(wipe).resolves.toBeUndefined();
    expect(mockClearDApps).toHaveBeenCalledTimes(1);
    expect(mockComplete).toHaveBeenCalledWith(requestId);
    send.mockRestore();
  });

  it('leaves the durable journal pending when hosted-wallet deletion fails', async () => {
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
    const wipe = NativeBridge.clearWalletDurably();
    const requestId = (await waitForClearRequest(send)).requestId as string;

    await handleBridge({
      type: 'WALLET_CLEARED',
      payload: { requestId, success: false, error: 'delete failed' },
    });
    await expect(wipe).rejects.toThrow('delete failed');
    expect(mockClearDApps).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
    send.mockRestore();
  });
});
