import { RefObject } from 'react';
import { Alert, Share, Platform, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import WebView from 'react-native-webview';
import SeedStorageService from './SeedStorageService';

/**
 * Message types that can be received from the WebView
 */
export type WebToNativeMessageType =
  | 'SCAN_QR'
  | 'COPY_TO_CLIPBOARD'
  | 'SHARE'
  | 'TX_CONFIRMED'
  | 'LOG'
  | 'OPEN_URL'                // Open external URL in device browser
  | 'HAPTIC'                  // Trigger haptic feedback
  // Seed persistence messages
  | 'SEED_STORED'             // Web stored encrypted seed, native should backup
  | 'REQUEST_BIOMETRIC_UNLOCK'  // Web asks native to unlock with biometric
  | 'WALLET_CLEARED'          // Web confirmed it cleared localStorage
  | 'WEB_APP_READY'           // Web app is fully initialized and ready to receive data
  | 'PIN_VERIFIED'            // Web responds to PIN verification request
  // Navigation messages
  | 'OPEN_NATIVE_SETTINGS';   // Request native app to open its settings screen

/**
 * Message types that can be sent to the WebView
 */
export type NativeToWebMessageType =
  | 'QR_RESULT'
  | 'BIOMETRIC_SUCCESS'
  | 'APP_STATE'
  | 'CLIPBOARD_SUCCESS'
  | 'SHARE_SUCCESS'
  | 'ERROR'
  // Seed persistence messages
  | 'UNLOCK_WITH_PIN'         // Native sends PIN after biometric success
  | 'RESTORE_SEED'            // Native sends backup seed if localStorage empty
  | 'CLEAR_WALLET'            // Native requests web to clear wallet
  | 'BIOMETRIC_SETUP_PROMPT'  // Native prompts user to enable biometric
  | 'VERIFY_PIN';             // Native asks web to verify PIN can decrypt seed

export interface BridgeMessage {
  type: WebToNativeMessageType;
  payload?: Record<string, unknown>;
}

export interface BridgeResponse {
  type: NativeToWebMessageType;
  payload?: Record<string, unknown>;
}

/**
 * Callback for when QR scanning is requested
 */
type QRScanCallback = () => void;

/**
 * Callback for when biometric unlock is requested
 */
type BiometricUnlockCallback = () => Promise<void>;

/**
 * Callback for when seed is stored (for biometric setup prompt)
 */
type SeedStoredCallback = (address: string) => void;

/**
 * Callback for when web app is fully initialized
 */
type WebAppReadyCallback = () => Promise<void>;

/**
 * Callback for when native settings should be opened
 */
type OpenNativeSettingsCallback = () => void;

/**
 * Callback for when web app confirms wallet data cleared
 */
type WalletClearedCallback = () => void;

/**
 * Callback for PIN verification result
 */
type PinVerifiedCallback = (success: boolean, error?: string) => void;

/**
 * Service for handling communication between native app and WebView
 */
class NativeBridge {
  private webViewRef: RefObject<WebView | null> | null = null;
  private qrScanCallback: QRScanCallback | null = null;
  private biometricUnlockCallback: BiometricUnlockCallback | null = null;
  private seedStoredCallback: SeedStoredCallback | null = null;
  private webAppReadyCallback: WebAppReadyCallback | null = null;
  private openNativeSettingsCallback: OpenNativeSettingsCallback | null = null;
  private walletClearedCallback: WalletClearedCallback | null = null;
  private pinVerifiedCallback: PinVerifiedCallback | null = null;

  /**
   * Set the WebView reference for sending messages back to web
   */
  setWebViewRef(ref: RefObject<WebView | null>) {
    this.webViewRef = ref;
  }

  /**
   * Register callback for QR scan requests
   */
  onQRScanRequest(callback: QRScanCallback) {
    this.qrScanCallback = callback;
  }

  /**
   * Register callback for biometric unlock requests
   */
  onBiometricUnlockRequest(callback: BiometricUnlockCallback) {
    this.biometricUnlockCallback = callback;
  }

  /**
   * Register callback for when seed is stored (to prompt biometric setup)
   */
  onSeedStored(callback: SeedStoredCallback) {
    this.seedStoredCallback = callback;
  }

  /**
   * Register callback for when web app is fully initialized
   */
  onWebAppReady(callback: WebAppReadyCallback) {
    this.webAppReadyCallback = callback;
  }

  /**
   * Register callback for when native settings should be opened
   */
  onOpenNativeSettings(callback: OpenNativeSettingsCallback) {
    this.openNativeSettingsCallback = callback;
  }

  /**
   * Register callback for when web app confirms wallet data cleared
   */
  onWalletCleared(callback: WalletClearedCallback) {
    this.walletClearedCallback = callback;
  }

  /**
   * Unregister wallet cleared callback
   */
  offWalletCleared() {
    this.walletClearedCallback = null;
  }

  /**
   * Check if WebView is ready to receive messages
   */
  isWebViewReady(): boolean {
    return this.webViewRef?.current != null;
  }

  /**
   * Send a message to the WebView
   */
  sendToWeb(message: BridgeResponse) {
    if (this.webViewRef?.current) {
      const script = `
        window.dispatchEvent(new CustomEvent('nativeMessage', {
          detail: ${JSON.stringify(message)}
        }));
        true;
      `;
      this.webViewRef.current.injectJavaScript(script);
    } else {
      console.warn(`[NativeBridge] Cannot send ${message.type}: WebView ref is not available`);
    }
  }

  /**
   * Handle incoming message from WebView
   */
  async handle(message: BridgeMessage) {
    const { type, payload } = message;

    switch (type) {
      case 'SCAN_QR':
        this.handleScanQR();
        break;

      case 'COPY_TO_CLIPBOARD': {
        const text = payload?.text;
        if (typeof text !== 'string') {
          console.warn('[NativeBridge] COPY_TO_CLIPBOARD missing or invalid text');
          this.sendToWeb({ type: 'ERROR', payload: { message: 'Invalid clipboard text' } });
          return;
        }
        await this.handleCopyToClipboard(text);
        break;
      }

      case 'SHARE': {
        const title = payload?.title;
        const text = payload?.text;
        const url = payload?.url;
        // At least text or url should be provided
        if ((title !== undefined && typeof title !== 'string') ||
            (text !== undefined && typeof text !== 'string') ||
            (url !== undefined && typeof url !== 'string')) {
          console.warn('[NativeBridge] SHARE has invalid payload types');
          this.sendToWeb({ type: 'ERROR', payload: { message: 'Invalid share payload' } });
          return;
        }
        await this.handleShare(title, text, url);
        break;
      }

      case 'TX_CONFIRMED': {
        const txHash = payload?.txHash;
        const txType = payload?.type;
        if (typeof txHash !== 'string' || (txType !== 'incoming' && txType !== 'outgoing')) {
          console.warn('[NativeBridge] TX_CONFIRMED has invalid payload');
          return;
        }
        this.handleTxConfirmed(txHash, txType);
        break;
      }

      case 'LOG':
        console.log('[WebView]', payload?.message);
        break;

      case 'HAPTIC':
        this.handleHaptic(payload?.style as string | undefined);
        break;

      case 'OPEN_URL': {
        const url = payload?.url;
        if (typeof url !== 'string') {
          console.warn('[NativeBridge] OPEN_URL missing or invalid url');
          this.sendToWeb({ type: 'ERROR', payload: { message: 'Invalid URL' } });
          return;
        }
        await this.handleOpenUrl(url);
        break;
      }

      // Seed persistence messages
      case 'SEED_STORED': {
        const address = payload?.address;
        const encryptedSeed = payload?.encryptedSeed;
        const blockchain = payload?.blockchain;
        if (typeof address !== 'string' || typeof encryptedSeed !== 'string' || typeof blockchain !== 'string') {
          console.warn('[NativeBridge] SEED_STORED missing or invalid required fields');
          return;
        }
        await this.handleSeedStored(address, encryptedSeed, blockchain);
        break;
      }

      case 'REQUEST_BIOMETRIC_UNLOCK':
        await this.handleBiometricUnlockRequest();
        break;

      case 'WALLET_CLEARED':
        console.log('[NativeBridge] Web confirmed wallet cleared');
        if (this.walletClearedCallback) {
          this.walletClearedCallback();
        }
        break;

      case 'WEB_APP_READY':
        if (this.webAppReadyCallback) {
          await this.webAppReadyCallback();
        }
        break;

      case 'OPEN_NATIVE_SETTINGS':
        console.log('[NativeBridge] Opening native settings');
        if (this.openNativeSettingsCallback) {
          this.openNativeSettingsCallback();
        }
        break;

      case 'PIN_VERIFIED': {
        const success = payload?.success === true;
        const error = typeof payload?.error === 'string' ? payload.error : undefined;
        console.log(`[NativeBridge] PIN verification result: ${success ? 'success' : 'failed'}`);
        if (this.pinVerifiedCallback) {
          this.pinVerifiedCallback(success, error);
          this.pinVerifiedCallback = null; // Clear after use
        }
        break;
      }

      default:
        console.warn(`Unknown message type: ${type}`);
    }
  }

  /**
   * Handle QR scan request - trigger the registered callback
   */
  private handleScanQR() {
    if (this.qrScanCallback) {
      this.qrScanCallback();
    } else {
      console.warn('QR scan requested but no callback registered');
      this.sendToWeb({
        type: 'ERROR',
        payload: { message: 'QR scanner not available' },
      });
    }
  }

  /**
   * Handle copy to clipboard request
   */
  private async handleCopyToClipboard(text: string) {
    if (!text) {
      this.sendToWeb({
        type: 'ERROR',
        payload: { message: 'No text provided to copy' },
      });
      return;
    }

    try {
      await Clipboard.setStringAsync(text);
      this.sendToWeb({
        type: 'CLIPBOARD_SUCCESS',
        payload: { text },
      });
    } catch (error) {
      console.error('Clipboard error:', error);
      this.sendToWeb({
        type: 'ERROR',
        payload: { message: 'Failed to copy to clipboard' },
      });
    }
  }

  /**
   * Handle share request
   */
  private async handleShare(title?: string, text?: string, url?: string) {
    try {
      // Build message - at least one of text or url must be provided
      let message = text || '';
      if (url) {
        if (Platform.OS === 'ios') {
          // iOS supports url separately
          message = message || url;
        } else {
          // Android doesn't support url separately, append to message
          message = message ? `${message}\n${url}` : url;
        }
      }

      if (!message) {
        this.sendToWeb({
          type: 'ERROR',
          payload: { message: 'Nothing to share' },
        });
        return;
      }

      const shareContent: { title?: string; message: string; url?: string } = {
        message,
      };

      if (title) shareContent.title = title;
      if (url && Platform.OS === 'ios') shareContent.url = url;

      const result = await Share.share(shareContent);

      this.sendToWeb({
        type: 'SHARE_SUCCESS',
        payload: {
          action: result.action,
          activityType: result.activityType
        },
      });
    } catch (error) {
      console.error('Share error:', error);
      this.sendToWeb({
        type: 'ERROR',
        payload: { message: 'Failed to share' },
      });
    }
  }

  /**
   * Handle transaction confirmed notification
   * This can be used to trigger local notifications or update UI
   */
  private handleTxConfirmed(txHash: string, txType: 'incoming' | 'outgoing') {
    console.log(`Transaction ${txType}: ${txHash}`);
    // TODO: Integrate with NotificationService when implemented
    // NotificationService.showTransactionNotification(txHash, txType);
  }

  /**
   * Handle haptic feedback request
   * Supports: light, medium, heavy, success, warning, error
   */
  private handleHaptic(style?: string) {
    switch (style) {
      case 'light':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'medium':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      case 'heavy':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        break;
      case 'success':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'warning':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case 'error':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
      default:
        // Default to light impact for any unspecified style
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }

  /**
   * Handle open URL request - opens in device's default browser
   */
  private async handleOpenUrl(url: string) {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        console.warn(`[NativeBridge] Cannot open URL: ${url}`);
        this.sendToWeb({
          type: 'ERROR',
          payload: { message: 'Cannot open this URL' },
        });
      }
    } catch (error) {
      console.error('[NativeBridge] Error opening URL:', error);
      this.sendToWeb({
        type: 'ERROR',
        payload: { message: 'Failed to open URL' },
      });
    }
  }

  /**
   * Send QR scan result back to WebView
   */
  sendQRResult(address: string) {
    this.sendToWeb({
      type: 'QR_RESULT',
      payload: { address },
    });
  }

  /**
   * Send app state change to WebView
   */
  sendAppState(state: 'active' | 'background' | 'inactive') {
    this.sendToWeb({
      type: 'APP_STATE',
      payload: { state },
    });
  }

  /**
   * Send biometric auth result to WebView
   */
  sendBiometricResult(authenticated: boolean) {
    this.sendToWeb({
      type: 'BIOMETRIC_SUCCESS',
      payload: { authenticated },
    });
  }

  // ============================================================
  // Seed Persistence Handlers
  // ============================================================

  /**
   * Handle seed stored notification from web
   * Backup the encrypted seed and prompt for biometric setup if needed
   * Note: Validation is performed in handle() before this method is called
   */
  private async handleSeedStored(
    address: string,
    encryptedSeed: string,
    blockchain: string
  ) {
    console.log(`[NativeBridge] Backing up seed for ${address}`);

    // Backup the encrypted seed to AsyncStorage
    await SeedStorageService.backupSeed(address, encryptedSeed, blockchain);

    // Notify callback (to prompt biometric setup)
    if (this.seedStoredCallback) {
      this.seedStoredCallback(address);
    }
  }

  /**
   * Handle biometric unlock request from web
   */
  private async handleBiometricUnlockRequest() {
    if (this.biometricUnlockCallback) {
      await this.biometricUnlockCallback();
    } else {
      console.warn('[NativeBridge] Biometric unlock requested but no callback registered');
      this.sendToWeb({
        type: 'ERROR',
        payload: { message: 'Biometric unlock not available' },
      });
    }
  }

  // ============================================================
  // Seed Persistence Send Methods
  // ============================================================

  /**
   * Send PIN to web after successful biometric authentication
   */
  sendUnlockWithPin(pin: string) {
    this.sendToWeb({
      type: 'UNLOCK_WITH_PIN',
      payload: { pin },
    });
  }

  /**
   * Send backed up seed to web for restoration
   */
  sendRestoreSeed(address: string, encryptedSeed: string, blockchain: string) {
    this.sendToWeb({
      type: 'RESTORE_SEED',
      payload: { address, encryptedSeed, blockchain },
    });
  }

  /**
   * Request web to clear all wallet data (from native settings)
   */
  sendClearWallet() {
    this.sendToWeb({
      type: 'CLEAR_WALLET',
    });
  }

  /**
   * Prompt web that biometric setup is being shown
   */
  sendBiometricSetupPrompt() {
    this.sendToWeb({
      type: 'BIOMETRIC_SETUP_PROMPT',
    });
  }

  /**
   * Request web to verify PIN can decrypt the stored seed
   * @param pin The PIN to verify
   * @param timeoutMs Timeout in milliseconds (default 10 seconds)
   * @returns Promise that resolves with verification result
   */
  verifyPin(pin: string, timeoutMs: number = 10000): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      // Prevent race condition - reject if verification already in progress
      if (this.pinVerifiedCallback) {
        resolve({ success: false, error: 'A PIN verification is already in progress' });
        return;
      }

      // Check if WebView is ready
      if (!this.isWebViewReady()) {
        console.error('[NativeBridge] verifyPin failed: WebView is not ready');
        resolve({ success: false, error: 'WebView is not ready. Please try again.' });
        return;
      }

      // Set up timeout
      const timeout = setTimeout(() => {
        console.warn('[NativeBridge] PIN verification timed out after', timeoutMs, 'ms');
        this.pinVerifiedCallback = null;
        resolve({ success: false, error: 'PIN verification timed out' });
      }, timeoutMs);

      // Set up callback for response
      this.pinVerifiedCallback = (success: boolean, error?: string) => {
        clearTimeout(timeout);
        this.pinVerifiedCallback = null;
        resolve({ success, error });
      };

      // Send verification request to web
      console.log('[NativeBridge] Sending VERIFY_PIN to web');
      this.sendToWeb({
        type: 'VERIFY_PIN',
        payload: { pin },
      });
    });
  }
}

export default new NativeBridge();
