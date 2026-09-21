import React, { act } from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  Text,
  TouchableOpacity,
  type AppStateStatus,
} from 'react-native';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import * as LocalAuthentication from 'expo-local-authentication';
import WalletScreen from '../../app/(tabs)/index';
import BiometricService from '../BiometricService';
import NativeBridge from '../NativeBridge';
import SeedStorageService from '../SeedStorageService';

let mockGeneration = 0;
let mockFocused = true;
const mockInvalidationListeners = new Set<() => void>();
jest.mock('../../components/QRLWebView', () => 'QRLWebView');
jest.mock('../../components/PinEntryModal', () => 'PinEntryModal');
jest.mock('../../components/QRScannerModal', () => 'QRScannerModal');
jest.mock('../../components/QuantumLoadingScreen', () => 'QuantumLoadingScreen');
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockFocused,
  useFocusEffect: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  usePathname: () => '/',
}));
jest.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
  getEnrolledLevelAsync: jest.fn(async () => 3),
  supportedAuthenticationTypesAsync: jest.fn(async () => [2]),
  authenticateAsync: jest.fn(),
}));
jest.mock('../Logger', () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../WebViewService', () => ({ updateLastSession: jest.fn() }));
jest.mock('../SeedStorageService', () => ({
  getPendingWalletWipe: jest.fn(async () => null),
  hasWallet: jest.fn(async () => true),
  isBiometricEnabled: jest.fn(async () => true),
  hasPinStored: jest.fn(async () => true),
  getStoredPin: jest.fn(async () => '4826'),
  needsPinAccessibilityMigration: jest.fn(async () => false),
  getWalletGeneration: jest.fn(() => 1),
  isWalletGenerationCurrent: jest.fn(() => true),
}));
jest.mock('../NativeBridge', () => ({
  NATIVE_PIN_CHANGE_AMBIGUOUS_ERROR: 'ambiguous',
  NATIVE_PIN_COMMIT_ERROR: 'commit failed',
  captureSecurityContext: jest.fn(() => ({ authorizationGeneration: mockGeneration })),
  isSecurityContextCurrent: jest.fn(
    (context) => context.authorizationGeneration === mockGeneration
  ),
  invalidateAuthorization: jest.fn(() => {
    mockGeneration += 1;
    for (const listener of mockInvalidationListeners) listener();
  }),
  onAuthorizationInvalidated: jest.fn((listener) => {
    mockInvalidationListeners.add(listener);
    return () => mockInvalidationListeners.delete(listener);
  }),
  sendUnlockWithPinIfReady: jest.fn(
    (pin, context) => /^\d{4,6}$/.test(pin) && context.authorizationGeneration === mockGeneration
  ),
  sendUnlockWithPinForContext: jest.fn(
    (pin, context) => /^\d{4,6}$/.test(pin) && context.authorizationGeneration === mockGeneration
  ),
  verifyPin: jest.fn(async (pin: string) => ({ success: /^\d{4,6}$/.test(pin) })),
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

// The screen, authentication service and lifecycle helpers are real. Only OS,
// persistent storage, bridge transport and child native views are mocked.
describe('WalletScreen with real BiometricService prompt-return lifecycle', () => {
  let screen: ReactTestRenderer;
  let originalState: AppStateStatus;
  const listeners = new Set<(state: AppStateStatus) => void>();
  const prompts: ((value: LocalAuthentication.LocalAuthenticationResult) => void)[] = [];

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.mocked(SeedStorageService.getStoredPin).mockResolvedValue('4826');
    jest.mocked(SeedStorageService.hasWallet).mockResolvedValue(true);
    jest.mocked(SeedStorageService.getPendingWalletWipe).mockResolvedValue(null);
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
      screen = create(<WalletScreen />);
    });
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
  });
  afterEach(async () => {
    await act(async () => screen.unmount());
    // Settle the final bounded prompt after unmount, without a new mounted auth attempt.
    await act(async () => {
      for (const resolve of prompts) resolve({ success: false, error: 'user_cancel' });
      jest.advanceTimersByTime(301);
    });
    AppState.currentState = originalState;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  async function transition(next: AppStateStatus) {
    await act(async () => {
      AppState.currentState = next;
      for (const listener of [...listeners]) listener(next);
    });
  }
  function state() {
    const buttons = screen.root.findAllByType(TouchableOpacity as never);
    return {
      promptCount: jest.mocked(LocalAuthentication.authenticateAsync).mock.calls.length,
      deliveredUnlocks: jest
        .mocked(NativeBridge.sendUnlockWithPinIfReady)
        .mock.results.filter((result) => result.type === 'return' && result.value === true).length,
      authorized: jest.mocked(NativeBridge.setNativeAuthorization).mock.calls.at(-1)?.[0],
      lockOverlay:
        screen.root.findAll((node) => node.props.accessibilityLabel === 'Wallet locked').length > 0,
      spinner: screen.root.findAllByType(ActivityIndicator as never).length > 0,
      buttons: buttons.map((button) => ({
        text: button.findByType(Text as never).props.children,
        disabled: button.props.disabled,
      })),
    };
  }

  function button(label: string) {
    const found = screen.root
      .findAllByType(TouchableOpacity as never)
      .find((candidate) => candidate.findByType(Text as never).props.children === label);
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
    await act(async () => {
      prompts[0]({ success: true });
    });
    await act(async () => {
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
      await act(async () => {
        screen.update(<WalletScreen />);
      });
    }
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
    expect(NativeBridge.onBiometricUnlockRequest).toHaveBeenCalledTimes(1);
    await act(async () => {
      prompts[0]({ success: true });
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
    await act(async () => {
      mockFocused = false;
      screen.update(<WalletScreen />);
    });
    await act(async () => {
      mockFocused = true;
      screen.update(<WalletScreen />);
    });
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
    await act(async () => {
      prompts[0]({ success: true });
    });
    expectManualRetry();
    expect(SeedStorageService.getStoredPin).not.toHaveBeenCalled();
  });

  it.each([350, 1000, 5000])(
    'unlocks once after a successful prompt returns active after %i ms',
    async (delay) => {
      await transition('inactive');
      expect(BiometricService.isAuthenticationPromptActive()).toBe(true);
      await act(async () => {
        prompts[0]({ success: true });
      });
      expect(BiometricService.isAuthenticationPromptActive()).toBe(false);
      await act(async () => {
        jest.advanceTimersByTime(delay);
      });
      expect(SeedStorageService.getStoredPin).not.toHaveBeenCalled();
      expect(NativeBridge.sendUnlockWithPinIfReady).not.toHaveBeenCalled();
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
    await act(async () => {
      prompts[0]({ success: true });
    });
    await act(async () => {
      jest.advanceTimersByTime(10001);
    });
    expect(SeedStorageService.getStoredPin).not.toHaveBeenCalled();
    await transition('active');
    await transition('active');
    expectManualRetry();
  });

  it('keeps a cancelled prompt on manual retry after a delayed active return', async () => {
    await transition('inactive');
    await act(async () => {
      prompts[0]({ success: false, error: 'user_cancel' });
    });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await transition('active');
    await transition('active');
    expectManualRetry();
    expect(SeedStorageService.getStoredPin).not.toHaveBeenCalled();
  });

  it('offers working PIN fallback after the device authentication wait expires', async () => {
    await transition('inactive');
    await act(async () => {
      prompts[0]({ success: true });
    });
    await act(async () => {
      jest.advanceTimersByTime(10001);
    });
    await transition('active');
    expectManualRetry();
    await act(async () => {
      button('Use Wallet PIN').props.onPress();
    });
    const modal = screen.root.findByType('PinEntryModal' as never);
    expect(modal.props.visible).toBe(true);
    await act(async () => {
      await modal.props.onSubmit('9357');
    });
    expect(NativeBridge.verifyPin).toHaveBeenCalledWith('9357', 30000);
    expect(NativeBridge.sendUnlockWithPinIfReady).toHaveBeenCalledWith('9357', expect.any(Object));
    expect(state()).toMatchObject({
      promptCount: 1,
      deliveredUnlocks: 1,
      authorized: true,
      lockOverlay: false,
    });
  });

  it('lets PIN fallback supersede a pending OS prompt and rejects its late success', async () => {
    expect(button('Use Wallet PIN').props.disabled).toBe(false);
    await act(async () => {
      button('Use Wallet PIN').props.onPress();
    });
    const modal = screen.root.findByType('PinEntryModal' as never);
    expect(modal.props.visible).toBe(true);
    await act(async () => {
      await modal.props.onSubmit('9357');
    });
    await act(async () => {
      prompts[0]({ success: true });
    });
    expect(SeedStorageService.getStoredPin).not.toHaveBeenCalled();
    expect(NativeBridge.sendUnlockWithPinIfReady).toHaveBeenCalledTimes(1);
    expect(NativeBridge.sendUnlockWithPinIfReady).toHaveBeenCalledWith('9357', expect.any(Object));
    expect(state()).toMatchObject({
      promptCount: 1,
      deliveredUnlocks: 1,
      authorized: true,
      lockOverlay: false,
    });
  });

  it('keeps cancellation of the PIN fallback from reviving the superseded OS result', async () => {
    expect(button('Use Wallet PIN').props.disabled).toBe(false);
    await act(async () => {
      button('Use Wallet PIN').props.onPress();
    });
    await act(async () => {
      screen.root.findByType('PinEntryModal' as never).props.onCancel();
    });
    await act(async () => {
      prompts[0]({ success: true });
    });
    expectManualRetry();
    expect(NativeBridge.verifyPin).not.toHaveBeenCalled();
    expect(SeedStorageService.getStoredPin).not.toHaveBeenCalled();
  });

  it('keeps an initial document load during authentication on usable manual retry', async () => {
    await act(async () => {
      // QRLWebView resets document authority before notifying the screen.
      NativeBridge.invalidateAuthorization();
      screen.root.findByType('QRLWebView' as never).props.onDocumentLoadStart();
    });
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
    await act(async () => {
      prompts[0]({ success: true });
    });
    expectManualRetry();
    expect(SeedStorageService.getStoredPin).not.toHaveBeenCalled();
  });

  it('rejects a stored PIN read that finishes after its document was replaced', async () => {
    let finishRead!: (pin: string) => void;
    jest.mocked(SeedStorageService.getStoredPin).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        })
    );
    await act(async () => {
      prompts[0]({ success: true });
    });
    expect(SeedStorageService.getStoredPin).toHaveBeenCalledTimes(1);
    await act(async () => {
      NativeBridge.invalidateAuthorization();
      screen.root.findByType('QRLWebView' as never).props.onDocumentLoadStart();
    });
    await act(async () => {
      finishRead('4826');
    });
    expectManualRetry();
    expect(NativeBridge.sendUnlockWithPinIfReady).not.toHaveBeenCalled();
  });

  it('rejects background-interrupted authentication until an explicit successful retry', async () => {
    await transition('inactive');
    await transition('background');
    await transition('active');
    await act(async () => {
      prompts[0]({ success: true });
    });
    expectManualRetry();
    expect(SeedStorageService.getStoredPin).not.toHaveBeenCalled();
    jest.mocked(SeedStorageService.getStoredPin).mockResolvedValue('9357');
    await act(async () => {
      button('Try Device Login Again').props.onPress();
    });
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(2);
    await act(async () => {
      prompts[1]({ success: true });
    });
    expect(NativeBridge.sendUnlockWithPinIfReady).toHaveBeenCalledTimes(1);
    expect(NativeBridge.sendUnlockWithPinIfReady).toHaveBeenCalledWith('9357', expect.any(Object));
    expect(state()).toMatchObject({
      promptCount: 2,
      deliveredUnlocks: 1,
      authorized: true,
      lockOverlay: false,
    });
  });

  it('authenticates once after an already unlocked session returns from background', async () => {
    await act(async () => {
      prompts[0]({ success: true });
    });
    expect(state()).toMatchObject({ promptCount: 1, deliveredUnlocks: 1, authorized: true });
    await transition('inactive');
    await transition('background');
    await transition('active');
    await transition('active');
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(2);
    expect(state()).toMatchObject({ deliveredUnlocks: 1, authorized: false, lockOverlay: true });
    jest.mocked(SeedStorageService.getStoredPin).mockResolvedValue('9357');
    await act(async () => {
      prompts[1]({ success: true });
    });
    expect(state()).toMatchObject({
      promptCount: 2,
      deliveredUnlocks: 2,
      authorized: true,
      lockOverlay: false,
    });
  });

  it('rejects a pending PIN verification after background and keeps manual retry usable', async () => {
    let completeVerification!: (result: { success: boolean }) => void;
    jest.mocked(NativeBridge.verifyPin).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeVerification = resolve;
        })
    );
    expect(button('Use Wallet PIN').props.disabled).toBe(false);
    await act(async () => {
      button('Use Wallet PIN').props.onPress();
    });
    let submission!: Promise<void>;
    await act(async () => {
      submission = screen.root.findByType('PinEntryModal' as never).props.onSubmit('9357');
    });
    expect(NativeBridge.verifyPin).toHaveBeenCalledTimes(1);
    expect(button('Use Wallet PIN').props.disabled).toBe(true);
    await transition('inactive');
    await transition('background');
    await transition('active');
    await act(async () => {
      completeVerification({ success: true });
      prompts[0]({ success: true });
      await submission;
    });
    expectManualRetry();
    expect(NativeBridge.sendUnlockWithPinIfReady).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'opens the fresh empty wallet only after authoritative wipe completion (old prompt pending: %s)',
    async (completionFirst) => {
      await act(async () => {
        NativeBridge.invalidateAuthorization();
        jest.mocked(NativeBridge.onWalletClearStarted).mock.calls[0][0]();
      });
      expect(state()).toMatchObject({ authorized: false, lockOverlay: true, deliveredUnlocks: 0 });
      jest.mocked(SeedStorageService.hasWallet).mockResolvedValue(false);
      if (completionFirst) {
        await act(async () => {
          jest.mocked(NativeBridge.onWalletCleared).mock.calls[0][0]();
        });
      }
      await act(async () => {
        prompts[0]({ success: true });
      });
      if (!completionFirst) {
        expect(state()).toMatchObject({ authorized: false, lockOverlay: true });
        await act(async () => {
          jest.mocked(NativeBridge.onWalletCleared).mock.calls[0][0]();
        });
      }
      expect(state()).toMatchObject({
        promptCount: 1,
        deliveredUnlocks: 0,
        authorized: true,
        lockOverlay: false,
        spinner: false,
      });
      expect(SeedStorageService.hasWallet).toHaveBeenCalledTimes(2);
      expect(SeedStorageService.getStoredPin).not.toHaveBeenCalled();
      expect(screen.root.findByType('QRLWebView' as never)).toBeDefined();
    }
  );

  it('keeps an incomplete or failed wipe locked until completion is confirmed', async () => {
    await act(async () => {
      NativeBridge.invalidateAuthorization();
      jest.mocked(NativeBridge.onWalletClearStarted).mock.calls[0][0]();
      prompts[0]({ success: true });
    });
    await transition('active');
    await act(async () => {
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
        .findAllByType(Text as never)
        .some((node) => node.props.children === 'Finishing wallet removal...')
    ).toBe(true);
    expect(SeedStorageService.getStoredPin).not.toHaveBeenCalled();
  });

  it.each(['document', 'wipe'])(
    'rejects a successful pending foreground result after %s invalidation',
    async (change) => {
      await transition('inactive');
      await act(async () => {
        prompts[0]({ success: true });
      });
      await act(async () => {
        NativeBridge.invalidateAuthorization();
        if (change === 'document')
          screen.root.findByType('QRLWebView' as never).props.onDocumentLoadStart();
        if (change === 'wipe') jest.mocked(NativeBridge.onWalletClearStarted).mock.calls[0][0]();
        jest.advanceTimersByTime(1000);
      });
      await transition('active');
      expect(NativeBridge.sendUnlockWithPinIfReady).not.toHaveBeenCalled();
      expect(SeedStorageService.getStoredPin).not.toHaveBeenCalled();
    }
  );
});
