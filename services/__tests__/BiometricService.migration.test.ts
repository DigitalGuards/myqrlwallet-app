jest.mock('expo-local-authentication', () => ({
  SecurityLevel: {
    NONE: 0,
    SECRET: 1,
    BIOMETRIC_WEAK: 2,
    BIOMETRIC_STRONG: 3,
  },
  AuthenticationType: {
    FINGERPRINT: 1,
    FACIAL_RECOGNITION: 2,
    IRIS: 3,
  },
  getEnrolledLevelAsync: jest.fn(),
  supportedAuthenticationTypesAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));
jest.mock('../SeedStorageService', () => ({
  __esModule: true,
  default: {
    getWalletGeneration: jest.fn(),
    isWalletGenerationCurrent: jest.fn(),
    isBiometricEnabled: jest.fn(),
    hasPinStored: jest.fn(),
    getStoredPin: jest.fn(),
    needsPinAccessibilityMigration: jest.fn(),
    migratePinAccessibility: jest.fn(),
  },
}));
jest.mock('../NativeBridge', () => ({
  __esModule: true,
  NATIVE_PIN_CHANGE_AMBIGUOUS_ERROR: 'Native PIN change outcome is ambiguous',
  NATIVE_PIN_COMMIT_ERROR: 'Native secure PIN commit failed',
  default: {},
}));
jest.mock('../Logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), error: jest.fn() },
}));

import * as LocalAuthentication from 'expo-local-authentication';
import BiometricService from '../BiometricService';
import SeedStorageService from '../SeedStorageService';

const mockEnrolledLevel =
  LocalAuthentication.getEnrolledLevelAsync as jest.MockedFunction<
    typeof LocalAuthentication.getEnrolledLevelAsync
  >;
const mockSupportedTypes =
  LocalAuthentication.supportedAuthenticationTypesAsync as jest.MockedFunction<
    typeof LocalAuthentication.supportedAuthenticationTypesAsync
  >;
const mockAuthenticate = LocalAuthentication.authenticateAsync as jest.MockedFunction<
  typeof LocalAuthentication.authenticateAsync
>;
const mockGetStoredPin = SeedStorageService.getStoredPin as jest.MockedFunction<
  typeof SeedStorageService.getStoredPin
>;
const mockNeedsMigration =
  SeedStorageService.needsPinAccessibilityMigration as jest.MockedFunction<
    typeof SeedStorageService.needsPinAccessibilityMigration
  >;
const mockMigrate = SeedStorageService.migratePinAccessibility as jest.MockedFunction<
  typeof SeedStorageService.migratePinAccessibility
>;

describe('BiometricService PIN accessibility migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (SeedStorageService.getWalletGeneration as jest.Mock).mockReturnValue(7);
    (SeedStorageService.isWalletGenerationCurrent as jest.Mock).mockReturnValue(true);
    (SeedStorageService.isBiometricEnabled as jest.Mock).mockResolvedValue(true);
    (SeedStorageService.hasPinStored as jest.Mock).mockResolvedValue(true);
    mockEnrolledLevel.mockResolvedValue(LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG);
    mockSupportedTypes.mockResolvedValue([
      LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
    ]);
    mockAuthenticate.mockResolvedValue({ success: true });
    mockGetStoredPin.mockResolvedValue('1234');
    mockNeedsMigration.mockResolvedValue(true);
  });

  it('still unlocks with the authenticated PIN when migration must retry later', async () => {
    mockMigrate.mockResolvedValue(false);

    await expect(BiometricService.getPinWithBiometric()).resolves.toEqual({
      success: true,
      pin: '1234',
    });
    expect(mockMigrate).toHaveBeenCalledWith('1234');
  });

  it('never reports success when secure storage yields no PIN after authentication', async () => {
    mockGetStoredPin.mockResolvedValue(null);

    await expect(BiometricService.getPinWithBiometric()).resolves.toEqual({
      success: false,
      error: 'Failed to retrieve stored PIN',
    });
    expect(mockMigrate).not.toHaveBeenCalled();
  });
});
