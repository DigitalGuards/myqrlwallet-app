import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/**
 * Storage keys
 */
const SEED_BACKUP_PREFIX = 'seed_backup_';
const PIN_KEY = 'wallet_pin';
const BIOMETRIC_ENABLED_KEY = 'biometric_enabled';
const WALLET_METADATA_KEY = 'wallet_metadata';

/**
 * Wallet metadata stored in AsyncStorage
 */
interface WalletMetadata {
  addresses: string[];
  hasWallet: boolean;
  lastUpdated: number;
}

/**
 * Seed backup data structure
 */
interface SeedBackup {
  address: string;
  encryptedSeed: string;
  blockchain: string;
  storedAt: number;
}

/**
 * Service for securely storing wallet seeds and PINs
 *
 * Storage strategy:
 * - Encrypted seeds: AsyncStorage (persistent across app restarts)
 * - PIN: SecureStore (iOS Keychain / Android Keystore) - hardware-encrypted
 * - Biometric preference: AsyncStorage
 */
class SeedStorageService {
  /**
   * Backup an encrypted seed to AsyncStorage
   * Called when web app stores a new seed
   */
  async backupSeed(
    address: string,
    encryptedSeed: string,
    blockchain: string
  ): Promise<void> {
    const key = `${SEED_BACKUP_PREFIX}${address.toLowerCase()}`;
    const backup: SeedBackup = {
      address: address.toLowerCase(),
      encryptedSeed,
      blockchain,
      storedAt: Date.now(),
    };

    await AsyncStorage.setItem(key, JSON.stringify(backup));

    // Update wallet metadata
    await this.updateWalletMetadata(address);

    console.log(`[SeedStorage] Backed up seed for ${address}`);
  }

  /**
   * Retrieve a backed up seed
   */
  async getBackup(address: string): Promise<SeedBackup | null> {
    const key = `${SEED_BACKUP_PREFIX}${address.toLowerCase()}`;
    const data = await AsyncStorage.getItem(key);

    if (!data) return null;

    try {
      return JSON.parse(data) as SeedBackup;
    } catch {
      return null;
    }
  }

  /**
   * Get all backed up seeds
   * Uses metadata for efficient lookup with multiGet instead of scanning all keys
   */
  async getAllBackups(): Promise<SeedBackup[]> {
    // Try to use metadata for efficient lookup
    const metadata = await this.getWalletMetadata();
    if (metadata && metadata.addresses.length > 0) {
      const keys = metadata.addresses.map(
        address => `${SEED_BACKUP_PREFIX}${address.toLowerCase()}`
      );
      const results = await AsyncStorage.multiGet(keys);

      const backups: SeedBackup[] = [];
      for (const [, data] of results) {
        if (data) {
          try {
            backups.push(JSON.parse(data) as SeedBackup);
          } catch {
            // Skip invalid entries
          }
        }
      }
      return backups;
    }

    // Fallback: scan all keys (for backwards compatibility)
    const keys = await AsyncStorage.getAllKeys();
    const seedKeys = keys.filter(key => key.startsWith(SEED_BACKUP_PREFIX));

    const backups: SeedBackup[] = [];
    for (const key of seedKeys) {
      const data = await AsyncStorage.getItem(key);
      if (data) {
        try {
          backups.push(JSON.parse(data) as SeedBackup);
        } catch {
          // Skip invalid entries
        }
      }
    }

    return backups;
  }

  /**
   * Store PIN securely using expo-secure-store
   * This stores the PIN in iOS Keychain or Android Keystore
   */
  async storePinSecurely(pin: string): Promise<void> {
    await SecureStore.setItemAsync(PIN_KEY, pin, {
      // Require device authentication (biometric or passcode) to access
      requireAuthentication: false, // We'll handle biometric separately
    });
    console.log('[SeedStorage] PIN stored securely');
  }

  /**
   * Retrieve PIN from secure storage
   * Note: Call this AFTER successful biometric authentication
   */
  async getStoredPin(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(PIN_KEY);
    } catch (error) {
      console.error('[SeedStorage] Failed to retrieve PIN:', error);
      return null;
    }
  }

  /**
   * Check if a PIN is stored
   */
  async hasPinStored(): Promise<boolean> {
    const pin = await this.getStoredPin();
    return pin !== null;
  }

  /**
   * Set whether biometric unlock is enabled
   */
  async setBiometricEnabled(enabled: boolean): Promise<void> {
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, JSON.stringify(enabled));
    console.log(`[SeedStorage] Biometric enabled: ${enabled}`);
  }

  /**
   * Check if biometric unlock is enabled
   */
  async isBiometricEnabled(): Promise<boolean> {
    const data = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
    if (!data) return false;

    try {
      return JSON.parse(data) as boolean;
    } catch {
      return false;
    }
  }

  /**
   * Update wallet metadata when seeds are added/removed
   */
  private async updateWalletMetadata(newAddress?: string): Promise<void> {
    const backups = await this.getAllBackups();
    const addresses = backups.map(b => b.address);

    if (newAddress && !addresses.includes(newAddress.toLowerCase())) {
      addresses.push(newAddress.toLowerCase());
    }

    const metadata: WalletMetadata = {
      addresses,
      hasWallet: addresses.length > 0,
      lastUpdated: Date.now(),
    };

    await AsyncStorage.setItem(WALLET_METADATA_KEY, JSON.stringify(metadata));
  }

  /**
   * Get wallet metadata
   */
  async getWalletMetadata(): Promise<WalletMetadata | null> {
    const data = await AsyncStorage.getItem(WALLET_METADATA_KEY);
    if (!data) return null;

    try {
      return JSON.parse(data) as WalletMetadata;
    } catch {
      return null;
    }
  }

  /**
   * Check if wallet exists (any backed up seeds)
   */
  async hasWallet(): Promise<boolean> {
    const metadata = await this.getWalletMetadata();
    if (metadata) return metadata.hasWallet;

    // Fallback: check for any seed backups
    const backups = await this.getAllBackups();
    return backups.length > 0;
  }

  /**
   * Clear all wallet data (used when user removes wallet from settings)
   * WARNING: This permanently deletes all backed up seeds and stored PIN
   */
  async clearWallet(): Promise<void> {
    console.log('[SeedStorage] Clearing all wallet data...');

    // Clear all seed backups
    const keys = await AsyncStorage.getAllKeys();
    const seedKeys = keys.filter(key => key.startsWith(SEED_BACKUP_PREFIX));
    await AsyncStorage.multiRemove(seedKeys);

    // Clear PIN from secure storage
    await SecureStore.deleteItemAsync(PIN_KEY);

    // Clear biometric preference
    await AsyncStorage.removeItem(BIOMETRIC_ENABLED_KEY);

    // Clear wallet metadata
    await AsyncStorage.removeItem(WALLET_METADATA_KEY);

    console.log('[SeedStorage] All wallet data cleared');
  }

  /**
   * Remove a specific seed backup
   */
  async removeBackup(address: string): Promise<void> {
    const key = `${SEED_BACKUP_PREFIX}${address.toLowerCase()}`;
    await AsyncStorage.removeItem(key);
    await this.updateWalletMetadata();
    console.log(`[SeedStorage] Removed backup for ${address}`);
  }
}

export default new SeedStorageService();
