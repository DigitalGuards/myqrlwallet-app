import { act, type ReactElement } from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  Text,
  TouchableOpacity,
  type AppStateStatus,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import WalletScreen from '../../app/(tabs)/index';
import QRLWebView from '../../components/QRLWebView';
import PinEntryModal from '../../components/PinEntryModal';
import { malformed } from '../../test-utils/malformed';
import BiometricService from '../BiometricService';
import NativeBridge, { type NativeSecurityContext } from '../NativeBridge';
import SeedStorageService from '../SeedStorageService';
import { isRecord } from '../guards';
import { runAsPromise as mockRunAsPromise } from '../runAsPromise';

interface TestInstance {
  props: Record<string, unknown>;
  findByType: (type: unknown) => TestInstance;
  findAllByType: (type: unknown) => TestInstance[];
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}

interface TestRenderer {
  root: TestInstance;
  update: (element: ReactElement) => void;
  unmount: () => void;
}

function isNativeTestRenderer(value: unknown): value is {
  create: (element: ReactElement) => Promise<TestRenderer>;
} {
  return isRecord(value) && typeof value.create === 'function';
}

const nativeTestRenderer: unknown = jest.requireActual('@react-native/jest-preset/jest/renderer');
if (!isNativeTestRenderer(nativeTestRenderer)) throw new TypeError('Missing native test renderer');

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new TypeError('Missing test callback');
  return value;
}

function callProp(node: Pick<TestInstance, 'props'>, key: string, ...args: unknown[]): unknown {
  const callback = node.props[key];
  if (typeof callback !== 'function') throw new TypeError(`Missing callback ${key}`);
  return Reflect.apply(callback, node.props, args);
}

