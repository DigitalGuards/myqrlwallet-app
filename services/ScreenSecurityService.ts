import RNScreenshotPrevent from 'react-native-screenshot-prevent';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTING_KEY = '@MyQRLWallet:preventScreenshots';

/**
 * Service for managing screenshot and screen recording prevention.
 * Uses FLAG_SECURE on Android and secure text field technique on iOS.
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
      this.enable();
    }
    this.initialized = true;
    console.log('[ScreenSecurity] Initialized, prevention:', enabled ? 'enabled' : 'disabled');
  }

  /**
   * Check if screenshot prevention is currently enabled in settings.
   * Defaults to true (enabled) for security.
   */
  async isEnabled(): Promise<boolean> {
    try {
      const value = await AsyncStorage.getItem(SETTING_KEY);
      // Default to true (enabled) for wallet security
      return value !== 'false';
    } catch (error) {
      console.error('[ScreenSecurity] Failed to read setting:', error);
      return true; // Default to enabled on error
    }
  }

  /**
   * Update the screenshot prevention setting and apply it immediately.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    try {
      await AsyncStorage.setItem(SETTING_KEY, String(enabled));
      if (enabled) {
        this.enable();
      } else {
        this.disable();
      }
      console.log('[ScreenSecurity] Setting updated:', enabled ? 'enabled' : 'disabled');
    } catch (error) {
      console.error('[ScreenSecurity] Failed to save setting:', error);
      throw error;
    }
  }

  /**
   * Enable screenshot and screen recording prevention.
   * - Android: Uses FLAG_SECURE - screenshots show black, recording blocked at OS level
   * - iOS: Uses hidden secure text field technique to prevent capture
   */
  enable(): void {
    RNScreenshotPrevent.enabled(true);
    if (Platform.OS === 'ios') {
      RNScreenshotPrevent.enableSecureView();
    }
    console.log('[ScreenSecurity] Prevention enabled');
  }

  /**
   * Disable screenshot and screen recording prevention.
   * User should be warned this is a security risk.
   */
  disable(): void {
    RNScreenshotPrevent.enabled(false);
    if (Platform.OS === 'ios') {
      RNScreenshotPrevent.disableSecureView();
    }
    console.log('[ScreenSecurity] Prevention disabled');
  }
}

export default new ScreenSecurityService();
