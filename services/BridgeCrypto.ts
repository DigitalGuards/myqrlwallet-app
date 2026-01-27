/**
 * BridgeCrypto - ML-KEM-1024 Key Encapsulation for Secure Bridge Communication
 *
 * Implements post-quantum secure key exchange using ML-KEM-1024 (FIPS 203)
 * and AES-256-GCM for encrypting sensitive bridge messages.
 *
 * Security model:
 * - Post-quantum secure key exchange (NIST Category 5, ~AES-256 equivalent)
 * - Native acts as ENCAPSULATOR: receives web's public key, generates shared secret
 * - Web acts as DECAPSULATOR: generates keypair, decapsulates to get shared secret
 * - AES-256-GCM key derived from shared secret using HKDF
 * - Random IV per message, prepended to ciphertext
 *
 * Protocol:
 * 1. Web generates ML-KEM keypair, sends encapsulation key to native
 * 2. Native encapsulates: (ciphertext, sharedSecret) = encapsulate(webPublicKey)
 * 3. Native sends ciphertext back to web
 * 4. Web decapsulates: sharedSecret = decapsulate(ciphertext, secretKey)
 * 5. Both derive AES key from shared secret
 */

import * as Crypto from 'expo-crypto';
import { ml_kem1024 } from '@noble/post-quantum/ml-kem';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import Logger from './Logger';

// Constants
const AES_KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits for GCM

// HKDF info string for key derivation - updated for ML-KEM
const HKDF_INFO = new TextEncoder().encode('BridgeCrypto-ML-KEM-1024-AES-GCM-Key');
const HKDF_SALT = new TextEncoder().encode('MyQRLWallet-Bridge-v2');

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
 * Key exchange state for encapsulator (native)
 */
interface EncapsulatorState {
  sharedSecret: Uint8Array | null;
  aesKey: Uint8Array | null;
  isReady: boolean;
  encryptionEnabled: boolean;
}

/**
 * BridgeCrypto service singleton
 * Native acts as ENCAPSULATOR in ML-KEM key exchange
 */
class BridgeCryptoService {
  private state: EncapsulatorState | null = null;
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
   * Complete key exchange by encapsulating with web's public key
   * Returns the ciphertext that must be sent back to web
   *
   * @param webEncapKeyBase64 - Web's encapsulation key (ML-KEM-1024 public key) in base64
   * @returns Base64-encoded ciphertext, or null if encapsulation fails
   */
  async completeKeyExchange(webEncapKeyBase64: string): Promise<string | null> {
    try {
      const webEncapKey = this.base64ToUint8Array(webEncapKeyBase64);

      // Validate key size (ML-KEM-1024 public key is 1568 bytes)
      if (webEncapKey.length !== 1568) {
        Logger.error('BridgeCrypto', `Invalid encapsulation key size: ${webEncapKey.length} (expected 1568)`);
        return null;
      }

      // Encapsulate: generates ciphertext + shared secret
      const { cipherText, sharedSecret } = ml_kem1024.encapsulate(webEncapKey);

      // Derive AES key using HKDF
      const aesKey = hkdf(sha256, sharedSecret, HKDF_SALT, HKDF_INFO, AES_KEY_LENGTH);

      this.state = {
        sharedSecret: new Uint8Array(sharedSecret),
        aesKey: new Uint8Array(aesKey),
        isReady: true,
        encryptionEnabled: true,
      };

      Logger.debug('BridgeCrypto', 'ML-KEM-1024 key encapsulation completed successfully');

      // Notify any waiting callbacks
      this.onReadyCallbacks.forEach(cb => cb());
      this.onReadyCallbacks = [];

      // Return ciphertext for web to decapsulate
      return this.uint8ArrayToBase64(cipherText);
    } catch (error) {
      Logger.error('BridgeCrypto', 'Key encapsulation failed:', error);
      return null;
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

      // Encrypt using AES-GCM
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
   * AES-GCM encryption using @noble/ciphers
   */
  private async aesGcmEncrypt(
    key: Uint8Array,
    iv: Uint8Array,
    plaintext: Uint8Array
  ): Promise<Uint8Array> {
    const { gcm } = await import('@noble/ciphers/aes');
    const aes = gcm(key, iv);
    return aes.encrypt(plaintext);
  }

  /**
   * AES-GCM decryption using @noble/ciphers
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
