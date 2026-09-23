import * as LocalAuthentication from 'expo-local-authentication';
import { AppState } from 'react-native';
import SeedStorageService from './SeedStorageService';
import NativeBridge, {
  NATIVE_PIN_CHANGE_AMBIGUOUS_ERROR,
  NATIVE_PIN_COMMIT_ERROR,
} from './NativeBridge';
import Logger from './Logger';
import DeviceLoginState from './DeviceLoginState';
import { waitForForegroundAuthorization } from './ForegroundAuthorization';

const AUTHENTICATION_FOREGROUND_TIMEOUT_MS = 10_000;
const AUTHENTICATION_CHANGED_ERROR = 'Wallet state changed during authentication';

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
  private securityOperationGeneration = 0;
  private activeAuthenticationPrompts = 0;
  private pendingAuthenticationReturns = new Set<object>();
  private pinAuthenticationGeneration = 0;
  private authenticationSettledListeners = new Set<() => void>();

  isAuthenticationPromptActive(): boolean {
    return this.activeAuthenticationPrompts > 0;
  }

  isAuthenticationTransitionActive(): boolean {
    return this.isAuthenticationPromptActive() || this.pendingAuthenticationReturns.size > 0;
  }

  private notifyAuthenticationSettled(): void {
    if (!this.isAuthenticationTransitionActive()) {
      for (const listener of this.authenticationSettledListeners) listener();
    }
  }

  onAuthenticationPromptSettled(listener: () => void): () => void {
    this.authenticationSettledListeners.add(listener);
    return () => {
      this.authenticationSettledListeners.delete(listener);
    };
  }

  private async runAuthenticationPrompt(
    options: LocalAuthentication.LocalAuthenticationOptions,
    onSuccess?: () => void,
  ): Promise<LocalAuthentication.LocalAuthenticationResult> {
    this.activeAuthenticationPrompts += 1;
    try {
      const result = await LocalAuthentication.authenticateAsync(options);
      if (result.success) onSuccess?.();
      return result;
    } finally {
      this.activeAuthenticationPrompts -= 1;
      this.notifyAuthenticationSettled();
    }
  }

  private async authenticateInForeground(
    options: LocalAuthentication.LocalAuthenticationOptions,
    isCurrent: () => boolean
  ): Promise<LocalAuthentication.LocalAuthenticationResult> {
    if (!isCurrent()) return { success: false, error: 'app_cancel' };
    const pendingReturn = {};
    let foreground: Promise<boolean> | undefined;
    try {
      const result = await this.runAuthenticationPrompt(options, () => {
        // Reserve the successful return before prompt-settled observers can relock.
        if (!isCurrent()) return;
        this.pendingAuthenticationReturns.add(pendingReturn);
        foreground = waitForForegroundAuthorization(isCurrent, AUTHENTICATION_FOREGROUND_TIMEOUT_MS);
      });
      if (!result.success) return result;
      if (!foreground || !(await foreground) || !isCurrent()) {
        return { success: false, error: 'app_cancel' };
      }
      return result;
    } finally {
      if (this.pendingAuthenticationReturns.delete(pendingReturn)) {
        this.notifyAuthenticationSettled();
      }
    }
  }

  clearPendingSecurityOperations(): void {
    this.securityOperationGeneration += 1;
    this.pendingPinChange = null;
    this.pendingDeviceLoginPin = null;
  }

  private isSecurityOperationCurrent(operationGeneration: number, walletGeneration: number): boolean {
    return (
      operationGeneration === this.securityOperationGeneration &&
      SeedStorageService.isWalletGenerationCurrent(walletGeneration)
    );
  }
  /**
   * Check if device supports any form of authentication (biometrics, PIN, pattern, passcode)
   * @returns True if device has any authentication method available
   */
  async isBiometricAvailable(): Promise<boolean> {
    try {
      const securityLevel = await LocalAuthentication.getEnrolledLevelAsync();
      // SecurityLevel.NONE=0, .SECRET=1 (passcode/PIN/pattern), .BIOMETRIC_WEAK=2,
      // .BIOMETRIC_STRONG=3. iOS reports BIOMETRIC_STRONG(3) for a usable Face ID /
      // Touch ID. Any level greater than NONE means some form of authentication is
      // enrolled - "Device Login" deliberately covers passcode-only devices too.
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
   * Inspect whether the device has biometric hardware and whether that biometric
   * is currently USABLE BY THIS APP.
   *
   * On iOS, supportedAuthenticationTypesAsync() reflects the hardware (it reads
   * LAContext.biometryType), so it still reports Face ID even when the user has
   * turned Face ID OFF for this app in Settings (a sticky "Don't Allow"), or has
   * not enrolled a face, or is locked out. In all of those states
   * getEnrolledLevelAsync() drops to SECRET. The gap between "hardware present"
   * and "level >= biometric" tells us "this device has a biometric but it is not
   * usable right now" - it does NOT tell us WHY. Distinguishing the why
   * (off-for-app vs not-enrolled vs lockout) requires a biometrics-only
   * authenticateAsync probe; see getPinWithBiometric.
   */
  async getBiometricStatus(): Promise<{
    hasBiometricHardware: boolean;
    biometricUsable: boolean;
    biometricType: 'face' | 'fingerprint' | 'iris' | null;
  }> {
    try {
      const [level, types] = await Promise.all([
        LocalAuthentication.getEnrolledLevelAsync(),
        LocalAuthentication.supportedAuthenticationTypesAsync(),
      ]);

      let biometricType: 'face' | 'fingerprint' | 'iris' | null = null;
      if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        biometricType = 'face';
      } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        biometricType = 'fingerprint';
      } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
        biometricType = 'iris';
      }

      return {
        hasBiometricHardware: biometricType !== null,
        // >= BIOMETRIC_WEAK(2) counts as usable: iOS reports STRONG(3) for Face ID /
        // Touch ID; Android may report WEAK(2) for a Class 2 face unlock. SECRET(1)
        // means only the device credential is usable - which is also what we see
        // when biometrics are off-for-app / unenrolled / locked out.
        biometricUsable: level >= LocalAuthentication.SecurityLevel.BIOMETRIC_WEAK,
        biometricType,
      };
    } catch (error) {
      Logger.error('BiometricService', 'Biometric status check failed:', error);
      return { hasBiometricHardware: false, biometricUsable: false, biometricType: null };
    }
  }

  /**
   * Read the stored PIN after a successful authentication and opportunistically
   * migrate it to the current keychain accessibility class. Shared by the normal
   * unlock path and the biometric-probe success path.
   */
  private async retrieveStoredPinAfterAuth(
    walletGeneration: number,
    isCurrent: () => boolean
  ): Promise<{
    success: boolean;
    pin?: string;
    error?: string;
  }> {
    const canReadPin = () => isCurrent() && AppState.currentState === 'active';
    if (!canReadPin()) {
      return { success: false, error: 'Wallet state changed during authentication' };
    }
    let pin: string | null;
    try {
      pin = await SeedStorageService.getStoredPin();
    } catch {
      return { success: false, error: 'Wallet state changed during authentication' };
    }
    if (!pin) {
      return { success: false, error: 'Failed to retrieve stored PIN' };
    }
    if (!canReadPin()) {
      return { success: false, error: 'Wallet state changed during authentication' };
    }

    // Migrate PINs stored under a legacy accessibility class to the current one.
    // Gated by an AsyncStorage version marker; the marker only advances when the
    // write succeeds (set inside storePinSecurely itself).
    try {
      if (
        canReadPin() &&
        (await SeedStorageService.needsPinAccessibilityMigration())
      ) {
        if (!canReadPin()) {
          return { success: false, error: 'Wallet state changed during authentication' };
        }
        const migrated = await DeviceLoginState.migratePinAccessibility(pin, walletGeneration);
        Logger.debug(
          'BiometricService',
          `PIN accessibility migration: ${migrated ? 'ok' : 'retry-next-unlock'}`
        );
      }
    } catch {
      return { success: false, error: 'Wallet state changed during authentication' };
    }

    if (!canReadPin()) return { success: false, error: AUTHENTICATION_CHANGED_ERROR };
    return { success: true, pin };
  }

  /**
   * Authenticate user using biometrics
   * @param promptMessage - Message to display in the authentication prompt
   * @returns Authentication result
   */
  async authenticate(
    promptMessage: string = 'Authenticate to access your wallet',
    isCallerCurrent?: () => boolean,
  ): Promise<{
    success: boolean;
    error?: string;
    cancelled?: boolean;
  }> {
    const options: LocalAuthentication.LocalAuthenticationOptions = {
      promptMessage,
      fallbackLabel: 'Use passcode',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    };
    try {
      // A caller-bound prompt reserves its return to active, so the iOS
      // inactive grace cannot relock the wallet or expire the caller's action
      // while the Face ID sheet is still dismissing.
      const result = isCallerCurrent
        ? await this.authenticateInForeground(options, isCallerCurrent)
        : await this.runAuthenticationPrompt(options);

      if (result.success) return { success: true };
      return { success: false, cancelled: result.error === 'user_cancel' };
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
  async getPinWithBiometric(isCallerCurrent: () => boolean = () => true): Promise<{
    success: boolean;
    pin?: string;
    error?: string;
    // True only when a biometric IS enrolled on the device but turned OFF for
    // this app (the per-app Face ID/Touch ID toggle in iOS Settings is off).
    // The caller nudges the user to Settings rather than show a passcode sheet.
    // Not-enrolled / lockout do NOT set this - they proceed to normal unlock.
    biometricOffForApp?: boolean;
    biometricType?: 'face' | 'fingerprint' | 'iris' | null;
  }> {
    const walletGeneration = SeedStorageService.getWalletGeneration();
    const operationGeneration = this.securityOperationGeneration;
    const pinAuthenticationGeneration = ++this.pinAuthenticationGeneration;
    let invalidated = AppState.currentState !== 'active';
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') invalidated = true;
    });
    const isCurrent = () => {
      try {
        invalidated ||= AppState.currentState === 'background' ||
          !this.isSecurityOperationCurrent(operationGeneration, walletGeneration) ||
          pinAuthenticationGeneration !== this.pinAuthenticationGeneration ||
          !isCallerCurrent();
      } catch {
        invalidated = true;
      }
      return !invalidated;
    };
    try {
      return await this.getPinForCurrentAuthentication(walletGeneration, isCurrent);
    } finally {
      subscription.remove();
    }
  }

  private async getPinForCurrentAuthentication(
    walletGeneration: number,
    isCurrent: () => boolean
  ): Promise<{
    success: boolean;
    pin?: string;
    error?: string;
    biometricOffForApp?: boolean;
    biometricType?: 'face' | 'fingerprint' | 'iris' | null;
  }> {
    if (!isCurrent()) return { success: false, error: AUTHENTICATION_CHANGED_ERROR };
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

    // The device has biometric hardware but our level check reports it is not
    // usable. The level alone does NOT say WHY, and the cases need different
    // handling, so we ask iOS directly with a biometrics-only evaluation. When
    // biometrics cannot be evaluated this resolves immediately WITHOUT presenting
    // any UI, and the error code is the precise reason:
    //   not_available -> a biometric IS enrolled on the device but turned OFF for
    //                    this app (the sticky "Don't Allow"). The Settings toggle
    //                    exists, so nudge the user there instead of silently
    //                    dropping to the device-passcode sheet.
    //   not_enrolled  -> no biometric is set up on the device at all. This is a
    //                    legitimate passcode-only Device Login user; there is
    //                    nothing to enable, so fall through to the normal
    //                    device-credential unlock (no nudge, no regression).
    //   lockout/other -> transient; fall through so the passcode sheet can clear
    //                    the lockout and unlock.
    // If the level check was a transient false-negative and biometrics actually
    // work, this performs the real Face ID / Touch ID auth and we use its success.
    const status = await this.getBiometricStatus();
    if (!isCurrent()) return { success: false, error: AUTHENTICATION_CHANGED_ERROR };
    if (status.hasBiometricHardware && !status.biometricUsable) {
      try {
        const probe = await this.authenticateInForeground(
          {
            promptMessage: 'Unlock your wallet',
            cancelLabel: 'Cancel',
            disableDeviceFallback: true,
          },
          isCurrent
        );
        if (probe.success) {
          return this.retrieveStoredPinAfterAuth(walletGeneration, isCurrent);
        }
        if (probe.error === 'not_available') {
          return {
            success: false,
            error: 'Biometric unlock is turned off for this app',
            biometricOffForApp: true,
            biometricType: status.biometricType,
          };
        }
        if (
          probe.error === 'user_cancel' ||
          probe.error === 'app_cancel' ||
          probe.error === 'system_cancel'
        ) {
          // The probe presented real biometric UI (the level check was a
          // transient false-negative) and the user dismissed it. Cancel means
          // cancel: do not immediately raise the device-credential sheet.
          return { success: false, error: 'Authentication cancelled' };
        }
      } catch (error) {
        // Never let a native probe failure kill the unlock attempt; fall
        // through to the normal device-credential unlock below.
        Logger.error('BiometricService', 'Biometric probe failed:', error);
      }
      // not_enrolled / lockout / user_fallback / etc -> fall through to the
      // normal device-credential unlock so passcode-only users are never
      // blocked (user_fallback IS a request for the passcode sheet).
    }

    // Perform device authentication
    if (!isCurrent()) return { success: false, error: AUTHENTICATION_CHANGED_ERROR };
    let authResult: LocalAuthentication.LocalAuthenticationResult;
    try {
      authResult = await this.authenticateInForeground(
        {
          promptMessage: 'Unlock your wallet',
          fallbackLabel: 'Use passcode',
          cancelLabel: 'Cancel',
          disableDeviceFallback: false,
        },
        isCurrent
      );
    } catch {
      return { success: false, error: 'Authentication failed. Please try again.' };
    }
    if (!authResult.success) {
      return {
        success: false,
        error: 'Device Login did not complete. Try again or use your wallet PIN.',
      };
    }

    return this.retrieveStoredPinAfterAuth(walletGeneration, isCurrent);
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
    const operationGeneration = this.securityOperationGeneration;
    const walletGeneration = SeedStorageService.getWalletGeneration();
    const isCurrent = () =>
      this.isSecurityOperationCurrent(operationGeneration, walletGeneration);
    try {
      // Check if device login is available
      const available = await this.isBiometricAvailable();
      if (!available) {
        return {
          success: false,
          error: 'Device Login not available on this device',
        };
      }
      if (!isCurrent()) return { success: false, error: 'Wallet state changed' };

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
      if (!isCurrent()) return { success: false, error: 'Wallet state changed' };
      Logger.debug('BiometricService', 'PIN verified successfully');

      // Authenticate before storing (confirm user identity)
      const authResult = await this.authenticate(
        'Enable Device Login to unlock your wallet',
        isCurrent,
      );
      if (!authResult.success) {
        return {
          success: false,
          error: authResult.error || 'Authentication cancelled',
        };
      }
      if (!isCurrent()) return { success: false, error: 'Wallet state changed' };

      await DeviceLoginState.enable(pin, isCurrent);
      if (!isCurrent()) return { success: false, error: 'Wallet state changed' };

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
  async disableDeviceLogin(isAuthorized?: () => boolean): Promise<void> {
    await DeviceLoginState.disable(isAuthorized);
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
        if (
          result.error === NATIVE_PIN_COMMIT_ERROR ||
          result.error === NATIVE_PIN_CHANGE_AMBIGUOUS_ERROR
        ) {
          // The web may have reached either PIN. Its serialized compensation
          // accepts both states and converges every ciphertext and backup on
          // oldPin before NativeBridge commits oldPin to SecureStore.
          const rollback = await NativeBridge.changePin(newPin, oldPin, {
            acceptAlreadyTarget: true,
          });
          if (rollback.success) {
            return {
              success: false,
              error: 'The PIN change could not be confirmed. No change was made; your old PIN remains active.',
            };
          }
          if (rollback.error === NATIVE_PIN_COMMIT_ERROR) {
            return {
              success: false,
              error: 'Your old PIN remains active, but Device Login could not be restored. Disable and re-enable Device Login before using it.',
            };
          }
          return {
            success: false,
            error: 'PIN change recovery could not be confirmed. Try your old PIN first, then your new PIN if needed, and re-import any inaccessible account from its recovery phrase.',
          };
        }
        return {
          success: false,
          error: result.error || 'Failed to change PIN',
        };
      }
      Logger.debug('BiometricService', 'PIN changed successfully');
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
