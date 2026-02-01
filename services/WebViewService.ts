import AsyncStorage from '@react-native-async-storage/async-storage';
import Logger from './Logger';

const STORAGE_KEYS = {
  COOKIES: '@MyQRLWallet:cookies',
  LAST_SESSION: '@MyQRLWallet:lastSession',
  USER_PREFERENCES: '@MyQRLWallet:userPreferences',
};

export interface UserPreferences {
  notificationsEnabled?: boolean;
}

/**
 * Service class for managing WebView session data
 */
class WebViewService {
  /**
   * Save cookies from WebView for session persistence
   * @param cookies - Cookies string to store
   */
  async saveCookies(cookies: string): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.COOKIES, cookies);
      Logger.debug('WebViewService', 'Cookies saved successfully');
    } catch (error) {
      Logger.error('WebViewService', 'Failed to save cookies:', error);
    }
  }

  /**
   * Retrieve stored cookies
   * @returns The stored cookies string or null if not found
   */
  async getCookies(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(STORAGE_KEYS.COOKIES);
    } catch (error) {
      Logger.error('WebViewService', 'Failed to retrieve cookies:', error);
      return null;
    }
  }

  /**
   * Record the current session timestamp
   */
  async updateLastSession(): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      await AsyncStorage.setItem(STORAGE_KEYS.LAST_SESSION, timestamp);
    } catch (error) {
      Logger.error('WebViewService', 'Failed to update last session:', error);
    }
  }

  /**
   * Get the timestamp of the last session
   * @returns ISO timestamp string or null if not found
   */
  async getLastSession(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(STORAGE_KEYS.LAST_SESSION);
    } catch (error) {
      Logger.error('WebViewService', 'Failed to get last session:', error);
      return null;
    }
  }

  /**
   * Save user preferences
   * @param preferences - User preferences object
   */
  async saveUserPreferences(preferences: UserPreferences): Promise<void> {
    try {
      await AsyncStorage.setItem(
        STORAGE_KEYS.USER_PREFERENCES,
        JSON.stringify(preferences)
      );
    } catch (error) {
      Logger.error('WebViewService', 'Failed to save user preferences:', error);
    }
  }

  /**
   * Get stored user preferences
   * @returns User preferences object or default preferences if not found
   */
  async getUserPreferences(): Promise<UserPreferences> {
    try {
      const storedPreferences = await AsyncStorage.getItem(STORAGE_KEYS.USER_PREFERENCES);
      
      if (storedPreferences) {
        return JSON.parse(storedPreferences);
      }
      
      // Default preferences
      return {
        notificationsEnabled: true,
      };
    } catch (error) {
      Logger.error('WebViewService', 'Failed to get user preferences:', error);
      return {
        notificationsEnabled: true,
      };
    }
  }

  /**
   * Clear all stored session data
   */
  async clearSessionData(): Promise<void> {
    try {
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.COOKIES,
        STORAGE_KEYS.LAST_SESSION,
      ]);
      Logger.debug('WebViewService', 'Session data cleared successfully');
    } catch (error) {
      Logger.error('WebViewService', 'Failed to clear session data:', error);
    }
  }
}

export default new WebViewService(); 