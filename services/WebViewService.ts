import AsyncStorage from '@react-native-async-storage/async-storage';
import Logger from './Logger';

const STORAGE_KEYS = {
  COOKIES: '@MyQRLWallet:cookies',
  LAST_SESSION: '@MyQRLWallet:lastSession',
  USER_PREFERENCES: '@MyQRLWallet:userPreferences',
  CONTACTS_BACKUP: '@MyQRLWallet:contactsBackup',
};

export interface UserPreferences {
  notificationsEnabled?: boolean;
  // Home screen card visibility (mirrors the web wallet's Show Tokens/NFTs
  // Card settings; pushed to the WebView via SET_DISPLAY_PREFS).
  showTokensCard?: boolean;
  showNftsCard?: boolean;
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
        showTokensCard: true,
        showNftsCard: true,
      };
    } catch (error) {
      Logger.error('WebViewService', 'Failed to get user preferences:', error);
      return {
        notificationsEnabled: true,
        showTokensCard: true,
        showNftsCard: true,
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

  /**
   * Durable backup of the web wallet's address book (JSON array of
   * contacts; plain public data). Written on every CONTACTS_UPDATED,
   * pushed back on WEB_APP_READY, deleted only by Remove All Wallets.
   */
  async saveContactsBackup(contactsJson: string): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.CONTACTS_BACKUP, contactsJson);
      Logger.debug('WebViewService', 'Contacts backup saved');
    } catch (error) {
      Logger.error('WebViewService', 'Failed to save contacts backup:', error);
    }
  }

  async getContactsBackup(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(STORAGE_KEYS.CONTACTS_BACKUP);
    } catch (error) {
      Logger.error('WebViewService', 'Failed to read contacts backup:', error);
      return null;
    }
  }

  async clearContactsBackup(): Promise<void> {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.CONTACTS_BACKUP);
      Logger.debug('WebViewService', 'Contacts backup cleared');
    } catch (error) {
      Logger.error('WebViewService', 'Failed to clear contacts backup:', error);
    }
  }
}

export default new WebViewService(); 