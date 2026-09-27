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

import { AppState, Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import BiometricService from '../BiometricService';
import SeedStorageService from '../SeedStorageService';

describe('Device Login with biometric hardware but no enrolled biometric', () => {
  afterEach(() => jest.restoreAllMocks());

  beforeEach(() => {
    jest.resetAllMocks();
    AppState.currentState = 'active';
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
    jest.mocked(SeedStorageService.getWalletGeneration).mockReturnValue(7);
    jest.mocked(SeedStorageService.isWalletGenerationCurrent).mockReturnValue(true);
    jest.mocked(SeedStorageService.isBiometricEnabled).mockResolvedValue(true);
    jest.mocked(SeedStorageService.hasPinStored).mockResolvedValue(true);
    jest.mocked(SeedStorageService.getStoredPin).mockResolvedValue('482913');
    jest.mocked(SeedStorageService.needsPinAccessibilityMigration).mockResolvedValue(false);
    // Fingerprint hardware, only a screen lock enrolled.
    jest.mocked(LocalAuthentication.getEnrolledLevelAsync).mockResolvedValue(1);
    jest.mocked(LocalAuthentication.supportedAuthenticationTypesAsync).mockResolvedValue([1]);
    jest
      .mocked(LocalAuthentication.authenticateAsync)
      .mockResolvedValueOnce({ success: false, error: 'not_available' })
      .mockResolvedValueOnce({ success: true });
  });

  it('unlocks with the Android screen lock', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'android');
    const result = await BiometricService.getPinWithBiometric();
    platform.restore();
    expect(result).toMatchObject({ success: true, pin: '482913' });
    expect(result.biometricOffForApp).toBeUndefined();
    const calls = jest.mocked(LocalAuthentication.authenticateAsync).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]?.[0]).toMatchObject({ disableDeviceFallback: false });
  });

  it('keeps the iOS per-app biometric nudge', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'ios');
    const result = await BiometricService.getPinWithBiometric();
    platform.restore();
    expect(result).toMatchObject({ success: false, biometricOffForApp: true });
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
  });
});
