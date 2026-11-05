import React, { act, type ReactElement } from 'react';
import { Alert, AppState, InteractionManager, type AppStateStatus } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import WalletScreen from '../../app/(tabs)/index';
import QRLWebView from '../../components/QRLWebView';
import BiometricService from '../BiometricService';
import SeedStorageService from '../SeedStorageService';
import NativeBridge from '../NativeBridge';
import { isRecord } from '../guards';

interface TestInstance {
  props: Record<string, unknown>;
  findByType: (type: unknown) => TestInstance;
}

interface TestRenderer {
  root: TestInstance;
  unmount: () => void;
}

function isNativeTestRenderer(value: unknown): value is {
  create: (element: ReactElement) => Promise<TestRenderer>;
} {
  return isRecord(value) && typeof value.create === 'function';
}

const rendererModule: unknown = jest.requireActual('@react-native/jest-preset/jest/renderer');
if (!isNativeTestRenderer(rendererModule)) throw new TypeError('Missing native test renderer');
const nativeTestRenderer = rendererModule;

function callProp({ props }: Pick<TestInstance, 'props'>, key: string, ...args: unknown[]): unknown {
  const callback = props[key];
  if (typeof callback !== 'function') throw new TypeError(`Missing callback ${key}`);
  return Reflect.apply(callback, props, args);
}

