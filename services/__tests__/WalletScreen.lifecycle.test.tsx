import React, { act } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import WalletScreen from '../../app/(tabs)/index';
import BiometricService from '../BiometricService';
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
  });

  async function mount(state: AppStateStatus = 'active') {
    AppState.currentState = state;
    await act(async () => {
      screen = create(<WalletScreen />);
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

  it.each(['inactive', 'background', 'unknown'] as AppStateStatus[])(
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

  it('starts once on an active initial mount', async () => {
    await mount();
    expect(BiometricService.getPinWithBiometric).toHaveBeenCalledTimes(1);
  });

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
