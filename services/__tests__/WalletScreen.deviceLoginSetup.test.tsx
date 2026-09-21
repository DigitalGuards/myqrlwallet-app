import React, { act } from 'react';
import { Alert, AppState, InteractionManager, type AppStateStatus } from 'react-native';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import * as LocalAuthentication from 'expo-local-authentication';
import WalletScreen from '../../app/(tabs)/index';
import BiometricService from '../BiometricService';
import SeedStorageService from '../SeedStorageService';
import NativeBridge from '../NativeBridge';

jest.mock('../../components/QRLWebView', () => 'QRLWebView');
jest.mock('../../components/PinEntryModal', () => 'PinEntryModal');
jest.mock('../../components/QRScannerModal', () => 'QRScannerModal');
jest.mock('../../components/QuantumLoadingScreen', () => 'QuantumLoadingScreen');
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useFocusEffect: (callback: () => void) => {
    const ReactHooks = jest.requireActual<typeof React>('react');
    ReactHooks.useEffect(callback, [callback]);
  },
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  usePathname: () => '/',
}));
jest.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  getEnrolledLevelAsync: jest.fn(async () => 3),
  authenticateAsync: jest.fn(),
}));
jest.mock('../Logger', () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../WebViewService', () => ({ updateLastSession: jest.fn() }));
jest.mock('../SeedStorageService', () => ({
  getPendingWalletWipe: jest.fn(async () => null),
  hasWallet: jest.fn(async () => true),
  isBiometricEnabled: jest.fn(async () => false),
  wasBiometricPromptShown: jest.fn(async () => true),
  getWalletGeneration: jest.fn(() => 1),
  isWalletGenerationCurrent: jest.fn(() => true),
  storePinSecurely: jest.fn(async () => undefined),
  setBiometricEnabled: jest.fn(async () => undefined),
}));
jest.mock('../NativeBridge', () => ({
  NATIVE_PIN_CHANGE_AMBIGUOUS_ERROR: 'ambiguous',
  NATIVE_PIN_COMMIT_ERROR: 'commit failed',
  captureSecurityContext: jest.fn(() => ({ authorizationGeneration: 1 })),
  isSecurityContextCurrent: jest.fn(() => true),
  invalidateAuthorization: jest.fn(),
  sendUnlockWithPinIfReady: jest.fn(() => true),
  sendUnlockWithPinForContext: jest.fn(() => true),
  setNativeAuthorization: jest.fn(),
  sendAppState: jest.fn(),
  onBiometricUnlockRequest: jest.fn(),
  onSeedStored: jest.fn(),
  onOpenNativeSettings: jest.fn(),
  onQRScanRequest: jest.fn(),
  onAuthorizationInvalidated: jest.fn(() => jest.fn()),
  onDAppShowWebView: jest.fn(),
  onWalletClearStarted: jest.fn(),
  onWalletCleared: jest.fn(),
  onWebAppReady: jest.fn(),
  verifyPin: jest.fn(async () => ({ success: true })),
}));

describe('Device Login setup through the wallet screen lifecycle', () => {
  let screen: ReactTestRenderer | undefined;
  let listener: (state: AppStateStatus) => void;
  let originalState: AppStateStatus;
  let resolveAuthentication: (result: LocalAuthentication.LocalAuthenticationResult) => void;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    BiometricService.clearPendingSecurityOperations();
    originalState = AppState.currentState;
    AppState.currentState = 'active';
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
      listener = callback;
      return { remove: jest.fn() };
    });
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation((callback) => {
      if (typeof callback === 'function') callback();
      return { then: jest.fn(), done: jest.fn(), cancel: jest.fn() };
    });
    jest.mocked(LocalAuthentication.authenticateAsync).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAuthentication = resolve;
        })
    );
  });

  afterEach(async () => {
    if (screen) await act(async () => screen?.unmount());
    screen = undefined;
    AppState.currentState = originalState;
    BiometricService.clearPendingSecurityOperations();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  async function transition(next: AppStateStatus) {
    await act(async () => {
      AppState.currentState = next;
      listener(next);
      jest.advanceTimersByTime(400);
    });
  }

  async function beginSetup() {
    BiometricService.queueDeviceLoginSetup('1234');
    await act(async () => {
      screen = create(<WalletScreen />);
    });
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
  }

  it('completes setup when the OS prompt makes iOS inactive beyond the grace period', async () => {
    await beginSetup();
    await transition('inactive');
    await transition('active');
    await act(async () => {
      resolveAuthentication({ success: true });
    });

    expect(SeedStorageService.storePinSecurely).toHaveBeenCalledWith('1234');
    expect(SeedStorageService.setBiometricEnabled).toHaveBeenCalledWith(true);
    expect(Alert.alert).toHaveBeenCalledWith('Success', 'Device Login enabled!', expect.any(Array));
  });

  it('keeps a setup interrupted by real backgrounding from storing credentials', async () => {
    await beginSetup();
    await transition('inactive');
    await transition('background');
    await transition('active');
    await act(async () => {
      resolveAuthentication({ success: true });
    });

    expect(SeedStorageService.storePinSecurely).not.toHaveBeenCalled();
    expect(SeedStorageService.setBiometricEnabled).not.toHaveBeenCalled();
  });

  it('locks normally while PIN verification is pending before any OS prompt', async () => {
    let resolveVerification: (result: { success: boolean }) => void = () => undefined;
    jest.mocked(NativeBridge.verifyPin).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveVerification = resolve;
        })
    );
    BiometricService.queueDeviceLoginSetup('1234');
    await act(async () => {
      screen = create(<WalletScreen />);
    });
    await transition('inactive');
    await transition('active');
    await act(async () => {
      resolveVerification({ success: true });
    });
    expect(LocalAuthentication.authenticateAsync).not.toHaveBeenCalled();
    expect(SeedStorageService.storePinSecurely).not.toHaveBeenCalled();
  });

  it('relocks when a cancelled prompt settles while the app remains inactive', async () => {
    await beginSetup();
    await transition('inactive');
    jest.mocked(NativeBridge.invalidateAuthorization).mockClear();
    await act(async () => {
      resolveAuthentication({ success: false, error: 'user_cancel' });
    });
    expect(BiometricService.isAuthenticationPromptActive()).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(NativeBridge.invalidateAuthorization).toHaveBeenCalledTimes(1);
    expect(SeedStorageService.storePinSecurely).not.toHaveBeenCalled();
  });
});
