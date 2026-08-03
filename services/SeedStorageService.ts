import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import Logger from './Logger';

/**
 * Storage keys
 */
const LEGACY_SEED_BACKUP_PREFIX = 'seed_backup_';
const SEED_BACKUP_PREFIX = 'seed_backup_v2_';
const PIN_KEY = 'wallet_pin';
const DEVICE_CREDENTIAL_KEY = 'wallet_device_credential_v1';
const BIOMETRIC_ENABLED_KEY = 'biometric_enabled';
const BIOMETRIC_PROMPT_SHOWN_KEY = 'biometric_prompt_shown';
const WALLET_METADATA_KEY = 'wallet_metadata';
const WALLET_WIPE_PENDING_KEY = 'wallet_wipe_pending_v1';
// AsyncStorage mirror of "does the Keychain hold a PIN?". Maintained alongside
// every storePinSecurely / clearWallet so hasPinStored() can answer without
// hitting SecureStore. A background Keychain read during the lock transition
// raises errSecInteractionNotAllowed and pollutes logs.
const PIN_EXISTS_KEY = 'pin_exists';
// AsyncStorage marker for the accessibility class the stored PIN was written
// under. Bumped whenever we change the class. Used to decide whether a running
// session should silently re-write the PIN with the current class.
const PIN_ACCESSIBILITY_VERSION_KEY = 'pin_accessibility_version';
const CURRENT_PIN_ACCESSIBILITY_VERSION = 'v2';
const DEVICE_CREDENTIAL_PATTERN = /^[0-9a-f]{64}$/;
const CIPHERTEXT_HASH_PATTERN = /^[0-9a-f]{64}$/;
const Q_ADDRESS_PATTERN = /^Q[0-9a-fA-F]{40}$/;
const SUPPORTED_BLOCKCHAINS = new Set(['TEST_NET', 'MAIN_NET']);
const MAX_ENCRYPTED_SEED_LENGTH = 256 * 1024;
const MAX_SEED_BACKUPS = 64;
const REQUEST_ID_PATTERN = /^[0-9a-f]{32}$/;

// iOS SecStatusCode -25308 is raised when the Keychain item's accessibility
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

export interface PendingWalletWipe {
  version: 1;
  requestId: string;
  startedAt: number;
}

/**
 * Seed backup data structure
 */
export interface SeedBackup {
  address: string;
  encryptedSeed: string;
  blockchain: string;
  storedAt: number;
  revision: number;
  ciphertextHash?: string;
}

export class SecureStorageUnavailableError extends Error {
  constructor() {
    super('Wallet secure storage is temporarily unavailable');
    this.name = 'SecureStorageUnavailableError';
  }
}

function normalizeAddress(address: string): string {
  if (!Q_ADDRESS_PATTERN.test(address)) throw new Error('Invalid QRL wallet address');
  return `Q${address.slice(1).toLowerCase()}`;
}

function backupKey(blockchain: string, address: string): string {
  if (!SUPPORTED_BLOCKCHAINS.has(blockchain)) throw new Error('Unsupported wallet blockchain');
  return `${SEED_BACKUP_PREFIX}${blockchain}_${normalizeAddress(address).toLowerCase()}`;
}