let mockGeneration = 0;
let mockFocused = true;
const mockInvalidationListeners = new Set<() => void>();
jest.mock('../../components/QRLWebView', () => 'QRLWebView');
jest.mock('../../components/PinEntryModal', () => 'PinEntryModal');
jest.mock('../../components/QRScannerModal', () => 'QRScannerModal');
jest.mock('../../components/QuantumLoadingScreen', () => 'QuantumLoadingScreen');
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  usePathname: () => '/',
  useIsFocused: () => mockFocused,
  useFocusEffect: jest.fn(),
}));
jest.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
  getEnrolledLevelAsync: jest.fn(() => Promise.resolve(3)),
  supportedAuthenticationTypesAsync: jest.fn(() => Promise.resolve([2])),
  authenticateAsync: jest.fn(),
}));
jest.mock('../Logger', () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../WebViewService', () => ({ updateLastSession: jest.fn() }));
jest.mock('../SeedStorageService', () => ({
  getPendingWalletWipe: jest.fn(() => Promise.resolve(null)),
  hasWallet: jest.fn(() => Promise.resolve(true)),
  isBiometricEnabled: jest.fn(() => Promise.resolve(true)),
  hasPinStored: jest.fn(() => Promise.resolve(true)),
  getStoredPin: jest.fn(() => Promise.resolve('4826')),
  needsPinAccessibilityMigration: jest.fn(() => Promise.resolve(false)),
  getWalletGeneration: jest.fn(() => 1),
  isWalletGenerationCurrent: jest.fn(() => true),
}));
jest.mock('../NativeBridge', () => ({
  NATIVE_PIN_CHANGE_AMBIGUOUS_ERROR: 'ambiguous',
  NATIVE_PIN_COMMIT_ERROR: 'commit failed',
  captureSecurityContext: jest.fn(() => ({ authorizationGeneration: mockGeneration })),
  isSecurityContextCurrent: jest.fn(
    (context: Pick<NativeSecurityContext, 'authorizationGeneration'>) =>
      context.authorizationGeneration === mockGeneration
  ),
  invalidateAuthorization: jest.fn(() => {
    mockGeneration += 1;
    for (const listener of mockInvalidationListeners) listener();
  }),
  onAuthorizationInvalidated: jest.fn((listener: () => void) => {
    mockInvalidationListeners.add(listener);
    return () => mockInvalidationListeners.delete(listener);
  }),
  sendUnlockWithPinIfReady: jest.fn(
    (pin: string, context: Pick<NativeSecurityContext, 'authorizationGeneration'>) =>
      /^\d{4,6}$/.test(pin) && context.authorizationGeneration === mockGeneration
  ),
  sendUnlockWithPinForContext: jest.fn(
    (pin: string, context: Pick<NativeSecurityContext, 'authorizationGeneration'>) =>
      /^\d{4,6}$/.test(pin) && context.authorizationGeneration === mockGeneration
  ),
  verifyPin: jest.fn((pin: string) => mockRunAsPromise(() => ({ success: /^\d{4,6}$/.test(pin) }))),
  setNativeAuthorization: jest.fn(),
  sendAppState: jest.fn(),
  onBiometricUnlockRequest: jest.fn(),
  onSeedStored: jest.fn(),
  onOpenNativeSettings: jest.fn(),
  onQRScanRequest: jest.fn(),
  onDAppShowWebView: jest.fn(),
  onWalletClearStarted: jest.fn(),
  onWalletCleared: jest.fn(),
  onWebAppReady: jest.fn(),
}));

describe('prompt-return callback boundary', () => {
  it('preserves the receiver, arguments and promise returned by a callback', async () => {
    const result = Promise.resolve({ success: true });
    const callback = jest.fn(() => result);
    const props = { onSubmit: callback };

    expect(callProp({ props }, 'onSubmit', '9357')).toBe(result);
    expect(callback.mock.contexts).toEqual([props]);
    expect(callback.mock.calls).toEqual([['9357']]);
    await expect(result).resolves.toEqual({ success: true });
  });

  it('propagates callback throws and promise rejections', async () => {
    const failure = new Error('Callback failed');
    expect(() => callProp({ props: { onCancel: () => { throw failure; } } }, 'onCancel'))
      .toThrow(failure);
    await expect(callProp({ props: { onSubmit: () => Promise.reject(failure) } }, 'onSubmit'))
      .rejects.toBe(failure);
  });

  it('keeps PIN mock coercion and rejected-promise behavior', async () => {
    await expect(NativeBridge.verifyPin(malformed(4826))).resolves.toEqual({ success: true });
    await expect(NativeBridge.verifyPin(malformed(4826n))).resolves.toEqual({ success: true });
    await expect(NativeBridge.verifyPin(malformed(Symbol('pin')))).rejects.toThrow(TypeError);
  });

  it.each([undefined, null, false, 0, 'callback', {}])(
    'rejects a missing or non-callable prop: %p',
    (onSubmit) => {
      expect(() => callProp({ props: { onSubmit } }, 'onSubmit')).toThrow(TypeError);
    }
  );
});

// The screen, authentication service and lifecycle helpers are real. Only OS,
// persistent storage, bridge transport and child native views are mocked.
describe('WalletScreen with real BiometricService prompt-return lifecycle', () => {
  let screen: TestRenderer;
  let originalState: AppStateStatus;
  const listeners = new Set<(state: AppStateStatus) => void>();
  const prompts: ((value: LocalAuthentication.LocalAuthenticationResult) => void)[] = [];

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.mocked(SeedStorageService).getStoredPin.mockResolvedValue('4826');
    jest.mocked(SeedStorageService).hasWallet.mockResolvedValue(true);
    jest.mocked(SeedStorageService).getPendingWalletWipe.mockResolvedValue(null);
    mockGeneration = 0;
    mockFocused = true;
    mockInvalidationListeners.clear();
    listeners.clear();
    prompts.length = 0;
    originalState = AppState.currentState;
    AppState.currentState = 'active';
    expect(Platform.OS).toBe('ios');
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
      listeners.add(callback);
      return { remove: () => listeners.delete(callback) };
    });
    jest.mocked(LocalAuthentication.authenticateAsync).mockImplementation(
      () =>
        new Promise((resolve) => {
          prompts.push(resolve);
        })
    );
    await act(async () => {
      screen = await nativeTestRenderer.create(<WalletScreen />);
    });
    // The native wrapper establishes the first document context before the
    // screen can start OS authentication. No web-ready message is required.
    expect(LocalAuthentication.authenticateAsync).not.toHaveBeenCalled();
    await act<undefined>(() => {
      NativeBridge.invalidateAuthorization();
      callProp(screen.root.findByType(QRLWebView), 'onDocumentLoadStart');
    });
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
  });
  afterEach(async () => {
    await act<undefined>(() => {
      screen.unmount();
    });
    // Settle the final bounded prompt after unmount, without a new mounted auth attempt.
    await act<undefined>(() => {
      for (const resolve of prompts) resolve({ success: false, error: 'user_cancel' });
      jest.advanceTimersByTime(301);
    });
    AppState.currentState = originalState;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  async function transition(next: AppStateStatus) {
    await act<undefined>(() => {
      AppState.currentState = next;
      for (const listener of [...listeners]) listener(next);
    });
  }
  function state() {
    const buttons = screen.root.findAllByType(TouchableOpacity);
    return {
      promptCount: jest.mocked(LocalAuthentication.authenticateAsync).mock.calls.length,
      deliveredUnlocks: jest
        .mocked(NativeBridge)
        .sendUnlockWithPinIfReady.mock.results.filter((result) => result.type === 'return' && result.value).length,
      authorized: jest.mocked(NativeBridge).setNativeAuthorization.mock.calls.at(-1)?.[0],
      lockOverlay:
        screen.root.findAll((node) => node.props.accessibilityLabel === 'Wallet locked').length > 0,
      spinner: screen.root.findAllByType(ActivityIndicator).length > 0,
      buttons: buttons.map((button) => ({
        text: button.findByType(Text).props.children,
        disabled: button.props.disabled,
      })),
    };
  }

  function button(label: string) {
    const found = screen.root
      .findAllByType(TouchableOpacity)
      .find((candidate) => candidate.findByType(Text).props.children === label);
    if (!found) throw new Error(`Missing button ${label}`);
    return found;
  }

  function expectManualRetry() {
    expect(state()).toMatchObject({
      promptCount: 1,
      deliveredUnlocks: 0,
      authorized: false,
      lockOverlay: true,
      spinner: false,
    });
    expect(button('Try Device Login Again').props.disabled).toBe(false);
    expect(button('Use Wallet PIN').props.disabled).toBe(false);
  }

  it('control: successful prompt returning active inside 300 ms unlocks once', async () => {
    await transition('inactive');
    expect(BiometricService.isAuthenticationPromptActive()).toBe(true);
    await act<undefined>(() => {
      required(prompts[0])({ success: true });
    });
    await act<undefined>(() => {
      jest.advanceTimersByTime(100);
    });
    await transition('active');
    expect(state()).toMatchObject({
      promptCount: 1,
      deliveredUnlocks: 1,
      authorized: true,
      lockOverlay: false,
      spinner: false,
    });
  });

  it('control: forced screen re-renders alone retain the same pending authentication', async () => {
    for (let render = 0; render < 3; render += 1) {
      await act<undefined>(() => {
        screen.update(<WalletScreen />);
      });
    }
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
    expect(jest.mocked(NativeBridge).onBiometricUnlockRequest.mock.calls).toHaveLength(1);
    await act<undefined>(() => {
      required(prompts[0])({ success: true });
    });
    expect(state()).toMatchObject({
      promptCount: 1,
      deliveredUnlocks: 1,
      authorized: true,
      lockOverlay: false,
      spinner: false,
    });
  });

  it('keeps manual retry usable after focus changes during a pending OS prompt', async () => {
    await act<undefined>(() => {
      mockFocused = false;
      screen.update(<WalletScreen />);
    });
    await act<undefined>(() => {
      mockFocused = true;
      screen.update(<WalletScreen />);
    });
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
    await act<undefined>(() => {
      required(prompts[0])({ success: true });
    });
    expectManualRetry();
    expect(jest.mocked(SeedStorageService).getStoredPin.mock.calls).toHaveLength(0);
  });

  it.each([350, 1000, 5000])(
    'unlocks once after a successful prompt returns active after %i ms',
    async (delay) => {
      await transition('inactive');
      expect(BiometricService.isAuthenticationPromptActive()).toBe(true);
      await act<undefined>(() => {
        required(prompts[0])({ success: true });
      });
      expect(BiometricService.isAuthenticationPromptActive()).toBe(false);
      await act<undefined>(() => {
        jest.advanceTimersByTime(delay);
      });
      expect(jest.mocked(SeedStorageService).getStoredPin.mock.calls).toHaveLength(0);
      expect(jest.mocked(NativeBridge).sendUnlockWithPinIfReady.mock.calls).toHaveLength(0);
      await transition('active');
      expect(state()).toMatchObject({
        promptCount: 1,
        deliveredUnlocks: 1,
        authorized: true,
        lockOverlay: false,
        spinner: false,
      });
      await transition('active');
      expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
    }
  );

  it('expires a successful foreground wait after ten seconds without automatically prompting again', async () => {
    await transition('inactive');
    await act<undefined>(() => {
      required(prompts[0])({ success: true });
    });
    await act<undefined>(() => {
      jest.advanceTimersByTime(10001);
    });
    expect(jest.mocked(SeedStorageService).getStoredPin.mock.calls).toHaveLength(0);
    await transition('active');
    await transition('active');
    expectManualRetry();
  });

  it('keeps a cancelled prompt on manual retry after a delayed active return', async () => {
    await transition('inactive');
    await act<undefined>(() => {
      required(prompts[0])({ success: false, error: 'user_cancel' });
    });
    await act<undefined>(() => {
      jest.advanceTimersByTime(1000);
    });
    await transition('active');
    await transition('active');
    expectManualRetry();
    expect(jest.mocked(SeedStorageService).getStoredPin.mock.calls).toHaveLength(0);
  });

  it('offers working PIN fallback after the device authentication wait expires', async () => {
    await transition('inactive');
    await act<undefined>(() => {
      required(prompts[0])({ success: true });
    });
    await act<undefined>(() => {
      jest.advanceTimersByTime(10001);
    });
    await transition('active');
    expectManualRetry();
    await act<undefined>(() => {
      callProp(button('Use Wallet PIN'), 'onPress');
    });
    const modal = screen.root.findByType(PinEntryModal);
    expect(modal.props.visible).toBe(true);
    await act(async () => {
      await callProp(modal, 'onSubmit', '9357');
    });
    expect(jest.mocked(NativeBridge).verifyPin.mock.calls).toContainEqual(['9357', 30000]);
    expect(jest.mocked(NativeBridge).sendUnlockWithPinIfReady.mock.calls).toContainEqual([
      '9357',
      expect.any(Object),
    ]);
    expect(state()).toMatchObject({
      promptCount: 1,
      deliveredUnlocks: 1,
      authorized: true,
      lockOverlay: false,
    });
  });

  it('lets PIN fallback supersede a pending OS prompt and rejects its late success', async () => {
    expect(button('Use Wallet PIN').props.disabled).toBe(false);
    await act<undefined>(() => {
      callProp(button('Use Wallet PIN'), 'onPress');
    });
    const modal = screen.root.findByType(PinEntryModal);
    expect(modal.props.visible).toBe(true);
    await act(async () => {
      await callProp(modal, 'onSubmit', '9357');
    });
    await act<undefined>(() => {
      required(prompts[0])({ success: true });
    });
    expect(jest.mocked(SeedStorageService).getStoredPin.mock.calls).toHaveLength(0);
    expect(jest.mocked(NativeBridge).sendUnlockWithPinIfReady.mock.calls).toHaveLength(1);
    expect(jest.mocked(NativeBridge).sendUnlockWithPinIfReady.mock.calls).toContainEqual([
      '9357',
      expect.any(Object),
    ]);
    expect(state()).toMatchObject({
      promptCount: 1,
      deliveredUnlocks: 1,
      authorized: true,
      lockOverlay: false,
    });
  });

  it('keeps cancellation of the PIN fallback from reviving the superseded OS result', async () => {
    expect(button('Use Wallet PIN').props.disabled).toBe(false);
    await act<undefined>(() => {
      callProp(button('Use Wallet PIN'), 'onPress');
    });
    await act<undefined>(() => {
      callProp(screen.root.findByType(PinEntryModal), 'onCancel');
    });
    await act<undefined>(() => {
      required(prompts[0])({ success: true });
    });
    expectManualRetry();
    expect(jest.mocked(NativeBridge).verifyPin.mock.calls).toHaveLength(0);
    expect(jest.mocked(SeedStorageService).getStoredPin.mock.calls).toHaveLength(0);
  });

  it('unlocks on the first attempt after the initial document starts', async () => {
    await transition('inactive');
    await act<undefined>(() => {
      required(prompts[0])({ success: true });
      jest.advanceTimersByTime(350);
    });
    expect(jest.mocked(SeedStorageService).getStoredPin.mock.calls).toHaveLength(0);
    await transition('active');
    expect(state()).toMatchObject({
      promptCount: 1,
      deliveredUnlocks: 1,
      authorized: true,
      lockOverlay: false,
      spinner: false,
    });
    expect(jest.mocked(NativeBridge).sendUnlockWithPinIfReady.mock.calls).toContainEqual([
      '4826',
      NativeBridge.captureSecurityContext(),
    ]);
  });

  it('keeps a later document load during authentication on usable manual retry', async () => {
    await act<undefined>(() => {
      // QRLWebView resets document authority before notifying the screen.
      NativeBridge.invalidateAuthorization();
      callProp(screen.root.findByType(QRLWebView), 'onDocumentLoadStart');
    });
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
    await act<undefined>(() => {
      required(prompts[0])({ success: true });
    });
    expectManualRetry();
    expect(jest.mocked(SeedStorageService).getStoredPin.mock.calls).toHaveLength(0);
  });

  it('rejects a stored PIN read that finishes after its document was replaced', async () => {
    let finishRead: ((pin: string) => void) | undefined;
    jest.mocked(SeedStorageService).getStoredPin.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        })
    );
    await act<undefined>(() => {
      required(prompts[0])({ success: true });
    });
    expect(jest.mocked(SeedStorageService).getStoredPin.mock.calls).toHaveLength(1);
    await act<undefined>(() => {
      NativeBridge.invalidateAuthorization();
      callProp(screen.root.findByType(QRLWebView), 'onDocumentLoadStart');
    });
    await act<undefined>(() => {
      required(finishRead)('4826');
    });
    expectManualRetry();
    expect(jest.mocked(NativeBridge).sendUnlockWithPinIfReady.mock.calls).toHaveLength(0);
  });

  it('rejects background-interrupted authentication until an explicit successful retry', async () => {
    await transition('inactive');
    await transition('background');
    await transition('active');
    await act<undefined>(() => {
      required(prompts[0])({ success: true });
    });
    expectManualRetry();
    expect(jest.mocked(SeedStorageService).getStoredPin.mock.calls).toHaveLength(0);
    jest.mocked(SeedStorageService).getStoredPin.mockResolvedValue('9357');
    await act<undefined>(() => {
      callProp(button('Try Device Login Again'), 'onPress');
    });
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(2);
    await act<undefined>(() => {
      required(prompts[1])({ success: true });
    });
    expect(jest.mocked(NativeBridge).sendUnlockWithPinIfReady.mock.calls).toHaveLength(1);
    expect(jest.mocked(NativeBridge).sendUnlockWithPinIfReady.mock.calls).toContainEqual([
      '9357',
      expect.any(Object),
    ]);
    expect(state()).toMatchObject({
      promptCount: 2,
      deliveredUnlocks: 1,
      authorized: true,
      lockOverlay: false,
    });
  });

  it('authenticates once after an already unlocked session returns from background', async () => {
    await act<undefined>(() => {
      required(prompts[0])({ success: true });
    });
    expect(state()).toMatchObject({ promptCount: 1, deliveredUnlocks: 1, authorized: true });
    await transition('inactive');
    await transition('background');
    await transition('active');
    await transition('active');
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(2);
    expect(state()).toMatchObject({ deliveredUnlocks: 1, authorized: false, lockOverlay: true });
    jest.mocked(SeedStorageService).getStoredPin.mockResolvedValue('9357');
    await act<undefined>(() => {
      required(prompts[1])({ success: true });
    });
    expect(state()).toMatchObject({
      promptCount: 2,
      deliveredUnlocks: 2,
      authorized: true,
      lockOverlay: false,
    });
  });

  it('rejects a pending PIN verification after background and keeps manual retry usable', async () => {
    let completeVerification: ((result: { success: boolean }) => void) | undefined;
    jest.mocked(NativeBridge).verifyPin.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeVerification = resolve;
        })
    );
    expect(button('Use Wallet PIN').props.disabled).toBe(false);
    await act<undefined>(() => {
      callProp(button('Use Wallet PIN'), 'onPress');
    });
    let submission: unknown;
    await act<undefined>(() => {
      submission = callProp(screen.root.findByType(PinEntryModal), 'onSubmit', '9357');
    });
    expect(submission).toBeInstanceOf(Promise);
    expect(jest.mocked(NativeBridge).verifyPin.mock.calls).toHaveLength(1);
    expect(button('Use Wallet PIN').props.disabled).toBe(true);
    await transition('inactive');
    await transition('background');
    await transition('active');
    await act(async () => {
      required(completeVerification)({ success: true });
      required(prompts[0])({ success: true });
      await submission;
    });
    expectManualRetry();
    expect(jest.mocked(NativeBridge).sendUnlockWithPinIfReady.mock.calls).toHaveLength(0);
  });

  it.each([false, true])(
    'opens the fresh empty wallet only after authoritative wipe completion (old prompt pending: %s)',
    async (completionFirst) => {
      await act<undefined>(() => {
        NativeBridge.invalidateAuthorization();
        required(jest.mocked(NativeBridge).onWalletClearStarted.mock.calls[0])[0]();
      });
      expect(state()).toMatchObject({ authorized: false, lockOverlay: true, deliveredUnlocks: 0 });
      jest.mocked(SeedStorageService).hasWallet.mockResolvedValue(false);
      if (completionFirst) {
        await act<undefined>(() => {
          required(jest.mocked(NativeBridge).onWalletCleared.mock.calls[0])[0]();
        });
      }
      await act<undefined>(() => {
        required(prompts[0])({ success: true });
      });
      if (!completionFirst) {
        expect(state()).toMatchObject({ authorized: false, lockOverlay: true });
        await act<undefined>(() => {
          required(jest.mocked(NativeBridge).onWalletCleared.mock.calls[0])[0]();
        });
      }
      expect(state()).toMatchObject({
        promptCount: 1,
        deliveredUnlocks: 0,
        authorized: true,
        lockOverlay: false,
        spinner: false,
      });
      expect(jest.mocked(SeedStorageService).hasWallet.mock.calls).toHaveLength(2);
      expect(jest.mocked(SeedStorageService).getStoredPin.mock.calls).toHaveLength(0);
      expect(screen.root.findByType(QRLWebView)).toBeDefined();
    }
  );

  it('keeps an incomplete or failed wipe locked until completion is confirmed', async () => {
    await act<undefined>(() => {
      NativeBridge.invalidateAuthorization();
      required(jest.mocked(NativeBridge).onWalletClearStarted.mock.calls[0])[0]();
      required(prompts[0])({ success: true });
    });
    await transition('active');
    await act<undefined>(() => {
      screen.update(<WalletScreen />);
    });
    expect(state()).toMatchObject({
      promptCount: 1,
      deliveredUnlocks: 0,
      authorized: false,
      lockOverlay: true,
      buttons: [],
    });
    expect(
      screen.root
        .findAllByType(Text)
        .some((node) => node.props.children === 'Finishing wallet removal...')
    ).toBe(true);
    expect(jest.mocked(SeedStorageService).getStoredPin.mock.calls).toHaveLength(0);
  });

  it.each(['document', 'wipe'])(
    'rejects a successful pending foreground result after %s invalidation',
    async (change) => {
      await transition('inactive');
      await act<undefined>(() => {
        required(prompts[0])({ success: true });
      });
      await act<undefined>(() => {
        NativeBridge.invalidateAuthorization();
        if (change === 'document')
          callProp(screen.root.findByType(QRLWebView), 'onDocumentLoadStart');
        if (change === 'wipe')
          required(jest.mocked(NativeBridge).onWalletClearStarted.mock.calls[0])[0]();
        jest.advanceTimersByTime(1000);
      });
      await transition('active');
      expect(jest.mocked(NativeBridge).sendUnlockWithPinIfReady.mock.calls).toHaveLength(0);
      expect(jest.mocked(SeedStorageService).getStoredPin.mock.calls).toHaveLength(0);
    }
  );
});
