import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import Logger from './Logger';

/**
 * Storage keys
 */
const SEED_BACKUP_PREFIX = 'seed_backup_';
const PIN_KEY = 'wallet_pin';
const BIOMETRIC_ENABLED_KEY = 'biometric_enabled';
const BIOMETRIC_PROMPT_SHOWN_KEY = 'biometric_prompt_shown';
const WALLET_METADATA_KEY = 'wallet_metadata';
// AsyncStorage mirror of "does the Keychain hold a PIN?". Maintained alongside
// every storePinSecurely / clearWallet so hasPinStored() can answer without
// hitting SecureStore — a background Keychain read during the lock transition
// raises errSecInteractionNotAllowed and pollutes logs.
const PIN_EXISTS_KEY = 'pin_exists';
// AsyncStorage marker for the accessibility class the stored PIN was written
// under. Bumped whenever we change the class. Used to decide whether a running
// session should silently re-write the PIN with the current class.
const PIN_ACCESSIBILITY_VERSION_KEY = 'pin_accessibility_version';
const CURRENT_PIN_ACCESSIBILITY_VERSION = 'v2';

// iOS SecStatusCode -25308 — raised when the Keychain item's accessibility
// class denies the current state (device locked / pre-first-unlock / etc).
// Treat this as an expected runtime condition during lock transitions rather
// than an error worth logging.
function isInteractionNotAllowed(error: unknown): boolean {
  if (!error) return false;
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
  return (
    message.includes('User interaction is not allowed') ||
    message.includes('errSecInteractionNotAllowed') ||
    message.includes('-25308') ||
    // Android Keystore analogue when the user lock screen hasn't been set up yet.
    (message.includes('Keystore') && message.includes('not initialized'))
  );
}

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

    Logger.debug('SeedStorage', `Backed up seed for ${address}`);
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
   * Store PIN securely using expo-secure-store.
   *
   * WHEN_UNLOCKED_THIS_DEVICE_ONLY — wallet-threat-model correct: the PIN
   * becomes unreadable the instant the screen locks, so a lost/stolen locked
   * device cannot hand the PIN to a background forensic acquisition.
   * `ThisDeviceOnly` keeps the PIN out of iCloud Keychain sync. This works
   * safely only because no background code path reads the PIN — hasPinStored
   * consults an AsyncStorage marker, not the Keychain. If you ever add a
   * background reader, reconsider the class choice.
   *
   * After a successful keychain write, mirror "PIN exists" and the
   * accessibility version into AsyncStorage atomically (multiSet), so
   * hasPinStored / needsPinAccessibilityMigration can answer without touching
   * SecureStore.
   */
  async storePinSecurely(pin: string): Promise<void> {
    await SecureStore.setItemAsync(PIN_KEY, pin, {
      requireAuthentication: false, // biometric handled separately
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    await AsyncStorage.multiSet([
      [PIN_EXISTS_KEY, '1'],
      [PIN_ACCESSIBILITY_VERSION_KEY, CURRENT_PIN_ACCESSIBILITY_VERSION],
    ]);
    Logger.debug('SeedStorage', 'PIN stored securely');
  }

  /**
   * Retrieve PIN from secure storage.
   * Call after successful biometric authentication.
   */
  async getStoredPin(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(PIN_KEY);
    } catch (error) {
      if (isInteractionNotAllowed(error)) {
        // Expected during device-lock transitions. Return null silently —
        // callers treat a missing PIN as "not unlocked yet" which is correct.
        return null;
      }
      Logger.error('SeedStorage', 'Failed to retrieve PIN:', error);
      return null;
    }
  }

  /**
   * Re-write the stored PIN with the current accessibility class. Used to
   * migrate PINs stored under legacy classes (WHEN_UNLOCKED, or 1.2.1's
   * AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY) to the current
   * WHEN_UNLOCKED_THIS_DEVICE_ONLY. Returns true on success so callers can
   * avoid flipping migration markers on a failed write.
   */
  async migratePinAccessibility(pin: string): Promise<boolean> {
    try {
      await this.storePinSecurely(pin);
      return true;
    } catch (error) {
      Logger.error('SeedStorage', 'PIN accessibility migration failed:', error);
      return false;
    }
  }

  /**
   * Whether the stored PIN's accessibility class needs a re-write to the
   * current version. True only if a PIN exists AND the version marker is
   * absent or stale.
   */
  async needsPinAccessibilityMigration(): Promise<boolean> {
    const [hasPin, version] = await Promise.all([
      this.hasPinStored(),
      AsyncStorage.getItem(PIN_ACCESSIBILITY_VERSION_KEY),
    ]);
    return hasPin && version !== CURRENT_PIN_ACCESSIBILITY_VERSION;
  }

  /**
   * Check if a PIN is stored. AsyncStorage-only — must never read the
   * keychain, or the lock-transition error comes back. See storePinSecurely.
   */
  async hasPinStored(): Promise<boolean> {
    const marker = await AsyncStorage.getItem(PIN_EXISTS_KEY);
    return marker === '1';
  }

  /**
   * One-shot bootstrap for installs upgrading from ≤1.2.1: if the AsyncStorage
   * marker is absent but the keychain still holds a PIN, mirror the existence
   * flag. Safe to call at app launch — runs at most one keychain read (only
   * when the marker is missing), and only in the foreground where
   * interactionNotAllowed is not a concern.
   */
  async repairPinExistsMarker(): Promise<void> {
    try {
      const marker = await AsyncStorage.getItem(PIN_EXISTS_KEY);
      if (marker === '1') return; // already set — nothing to do
      const pin = await this.getStoredPin();
      if (pin !== null) {
        await AsyncStorage.setItem(PIN_EXISTS_KEY, '1');
        Logger.debug('SeedStorage', 'Repaired pin_exists marker for upgraded install');
      }
    } catch (error) {
      // Repair is best-effort; absence of the marker just means hasPinStored
      // returns false until the next storePinSecurely write.
      Logger.warn('SeedStorage', 'pin_exists repair skipped:', error);
    }
  }

  /**
   * Set whether biometric unlock is enabled
   */
  async setBiometricEnabled(enabled: boolean): Promise<void> {
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, JSON.stringify(enabled));
    Logger.debug('SeedStorage', `Biometric enabled: ${enabled}`);
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
   * Set whether the biometric setup prompt has been shown
   */
  async setBiometricPromptShown(shown: boolean): Promise<void> {
    await AsyncStorage.setItem(BIOMETRIC_PROMPT_SHOWN_KEY, JSON.stringify(shown));
  }

  /**
   * Check if the biometric setup prompt has been shown
   */
  async wasBiometricPromptShown(): Promise<boolean> {
    const data = await AsyncStorage.getItem(BIOMETRIC_PROMPT_SHOWN_KEY);
    if (!data) return false;

    try {
      return JSON.parse(data) as boolean;
    } catch {
      return false;
    }
  }

  /**
   * Update wallet metadata when seeds are added/removed
   * Reads existing metadata and updates in-memory to avoid re-reading all backups
   */
  private async updateWalletMetadata(newAddress?: string): Promise<void> {
    // Read existing metadata instead of re-reading all backups
    const existingMetadata = await this.getWalletMetadata();
    const addresses = existingMetadata?.addresses ? [...existingMetadata.addresses] : [];

    if (newAddress) {
      const normalizedAddress = newAddress.toLowerCase();
      if (!addresses.includes(normalizedAddress)) {
        addresses.push(normalizedAddress);
      }
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
   * Clear all wallet data (used when user removes wallet from settings).
   * WARNING: permanently deletes all backed up seeds, stored PIN, and the
   * AsyncStorage markers that mirror keychain state. iOS keeps SecureStore
   * items across app reinstalls (they're tied to the Keychain access group),
   * so the AsyncStorage markers MUST be cleared too — otherwise a reinstall
   * could see `pin_exists = '1'` pointing at a Keychain the Keychain no
   * longer holds (or vice versa).
   */
  async clearWallet(): Promise<void> {
    Logger.debug('SeedStorage', 'Clearing all wallet data...');

    // Clear all seed backups
    const keys = await AsyncStorage.getAllKeys();
    const seedKeys = keys.filter(key => key.startsWith(SEED_BACKUP_PREFIX));
    await AsyncStorage.multiRemove(seedKeys);

    // Clear PIN from secure storage
    await SecureStore.deleteItemAsync(PIN_KEY);

    // Clear biometric preference + prompt flag + wallet metadata + PIN
    // mirror markers in one shot.
    await AsyncStorage.multiRemove([
      BIOMETRIC_ENABLED_KEY,
      BIOMETRIC_PROMPT_SHOWN_KEY,
      WALLET_METADATA_KEY,
      PIN_EXISTS_KEY,
      PIN_ACCESSIBILITY_VERSION_KEY,
    ]);

    Logger.debug('SeedStorage', 'All wallet data cleared');
  }

  /**
   * Remove a specific seed backup
   */
  async removeBackup(address: string): Promise<void> {
    const key = `${SEED_BACKUP_PREFIX}${address.toLowerCase()}`;
    await AsyncStorage.removeItem(key);
    await this.updateWalletMetadata();
    Logger.debug('SeedStorage', `Removed backup for ${address}`);
  }
}

export default new SeedStorageService();