jest.mock('../../components/QRLWebView', () => 'QRLWebView');
jest.mock('../../components/PinEntryModal', () => 'PinEntryModal');
jest.mock('../../components/QRScannerModal', () => 'QRScannerModal');
jest.mock('../../components/QuantumLoadingScreen', () => 'QuantumLoadingScreen');
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  usePathname: () => '/',
  useIsFocused: () => true,
  useFocusEffect: (callback: () => void) => {
    const ReactHooks = jest.requireActual<typeof React>('react');
    ReactHooks.useEffect(callback, [callback]);
  },
}));
jest.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  getEnrolledLevelAsync: jest.fn(() => Promise.resolve(3)),
  authenticateAsync: jest.fn(),
}));
jest.mock('../Logger', () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../WebViewService', () => ({ updateLastSession: jest.fn() }));
jest.mock('../SeedStorageService', () => ({
  getPendingWalletWipe: jest.fn(() => Promise.resolve(null)),
  hasWallet: jest.fn(() => Promise.resolve(true)),
  isBiometricEnabled: jest.fn(() => Promise.resolve(false)),
  wasBiometricPromptShown: jest.fn(() => Promise.resolve(true)),
  getWalletGeneration: jest.fn(() => 1),
  isWalletGenerationCurrent: jest.fn(() => true),
  storePinSecurely: jest.fn(() => Promise.resolve(undefined)),
  setBiometricEnabled: jest.fn(() => Promise.resolve(undefined)),
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
  verifyPin: jest.fn(() => Promise.resolve({ success: true })),
}));

describe('Device Login setup test boundaries', () => {
  it('keeps service mocks promise-based with their existing results', async () => {
    await expect(LocalAuthentication.getEnrolledLevelAsync()).resolves.toBe(3);
    await expect(SeedStorageService.getPendingWalletWipe()).resolves.toBeNull();
    await expect(SeedStorageService.hasWallet()).resolves.toBe(true);
    await expect(SeedStorageService.isBiometricEnabled()).resolves.toBe(false);
    await expect(SeedStorageService.wasBiometricPromptShown()).resolves.toBe(true);
    await expect(SeedStorageService.storePinSecurely('1234')).resolves.toBeUndefined();
    await expect(SeedStorageService.setBiometricEnabled(true)).resolves.toBeUndefined();
    await expect(NativeBridge.verifyPin('1234')).resolves.toEqual({ success: true });
  });

  it('calls a prop synchronously with its receiver and preserves its result', async () => {
    const result = Promise.resolve(true);
    const onDocumentLoadStart = jest.fn(() => result);
    const props = { onDocumentLoadStart, extra: 'retained' };

    expect(callProp({ props }, 'onDocumentLoadStart')).toBe(result);
    expect(onDocumentLoadStart.mock.calls).toEqual([[]]);
    expect(onDocumentLoadStart.mock.contexts[0]).toBe(props);
    await expect(result).resolves.toBe(true);
  });

  it('propagates callback errors and rejections', async () => {
    const failure = new Error('Document callback failed');
    const throws = { onDocumentLoadStart: () => { throw failure; } };
    const rejects = { onDocumentLoadStart: () => Promise.reject(failure) };

    expect(() => callProp({ props: throws }, 'onDocumentLoadStart')).toThrow(failure);
    await expect(callProp({ props: rejects }, 'onDocumentLoadStart')).rejects.toBe(failure);
  });

  it.each([undefined, null, false, 0, 'callback', {}])(
    'rejects a non-callable document callback: %p',
    (onDocumentLoadStart) => {
      expect(() => callProp({ props: { onDocumentLoadStart } }, 'onDocumentLoadStart'))
        .toThrow(TypeError);
    }
  );
});

describe('Device Login setup through the wallet screen lifecycle', () => {
  let screen: TestRenderer | undefined;
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
    if (screen) {
      await act<undefined>(() => {
        screen?.unmount();
      });
    }
    screen = undefined;
    AppState.currentState = originalState;
    BiometricService.clearPendingSecurityOperations();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  async function transition(next: AppStateStatus) {
    await act<undefined>(() => {
      AppState.currentState = next;
      listener(next);
      jest.advanceTimersByTime(400);
    });
  }

  async function beginSetup() {
    BiometricService.queueDeviceLoginSetup('1234');
    await act(async () => {
      screen = await nativeTestRenderer.create(<WalletScreen />);
    });
    await act<undefined>(() => {
      if (!screen) throw new TypeError('Missing wallet screen');
      callProp(screen.root.findByType(QRLWebView), 'onDocumentLoadStart');
    });
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
  }

  it('completes setup when the OS prompt makes iOS inactive beyond the grace period', async () => {
    await beginSetup();
    await transition('inactive');
    await transition('active');
    await act<undefined>(() => {
      resolveAuthentication({ success: true });
    });

    expect(jest.mocked(SeedStorageService).storePinSecurely.mock.calls).toContainEqual(['1234']);
    expect(jest.mocked(SeedStorageService).setBiometricEnabled.mock.calls).toContainEqual([true]);
    expect(Alert.alert).toHaveBeenCalledWith('Success', 'Device Login enabled!', expect.any(Array));
  });

  it('keeps a setup interrupted by real backgrounding from storing credentials', async () => {
    await beginSetup();
    await transition('inactive');
    await transition('background');
    await transition('active');
    await act<undefined>(() => {
      resolveAuthentication({ success: true });
    });

    expect(jest.mocked(SeedStorageService).storePinSecurely.mock.calls).toHaveLength(0);
    expect(jest.mocked(SeedStorageService).setBiometricEnabled.mock.calls).toHaveLength(0);
  });

  it('tells the user when a lock dropped a queued PIN change', async () => {
    await beginSetup();
    BiometricService.queuePinChange('1234', '5678');
    await transition('inactive');
    await transition('background');
    await transition('active');
    await act<undefined>(() => {
      resolveAuthentication({ success: true });
    });

    expect(BiometricService.hasPendingPinChange()).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith('PIN Not Changed', expect.stringContaining('locked'));
  });

  it('keeps a pending dApp link when the app backgrounds again before unlock', async () => {
    await beginSetup();
    jest.mocked(NativeBridge).invalidateAuthorization.mockClear();
    await transition('inactive');
    await transition('background');
    await transition('active');

    expect(jest.mocked(NativeBridge).invalidateAuthorization.mock.calls.length).toBeGreaterThan(0);
    for (const [options] of jest.mocked(NativeBridge).invalidateAuthorization.mock.calls) {
      expect(options).toEqual({ preservePendingDAppIntent: true });
    }
    await act<undefined>(() => {
      resolveAuthentication({ success: false, error: 'user_cancel' });
    });
  });

  it('locks normally while PIN verification is pending before any OS prompt', async () => {
    let resolveVerification: (result: { success: boolean }) => void = () => undefined;
    jest.mocked(NativeBridge).verifyPin.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveVerification = resolve;
        })
    );
    BiometricService.queueDeviceLoginSetup('1234');
    await act(async () => {
      screen = await nativeTestRenderer.create(<WalletScreen />);
    });
    await act<undefined>(() => {
      if (!screen) throw new TypeError('Missing wallet screen');
      callProp(screen.root.findByType(QRLWebView), 'onDocumentLoadStart');
    });
    await transition('inactive');
    await transition('active');
    await act<undefined>(() => {
      resolveVerification({ success: true });
    });
    expect(LocalAuthentication.authenticateAsync).not.toHaveBeenCalled();
    expect(jest.mocked(SeedStorageService).storePinSecurely.mock.calls).toHaveLength(0);
  });

  it('relocks when a cancelled prompt settles while the app remains inactive', async () => {
    await beginSetup();
    await transition('inactive');
    jest.mocked(NativeBridge).invalidateAuthorization.mockClear();
    await act<undefined>(() => {
      resolveAuthentication({ success: false, error: 'user_cancel' });
    });
    expect(BiometricService.isAuthenticationPromptActive()).toBe(false);
    await act<undefined>(() => {
      jest.advanceTimersByTime(400);
    });
    expect(jest.mocked(NativeBridge).invalidateAuthorization.mock.calls).toHaveLength(1);
    expect(jest.mocked(SeedStorageService).storePinSecurely.mock.calls).toHaveLength(0);
  });
});
