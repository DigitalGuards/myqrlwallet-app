/**
 * BridgeCrypto - ECDH Key Agreement for Secure Bridge Communication
 *
 * Implements ephemeral ECDH key exchange using P-256 (secp256r1) curve
 * and AES-256-GCM for encrypting sensitive bridge messages.
 *
 * Security model:
 * - Each session generates new ephemeral keypairs
 * - Shared secret derived via ECDH
 * - AES-256-GCM key derived from shared secret using HKDF
 * - Random IV per message, prepended to ciphertext
 */

import * as Crypto from 'expo-crypto';
import { p256 } from '@noble/curves/p256';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import Logger from './Logger';

// Constants
const AES_KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

// HKDF info string for key derivation
const HKDF_INFO = new TextEncoder().encode('BridgeCrypto-AES-GCM-Key');
const HKDF_SALT = new TextEncoder().encode('MyQRLWallet-Bridge-v1');

/**
 * Encrypted message envelope
 */
export interface EncryptedEnvelope {
  /** Base64-encoded ciphertext with IV prepended */
  encrypted: string;
  /** Indicates message is encrypted */
  isEncrypted: true;
}

/**
 * Key exchange state
 */
interface KeyExchangeState {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  sharedSecret: Uint8Array | null;
  aesKey: Uint8Array | null;
  isReady: boolean;
  encryptionEnabled: boolean;
}

/**
 * BridgeCrypto service singleton
 * Manages ECDH key exchange and message encryption/decryption
 */
class BridgeCryptoService {
  private state: KeyExchangeState | null = null;
  private onReadyCallbacks: Array<() => void> = [];

  /**
   * Check if encryption is ready (key exchange complete)
   */
  isReady(): boolean {
    return this.state?.isReady ?? false;
  }

  /**
   * Check if encryption should be used for messages
   * Returns true only if key exchange completed successfully and encryption is enabled
   */
  shouldEncrypt(): boolean {
    return this.state?.encryptionEnabled === true && this.state?.isReady === true;
  }

  /**
   * Get the public key for key exchange (base64 encoded)
   * Generates new keypair if not already initialized
   */
  async getPublicKey(): Promise<string> {
    if (!this.state) {
      await this.generateKeyPair();
    }
    return this.uint8ArrayToBase64(this.state!.publicKey);
  }

  /**
   * Generate a new ephemeral ECDH keypair
   */
  async generateKeyPair(): Promise<void> {
    // Generate random private key using expo-crypto
    const privateKeyBytes = await Crypto.getRandomBytesAsync(32);
    const privateKey = new Uint8Array(privateKeyBytes);

    // Derive public key from private key
    const publicKey = p256.getPublicKey(privateKey, false); // uncompressed format

    this.state = {
      privateKey,
      publicKey,
      sharedSecret: null,
      aesKey: null,
      isReady: false,
      encryptionEnabled: false,
    };

    Logger.debug('BridgeCrypto', 'Generated new ECDH keypair');
  }

  /**
   * Complete key exchange with peer's public key
   * Derives shared secret and AES key
   *
   * @param peerPublicKeyBase64 - Peer's public key in base64 (uncompressed P-256)
   */
  async completeKeyExchange(peerPublicKeyBase64: string): Promise<boolean> {
    if (!this.state) {
      Logger.error('BridgeCrypto', 'Cannot complete key exchange: no keypair generated');
      return false;
    }

    try {
      const peerPublicKey = this.base64ToUint8Array(peerPublicKeyBase64);

      // Validate peer public key is on the curve
      try {
        p256.ProjectivePoint.fromHex(peerPublicKey);
      } catch {
        Logger.error('BridgeCrypto', 'Invalid peer public key');
        return false;
      }

      // Compute shared secret via ECDH
      const sharedPoint = p256.getSharedSecret(this.state.privateKey, peerPublicKey);

      // The shared secret is the x-coordinate of the shared point
      // getSharedSecret returns the x-coordinate directly (32 bytes)
      const sharedSecret = sharedPoint.slice(1, 33); // Skip the 0x04 prefix if present

      // Derive AES key using HKDF
      const aesKey = hkdf(sha256, sharedSecret, HKDF_SALT, HKDF_INFO, AES_KEY_LENGTH);

      this.state.sharedSecret = sharedSecret;
      this.state.aesKey = new Uint8Array(aesKey);
      this.state.isReady = true;
      this.state.encryptionEnabled = true;

      Logger.debug('BridgeCrypto', 'Key exchange completed successfully');

      // Notify any waiting callbacks
      this.onReadyCallbacks.forEach(cb => cb());
      this.onReadyCallbacks = [];

      return true;
    } catch (error) {
      Logger.error('BridgeCrypto', 'Key exchange failed:', error);
      return false;
    }
  }

