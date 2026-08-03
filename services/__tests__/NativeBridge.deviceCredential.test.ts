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
    getDeviceCredential: jest.fn(),
    getOrCreateDeviceCredential: jest.fn(),
    backupSeed: jest.fn(),
    storePinSecurely: jest.fn(),
    getPendingWalletWipe: jest.fn(async () => null),
  },
}));
jest.mock('../DAppConnectionStore', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('../WebViewService', () => ({
  __esModule: true,
  default: {
    getUserPreferences: jest.fn(async () => ({})),
    getContactsBackup: jest.fn(async () => null),
  },
}));
jest.mock('../Logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import NativeBridge, {
  BridgeMessage,
  NATIVE_PIN_CHANGE_AMBIGUOUS_ERROR,
  NATIVE_PIN_COMMIT_ERROR,
} from '../NativeBridge';
import SeedStorageService from '../SeedStorageService';

const mockGetDeviceCredential =
  SeedStorageService.getDeviceCredential as jest.MockedFunction<
    typeof SeedStorageService.getDeviceCredential
  >;
const mockGetOrCreate =
  SeedStorageService.getOrCreateDeviceCredential as jest.MockedFunction<
    typeof SeedStorageService.getOrCreateDeviceCredential
  >;
const mockBackupSeed = SeedStorageService.backupSeed as jest.MockedFunction<
  typeof SeedStorageService.backupSeed
>;
const mockStorePin = SeedStorageService.storePinSecurely as jest.MockedFunction<
  typeof SeedStorageService.storePinSecurely
>;

const REQUEST_ID = '12'.repeat(16);
const CREDENTIAL = 'ab'.repeat(32);
const ADDRESS = `Q${'12'.repeat(20)}`;
const CIPHERTEXT_HASH = 'cd'.repeat(32);
const DOCUMENT_ID = 'de'.repeat(16);
const nativeHandle = NativeBridge.handle.bind(NativeBridge);

async function authenticateDocument(): Promise<void> {
  if (NativeBridge.getIsWebAppReady()) return;
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
  if (message.type === 'WEB_APP_READY') return authenticateDocument();
  return nativeHandle({
    ...message,
    payload: { ...(message.payload ?? {}), documentId: DOCUMENT_ID },
  });
}

function lastPinChangeRequestId(send: jest.SpyInstance): string {
  const message = [...send.mock.calls]
    .reverse()
    .map(call => call[0] as { type?: string; payload?: Record<string, unknown> })
    .find(candidate => candidate.type === 'CHANGE_PIN');
  const requestId = message?.payload?.requestId;
  if (typeof requestId !== 'string') throw new Error('CHANGE_PIN requestId was not sent');
  return requestId;
}

describe('NativeBridge device credential protocol', () => {
  beforeEach(async () => {
    NativeBridge.resetWebAppReady();
    NativeBridge.endWalletClear();
    NativeBridge.setNativeAuthorization(true);
    await authenticateDocument();
    jest.clearAllMocks();
    mockStorePin.mockResolvedValue(undefined);
  });

  it('returns a credential only after SecureStore get-or-create resolves', async () => {
    mockGetOrCreate.mockResolvedValue(CREDENTIAL);
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => undefined);

    await handleBridge({
      type: 'DEVICE_CREDENTIAL_REQUEST',
      payload: { requestId: REQUEST_ID, createIfMissing: true, candidate: CREDENTIAL },
    });

    expect(mockGetOrCreate).toHaveBeenCalledWith(CREDENTIAL);
    expect(send).toHaveBeenCalledWith({
      type: 'DEVICE_CREDENTIAL_RESPONSE',
      payload: { requestId: REQUEST_ID, credential: CREDENTIAL },
    });
    send.mockRestore();
  });

  it('does not create a replacement when decryption asks for an existing factor', async () => {
    mockGetDeviceCredential.mockResolvedValue(null);
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => undefined);

    await handleBridge({
      type: 'DEVICE_CREDENTIAL_REQUEST',
      payload: { requestId: REQUEST_ID, createIfMissing: false },
    });

    expect(mockGetOrCreate).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({
      type: 'DEVICE_CREDENTIAL_RESPONSE',
      payload: { requestId: REQUEST_ID, error: 'NOT_FOUND' },
    });
    send.mockRestore();
  });

  it('injects a PIN only after the current WebView is ready', async () => {
    NativeBridge.resetWebAppReady();
    NativeBridge.setNativeAuthorization(true);
    const context = NativeBridge.captureSecurityContext();
    const preReadySend = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);

    expect(NativeBridge.sendUnlockWithPinIfReady('1234', context)).toBe(false);
    expect(preReadySend).not.toHaveBeenCalled();
    preReadySend.mockRestore();

    await handleBridge({ type: 'WEB_APP_READY' });
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => true);
    expect(NativeBridge.sendUnlockWithPinIfReady('1234', context)).toBe(true);
    expect(send).toHaveBeenCalledWith({
      type: 'UNLOCK_WITH_PIN',
      payload: { pin: '1234' },
    });
    send.mockRestore();
  });

  it('rejects malformed candidates before secure storage is touched', async () => {
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => undefined);
    await handleBridge({
      type: 'DEVICE_CREDENTIAL_REQUEST',
      payload: { requestId: REQUEST_ID, createIfMissing: true, candidate: 'abcd' },
    });

    expect(mockGetOrCreate).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({
      type: 'DEVICE_CREDENTIAL_RESPONSE',
      payload: { requestId: REQUEST_ID, error: 'INVALID_REQUEST' },
    });
    send.mockRestore();
  });

  it('acknowledges an exact seed revision only after backup persistence resolves', async () => {
    let releaseBackup!: () => void;
    mockBackupSeed.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseBackup = () =>
          resolve({
            address: ADDRESS,
            encryptedSeed: 'ciphertext',
            blockchain: 'TEST_NET',
            revision: 7,
            ciphertextHash: CIPHERTEXT_HASH,
            storedAt: 1,
          });
      }),
    );
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => undefined);

    const handled = handleBridge({
      type: 'SEED_STORED',
      payload: {
        requestId: REQUEST_ID,
        address: ADDRESS,
        encryptedSeed: 'ciphertext',
        blockchain: 'TEST_NET',
        revision: 7,
        ciphertextHash: CIPHERTEXT_HASH,
      },
    });
    expect(send).not.toHaveBeenCalled();
    releaseBackup();
    await handled;

    expect(mockBackupSeed).toHaveBeenCalledWith(
      ADDRESS,
      'ciphertext',
      'TEST_NET',
      7,
      CIPHERTEXT_HASH,
    );
    expect(send).toHaveBeenCalledWith({
      type: 'SEED_STORED_RESPONSE',
      payload: {
        requestId: REQUEST_ID,
        success: true,
        revision: 7,
        ciphertextHash: CIPHERTEXT_HASH,
      },
    });
    send.mockRestore();
  });

  it('rejects a lowercase-q seed address before native persistence', async () => {
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => undefined);

    await handleBridge({
      type: 'SEED_STORED',
      payload: {
        requestId: REQUEST_ID,
        address: `q${'12'.repeat(20)}`,
        encryptedSeed: 'ciphertext',
        blockchain: 'TEST_NET',
        revision: 7,
        ciphertextHash: CIPHERTEXT_HASH,
      },
    });

    expect(mockBackupSeed).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({
      type: 'SEED_STORED_RESPONSE',
      payload: {
        requestId: REQUEST_ID,
        success: false,
        error: 'INVALID_REQUEST',
      },
    });
    send.mockRestore();
  });

  it('returns a correlated failure when durable seed backup fails', async () => {
    mockBackupSeed.mockRejectedValueOnce(new Error('disk full'));
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => undefined);

    await handleBridge({
      type: 'SEED_STORED',
      payload: {
        requestId: REQUEST_ID,
        address: ADDRESS,
        encryptedSeed: 'ciphertext',
        blockchain: 'MAIN_NET',
        revision: 3,
        ciphertextHash: CIPHERTEXT_HASH,
      },
    });

    expect(send).toHaveBeenCalledWith({
      type: 'SEED_STORED_RESPONSE',
      payload: {
        requestId: REQUEST_ID,
        success: false,
        revision: 3,
        ciphertextHash: CIPHERTEXT_HASH,
        error: 'STORAGE_ERROR',
      },
    });
    send.mockRestore();
  });

  it('commits only the expected new global PIN after web backup success', async () => {
    await handleBridge({ type: 'WEB_APP_READY' });
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => undefined);
    const change = NativeBridge.changePin('1234', '5678');
    await Promise.resolve();
    const requestId = lastPinChangeRequestId(send);

    await handleBridge({
      type: 'PIN_CHANGED',
      payload: { requestId, success: true, newPin: '5678' },
    });

    await expect(change).resolves.toEqual({ success: true, error: undefined });
    expect(mockStorePin).toHaveBeenCalledWith('5678');
    send.mockRestore();
  });

  it('rejects a PIN_CHANGED response that does not match the pending request', async () => {
    await handleBridge({ type: 'WEB_APP_READY' });
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => undefined);
    const change = NativeBridge.changePin('1234', '5678');
    await Promise.resolve();
    const requestId = lastPinChangeRequestId(send);

    await handleBridge({
      type: 'PIN_CHANGED',
      payload: { requestId, success: true, newPin: '9999' },
    });

    await expect(change).resolves.toEqual({
      success: false,
      error: 'PIN change response did not match the pending request',
    });
    expect(mockStorePin).not.toHaveBeenCalled();
    send.mockRestore();
  });

  it('fails the request when the expected PIN cannot be committed securely', async () => {
    mockStorePin.mockRejectedValueOnce(new Error('secure store unavailable'));
    await handleBridge({ type: 'WEB_APP_READY' });
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => undefined);
    const change = NativeBridge.changePin('1234', '5678');
    await Promise.resolve();
    const requestId = lastPinChangeRequestId(send);

    await handleBridge({
      type: 'PIN_CHANGED',
      payload: { requestId, success: true, newPin: '5678' },
    });

    await expect(change).resolves.toEqual({
      success: false,
      error: NATIVE_PIN_COMMIT_ERROR,
    });
    send.mockRestore();
  });

  it('compensates a secure PIN write that committed before reporting failure', async () => {
    let effectiveSecurePin = '1234';
    let effectiveCiphertextPin = '1234';
    mockStorePin
      .mockImplementationOnce(async pin => {
        effectiveSecurePin = pin;
        throw new Error('marker write failed after secure commit');
      })
      .mockImplementationOnce(async pin => {
        effectiveSecurePin = pin;
      });
    await handleBridge({ type: 'WEB_APP_READY' });
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => undefined);

    const original = NativeBridge.changePin('1234', '5678');
    await Promise.resolve();
    const originalRequestId = lastPinChangeRequestId(send);
    effectiveCiphertextPin = '5678';
    await handleBridge({
      type: 'PIN_CHANGED',
      payload: { requestId: originalRequestId, success: true, newPin: '5678' },
    });
    await expect(original).resolves.toEqual({
      success: false,
      error: NATIVE_PIN_COMMIT_ERROR,
    });
    expect(effectiveSecurePin).toBe('5678');

    const compensation = NativeBridge.changePin('5678', '1234', {
      acceptAlreadyTarget: true,
    });
    await Promise.resolve();
    const compensationRequestId = lastPinChangeRequestId(send);
    expect(compensationRequestId).not.toBe(originalRequestId);

    // Re-delivery of the original ACK is harmless while compensation owns the
    // request slot.
    await handleBridge({
      type: 'PIN_CHANGED',
      payload: { requestId: originalRequestId, success: true, newPin: '5678' },
    });
    effectiveCiphertextPin = '1234';
    await handleBridge({
      type: 'PIN_CHANGED',
      payload: { requestId: compensationRequestId, success: true, newPin: '1234' },
    });
    await expect(compensation).resolves.toEqual({ success: true, error: undefined });

    expect(effectiveCiphertextPin).toBe('1234');
    expect(effectiveSecurePin).toBe('1234');
    expect(mockStorePin.mock.calls.map(([pin]) => pin)).toEqual(['5678', '1234']);
    send.mockRestore();
  });

  it('ignores unsolicited PIN_CHANGED messages instead of storing their PIN', async () => {
    await handleBridge({
      type: 'PIN_CHANGED',
      payload: { requestId: REQUEST_ID, success: true, newPin: '9999' },
    });

    expect(mockStorePin).not.toHaveBeenCalled();
  });

  it('reserves a PIN change before readiness work so concurrent requests cannot race', async () => {
    await handleBridge({ type: 'WEB_APP_READY' });
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => undefined);
    const first = NativeBridge.changePin('1234', '5678');
    const second = NativeBridge.changePin('1234', '9999');

    await expect(second).resolves.toEqual({
      success: false,
      error: 'A PIN change is already in progress',
    });
    await Promise.resolve();
    const requestId = lastPinChangeRequestId(send);
    await handleBridge({
      type: 'PIN_CHANGED',
      payload: { requestId, success: false, error: 'cancelled' },
    });
    await expect(first).resolves.toEqual({ success: false, error: 'cancelled' });
    send.mockRestore();
  });

  it('ignores a late success after timeout and commits only the compensation target', async () => {
    jest.useFakeTimers();
    try {
      await handleBridge({ type: 'WEB_APP_READY' });
      const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => undefined);
      const original = NativeBridge.changePin('1234', '5678', { timeoutMs: 10 });
      await Promise.resolve();
      const originalRequestId = lastPinChangeRequestId(send);

      jest.advanceTimersByTime(10);
      await expect(original).resolves.toEqual({
        success: false,
        error: NATIVE_PIN_CHANGE_AMBIGUOUS_ERROR,
      });

      const compensation = NativeBridge.changePin('5678', '1234', {
        timeoutMs: 100,
        acceptAlreadyTarget: true,
      });
      await Promise.resolve();
      const compensationRequestId = lastPinChangeRequestId(send);
      expect(compensationRequestId).not.toBe(originalRequestId);
      expect(send).toHaveBeenLastCalledWith({
        type: 'CHANGE_PIN',
        payload: {
          requestId: compensationRequestId,
          oldPin: '5678',
          newPin: '1234',
          acceptAlreadyTarget: true,
        },
      });

      // Model the original web rotation committing before timeout while its
      // acknowledgement is delivered only after compensation has started.
      await handleBridge({
        type: 'PIN_CHANGED',
        payload: { requestId: originalRequestId, success: true, newPin: '5678' },
      });
      expect(mockStorePin).not.toHaveBeenCalled();

      await handleBridge({
        type: 'PIN_CHANGED',
        payload: { requestId: compensationRequestId, success: true, newPin: '1234' },
      });
      await expect(compensation).resolves.toEqual({ success: true, error: undefined });
      expect(mockStorePin).toHaveBeenCalledTimes(1);
      expect(mockStorePin).toHaveBeenCalledWith('1234');
      send.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });

  it('orders compensation after a PIN commit that is still pending at timeout', async () => {
    jest.useFakeTimers();
    try {
      let releaseNewPinCommit!: () => void;
      const newPinCommitBlocked = new Promise<void>(resolve => {
        releaseNewPinCommit = resolve;
      });
      mockStorePin.mockImplementation(pin =>
        pin === '5678' ? newPinCommitBlocked : Promise.resolve(),
      );
      await handleBridge({ type: 'WEB_APP_READY' });
      const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => undefined);
      const original = NativeBridge.changePin('1234', '5678', { timeoutMs: 10 });
      await Promise.resolve();
      const originalRequestId = lastPinChangeRequestId(send);

      const originalResponse = handleBridge({
        type: 'PIN_CHANGED',
        payload: { requestId: originalRequestId, success: true, newPin: '5678' },
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(mockStorePin).toHaveBeenCalledWith('5678');

      jest.advanceTimersByTime(10);
      await expect(original).resolves.toEqual({
        success: false,
        error: NATIVE_PIN_CHANGE_AMBIGUOUS_ERROR,
      });

      const compensation = NativeBridge.changePin('5678', '1234', {
        timeoutMs: 100,
        acceptAlreadyTarget: true,
      });
      await Promise.resolve();
      const compensationRequestId = lastPinChangeRequestId(send);
      const compensationResponse = handleBridge({
        type: 'PIN_CHANGED',
        payload: { requestId: compensationRequestId, success: true, newPin: '1234' },
      });
      await Promise.resolve();
      expect(mockStorePin).toHaveBeenCalledTimes(1);

      releaseNewPinCommit();
      await Promise.all([originalResponse, compensationResponse]);
      await expect(compensation).resolves.toEqual({ success: true, error: undefined });
      expect(mockStorePin.mock.calls.map(([pin]) => pin)).toEqual(['5678', '1234']);
      send.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });

  it('invalidates a pending PIN change before wipe and ignores its late response', async () => {
    await handleBridge({ type: 'WEB_APP_READY' });
    const send = jest.spyOn(NativeBridge, 'sendToWeb').mockImplementation(() => undefined);
    const change = NativeBridge.changePin('1234', '5678');
    await Promise.resolve();
    const requestId = lastPinChangeRequestId(send);

    NativeBridge.beginWalletClear();
    await expect(change).resolves.toEqual({
      success: false,
      error: 'Wallet clear is in progress',
    });
    NativeBridge.endWalletClear();

    // Model PIN_CHANGED arriving after native and web clear have completed.
    await handleBridge({
      type: 'PIN_CHANGED',
      payload: { requestId, success: true, newPin: '5678' },
    });
    expect(mockStorePin).not.toHaveBeenCalled();
    send.mockRestore();
  });
});
