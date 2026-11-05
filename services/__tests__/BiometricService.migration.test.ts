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
import { AppState, type AppStateStatus } from 'react-native';
import BiometricService from '../BiometricService';
import SeedStorageService from '../SeedStorageService';

const mockEnrolledLevel = jest.mocked(LocalAuthentication.getEnrolledLevelAsync);
const mockSupportedTypes = jest.mocked(LocalAuthentication.supportedAuthenticationTypesAsync);
const mockAuthenticate = jest.mocked(LocalAuthentication.authenticateAsync);
const mockGetStoredPin = jest.spyOn(SeedStorageService, 'getStoredPin');
const mockNeedsMigration = jest.spyOn(SeedStorageService, 'needsPinAccessibilityMigration');
const mockMigrate = jest.spyOn(SeedStorageService, 'migratePinAccessibility');

describe('BiometricService PIN accessibility migration', () => {
  let originalState: AppStateStatus;
  beforeEach(() => {
    originalState = AppState.currentState;
    AppState.currentState = 'active';
    jest.clearAllMocks();
    jest.mocked(SeedStorageService).getWalletGeneration.mockReturnValue(7);
    jest.mocked(SeedStorageService).isWalletGenerationCurrent.mockReturnValue(true);
    jest.mocked(SeedStorageService).isBiometricEnabled.mockResolvedValue(true);
    jest.mocked(SeedStorageService).hasPinStored.mockResolvedValue(true);
    mockEnrolledLevel.mockResolvedValue(LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG);
    mockSupportedTypes.mockResolvedValue([
      LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
    ]);
    mockAuthenticate.mockResolvedValue({ success: true });
    mockGetStoredPin.mockResolvedValue('1234');
    mockNeedsMigration.mockResolvedValue(true);
  });

  afterEach(() => {
    AppState.currentState = originalState;
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

  it.each(['disabled', 'rotated'])('skips stale accessibility migration after Device Login is %s', async change => {
    let releaseMigrationCheck: (() => void) | undefined;
    mockNeedsMigration.mockImplementationOnce(() => new Promise<boolean>(resolve => {
      releaseMigrationCheck = () => { resolve(true); };
    }));
    const unlock = BiometricService.getPinWithBiometric();
    for (let i = 0; i < 30 && !releaseMigrationCheck; i++) await Promise.resolve();
    expect(releaseMigrationCheck).toBeDefined();
    if (change === 'disabled') {
      jest.mocked(SeedStorageService).isBiometricEnabled.mockResolvedValue(false);
      mockGetStoredPin.mockResolvedValue(null);
    } else {
      mockGetStoredPin.mockResolvedValue('5678');
    }
    if (!releaseMigrationCheck) throw new Error('Migration check was not reached');
    releaseMigrationCheck();
    await unlock;
    expect(mockMigrate).not.toHaveBeenCalled();
  });
});
