import { act, type ReactElement } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import WalletScreen from '../../app/(tabs)/index';
import QRLWebView from '../../components/QRLWebView';
import QRScannerModal from '../../components/QRScannerModal';
import { malformed } from '../../test-utils/malformed';
import BiometricService from '../BiometricService';
import SeedStorageService from '../SeedStorageService';
import NativeBridge, { type NativeQrScanRequest } from '../NativeBridge';
import { isRecord } from '../guards';
import { runAsPromise } from '../runAsPromise';

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

const mockInvalidationListeners = new Set<() => void>();
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
jest.mock('../Logger', () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../WebViewService', () => ({ updateLastSession: jest.fn() }));
jest.mock('../SeedStorageService', () => ({
  getPendingWalletWipe: jest.fn(() => Promise.resolve(null)),
  hasWallet: jest.fn(() => Promise.resolve(true)),
  isBiometricEnabled: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../BiometricService', () => ({
  getPinWithBiometric: jest.fn(() => Promise.resolve({ success: false, error: 'Cancelled test prompt' })),
  isAuthenticationPromptActive: jest.fn(() => false),
  isAuthenticationTransitionActive: jest.fn(() => false),
  onAuthenticationPromptSettled: jest.fn(() => jest.fn()),
  clearPendingSecurityOperations: jest.fn(),
}));
jest.mock('../NativeBridge', () => ({
  captureSecurityContext: jest.fn(() => ({})),
  isSecurityContextCurrent: jest.fn(() => true),
  invalidateAuthorization: jest.fn(() => {
    for (const listener of mockInvalidationListeners) listener();
  }),
  onAuthorizationInvalidated: jest.fn((listener: () => void) => {
    mockInvalidationListeners.add(listener);
    return () => mockInvalidationListeners.delete(listener);
  }),
  setNativeAuthorization: jest.fn(),
  sendAppState: jest.fn(),
  sendQRResult: jest.fn(() => true),
  sendQRCancelled: jest.fn(() => true),
  onBiometricUnlockRequest: jest.fn(),
  onSeedStored: jest.fn(),
  onOpenNativeSettings: jest.fn(),
  onQRScanRequest: jest.fn(),
  onDAppShowWebView: jest.fn(),
  onWalletClearStarted: jest.fn(),
  onWalletCleared: jest.fn(),
  onWebAppReady: jest.fn(),
}));

describe('WalletScreen initial foreground and scanner lifecycle', () => {
  let screen: TestRenderer | undefined;
  const listeners = new Set<(state: AppStateStatus) => void>();
  let original: AppStateStatus;
  const setNativeAuthorization = jest.spyOn(NativeBridge, 'setNativeAuthorization');
  const sendQRResult = jest.spyOn(NativeBridge, 'sendQRResult');
  const sendQRCancelled = jest.spyOn(NativeBridge, 'sendQRCancelled');

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    listeners.clear();
    mockInvalidationListeners.clear();
    original = AppState.currentState;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
      listeners.add(callback);
      return { remove: () => listeners.delete(callback) };
    });
  });
  afterEach(async () => {
    if (screen) await act(() => runAsPromise(() => { screen?.unmount(); }));
    screen = undefined;
    AppState.currentState = original;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  async function mount(state: AppStateStatus = 'active', startDocument = true) {
    AppState.currentState = state;
    await act(async () => {
      screen = await nativeTestRenderer.create(<WalletScreen />);
    });
    expect(jest.mocked(BiometricService).getPinWithBiometric.mock.calls).toHaveLength(0);
    if (startDocument) await documentLoadStart();
  }
  async function documentLoadStart() {
    await act(() => runAsPromise(() => {
      NativeBridge.invalidateAuthorization();
      callProp(required(screen).root.findByType(QRLWebView).props, 'onDocumentLoadStart');
    }));
  }
  async function transition(next: AppStateStatus) {
    await act(() => runAsPromise(() => {
      AppState.currentState = next;
      for (const listener of [...listeners]) listener(next);
    }));
  }
  function scanner() {
    return required(screen).root.findByType(QRScannerModal).props;
  }
  async function openScanner(id: string) {
    const request: NativeQrScanRequest = {
      requestId: id,
      context: NativeBridge.captureSecurityContext(),
    };
    await act(() => runAsPromise(() => {
      required(jest.mocked(NativeBridge).onQRScanRequest.mock.calls[0])[0](request);
    }));
    expect(scanner().visible).toBe(true);
    return { request, callbacks: scanner() };
  }

  it.each<AppStateStatus>(['inactive', 'background', 'unknown', malformed<AppStateStatus>(null)])(
    'starts authentication once when first mounted %s and then activated',
    async (state) => {
      await mount(state);
      expect(jest.mocked(BiometricService).getPinWithBiometric.mock.calls).toHaveLength(0);
      await transition('active');
      await transition('active');
      expect(jest.mocked(BiometricService).getPinWithBiometric.mock.calls).toHaveLength(1);
      expect(setNativeAuthorization).toHaveBeenLastCalledWith(false);
    }
  );

  it('starts once after the first document load on an active initial mount', async () => {
    await mount();
    expect(jest.mocked(BiometricService).getPinWithBiometric.mock.calls).toHaveLength(1);
  });

  it.each<AppStateStatus>(['inactive', 'unknown', malformed<AppStateStatus>(null)])(
    'waits for the first document if %s becomes active before it starts',
    async (state) => {
      await mount(state, false);
      await transition('active');
      expect(jest.mocked(BiometricService).getPinWithBiometric.mock.calls).toHaveLength(0);
      await documentLoadStart();
      expect(jest.mocked(BiometricService).getPinWithBiometric.mock.calls).toHaveLength(1);
    }
  );

  it.each<[
    method: 'getPendingWalletWipe' | 'hasWallet' | 'isBiometricEnabled',
    value: boolean | null,
  ]>([
    ['getPendingWalletWipe', null],
    ['hasWallet', true],
    ['isBiometricEnabled', true],
  ])(
    'resumes a live %s preflight after a short inactive interval',
    async (method, value) => {
      let finishRead!: (result: typeof value) => void;
      const read = new Promise<typeof value>((resolve) => { finishRead = resolve; });
      const readMock: jest.MockInstance<
        Promise<Awaited<ReturnType<(typeof SeedStorageService)[typeof method]>>>,
        []
      > = jest.spyOn(SeedStorageService, method);
      readMock.mockImplementationOnce(() => read);
      await mount();
      expect(readMock.mock.results).toEqual([{ type: 'return', value: read }]);
      expect(jest.mocked(BiometricService).getPinWithBiometric.mock.calls).toHaveLength(0);
      await transition('inactive');
      await act(() => runAsPromise(() => {
        finishRead(value);
        jest.advanceTimersByTime(100);
      }));
      expect(jest.mocked(BiometricService).getPinWithBiometric.mock.calls).toHaveLength(0);
      await transition('active');
      expect(jest.mocked(BiometricService).getPinWithBiometric.mock.calls).toHaveLength(1);
      await transition('active');
      expect(jest.mocked(BiometricService).getPinWithBiometric.mock.calls).toHaveLength(1);
    }
  );

  it.each(['authorization', 'background', 'wallet-clear', 'document'])(
    'closes scanner on %s and rejects retained camera callbacks',
    async (reason) => {
      await mount();
      const { callbacks } = await openScanner('first');
      await act(() => runAsPromise(() => {
        if (reason === 'authorization') NativeBridge.invalidateAuthorization();
        if (reason === 'wallet-clear')
          required(jest.mocked(NativeBridge).onWalletClearStarted.mock.calls[0])[0]();
        if (reason === 'document')
          callProp(required(screen).root.findByType(QRLWebView).props, 'onDocumentLoadStart');
      }));
      if (reason === 'background') await transition('background');
      expect(scanner().visible).toBe(false);
      await act(() => runAsPromise(() => {
        callProp(callbacks, 'onScan', 'qrlconnect://stale');
        callProp(callbacks, 'onClose');
      }));
      expect(jest.mocked(NativeBridge).sendQRResult.mock.calls).toHaveLength(0);
      expect(jest.mocked(NativeBridge).sendQRCancelled.mock.calls).toHaveLength(0);
    }
  );

  it('rejects an old camera callback after a new request in the same session', async () => {
    await mount();
    const first = await openScanner('first');
    const second = await openScanner('second');
    await act(() => runAsPromise(() => {
      callProp(first.callbacks, 'onScan', 'stale');
      callProp(first.callbacks, 'onClose');
    }));
    expect(jest.mocked(NativeBridge).sendQRResult.mock.calls).toHaveLength(0);
    expect(scanner().visible).toBe(true);
    await act(() => runAsPromise(() => {
      callProp(second.callbacks, 'onScan', 'fresh');
      callProp(second.callbacks, 'onClose');
    }));
    expect(sendQRResult).toHaveBeenCalledWith('fresh', second.request);
    expect(jest.mocked(NativeBridge).sendQRResult.mock.calls).toHaveLength(1);
    expect(jest.mocked(NativeBridge).sendQRCancelled.mock.calls).toHaveLength(0);
    expect(scanner().visible).toBe(false);
  });

  it('cancels the current scanner once when unmounted', async () => {
    await mount();
    const { request, callbacks } = await openScanner('current');
    await act(() => runAsPromise(() => {
      screen?.unmount();
      screen = undefined;
    }));
    await act(() => runAsPromise(() => {
      callProp(callbacks, 'onScan', 'stale');
      callProp(callbacks, 'onClose');
    }));
    expect(jest.mocked(NativeBridge).sendQRCancelled.mock.calls).toHaveLength(1);
    expect(sendQRCancelled).toHaveBeenCalledWith(request);
    expect(jest.mocked(NativeBridge).sendQRResult.mock.calls).toHaveLength(0);
  });
});
