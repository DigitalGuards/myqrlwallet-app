import { act, type ReactElement } from 'react';
import { AppState, Text, TouchableOpacity, type AppStateStatus } from 'react-native';
import WalletScreen from '../../app/(tabs)/index';
import QRLWebView from '../../components/QRLWebView';
import BiometricService from '../BiometricService';
import NativeBridge from '../NativeBridge';
import { isRecord } from '../guards';
import { runAsPromise } from '../runAsPromise';

interface TestInstance {
  props: Record<string, unknown>;
  findByType: (type: unknown) => TestInstance;
  findAllByType: (type: unknown) => TestInstance[];
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

const nativeRendererModule: unknown = jest.requireActual('@react-native/jest-preset/jest/renderer');
if (!isNativeTestRenderer(nativeRendererModule)) throw new TypeError('Missing native test renderer');
const nativeTestRenderer = nativeRendererModule;

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new TypeError('Missing test value');
  return value;
}

function callProp(props: Record<string, unknown>, key: string, ...args: unknown[]): unknown {
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
  useFocusEffect: jest.fn(),
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
  isAuthenticationTransitionActive: jest.fn(() => false),
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
    onAuthorizationInvalidated: jest.fn(() => jest.fn()),
    onDAppShowWebView: jest.fn(),
    onWalletClearStarted: jest.fn(),
    onWalletCleared: jest.fn(),
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
  let screen: TestRenderer | undefined;
  const listeners = new Set<(state: AppStateStatus) => void>();
  let originalState: AppStateStatus;
  const getPin = jest.spyOn(BiometricService, 'getPinWithBiometric');
  const sendUnlockWithPinIfReady = jest.spyOn(NativeBridge, 'sendUnlockWithPinIfReady');
  const sendUnlockWithPinForContext = jest.spyOn(NativeBridge, 'sendUnlockWithPinForContext');
  const setNativeAuthorization = jest.spyOn(NativeBridge, 'setNativeAuthorization');

  const transition = async (next: AppStateStatus) => {
    await act(() => runAsPromise(() => {
      AppState.currentState = next;
      for (const listener of [...listeners]) listener(next);
    }));
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    listeners.clear();
    getPin.mockReset();
    originalState = AppState.currentState;
    AppState.currentState = 'active';
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
      listeners.add(callback);
      return { remove: () => listeners.delete(callback) };
    });
  });

  afterEach(async () => {
    if (screen) await act(() => runAsPromise(() => { required(screen).unmount(); }));
    AppState.currentState = originalState;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  async function mountWithPendingAuth() {
    const oldAuth = deferredAuth();
    const freshAuth = deferredAuth();
    getPin.mockReturnValueOnce(oldAuth.promise).mockReturnValueOnce(freshAuth.promise);
    await act(async () => {
      screen = await nativeTestRenderer.create(<WalletScreen />);
    });
    expect(getPin).not.toHaveBeenCalled();
    await act(() => runAsPromise(() => {
      NativeBridge.invalidateAuthorization();
      callProp(required(screen).root.findByType(QRLWebView).props, 'onDocumentLoadStart');
    }));
    expect(getPin).toHaveBeenCalledTimes(1);
    return { oldAuth, freshAuth };
  }

  it('requires an explicit retry when background interrupted a prompt', async () => {
    const { oldAuth, freshAuth } = await mountWithPendingAuth();
    await transition('inactive');
    await transition('background');
    await transition('active');
    await transition('active');
    expect(getPin).toHaveBeenCalledTimes(1);

    await act(() => runAsPromise(() => {
      oldAuth.resolve({ success: true, pin: 'old-pin' });
    }));
    expect(getPin).toHaveBeenCalledTimes(1);
    expect(jest.mocked(NativeBridge).sendUnlockWithPinIfReady.mock.calls).toHaveLength(0);

    await act(() => runAsPromise(() => {
      callProp(required(required(screen).root.findAllByType(TouchableOpacity).find((button) =>
        button.findByType(Text).props.children === 'Try Device Login Again'
      )).props, 'onPress');
    }));
    expect(getPin).toHaveBeenCalledTimes(2);

    await act(() => runAsPromise(() => {
      freshAuth.resolve({ success: true, pin: 'fresh-pin' });
    }));
    expect(jest.mocked(NativeBridge).sendUnlockWithPinIfReady.mock.calls).toHaveLength(1);
    expect(sendUnlockWithPinIfReady).toHaveBeenCalledWith(
      'fresh-pin',
      expect.any(Object)
    );
    expect(setNativeAuthorization).toHaveBeenLastCalledWith(true);
    await transition('active');
    expect(getPin).toHaveBeenCalledTimes(2);
  });

  it('keeps manual retry when the interrupted prompt settles in the background', async () => {
    const { oldAuth } = await mountWithPendingAuth();
    await transition('inactive');
    await transition('background');
    await act(() => runAsPromise(() => {
      oldAuth.resolve({ success: false });
    }));
    expect(getPin).toHaveBeenCalledTimes(1);
    await transition('active');
    expect(getPin).toHaveBeenCalledTimes(1);
    expect(jest.mocked(NativeBridge).sendUnlockWithPinIfReady.mock.calls).toHaveLength(0);
  });

  it('preserves a successful prompt across a brief inactive interruption', async () => {
    const { oldAuth } = await mountWithPendingAuth();
    await transition('inactive');
    await transition('active');
    await act(() => runAsPromise(() => {
      oldAuth.resolve({ success: true, pin: 'fresh-pin' });
    }));
    expect(getPin).toHaveBeenCalledTimes(1);
    expect(jest.mocked(NativeBridge).sendUnlockWithPinIfReady.mock.calls).toHaveLength(1);
    expect(setNativeAuthorization).toHaveBeenLastCalledWith(true);
  });

  it('waits for active when the initial successful OS prompt settles while inactive', async () => {
    const { oldAuth } = await mountWithPendingAuth();
    await transition('inactive');
    await act(() => runAsPromise(() => { oldAuth.resolve({ success: true, pin: 'fresh-pin' }); }));
    expect(jest.mocked(NativeBridge).sendUnlockWithPinIfReady.mock.calls).toHaveLength(0);
    await act(() => runAsPromise(() => { jest.advanceTimersByTime(100); }));
    await transition('active');
    expect(sendUnlockWithPinIfReady).toHaveBeenCalledWith('fresh-pin', expect.any(Object));
    expect(setNativeAuthorization).toHaveBeenLastCalledWith(true);
    expect(getPin).toHaveBeenCalledTimes(1);
  });

  it('drops the completed PIN if background wins the foreground grace race', async () => {
    const { oldAuth } = await mountWithPendingAuth();
    await transition('inactive');
    await act(() => runAsPromise(() => { oldAuth.resolve({ success: true, pin: 'stale-pin' }); }));
    await transition('background');
    expect(jest.mocked(NativeBridge).sendUnlockWithPinIfReady.mock.calls).toHaveLength(0);
    await transition('active');
    expect(getPin).toHaveBeenCalledTimes(1);
    expect(setNativeAuthorization).toHaveBeenLastCalledWith(false);
  });

  it('waits for active before delivering a WebView-requested unlock result', async () => {
    const { oldAuth, freshAuth: webAuth } = await mountWithPendingAuth();
    await act(() => runAsPromise(() => { oldAuth.resolve({ success: true, pin: 'initial-pin' }); }));
    const callback = required(jest.mocked(NativeBridge).onBiometricUnlockRequest.mock.calls[0])[0];
    let operation!: Promise<void>;
    await act(() => runAsPromise(() => { operation = callback(NativeBridge.captureSecurityContext()); }));
    expect(operation).toBeInstanceOf(Promise);
    await transition('inactive');
    await act(() => runAsPromise(() => { webAuth.resolve({ success: true, pin: 'fresh-pin' }); }));
    expect(jest.mocked(NativeBridge).sendUnlockWithPinForContext.mock.calls).toHaveLength(0);
    await transition('active');
    await act(async () => { await operation; });
    expect(sendUnlockWithPinForContext).toHaveBeenCalledWith('fresh-pin', expect.any(Object));
    expect(getPin).toHaveBeenCalledTimes(2);
  });

  it('keeps a cancelled foreground prompt on the manual retry path', async () => {
    const { oldAuth } = await mountWithPendingAuth();
    await transition('inactive');
    await transition('active');
    await act(() => runAsPromise(() => {
      oldAuth.resolve({ success: false, error: 'Cancelled' });
    }));
    expect(getPin).toHaveBeenCalledTimes(1);
    expect(jest.mocked(NativeBridge).sendUnlockWithPinIfReady.mock.calls).toHaveLength(0);
    expect(setNativeAuthorization).toHaveBeenLastCalledWith(false);
  });

  it('keeps manual retry after an interrupted WebView-requested prompt settles', async () => {
    const { oldAuth, freshAuth: webAuth } = await mountWithPendingAuth();
    await act(() => runAsPromise(() => {
      oldAuth.resolve({ success: true, pin: 'initial-pin' });
    }));
    const resumedAuth = deferredAuth();
    getPin.mockReturnValueOnce(resumedAuth.promise);
    const callback = required(jest.mocked(NativeBridge).onBiometricUnlockRequest.mock.calls[0])[0];
    let webUnlock: Promise<void>;
    await act(() => runAsPromise(() => {
      webUnlock = callback(NativeBridge.captureSecurityContext());
    }));
    expect(getPin).toHaveBeenCalledTimes(2);
    await transition('inactive');
    await transition('background');
    await transition('active');
    await act(async () => {
      webAuth.resolve({ success: false });
      await webUnlock;
    });
    expect(getPin).toHaveBeenCalledTimes(2);
    expect(jest.mocked(NativeBridge).sendUnlockWithPinForContext.mock.calls).toHaveLength(0);
  });
});
