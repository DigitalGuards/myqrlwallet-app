jest.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
  getEnrolledLevelAsync: jest.fn(),
  supportedAuthenticationTypesAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));
jest.mock('../SeedStorageService', () => ({
  getWalletGeneration: jest.fn(),
  isWalletGenerationCurrent: jest.fn(),
  isBiometricEnabled: jest.fn(),
  hasPinStored: jest.fn(),
  getStoredPin: jest.fn(),
  needsPinAccessibilityMigration: jest.fn(),
}));
jest.mock('../DeviceLoginState', () => ({ migratePinAccessibility: jest.fn() }));
jest.mock('../NativeBridge', () => ({}));
jest.mock('../Logger', () => ({ debug: jest.fn(), error: jest.fn() }));

import { AppState, type AppStateStatus } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import BiometricService from '../BiometricService';
import SeedStorageService from '../SeedStorageService';
import DeviceLoginState from '../DeviceLoginState';

describe('Device Login successful prompt foreground completion', () => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  let originalState: AppStateStatus;
  let resolvePrompt: (result: LocalAuthentication.LocalAuthenticationResult) => void;

  const drain = async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  };
  const transition = (state: AppStateStatus) => {
    AppState.currentState = state;
    for (const listener of [...listeners]) listener(state);
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    originalState = AppState.currentState;
    AppState.currentState = 'active';
    listeners.clear();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    });
    jest.mocked(SeedStorageService.getWalletGeneration).mockReturnValue(7);
    jest.mocked(SeedStorageService.isWalletGenerationCurrent).mockReturnValue(true);
    jest.mocked(SeedStorageService.isBiometricEnabled).mockResolvedValue(true);
    jest.mocked(SeedStorageService.hasPinStored).mockResolvedValue(true);
    jest.mocked(SeedStorageService.getStoredPin).mockResolvedValue('1234');
    jest.mocked(SeedStorageService.needsPinAccessibilityMigration).mockResolvedValue(false);
    jest.mocked(LocalAuthentication.getEnrolledLevelAsync).mockResolvedValue(3);
    jest.mocked(LocalAuthentication.supportedAuthenticationTypesAsync).mockResolvedValue([2]);
    jest.mocked(LocalAuthentication.authenticateAsync).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePrompt = resolve;
        })
    );
  });

  afterEach(() => {
    AppState.currentState = originalState;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each([350, 1_000, 5_000, 9_999])(
    'waits for active after a %ims successful prompt return',
    async (delay) => {
      const unlock = BiometricService.getPinWithBiometric();
      await drain();
      transition('inactive');
      resolvePrompt({ success: true });
      await drain();
      await jest.advanceTimersByTimeAsync(delay);
      expect(SeedStorageService.getStoredPin).not.toHaveBeenCalled();
      transition('active');
      await expect(unlock).resolves.toEqual({ success: true, pin: '1234' });
      expect(listeners.size).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
    }
  );

  it('keeps transition protection continuously until foreground, then notifies settlement', async () => {
    const settled = jest.fn();
    const unsubscribe = BiometricService.onAuthenticationPromptSettled(settled);
    try {
      const unlock = BiometricService.getPinWithBiometric();
      await drain();
      expect(BiometricService.isAuthenticationTransitionActive()).toBe(true);
      transition('inactive');
      resolvePrompt({ success: true });
      await drain();
      expect(BiometricService.isAuthenticationPromptActive()).toBe(false);
      expect(BiometricService.isAuthenticationTransitionActive()).toBe(true);
      expect(settled).not.toHaveBeenCalled();
      transition('active');
      await unlock;
      expect(BiometricService.isAuthenticationTransitionActive()).toBe(false);
      expect(settled).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it('expires at ten seconds and disposes listeners/timers without reading a PIN', async () => {
    const unlock = BiometricService.getPinWithBiometric();
    await drain();
    transition('inactive');
    resolvePrompt({ success: true });
    await drain();
    await jest.advanceTimersByTimeAsync(10_000);
    await expect(unlock).resolves.toMatchObject({ success: false });
    expect(BiometricService.isAuthenticationTransitionActive()).toBe(false);
    expect(SeedStorageService.getStoredPin).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    transition('active');
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
  });

  it.each(['caller', 'wallet', 'operation', 'throwing-caller'])(
    'cancels %s context loss without an AppState event',
    async (kind) => {
      let current = true;
      const unlock = BiometricService.getPinWithBiometric(() => {
        if (!current && kind === 'throwing-caller') throw new Error('disposed');
        return current;
      });
      await drain();
      transition('inactive');
      resolvePrompt({ success: true });
      await drain();
      if (kind === 'wallet')
        jest.mocked(SeedStorageService.isWalletGenerationCurrent).mockReturnValue(false);
      else if (kind === 'operation') BiometricService.clearPendingSecurityOperations();
      else current = false;
      await jest.advanceTimersByTimeAsync(50);
      await expect(unlock).resolves.toMatchObject({ success: false });
      expect(SeedStorageService.getStoredPin).not.toHaveBeenCalled();
      expect(listeners.size).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
      expect(BiometricService.isAuthenticationTransitionActive()).toBe(false);
    }
  );

  it.each(['before-result', 'after-result'])(
    'rejects a real background transition %s, even if active resumes immediately',
    async (when) => {
      const unlock = BiometricService.getPinWithBiometric();
      await drain();
      transition('inactive');
      if (when === 'after-result') {
        resolvePrompt({ success: true });
        await drain();
      }
      transition('background');
      transition('active');
      if (when === 'before-result') resolvePrompt({ success: true });
      await expect(unlock).resolves.toMatchObject({ success: false });
      expect(SeedStorageService.getStoredPin).not.toHaveBeenCalled();
      expect(listeners.size).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
    }
  );

  it.each(['read', 'migration-check', 'migration'])(
    'rejects stale context after the async %s boundary',
    async (boundary) => {
      let current = true;
      let finish!: () => void;
      if (boundary === 'read') {
        jest.mocked(SeedStorageService.getStoredPin).mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = () => resolve('1234');
            })
        );
      } else {
        jest.mocked(SeedStorageService.needsPinAccessibilityMigration).mockResolvedValue(true);
        if (boundary === 'migration-check') {
          jest.mocked(SeedStorageService.needsPinAccessibilityMigration).mockImplementationOnce(
            () =>
              new Promise((resolve) => {
                finish = () => resolve(true);
              })
          );
        } else {
          jest.mocked(DeviceLoginState.migratePinAccessibility).mockImplementationOnce(
            () =>
              new Promise((resolve) => {
                finish = () => resolve(true);
              })
          );
        }
      }
      const unlock = BiometricService.getPinWithBiometric(() => current);
      await drain();
      resolvePrompt({ success: true });
      await drain();
      expect(finish).toBeDefined();
      current = false;
      finish();
      await expect(unlock).resolves.toMatchObject({ success: false });
      expect(listeners.size).toBe(0);
    }
  );

  it('protects the biometrics-only success probe through its foreground return', async () => {
    jest.mocked(LocalAuthentication.getEnrolledLevelAsync).mockResolvedValue(1);
    const unlock = BiometricService.getPinWithBiometric();
    await drain();
    transition('inactive');
    resolvePrompt({ success: true });
    await drain();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(SeedStorageService.getStoredPin).not.toHaveBeenCalled();
    transition('active');
    await expect(unlock).resolves.toMatchObject({ success: true, pin: '1234' });
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
  });

  it.each(['user_cancel', 'app_cancel', 'system_cancel'] as const)(
    'does not fall through to a second prompt after probe %s',
    async (error) => {
      jest.mocked(LocalAuthentication.getEnrolledLevelAsync).mockResolvedValue(1);
      const unlock = BiometricService.getPinWithBiometric();
      await drain();
      resolvePrompt({ success: false, error });
      await expect(unlock).resolves.toMatchObject({ success: false });
      expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
      expect(SeedStorageService.getStoredPin).not.toHaveBeenCalled();
      expect(listeners.size).toBe(0);
    }
  );

  it('leaves generic Settings authentication without an extended inactive return', async () => {
    const authenticate = BiometricService.authenticate();
    transition('inactive');
    resolvePrompt({ success: true });
    await expect(authenticate).resolves.toEqual({ success: true });
    expect(BiometricService.isAuthenticationTransitionActive()).toBe(false);
    expect(SeedStorageService.getStoredPin).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});
