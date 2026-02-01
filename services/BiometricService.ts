import * as LocalAuthentication from 'expo-local-authentication';
import SeedStorageService from './SeedStorageService';
import NativeBridge from './NativeBridge';
import Logger from './Logger';

/**
 * Queued PIN change request (stored in memory for navigation between screens)
 */
interface PinChangeRequest {
  oldPin: string;
  newPin: string;
}

/**
 * Service for managing device authentication (biometrics, PIN, pattern, passcode)
 */
class BiometricService {
  // In-memory queue for PIN change (used during navigation from Settings to WebView tab)
  private pendingPinChange: PinChangeRequest | null = null;
  // In-memory queue for Device Login setup (used during navigation from Settings to WebView tab)
  private pendingDeviceLoginPin: string | null = null;
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
      Logger.error('BiometricService', 'Device authentication availability check failed:', error);
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
      Logger.error('BiometricService', 'Failed to get biometric types:', error);
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
      Logger.error('BiometricService', 'Authentication error:', error);
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
      Logger.debug('BiometricService', 'Verifying PIN with web app...');
      const verifyResult = await NativeBridge.verifyPin(pin, 30000);
      if (!verifyResult.success) {
        Logger.debug('BiometricService', 'PIN verification failed:', verifyResult.error);
        return {
          success: false,
          error: verifyResult.error || 'Incorrect PIN',
        };
      }
      Logger.debug('BiometricService', 'PIN verified successfully');

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
      Logger.error('BiometricService', 'Failed to setup Device Login:', error);
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

  // ============================================================
  // PIN Change Queue (for navigation-based execution)
  // ============================================================
  // WebView JavaScript execution is throttled when Settings tab is active.
  // To execute PIN change reliably, we queue the request and navigate to
  // the WebView tab, which activates the WebView and processes the message.

  /**
   * Queue a PIN change request for execution after navigation
   * Call this from Settings, then navigate to index with ?changePin=true
   * @param oldPin The current PIN
   * @param newPin The new PIN to set
   */
  queuePinChange(oldPin: string, newPin: string): void {
    this.pendingPinChange = { oldPin, newPin };
  }

  /**
   * Check if there's a pending PIN change request
   */
  hasPendingPinChange(): boolean {
    return this.pendingPinChange !== null;
  }

  /**
   * Execute the queued PIN change request
   * Call this from index.tsx when changePin param is detected
   * @returns Result of the PIN change operation
   */
  async executePendingPinChange(): Promise<{
    success: boolean;
    error?: string;
  }> {
    if (!this.pendingPinChange) {
      return { success: false, error: 'No PIN change request queued' };
    }

    const { oldPin, newPin } = this.pendingPinChange;
    this.pendingPinChange = null; // Clear immediately to prevent re-execution

    return this.changePin(oldPin, newPin);
  }

  /**
   * Clear any pending PIN change request
   * Call this if the operation is cancelled
   */
  clearPendingPinChange(): void {
    this.pendingPinChange = null;
  }

  // ============================================================
  // Device Login Setup Queue (for navigation-based execution)
  // ============================================================
  // Same pattern as PIN change - queue on Settings, execute on WebView tab.

  /**
   * Queue a Device Login setup request for execution after navigation
   * Call this from Settings, then navigate to index with ?enableDeviceLogin=true
   * @param pin The PIN to verify and store for Device Login
   */
  queueDeviceLoginSetup(pin: string): void {
    this.pendingDeviceLoginPin = pin;
  }

  /**
   * Check if there's a pending Device Login setup request
   */
  hasPendingDeviceLoginSetup(): boolean {
    return this.pendingDeviceLoginPin !== null;
  }

  /**
   * Execute the queued Device Login setup request
   * Call this from index.tsx when enableDeviceLogin param is detected
   * @returns Result of the setup operation
   */
  async executePendingDeviceLoginSetup(): Promise<{
    success: boolean;
    error?: string;
  }> {
    if (!this.pendingDeviceLoginPin) {
      return { success: false, error: 'No Device Login setup request queued' };
    }

    const pin = this.pendingDeviceLoginPin;
    this.pendingDeviceLoginPin = null; // Clear immediately to prevent re-execution

    return this.setupDeviceLogin(pin);
  }

  /**
   * Clear any pending Device Login setup request
   * Call this if the operation is cancelled
   */
  clearPendingDeviceLoginSetup(): void {
    this.pendingDeviceLoginPin = null;
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
      Logger.debug('BiometricService', 'Requesting PIN change via web app...');

      // Send CHANGE_PIN to web and wait for PIN_CHANGED response
      const result = await NativeBridge.changePin(oldPin, newPin);

      if (!result.success) {
        Logger.debug('BiometricService', 'PIN change failed:', result.error);
        return {
          success: false,
          error: result.error || 'Failed to change PIN',
        };
      }

      // Update SecureStore with the new PIN
      try {
        Logger.debug('BiometricService', 'Web confirmed PIN change, updating SecureStore...');
        await SeedStorageService.storePinSecurely(newPin);
        Logger.debug('BiometricService', 'PIN changed successfully');
      } catch (storageError) {
        Logger.error('BiometricService', 'Failed to store new PIN for biometrics:', storageError);
        return {
          success: true, // The PIN change was successful on the web side
          error: 'PIN changed, but failed to update for Device Login. Please disable and re-enable Device Login in settings to resolve this.',
        };
      }

      return { success: true };
    } catch (error) {
      Logger.error('BiometricService', 'Failed to change PIN:', error);
      return {
        success: false,
        error: 'An unexpected error occurred while changing your PIN.',
      };
    }
  }
}

export default new BiometricService(); 