function parseBackup(data: string): SeedBackup | null {
  try {
    const parsed = JSON.parse(data) as Partial<SeedBackup>;
    if (
      typeof parsed.address !== 'string' ||
      !Q_ADDRESS_PATTERN.test(parsed.address) ||
      typeof parsed.encryptedSeed !== 'string' ||
      parsed.encryptedSeed.length === 0 ||
      parsed.encryptedSeed.length > MAX_ENCRYPTED_SEED_LENGTH ||
      typeof parsed.blockchain !== 'string' ||
      !SUPPORTED_BLOCKCHAINS.has(parsed.blockchain) ||
      typeof parsed.storedAt !== 'number' ||
      !Number.isSafeInteger(parsed.storedAt) ||
      parsed.storedAt < 0
    ) {
      return null;
    }
    const revision =
      Number.isSafeInteger(parsed.revision) && (parsed.revision ?? -1) >= 0
        ? parsed.revision ?? 0
        : 0;
    const ciphertextHash =
      typeof parsed.ciphertextHash === 'string' &&
      CIPHERTEXT_HASH_PATTERN.test(parsed.ciphertextHash)
        ? parsed.ciphertextHash
        : undefined;
    if (revision > 0 && ciphertextHash === undefined) return null;
    return {
      address: normalizeAddress(parsed.address),
      encryptedSeed: parsed.encryptedSeed,
      blockchain: parsed.blockchain,
      storedAt: parsed.storedAt,
      revision,
      ...(ciphertextHash ? { ciphertextHash } : {}),
    };
  } catch {
    return null;
  }
}

function parseWalletMetadata(data: string): WalletMetadata | null {
  try {
    const parsed = JSON.parse(data) as Partial<WalletMetadata>;
    if (
      !Array.isArray(parsed.addresses) ||
      parsed.addresses.length > MAX_SEED_BACKUPS ||
      !parsed.addresses.every((address) => typeof address === 'string' && Q_ADDRESS_PATTERN.test(address)) ||
      typeof parsed.hasWallet !== 'boolean' ||
      typeof parsed.lastUpdated !== 'number' ||
      !Number.isSafeInteger(parsed.lastUpdated) ||
      parsed.lastUpdated < 0
    ) {
      return null;
    }
    return {
      addresses: parsed.addresses.map(normalizeAddress),
      hasWallet: parsed.hasWallet,
      lastUpdated: parsed.lastUpdated,
    };
  } catch {
    return null;
  }
}

