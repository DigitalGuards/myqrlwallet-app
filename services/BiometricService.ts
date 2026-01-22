import * as LocalAuthentication from 'expo-local-authentication';
import SeedStorageService from './SeedStorageService';
import NativeBridge from './NativeBridge';

/**
 * Service for managing device authentication (biometrics, PIN, pattern, passcode)
 */
class BiometricService {
  /**
   * Check if device supports any form of authentication (biometrics, PIN, pattern, passcode)
   * @returns True if device has any authentication method available
   */
  async isBiometricAvailable(): Promise<boolean> {
    try {
      const securityLevel = await LocalAuthentication.getEnrolledLevelAsync();
      // SecurityLevel.NONE is 0, .SECRET is 1, .BIOMETRIC is 2.
      // Any level greater than NONE means some form of authentication is enrolled.
      return securityLevel > LocalAuthentication.SecurityLevel.NONE;
    } catch (error) {
      console.error('Device authentication availability check failed:', error);
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
   * Get user-friendly name for device authentication
   * @returns User-friendly device login name
   */
  getDeviceLoginName(): string {
    return 'Device Login';
  }

  // ============================================================
  // PIN-based Device Login
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
    // First check if device login is available
    const available = await this.isBiometricAvailable();
    if (!available) {
      return {
        success: false,
        error: 'Device Login not available on this device',
      };
    }

    // Check if device login is enabled
    const biometricEnabled = await SeedStorageService.isBiometricEnabled();
    if (!biometricEnabled) {
      return {
        success: false,
        error: 'Device Login not enabled',
      };
    }

    // Check if PIN is stored
    const hasPIN = await SeedStorageService.hasPinStored();
    if (!hasPIN) {
      return {
        success: false,
        error: 'No PIN stored for Device Login',
      };
    }

    // Perform device authentication
    const authResult = await this.authenticate('Unlock your wallet');
    if (!authResult.success) {
      return {
        success: false,
        error: authResult.error || 'Device Login failed',
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
   * Set up device login by storing the PIN securely
   * Verifies PIN can decrypt the wallet seed before storing
   * @param pin The user's PIN to store
   * @returns Success status
   */
  async setupDeviceLogin(pin: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      // Check if device login is available
      const available = await this.isBiometricAvailable();
      if (!available) {
        return {
          success: false,
          error: 'Device Login not available on this device',
        };
      }

      // First verify the PIN with the web app (ensures it can decrypt the seed)
      console.log('[BiometricService] Verifying PIN with web app...');
      const verifyResult = await NativeBridge.verifyPin(pin);
      if (!verifyResult.success) {
        console.log('[BiometricService] PIN verification failed:', verifyResult.error);
        return {
          success: false,
          error: verifyResult.error || 'Incorrect PIN',
        };
      }
      console.log('[BiometricService] PIN verified successfully');

      // Authenticate before storing (confirm user identity)
      const authResult = await this.authenticate(
        'Enable Device Login to unlock your wallet'
      );
      if (!authResult.success) {
        return {
          success: false,
          error: authResult.error || 'Authentication cancelled',
        };
      }

      // Store the PIN securely
      await SeedStorageService.storePinSecurely(pin);

      // Enable device login
      await SeedStorageService.setBiometricEnabled(true);

      return { success: true };
    } catch (error) {
      console.error('Failed to setup Device Login:', error);
      return {
        success: false,
        error: 'Failed to set up Device Login',
      };
    }
  }

  /**
   * Disable device login
   */
  async disableDeviceLogin(): Promise<void> {
    await SeedStorageService.setBiometricEnabled(false);
  }

  /**
   * Check if device login is set up and ready
   */
  async isDeviceLoginReady(): Promise<boolean> {
    const available = await this.isBiometricAvailable();
    const enabled = await SeedStorageService.isBiometricEnabled();
    const hasPin = await SeedStorageService.hasPinStored();

    return available && enabled && hasPin;
  }

  /**
   * Change the wallet PIN
   * Sends CHANGE_PIN message to web app to re-encrypt all seeds
   * Updates SecureStore with new PIN on success
   * @param oldPin The current PIN
   * @param newPin The new PIN to set
   * @returns Success status and optional error message
   */
  async changePin(oldPin: string, newPin: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      console.log('[BiometricService] Requesting PIN change via web app...');

      // Send CHANGE_PIN to web and wait for PIN_CHANGED response
      const result = await NativeBridge.changePin(oldPin, newPin);

      if (!result.success) {
        console.log('[BiometricService] PIN change failed:', result.error);
        return {
          success: false,
          error: result.error || 'Failed to change PIN',
        };
      }

      // Update SecureStore with the new PIN
      console.log('[BiometricService] Web confirmed PIN change, updating SecureStore...');
      await SeedStorageService.storePinSecurely(newPin);
      console.log('[BiometricService] PIN changed successfully');

      return { success: true };
    } catch (error) {
      console.error('[BiometricService] Failed to change PIN:', error);
      return {
        success: false,
        error: 'Failed to change PIN',
      };
    }
  }
}

export default new BiometricService(); 