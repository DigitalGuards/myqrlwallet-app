import React, { act } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import WalletScreen from '../../app/(tabs)/index';
import BiometricService from '../BiometricService';
import SeedStorageService from '../SeedStorageService';
import NativeBridge, { type NativeQrScanRequest } from '../NativeBridge';

const mockInvalidationListeners = new Set<() => void>();
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
jest.mock('../Logger', () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../WebViewService', () => ({ updateLastSession: jest.fn() }));
jest.mock('../SeedStorageService', () => ({
  getPendingWalletWipe: jest.fn(async () => null),
  hasWallet: jest.fn(async () => true),
  isBiometricEnabled: jest.fn(async () => true),
}));
jest.mock('../BiometricService', () => ({
  getPinWithBiometric: jest.fn(async () => ({ success: false, error: 'Cancelled test prompt' })),
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
  let screen: ReactTestRenderer | undefined;
  const listeners = new Set<(state: AppStateStatus) => void>();
  let original: AppStateStatus;

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
    if (screen) await act(async () => screen?.unmount());
    screen = undefined;
    AppState.currentState = original;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  async function mount(state: AppStateStatus = 'active', startDocument = true) {
    AppState.currentState = state;
    await act(async () => {
      screen = create(<WalletScreen />);
    });
    expect(BiometricService.getPinWithBiometric).not.toHaveBeenCalled();
    if (startDocument) await documentLoadStart();
  }
  async function documentLoadStart() {
    await act(async () => {
      NativeBridge.invalidateAuthorization();
      screen!.root.findByType('QRLWebView' as never).props.onDocumentLoadStart();
    });
  }
  async function transition(next: AppStateStatus) {
    await act(async () => {
      AppState.currentState = next;
      for (const listener of [...listeners]) listener(next);
    });
  }
  function scanner() {
    return screen!.root.findByType('QRScannerModal' as never).props;
  }
  async function openScanner(id: string) {
    const request = {
      requestId: id,
      context: NativeBridge.captureSecurityContext(),
    } as NativeQrScanRequest;
    await act(async () => {
      jest.mocked(NativeBridge.onQRScanRequest).mock.calls[0][0](request);
    });
    expect(scanner().visible).toBe(true);
    return { request, callbacks: scanner() };
  }

  it.each(['inactive', 'background', 'unknown', null] as AppStateStatus[])(
    'starts authentication once when first mounted %s and then activated',
    async (state) => {
      await mount(state);
      expect(BiometricService.getPinWithBiometric).not.toHaveBeenCalled();
      await transition('active');
      await transition('active');
      expect(BiometricService.getPinWithBiometric).toHaveBeenCalledTimes(1);
      expect(NativeBridge.setNativeAuthorization).toHaveBeenLastCalledWith(false);
    }
  );

  it('starts once after the first document load on an active initial mount', async () => {
    await mount();
    expect(BiometricService.getPinWithBiometric).toHaveBeenCalledTimes(1);
  });

  it.each(['inactive', 'unknown', null] as AppStateStatus[])(
    'waits for the first document if %s becomes active before it starts',
    async (state) => {
      await mount(state, false);
      await transition('active');
      expect(BiometricService.getPinWithBiometric).not.toHaveBeenCalled();
      await documentLoadStart();
      expect(BiometricService.getPinWithBiometric).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    ['getPendingWalletWipe', null],
    ['hasWallet', true],
    ['isBiometricEnabled', true],
  ] as const)(
    'resumes a live %s preflight after a short inactive interval',
    async (method, value) => {
      let finishRead!: (result: typeof value) => void;
      const read = new Promise<typeof value>((resolve) => { finishRead = resolve; });
      jest.mocked(SeedStorageService[method]).mockImplementationOnce(() => read as never);
      await mount();
      expect(BiometricService.getPinWithBiometric).not.toHaveBeenCalled();
      await transition('inactive');
      await act(async () => {
        finishRead(value);
        jest.advanceTimersByTime(100);
      });
      expect(BiometricService.getPinWithBiometric).not.toHaveBeenCalled();
      await transition('active');
      expect(BiometricService.getPinWithBiometric).toHaveBeenCalledTimes(1);
      await transition('active');
      expect(BiometricService.getPinWithBiometric).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['authorization', 'background', 'wallet-clear', 'document'])(
    'closes scanner on %s and rejects retained camera callbacks',
    async (reason) => {
      await mount();
      const { callbacks } = await openScanner('first');
      await act(async () => {
        if (reason === 'authorization') NativeBridge.invalidateAuthorization();
        if (reason === 'wallet-clear')
          jest.mocked(NativeBridge.onWalletClearStarted).mock.calls[0][0]();
        if (reason === 'document')
          screen!.root.findByType('QRLWebView' as never).props.onDocumentLoadStart();
      });
      if (reason === 'background') await transition('background');
      expect(scanner().visible).toBe(false);
      await act(async () => {
        callbacks.onScan('qrlconnect://stale');
        callbacks.onClose();
      });
      expect(NativeBridge.sendQRResult).not.toHaveBeenCalled();
      expect(NativeBridge.sendQRCancelled).not.toHaveBeenCalled();
    }
  );

  it('rejects an old camera callback after a new request in the same session', async () => {
    await mount();
    const first = await openScanner('first');
    const second = await openScanner('second');
    await act(async () => {
      first.callbacks.onScan('stale');
      first.callbacks.onClose();
    });
    expect(NativeBridge.sendQRResult).not.toHaveBeenCalled();
    expect(scanner().visible).toBe(true);
    await act(async () => {
      second.callbacks.onScan('fresh');
      second.callbacks.onClose();
    });
    expect(NativeBridge.sendQRResult).toHaveBeenCalledWith('fresh', second.request);
    expect(NativeBridge.sendQRResult).toHaveBeenCalledTimes(1);
    expect(NativeBridge.sendQRCancelled).not.toHaveBeenCalled();
    expect(scanner().visible).toBe(false);
  });

  it('cancels the current scanner once when unmounted', async () => {
    await mount();
    const { request, callbacks } = await openScanner('current');
    await act(async () => {
      screen?.unmount();
      screen = undefined;
    });
    await act(async () => {
      callbacks.onScan('stale');
      callbacks.onClose();
    });
    expect(NativeBridge.sendQRCancelled).toHaveBeenCalledTimes(1);
    expect(NativeBridge.sendQRCancelled).toHaveBeenCalledWith(request);
    expect(NativeBridge.sendQRResult).not.toHaveBeenCalled();
  });
});