  /**
   * Encrypt a message using AES-256-GCM
   *
   * @param plaintext - String to encrypt
   * @returns Encrypted envelope or null if encryption not ready
   */
  async encrypt(plaintext: string): Promise<EncryptedEnvelope | null> {
    if (!this.state?.isReady || !this.state.aesKey) {
      Logger.warn('BridgeCrypto', 'Cannot encrypt: key exchange not complete');
      return null;
    }

    try {
      // Generate random IV
      const ivBytes = await Crypto.getRandomBytesAsync(IV_LENGTH);
      const iv = new Uint8Array(ivBytes);

      // Convert plaintext to bytes
      const plaintextBytes = new TextEncoder().encode(plaintext);

      // Encrypt using AES-GCM (we'll use SubtleCrypto via a shim)
      const ciphertext = await this.aesGcmEncrypt(
        this.state.aesKey,
        iv,
        plaintextBytes
      );

      // Prepend IV to ciphertext
      const combined = new Uint8Array(IV_LENGTH + ciphertext.length);
      combined.set(iv, 0);
      combined.set(ciphertext, IV_LENGTH);

      return {
        encrypted: this.uint8ArrayToBase64(combined),
        isEncrypted: true,
      };
    } catch (error) {
      Logger.error('BridgeCrypto', 'Encryption failed:', error);
      return null;
    }
  }

  /**
   * Decrypt a message using AES-256-GCM
   *
   * @param envelope - Encrypted envelope
   * @returns Decrypted string or null if decryption fails
   */
  async decrypt(envelope: EncryptedEnvelope): Promise<string | null> {
    if (!this.state?.isReady || !this.state.aesKey) {
      Logger.warn('BridgeCrypto', 'Cannot decrypt: key exchange not complete');
      return null;
    }

    try {
      // Decode the combined IV + ciphertext
      const combined = this.base64ToUint8Array(envelope.encrypted);

      // Extract IV and ciphertext
      const iv = combined.slice(0, IV_LENGTH);
      const ciphertext = combined.slice(IV_LENGTH);

      // Decrypt using AES-GCM
      const plaintextBytes = await this.aesGcmDecrypt(
        this.state.aesKey,
        iv,
        ciphertext
      );

      return new TextDecoder().decode(plaintextBytes);
    } catch (error) {
      Logger.error('BridgeCrypto', 'Decryption failed:', error);
      return null;
    }
  }

  /**
   * Reset the crypto state (call on session end or WebView reload)
   */
  reset(): void {
    // Clear sensitive data
    if (this.state) {
      this.state.privateKey.fill(0);
      if (this.state.sharedSecret) this.state.sharedSecret.fill(0);
      if (this.state.aesKey) this.state.aesKey.fill(0);
    }
    this.state = null;
    this.onReadyCallbacks = [];
    Logger.debug('BridgeCrypto', 'Crypto state reset');
  }

  /**
   * Wait for key exchange to complete
   * @param timeoutMs - Maximum time to wait
   */
  waitForReady(timeoutMs: number = 10000): Promise<void> {
    if (this.state?.isReady) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.onReadyCallbacks.indexOf(callback);
        if (index !== -1) this.onReadyCallbacks.splice(index, 1);
        reject(new Error('Key exchange timeout'));
      }, timeoutMs);

      const callback = () => {
        clearTimeout(timeout);
        resolve();
      };

      this.onReadyCallbacks.push(callback);
    });
  }

  // ============================================================
  // Private helpers
  // ============================================================

  /**
   * AES-GCM encryption using a pure JS implementation
   * Note: In production, consider using react-native-quick-crypto for native performance
   */
  private async aesGcmEncrypt(
    key: Uint8Array,
    iv: Uint8Array,
    plaintext: Uint8Array
  ): Promise<Uint8Array> {
    // Use the gcm module from @noble/ciphers
    const { gcm } = await import('@noble/ciphers/aes');
    const aes = gcm(key, iv);
    return aes.encrypt(plaintext);
  }

  /**
   * AES-GCM decryption using a pure JS implementation
   */
  private async aesGcmDecrypt(
    key: Uint8Array,
    iv: Uint8Array,
    ciphertext: Uint8Array
  ): Promise<Uint8Array> {
    const { gcm } = await import('@noble/ciphers/aes');
    const aes = gcm(key, iv);
    return aes.decrypt(ciphertext);
  }

  /**
   * Convert Uint8Array to base64 string
   */
  private uint8ArrayToBase64(bytes: Uint8Array): string {
    // Use Buffer in React Native environment
    return Buffer.from(bytes).toString('base64');
  }

  /**
   * Convert base64 string to Uint8Array
   */
  private base64ToUint8Array(base64: string): Uint8Array {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
}

export default new BridgeCryptoService();

/**
 * Type guard to check if a message is an encrypted envelope
 */
export function isEncryptedEnvelope(message: unknown): message is EncryptedEnvelope {
  return (
    typeof message === 'object' &&
    message !== null &&
    'isEncrypted' in message &&
    (message as EncryptedEnvelope).isEncrypted === true &&
    'encrypted' in message &&
    typeof (message as EncryptedEnvelope).encrypted === 'string'
  );
}
