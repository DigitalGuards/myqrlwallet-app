import React, { act } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import WalletScreen from '../../app/(tabs)/index';
import BiometricService from '../BiometricService';
import NativeBridge from '../NativeBridge';

jest.mock('../../components/QRLWebView', () => 'QRLWebView');
jest.mock('../../components/PinEntryModal', () => 'PinEntryModal');
jest.mock('../../components/QRScannerModal', () => 'QRScannerModal');
jest.mock('../../components/QuantumLoadingScreen', () => 'QuantumLoadingScreen');
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useFocusEffect: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  usePathname: () => '/',
}));
jest.mock('../Logger', () => ({
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));
jest.mock('../WebViewService', () => ({ updateLastSession: jest.fn() }));
jest.mock('../SeedStorageService', () => ({
  getPendingWalletWipe: jest.fn().mockResolvedValue(null),
  hasWallet: jest.fn().mockResolvedValue(true),
  isBiometricEnabled: jest.fn().mockResolvedValue(true),
}));
jest.mock('../BiometricService', () => ({
  getPinWithBiometric: jest.fn(),
  isAuthenticationPromptActive: jest.fn(() => false),
  onAuthenticationPromptSettled: jest.fn(() => jest.fn()),
  clearPendingSecurityOperations: jest.fn(),
}));
jest.mock('../NativeBridge', () => {
  let generation = 0;
  return {
    captureSecurityContext: jest.fn(() => ({
      authorizationGeneration: generation,
    })),
    isSecurityContextCurrent: jest.fn(
      (context: { authorizationGeneration: number }) =>
        context.authorizationGeneration === generation
    ),
    invalidateAuthorization: jest.fn(() => {
      generation += 1;
    }),
    sendUnlockWithPinIfReady: jest.fn(() => true),
    sendUnlockWithPinForContext: jest.fn(() => true),
    setNativeAuthorization: jest.fn(),
    sendAppState: jest.fn(),
    onBiometricUnlockRequest: jest.fn(),
    onSeedStored: jest.fn(),
    onOpenNativeSettings: jest.fn(),
    onQRScanRequest: jest.fn(),
    onDAppShowWebView: jest.fn(),
    onWalletClearStarted: jest.fn(),
    onWebAppReady: jest.fn(),
  };
});

type AuthResult = Awaited<ReturnType<typeof BiometricService.getPinWithBiometric>>;

function deferredAuth() {
  let resolve!: (result: AuthResult) => void;
  const promise = new Promise<AuthResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('wallet screen deferred foreground reauthentication', () => {
  let screen: ReactTestRenderer;
  let listener: (state: AppStateStatus) => void;
  let originalState: AppStateStatus;
  const getPin = jest.mocked(BiometricService.getPinWithBiometric);

  const transition = async (next: AppStateStatus) => {
    await act(async () => {
      AppState.currentState = next;
      listener(next);
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getPin.mockReset();
    originalState = AppState.currentState;
    AppState.currentState = 'active';
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
      listener = callback;
      return { remove: jest.fn() };
    });
  });

  afterEach(async () => {
    if (screen) await act(async () => screen.unmount());
    AppState.currentState = originalState;
    jest.restoreAllMocks();
  });

  async function mountWithPendingAuth() {
    const oldAuth = deferredAuth();
    const freshAuth = deferredAuth();
    getPin.mockReturnValueOnce(oldAuth.promise).mockReturnValueOnce(freshAuth.promise);
    await act(async () => {
      screen = create(<WalletScreen />);
    });
    expect(getPin).toHaveBeenCalledTimes(1);
    return { oldAuth, freshAuth };
  }

  it('retries once when foreground arrives before the interrupted prompt settles', async () => {
    const { oldAuth, freshAuth } = await mountWithPendingAuth();
    await transition('inactive');
    await transition('background');
    await transition('active');
    await transition('active');
    expect(getPin).toHaveBeenCalledTimes(1);

    await act(async () => {
      oldAuth.resolve({ success: true, pin: 'old-pin' });
    });
    expect(getPin).toHaveBeenCalledTimes(2);
    expect(NativeBridge.sendUnlockWithPinIfReady).not.toHaveBeenCalled();

    await act(async () => {
      freshAuth.resolve({ success: true, pin: 'fresh-pin' });
    });
    expect(NativeBridge.sendUnlockWithPinIfReady).toHaveBeenCalledTimes(1);
    expect(NativeBridge.sendUnlockWithPinIfReady).toHaveBeenCalledWith(
      'fresh-pin',
      expect.any(Object)
    );
    expect(NativeBridge.setNativeAuthorization).toHaveBeenLastCalledWith(true);
    await transition('active');
    expect(getPin).toHaveBeenCalledTimes(2);
  });

  it('waits for foreground when the interrupted prompt settles in the background', async () => {
    const { oldAuth } = await mountWithPendingAuth();
    await transition('inactive');
    await transition('background');
    await act(async () => {
      oldAuth.resolve({ success: false });
    });
    expect(getPin).toHaveBeenCalledTimes(1);
    await transition('active');
    expect(getPin).toHaveBeenCalledTimes(2);
    expect(NativeBridge.sendUnlockWithPinIfReady).not.toHaveBeenCalled();
  });

  it('preserves a successful prompt across a brief inactive interruption', async () => {
    const { oldAuth } = await mountWithPendingAuth();
    await transition('inactive');
    await transition('active');
    await act(async () => {
      oldAuth.resolve({ success: true, pin: 'fresh-pin' });
    });
    expect(getPin).toHaveBeenCalledTimes(1);
    expect(NativeBridge.sendUnlockWithPinIfReady).toHaveBeenCalledTimes(1);
    expect(NativeBridge.setNativeAuthorization).toHaveBeenLastCalledWith(true);
  });

  it('keeps a cancelled foreground prompt on the manual retry path', async () => {
    const { oldAuth } = await mountWithPendingAuth();
    await transition('inactive');
    await transition('active');
    await act(async () => {
      oldAuth.resolve({ success: false, error: 'Cancelled' });
    });
    expect(getPin).toHaveBeenCalledTimes(1);
    expect(NativeBridge.sendUnlockWithPinIfReady).not.toHaveBeenCalled();
    expect(NativeBridge.setNativeAuthorization).toHaveBeenLastCalledWith(false);
  });

  it('also resumes after an interrupted WebView-requested biometric prompt settles', async () => {
    const { oldAuth, freshAuth: webAuth } = await mountWithPendingAuth();
    await act(async () => {
      oldAuth.resolve({ success: true, pin: 'initial-pin' });
    });
    const resumedAuth = deferredAuth();
    getPin.mockReturnValueOnce(resumedAuth.promise);
    const callback = jest.mocked(NativeBridge.onBiometricUnlockRequest).mock.calls[0][0];
    let webUnlock: Promise<void>;
    await act(async () => {
      webUnlock = callback(NativeBridge.captureSecurityContext());
    });
    expect(getPin).toHaveBeenCalledTimes(2);
    await transition('inactive');
    await transition('background');
    await transition('active');
    await act(async () => {
      webAuth.resolve({ success: false });
      await webUnlock;
    });
    expect(getPin).toHaveBeenCalledTimes(3);
    expect(NativeBridge.sendUnlockWithPinForContext).not.toHaveBeenCalled();
  });
});
