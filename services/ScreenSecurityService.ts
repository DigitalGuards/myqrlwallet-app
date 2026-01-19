import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTING_KEY = '@MyQRLWallet:preventScreenshots';

/**
 * Service for managing screenshot and screen recording prevention.
 * NOTE: Screenshot prevention is currently disabled pending library compatibility.
 * This service maintains the setting but doesn't actually prevent screenshots.
 */
class ScreenSecurityService {
  private initialized = false;

  /**
   * Initialize screen security based on stored preference.
   * Should be called on app startup.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    console.log('[ScreenSecurity] Initialized (prevention disabled - library not available)');
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
      console.log('[ScreenSecurity] Setting updated:', enabled ? 'enabled' : 'disabled');
      // NOTE: Actual prevention is disabled pending library compatibility
    } catch (error) {
      console.error('[ScreenSecurity] Failed to save setting:', error);
      throw error;
    }
  }

  /**
   * Enable screenshot and screen recording prevention.
   * NOTE: Currently a no-op pending library compatibility.
   */
  enable(): void {
    console.log('[ScreenSecurity] Prevention requested (not available)');
  }

  /**
   * Disable screenshot and screen recording prevention.
   * NOTE: Currently a no-op pending library compatibility.
   */
  async disable(): Promise<void> {
    console.log('[ScreenSecurity] Prevention disable requested (not available)');
  }
}

export default new ScreenSecurityService();