function parsePendingWalletWipe(data: string): PendingWalletWipe | null {
  try {
    const parsed = JSON.parse(data) as Partial<PendingWalletWipe>;
    if (
      parsed.version !== 1 ||
      typeof parsed.requestId !== 'string' ||
      !REQUEST_ID_PATTERN.test(parsed.requestId) ||
      typeof parsed.startedAt !== 'number' ||
      !Number.isSafeInteger(parsed.startedAt) ||
      parsed.startedAt < 0
    ) {
      return null;
    }
    return { version: 1, requestId: parsed.requestId, startedAt: parsed.startedAt };
  } catch {
    return null;
  }
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
  private walletMutationQueue: Promise<void> = Promise.resolve();
  private walletClearInProgress = false;
  private walletGeneration = 0;
  private clearPromise: Promise<void> | null = null;
  private wipeJournalQueue: Promise<void> = Promise.resolve();

  private enqueueWalletOperation<T>(operation: () => Promise<T>): Promise<T> {
    const generation = this.walletGeneration;
    if (this.walletClearInProgress) {
      return Promise.reject(new Error('Wallet clear is in progress'));
    }

    const run = this.walletMutationQueue
      .catch(() => undefined)
      .then(async () => {
        if (this.walletClearInProgress || generation !== this.walletGeneration) {
          throw new Error('Wallet state changed before the operation could run');
        }
        return operation();
      });
    this.walletMutationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private enqueueWipeJournalOperation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.wipeJournalQueue.catch(() => undefined).then(operation);
    this.wipeJournalQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  getWalletGeneration(): number {
    return this.walletGeneration;
  }

  isWalletGenerationCurrent(generation: number): boolean {
    return !this.walletClearInProgress && generation === this.walletGeneration;
  }

  /**
   * Backup an encrypted seed to AsyncStorage
   * Called when web app stores a new seed
   */
  async backupSeed(
    address: string,
    encryptedSeed: string,
    blockchain: string,
    revision: number,
    ciphertextHash: string,
  ): Promise<SeedBackup> {
    if (
      typeof encryptedSeed !== 'string' ||
      encryptedSeed.length === 0 ||
      encryptedSeed.length > MAX_ENCRYPTED_SEED_LENGTH
    ) {
      throw new Error('Invalid encrypted seed payload');
    }
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw new Error('Invalid encrypted seed revision');
    }
    if (!CIPHERTEXT_HASH_PATTERN.test(ciphertextHash)) {
      throw new Error('Invalid encrypted seed hash');
    }
    const normalizedAddress = normalizeAddress(address);
    const key = backupKey(blockchain, normalizedAddress);

    return this.enqueueWalletOperation(async () => {
      const actualCiphertextHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        encryptedSeed,
      );
      if (actualCiphertextHash !== ciphertextHash) {
        throw new Error('Encrypted seed hash does not match its ciphertext');
      }

      const existingData = await AsyncStorage.getItem(key);
      const existing = existingData ? parseBackup(existingData) : null;
      if (existing && existing.revision > revision) {
        throw new Error('Seed backup revision is stale');
      }
      if (existing && existing.revision === revision) {
        if (
          existing.ciphertextHash !== ciphertextHash ||
          existing.encryptedSeed !== encryptedSeed
        ) {
          throw new Error('Seed backup revision conflicts with stored ciphertext');
        }
        return existing;
      }

      const currentBackups = await this.getAllBackupsRaw();
      const targetAlreadyExists = currentBackups.some(
        (backup) =>
          backup.blockchain === blockchain &&
          backup.address.toLowerCase() === normalizedAddress.toLowerCase(),
      );
      if (!targetAlreadyExists && currentBackups.length >= MAX_SEED_BACKUPS) {
        throw new Error('Maximum native seed backup count reached');
      }

      const backup: SeedBackup = {
        address: normalizedAddress,
        encryptedSeed,
        blockchain,
        storedAt: Date.now(),
        revision,
        ciphertextHash,
      };
      const serialized = JSON.stringify(backup);
      await AsyncStorage.setItem(key, serialized);

      // AsyncStorage resolving is not enough for a security-sensitive commit:
      // read the value back and bind the acknowledgement to the exact record.
      const confirmedData = await AsyncStorage.getItem(key);
      const confirmed = confirmedData ? parseBackup(confirmedData) : null;
      if (
        !confirmed ||
        confirmed.revision !== revision ||
        confirmed.ciphertextHash !== ciphertextHash ||
        confirmed.encryptedSeed !== encryptedSeed
      ) {
        throw new Error('Seed backup persistence could not be confirmed');
      }

      // Remove the address-only legacy slot only after the chain-scoped record
      // is confirmed. The v2 key prevents TEST_NET and MAIN_NET from clobbering
      // one another when they use the same Q-address.
      const legacyKey = `${LEGACY_SEED_BACKUP_PREFIX}${normalizedAddress.toLowerCase()}`;
      const legacyData = await AsyncStorage.getItem(legacyKey);
      const legacy = legacyData ? parseBackup(legacyData) : null;
      if (legacy?.blockchain === blockchain) {
        await AsyncStorage.removeItem(legacyKey);
      }
      await this.rebuildWalletMetadataRaw();
      Logger.debug('SeedStorage', `Backed up seed for ${normalizedAddress} (${blockchain})`);
      return confirmed;
    });
  }

  /**
   * Retrieve a backed up seed
   */
  async getBackup(address: string, blockchain: string): Promise<SeedBackup | null> {
    const key = backupKey(blockchain, address);
    return this.enqueueWalletOperation(async () => {
      const data = await AsyncStorage.getItem(key);
      return data ? parseBackup(data) : null;
    });
  }

  /**
   * Get all backed up seeds
   * Uses metadata for efficient lookup with multiGet instead of scanning all keys
   */
  async getAllBackups(): Promise<SeedBackup[]> {
    return this.enqueueWalletOperation(() => this.getAllBackupsRaw());
  }

  async getRestoreSnapshot(): Promise<{ generation: number; backups: SeedBackup[] }> {
    const generation = this.walletGeneration;
    const backups = await this.getAllBackups();
    if (!this.isWalletGenerationCurrent(generation)) {
      throw new Error('Wallet changed while preparing seed restore');
    }
    return { generation, backups };
  }

  /**
   * Store PIN securely using expo-secure-store.
   *
   * WHEN_UNLOCKED_THIS_DEVICE_ONLY is wallet-threat-model correct: the PIN
   * becomes unreadable the instant the screen locks, so a lost/stolen locked
   * device cannot hand the PIN to a background forensic acquisition.
   * `ThisDeviceOnly` keeps the PIN out of iCloud Keychain sync. This works
   * safely only because no background code path reads the PIN. hasPinStored
   * consults an AsyncStorage marker, not the Keychain. If you ever add a
   * background reader, reconsider the class choice.
   *
   * After a successful keychain write, mirror "PIN exists" and the
   * accessibility version into AsyncStorage atomically (multiSet), so
   * hasPinStored / needsPinAccessibilityMigration can answer without touching
   * SecureStore.
   */
  async storePinSecurely(pin: string): Promise<void> {
    return this.enqueueWalletOperation(async () => {
      await SecureStore.setItemAsync(PIN_KEY, pin, {
        requireAuthentication: false, // biometric handled separately
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      await AsyncStorage.multiSet([
        [PIN_EXISTS_KEY, '1'],
        [PIN_ACCESSIBILITY_VERSION_KEY, CURRENT_PIN_ACCESSIBILITY_VERSION],
      ]);
      Logger.debug('SeedStorage', 'PIN stored securely');
    });
  }

  /** Remove the Device Login PIN and its existence markers. */
  async clearStoredPin(): Promise<void> {
    return this.enqueueWalletOperation(async () => {
      await SecureStore.deleteItemAsync(PIN_KEY);
      if ((await SecureStore.getItemAsync(PIN_KEY)) !== null) {
        throw new Error('Stored PIN removal could not be confirmed');
      }
      await AsyncStorage.multiRemove([PIN_EXISTS_KEY, PIN_ACCESSIBILITY_VERSION_KEY]);
    });
  }

  /**
   * Retrieve PIN from secure storage.
   * Call after successful biometric authentication.
   */
  private async getStoredPinRaw(failIfUnavailable = false): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(PIN_KEY);
    } catch (error) {
      if (isInteractionNotAllowed(error)) {
        if (failIfUnavailable) throw new SecureStorageUnavailableError();
        // Authentication callers report a temporary retrieval failure without
        // interpreting it as proof that no PIN exists.
        return null;
      }
      Logger.error('SeedStorage', 'Failed to retrieve PIN:', error);
      return null;
    }
  }

  async getStoredPin(): Promise<string | null> {
    return this.enqueueWalletOperation(() => this.getStoredPinRaw());
  }

  private async getDeviceCredentialRaw(): Promise<string | null> {
    let credential: string | null;
    try {
      credential = await SecureStore.getItemAsync(DEVICE_CREDENTIAL_KEY);
    } catch (error) {
      // "Unavailable while locked" is not evidence that the item is absent.
      // Returning null here would let get-or-create replace the real factor and
      // permanently orphan every pin_v5 ciphertext encrypted under it.
      if (isInteractionNotAllowed(error)) throw new SecureStorageUnavailableError();
      throw error;
    }

    if (credential !== null && !DEVICE_CREDENTIAL_PATTERN.test(credential)) {
      throw new Error('Stored wallet device credential has an invalid format');
    }
    return credential;
  }

  /** Read the independent v5 seed-encryption factor from Keychain/Keystore. */
  async getDeviceCredential(): Promise<string | null> {
    return this.enqueueWalletOperation(() => this.getDeviceCredentialRaw());
  }

  /**
   * Return the existing device factor or durably store the WebCrypto-generated
   * candidate. The read-back is the acknowledgement the web wallet requires
   * before it writes any pin_v5 ciphertext. Calls are serialized so concurrent
   * bridge requests cannot replace one another's key.
   */
  async getOrCreateDeviceCredential(candidate: string): Promise<string> {
    if (!DEVICE_CREDENTIAL_PATTERN.test(candidate)) {
      throw new Error('Invalid wallet device credential candidate');
    }

    return this.enqueueWalletOperation(async () => {
      const existing = await this.getDeviceCredentialRaw();
      if (existing) return existing;

      await SecureStore.setItemAsync(DEVICE_CREDENTIAL_KEY, candidate, {
        requireAuthentication: false,
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      const confirmed = await this.getDeviceCredentialRaw();
      if (confirmed !== candidate) {
        throw new Error('Wallet device credential persistence could not be confirmed');
      }
      return confirmed;
    });
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
   * Check if a PIN is stored. The AsyncStorage `pin_exists` marker is the fast,
   * lock-safe path and is the only thing read in steady state. When the marker
   * is ABSENT (fresh install, or a ≤1.2.1 upgrade whose marker has not been
   * repaired yet) we fall back to a single keychain read so this can't lose a
   * race with repairPinExistsMarker() at cold launch. React flushes the
   * child's authCheck effect before the root layout's repair effect, so a
   * marker-only check would report "no PIN" for an upgraded install and trigger
   * a redundant Device-Login prompt. If secure storage is temporarily
   * unavailable, the fallback fails instead of claiming that the PIN is
   * absent. On a hit we repair the marker so subsequent calls never touch the
   * keychain again.
   */
  async hasPinStored(): Promise<boolean> {
    return this.enqueueWalletOperation(async () => {
      const marker = await AsyncStorage.getItem(PIN_EXISTS_KEY);
      if (marker === '1') return true;
      const pin = await this.getStoredPinRaw(true);
      if (pin !== null) {
        await AsyncStorage.setItem(PIN_EXISTS_KEY, '1');
        return true;
      }
      return false;
    });
  }

  /**
   * One-shot bootstrap for installs upgrading from ≤1.2.1: if the AsyncStorage
   * marker is absent but the keychain still holds a PIN, mirror the existence
   * flag. Safe to call at app launch. It runs at most one keychain read (only
   * when the marker is missing), and only in the foreground where
   * interactionNotAllowed is not a concern.
   */
  async repairPinExistsMarker(): Promise<void> {
    try {
      await this.enqueueWalletOperation(async () => {
        const marker = await AsyncStorage.getItem(PIN_EXISTS_KEY);
        if (marker === '1') return; // already set - nothing to do
        const pin = await this.getStoredPinRaw(true);
        if (pin !== null) {
          await AsyncStorage.setItem(PIN_EXISTS_KEY, '1');
          Logger.debug('SeedStorage', 'Repaired pin_exists marker for upgraded install');
        }
      });
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
    return this.enqueueWalletOperation(async () => {
      await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, JSON.stringify(enabled));
      Logger.debug('SeedStorage', `Biometric enabled: ${enabled}`);
    });
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
    return this.enqueueWalletOperation(() =>
      AsyncStorage.setItem(BIOMETRIC_PROMPT_SHOWN_KEY, JSON.stringify(shown)),
    );
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

  private async getAllBackupsRaw(): Promise<SeedBackup[]> {
    const keys = await AsyncStorage.getAllKeys();
    const seedKeys = keys.filter(
      key =>
        key.startsWith(SEED_BACKUP_PREFIX) ||
        (key.startsWith(LEGACY_SEED_BACKUP_PREFIX) && !key.startsWith(SEED_BACKUP_PREFIX)),
    );
    if (seedKeys.length === 0) return [];

    const results = await AsyncStorage.multiGet(seedKeys);
    const newestByScope = new Map<string, SeedBackup>();
    for (const [, data] of results) {
      if (!data) continue;
      const backup = parseBackup(data);
      if (!backup) continue;
      const scope = `${backup.blockchain}\u0000${backup.address.toLowerCase()}`;
      const existing = newestByScope.get(scope);
      if (
        !existing ||
        backup.revision > existing.revision ||
        (backup.revision === existing.revision && backup.storedAt > existing.storedAt)
      ) {
        newestByScope.set(scope, backup);
      }
    }
    return [...newestByScope.values()];
  }

  private async rebuildWalletMetadataRaw(): Promise<void> {
    const backups = await this.getAllBackupsRaw();
    const addresses = [...new Set(backups.map(backup => backup.address))];
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
    return parseWalletMetadata(data);
  }

  /**
   * Check if wallet exists (any backed up seeds)
   */
  async hasWallet(): Promise<boolean> {
    if (await this.getPendingWalletWipe()) return true;
    const metadata = await this.getWalletMetadata();
    if (metadata?.hasWallet === true) return true;

    // A negative or malformed cache is never authoritative. Scan the seed
    // records and repair metadata so a stale false value cannot bypass lock.
    const backups = await this.getAllBackups();
    await this.enqueueWalletOperation(() => this.rebuildWalletMetadataRaw());
    return backups.length > 0;
  }

  /** Read the durable marker that makes a partially completed wipe resumable. */
  async getPendingWalletWipe(): Promise<PendingWalletWipe | null> {
    return this.enqueueWipeJournalOperation(async () => {
      const data = await AsyncStorage.getItem(WALLET_WIPE_PENDING_KEY);
      if (!data) return null;
      const pending = parsePendingWalletWipe(data);
      if (!pending) throw new Error('Wallet wipe journal is invalid');
      return pending;
    });
  }

  /** Create a read-back-confirmed wipe marker before deleting any wallet state. */
  async beginWalletWipe(requestId: string): Promise<PendingWalletWipe> {
    if (!REQUEST_ID_PATTERN.test(requestId)) throw new Error('Invalid wallet wipe request ID');
    return this.enqueueWipeJournalOperation(async () => {
      const currentData = await AsyncStorage.getItem(WALLET_WIPE_PENDING_KEY);
      if (currentData) {
        const current = parsePendingWalletWipe(currentData);
        if (!current) throw new Error('Wallet wipe journal is invalid');
        return current;
      }

      const pending: PendingWalletWipe = { version: 1, requestId, startedAt: Date.now() };
      const serialized = JSON.stringify(pending);
      await AsyncStorage.setItem(WALLET_WIPE_PENDING_KEY, serialized);
      const confirmedData = await AsyncStorage.getItem(WALLET_WIPE_PENDING_KEY);
      const confirmed = confirmedData ? parsePendingWalletWipe(confirmedData) : null;
      if (!confirmed || confirmed.requestId !== requestId) {
        throw new Error('Wallet wipe journal persistence could not be confirmed');
      }
      return confirmed;
    });
  }

  /** Remove the wipe marker only after native and hosted-wallet postconditions hold. */
  async completeWalletWipe(requestId: string): Promise<void> {
    if (!REQUEST_ID_PATTERN.test(requestId)) throw new Error('Invalid wallet wipe request ID');
    return this.enqueueWipeJournalOperation(async () => {
      const currentData = await AsyncStorage.getItem(WALLET_WIPE_PENDING_KEY);
      if (!currentData) return;
      const current = parsePendingWalletWipe(currentData);
      if (!current || current.requestId !== requestId) {
        throw new Error('Wallet wipe acknowledgement does not match the journal');
      }
      await AsyncStorage.removeItem(WALLET_WIPE_PENDING_KEY);
      if ((await AsyncStorage.getItem(WALLET_WIPE_PENDING_KEY)) !== null) {
        throw new Error('Wallet wipe journal removal could not be confirmed');
      }
    });
  }

  /**
   * Clear all wallet data (used when user removes wallet from settings).
   * WARNING: permanently deletes all backed up seeds, stored PIN, and the
   * AsyncStorage markers that mirror keychain state. iOS keeps SecureStore
   * items across app reinstalls (they're tied to the Keychain access group),
   * so the AsyncStorage markers MUST be cleared too. Otherwise a reinstall
   * could see `pin_exists = '1'` pointing at a Keychain the Keychain no
   * longer holds (or vice versa).
   */
  async clearWallet(): Promise<void> {
    if (this.clearPromise) return this.clearPromise;
    Logger.debug('SeedStorage', 'Clearing all wallet data...');
    // Invalidate queued-but-not-started reads/writes immediately. Operations
    // already running finish before the queued wipe, which then removes their
    // output. Calls arriving after this point fail until the wipe completes.
    this.walletClearInProgress = true;
    this.walletGeneration += 1;

    const wipe = this.walletMutationQueue
      .catch(() => undefined)
      .then(async () => {
        const keys = await AsyncStorage.getAllKeys();
        const seedKeys = keys.filter(key => key.startsWith(LEGACY_SEED_BACKUP_PREFIX));
        await AsyncStorage.multiRemove(seedKeys);

        await SecureStore.deleteItemAsync(PIN_KEY);
        await SecureStore.deleteItemAsync(DEVICE_CREDENTIAL_KEY);
        const [storedPin, storedCredential] = await Promise.all([
          SecureStore.getItemAsync(PIN_KEY),
          SecureStore.getItemAsync(DEVICE_CREDENTIAL_KEY),
        ]);
        if (storedPin !== null || storedCredential !== null) {
          throw new Error('Secure wallet credential removal could not be confirmed');
        }

        const markerKeys = [
          BIOMETRIC_ENABLED_KEY,
          BIOMETRIC_PROMPT_SHOWN_KEY,
          WALLET_METADATA_KEY,
          PIN_EXISTS_KEY,
          PIN_ACCESSIBILITY_VERSION_KEY,
        ];
        await AsyncStorage.multiRemove(markerKeys);
        const remaining = await AsyncStorage.multiGet([...seedKeys, ...markerKeys]);
        if (remaining.some(([, value]) => value !== null)) {
          throw new Error('Native wallet data removal could not be confirmed');
        }
        Logger.debug('SeedStorage', 'All wallet data cleared');
      });
    this.walletMutationQueue = wipe.then(
      () => undefined,
      () => undefined,
    );
    this.clearPromise = wipe.finally(() => {
      this.walletClearInProgress = false;
      this.clearPromise = null;
    });
    return this.clearPromise;
  }

  /**
   * Remove a specific seed backup
   */
  async removeBackup(address: string, blockchain?: string): Promise<void> {
    const normalizedAddress = normalizeAddress(address);
    return this.enqueueWalletOperation(async () => {
      const legacyKey = `${LEGACY_SEED_BACKUP_PREFIX}${normalizedAddress.toLowerCase()}`;
      if (blockchain) {
        await AsyncStorage.removeItem(backupKey(blockchain, normalizedAddress));
        const legacyData = await AsyncStorage.getItem(legacyKey);
        const legacy = legacyData ? parseBackup(legacyData) : null;
        if (legacy?.blockchain === blockchain) {
          await AsyncStorage.removeItem(legacyKey);
        }
      } else {
        const keys = await AsyncStorage.getAllKeys();
        const suffix = `_${normalizedAddress.toLowerCase()}`;
        const scoped = keys.filter(
          key => key.startsWith(SEED_BACKUP_PREFIX) && key.endsWith(suffix),
        );
        await AsyncStorage.multiRemove(scoped);
        await AsyncStorage.removeItem(legacyKey);
      }
      await this.rebuildWalletMetadataRaw();
      Logger.debug('SeedStorage', `Removed backup for ${normalizedAddress}`);
    });
  }
}

export default new SeedStorageService();
