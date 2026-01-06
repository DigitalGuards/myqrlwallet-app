import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import SeedStorageService from './SeedStorageService';

/**
 * Service for managing biometric authentication
 */
class BiometricService {
  /**
   * Check if device supports biometric authentication
   * @returns True if device supports biometrics
   */
  async isBiometricAvailable(): Promise<boolean> {
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      if (!compatible) return false;

      const enrolled = await LocalAuthentication.isEnrolledAsync();
      return enrolled;
    } catch (error) {
      console.error('Biometric availability check failed:', error);
      return false;
    }
  }

  /**
   * Get available biometric types (fingerprint, face recognition, etc.)
   * @returns Array of available biometric types
   */
  async getAvailableBiometricTypes(): Promise<string[]> {
    try {
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      const biometricTypes: string[] = [];

      if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        biometricTypes.push('fingerprint');
      }
      
      if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        biometricTypes.push('facial');
      }
      
      if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
        biometricTypes.push('iris');
      }

      return biometricTypes;
    } catch (error) {
      console.error('Failed to get biometric types:', error);
      return [];
    }
  }

  /**
   * Authenticate user using biometrics
   * @param promptMessage - Message to display in the authentication prompt
   * @returns Authentication result
   */
  async authenticate(promptMessage: string = 'Authenticate to access your wallet'): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage,
        fallbackLabel: 'Use passcode',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });

      return { success: result.success };
    } catch (error) {
      console.error('Authentication error:', error);
      return {
        success: false,
        error: 'Authentication failed. Please try again.',
      };
    }
  }

  /**
   * Get user-friendly biometric type name based on device
   * @returns User-friendly biometric name
   */
  getBiometricName(): string {
    if (Platform.OS === 'ios') {
      return 'Face ID / Touch ID';
    } else {
      return 'Biometric Authentication';
    }
  }

  // ============================================================
  // PIN-based Biometric Unlock
  // ============================================================

  /**
   * Authenticate with biometrics and retrieve the stored PIN
   * This is the main unlock flow for the app
   * @returns The stored PIN if authentication succeeds, null otherwise
   */
  async getPinWithBiometric(): Promise<{
    success: boolean;
    pin?: string;
    error?: string;
  }> {
    // First check if biometric is available
    const available = await this.isBiometricAvailable();
    if (!available) {
      return {
        success: false,
        error: 'Biometric authentication not available on this device',
      };
    }

    // Check if biometric unlock is enabled
    const biometricEnabled = await SeedStorageService.isBiometricEnabled();
    if (!biometricEnabled) {
      return {
        success: false,
        error: 'Biometric unlock not enabled',
      };
    }

    // Check if PIN is stored
    const hasPIN = await SeedStorageService.hasPinStored();
    if (!hasPIN) {
      return {
        success: false,
        error: 'No PIN stored for biometric unlock',
      };
    }

    // Perform biometric authentication
    const authResult = await this.authenticate('Unlock your wallet');
    if (!authResult.success) {
      return {
        success: false,
        error: authResult.error || 'Biometric authentication failed',
      };
    }

    // Retrieve the PIN
    const pin = await SeedStorageService.getStoredPin();
    if (!pin) {
      return {
        success: false,
        error: 'Failed to retrieve stored PIN',
      };
    }

    return {
      success: true,
      pin,
    };
  }

  /**
   * Set up biometric unlock by storing the PIN securely
   * @param pin The user's PIN to store
   * @returns Success status
   */
  async setupBiometricUnlock(pin: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      // Check if biometric is available
      const available = await this.isBiometricAvailable();
      if (!available) {
        return {
          success: false,
          error: 'Biometric authentication not available on this device',
        };
      }

      // Authenticate before storing (confirm user identity)
      const authResult = await this.authenticate(
        `Enable ${this.getBiometricName()} to unlock your wallet`
      );
      if (!authResult.success) {
        return {
          success: false,
          error: authResult.error || 'Authentication cancelled',
        };
      }

      // Store the PIN securely
      await SeedStorageService.storePinSecurely(pin);

      // Enable biometric unlock
      await SeedStorageService.setBiometricEnabled(true);

      return { success: true };
    } catch (error) {
      console.error('Failed to setup biometric unlock:', error);
      return {
        success: false,
        error: 'Failed to set up biometric unlock',
      };
    }
  }

  /**
   * Disable biometric unlock
   */
  async disableBiometricUnlock(): Promise<void> {
    await SeedStorageService.setBiometricEnabled(false);
  }

  /**
   * Check if biometric unlock is set up and ready
   */
  async isBiometricUnlockReady(): Promise<boolean> {
    const available = await this.isBiometricAvailable();
    const enabled = await SeedStorageService.isBiometricEnabled();
    const hasPin = await SeedStorageService.hasPinStored();

    return available && enabled && hasPin;
  }
}

export default new BiometricService(); 