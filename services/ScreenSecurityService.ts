import * as ScreenCapture from 'expo-screen-capture';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTING_KEY = '@MyQRLWallet:preventScreenshots';

/**
 * Service for managing screenshot and screen recording prevention.
 * Uses expo-screen-capture which implements FLAG_SECURE on Android
 * and secure text field technique on iOS.
 */
class ScreenSecurityService {
  private initialized = false;

  /**
   * Initialize screen security based on stored preference.
   * Should be called on app startup.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const enabled = await this.isEnabled();
    if (enabled) {
      await this.enable();
    }
    this.initialized = true;
    console.log('[ScreenSecurity] Initialized, prevention:', enabled ? 'enabled' : 'disabled');
  }

  /**
   * Check if screenshot prevention is currently enabled in settings.
   * Defaults to false (disabled) - user must explicitly enable after creating/importing a wallet.
   */
  async isEnabled(): Promise<boolean> {
    try {
      const value = await AsyncStorage.getItem(SETTING_KEY);
      // Default to false - user must explicitly enable
      return value === 'true';
    } catch (error) {
      console.error('[ScreenSecurity] Failed to read setting:', error);
      return false; // Default to disabled on error
    }
  }

  /**
   * Update the screenshot prevention setting and apply it immediately.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    try {
      await AsyncStorage.setItem(SETTING_KEY, String(enabled));
      if (enabled) {
        await this.enable();
      } else {
        await this.disable();
      }
      console.log('[ScreenSecurity] Setting updated:', enabled ? 'enabled' : 'disabled');
    } catch (error) {
      console.error('[ScreenSecurity] Failed to save setting:', error);
      throw error;
    }
  }

  /**
   * Enable screenshot and screen recording prevention.
   * - Android: Uses FLAG_SECURE - screenshots show black, recording blocked
   * - iOS: Uses secure text field technique to prevent capture
   */
  async enable(): Promise<void> {
    await ScreenCapture.preventScreenCaptureAsync();
    console.log('[ScreenSecurity] Prevention enabled');
  }

  /**
   * Disable screenshot and screen recording prevention.
   * User should be warned this is a security risk.
   */
  async disable(): Promise<void> {
    await ScreenCapture.allowScreenCaptureAsync();
    console.log('[ScreenSecurity] Prevention disabled');
  }
}

export default new ScreenSecurityService();
