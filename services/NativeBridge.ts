import { RefObject } from 'react';
import { Alert, Share, Platform, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import WebView from 'react-native-webview';
import SeedStorageService from './SeedStorageService';
import DAppConnectionStore from './DAppConnectionStore';
import WebViewService from './WebViewService';
import Logger from './Logger';

export const NATIVE_PIN_COMMIT_ERROR = 'Native secure PIN commit failed';
export const NATIVE_PIN_CHANGE_AMBIGUOUS_ERROR = 'Native PIN change outcome is ambiguous';

const REQUEST_ID_PATTERN = /^[0-9a-f]{32}$/;
const Q40_ADDRESS_PATTERN = /^Q[0-9a-fA-F]{40}$/;
const CHANNEL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PIN_PATTERN = /^\d{4,6}$/;
const MAX_CLIPBOARD_CHARS = 64 * 1024;
const MAX_SHARE_TEXT_CHARS = 64 * 1024;
const MAX_SHARE_TITLE_CHARS = 256;
const MAX_LOG_CHARS = 4096;
const MAX_CONTACTS = 500;
const MAX_CONTACTS_JSON_CHARS = 256 * 1024;
const MAX_DAPP_NAME_CHARS = 128;
const MAX_DAPP_URL_CHARS = 2048;
const MAX_PENDING_SEED_WRITES = 4;

export interface NativeSecurityContext {
  walletGeneration: number;
  documentGeneration: number;
  authorizationGeneration: number;
  documentId: string | null;
}

function createRequestId(): string {
  return Array.from(Crypto.getRandomBytes(16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isValidContact(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const contact = value as Record<string, unknown>;
  return (
    typeof contact.id === 'string' &&
    contact.id.length > 0 &&
    contact.id.length <= 128 &&
    typeof contact.name === 'string' &&
    contact.name.length > 0 &&
    contact.name.length <= 128 &&
    typeof contact.address === 'string' &&
    Q40_ADDRESS_PATTERN.test(contact.address) &&
    typeof contact.createdAt === 'number' &&
    Number.isSafeInteger(contact.createdAt) &&
    contact.createdAt >= 0
  );
}

export interface NativePinChangeOptions {
  timeoutMs?: number;
  acceptAlreadyTarget?: boolean;
}

/** Parse the only URL class a privileged hosted WebView may open externally. */
export function parseExternalHttpUrl(value: string): string | null {
  if (value.length === 0 || value.length > 2048 || value.trim() !== value) return null;
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    const isLoopback =
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]';
    if (
      (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.hostname === ''
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function parseDAppMetadataUrl(value: string): string | null {
  const parsedValue = parseExternalHttpUrl(value);
  if (!parsedValue) return null;
  const parsed = new URL(parsedValue);
  if (parsed.protocol === 'https:') return parsedValue;
  if (
    __DEV__ &&
    parsed.protocol === 'http:' &&
    (parsed.hostname.toLowerCase() === 'localhost' ||
      parsed.hostname.toLowerCase().endsWith('.localhost') ||
      ['127.0.0.1', '[::1]'].includes(parsed.hostname.toLowerCase()))
  ) {
    return parsedValue;
  }
  return null;
}

/**
 * Message types that can be received from the WebView
 */
export type WebToNativeMessageType =
  | 'SCAN_QR'
  | 'COPY_TO_CLIPBOARD'
  | 'SHARE'
  | 'TX_CONFIRMED'
  | 'LOG'
  | 'OPEN_URL' // Open external URL in device browser
  | 'HAPTIC' // Trigger haptic feedback
  // Seed persistence messages
  | 'SEED_STORED' // Web stored encrypted seed, native should backup
  | 'DEVICE_CREDENTIAL_REQUEST' // Get/create the hardware-backed v5 wallet factor
  | 'REQUEST_BIOMETRIC_UNLOCK' // Web asks native to unlock with biometric
  | 'WALLET_CLEARED' // Web confirmed it cleared localStorage
  | 'WEB_APP_READY' // Web app is fully initialized and ready to receive data
  | 'WEB_DOCUMENT_READY' // Web echoes the native document challenge
  | 'PIN_VERIFIED' // Web responds to PIN verification request
  | 'PIN_CHANGED' // Web responds to PIN change request
  | 'CONTACTS_UPDATED' // Web address book changed, native should back it up
  // Navigation messages
  | 'OPEN_NATIVE_SETTINGS' // Request native app to open its settings screen
  // DApp Connect messages
  | 'DAPP_SHOW_WEBVIEW' // Request native to show/focus WebView tab (for approval)
  | 'DAPP_CONNECTED' // Notify native that a dApp connected
  | 'DAPP_DISCONNECTED' // Notify native that a dApp disconnected
  | 'DAPP_DISCONNECT_RESPONSE' // Correlated durable dApp disconnect result
  | 'DAPP_HAPTIC' // Trigger haptic for dApp approve/reject
  | 'DAPP_RETURN'; // Bounce back to the dApp after approval (peer redirect)

const LOCKED_ALLOWED_MESSAGE_TYPES = new Set<WebToNativeMessageType>([
  'LOG',
  'WEB_APP_READY',
  'WEB_DOCUMENT_READY',
  'PIN_VERIFIED',
  'PIN_CHANGED',
  'WALLET_CLEARED',
  'DAPP_DISCONNECT_RESPONSE',
]);

/**
 * Message types that can be sent to the WebView
 */
export type NativeToWebMessageType =
  | 'QR_RESULT'
  | 'QR_CANCELLED' // User closed QR scanner without scanning
  | 'BIOMETRIC_SUCCESS'
  | 'APP_STATE'
  | 'CLIPBOARD_SUCCESS'
  | 'SHARE_SUCCESS'
  | 'ERROR'
  // Seed persistence messages
  | 'UNLOCK_WITH_PIN' // Native sends PIN after biometric success
  | 'RESTORE_SEED' // Native sends backup seed if localStorage empty
  | 'CLEAR_WALLET' // Native requests web to clear wallet
  | 'BIOMETRIC_SETUP_PROMPT' // Native prompts user to enable biometric
  | 'VERIFY_PIN' // Native asks web to verify PIN can decrypt seed
  | 'CHANGE_PIN' // Native requests web to change PIN (re-encrypt seeds)
  | 'SEED_STORED_RESPONSE' // Native durably acknowledged an exact seed revision
  | 'DEVICE_CREDENTIAL_RESPONSE' // Native returns the hardware-backed v5 wallet factor
  | 'WEB_DOCUMENT_CHALLENGE' // Native challenges the claimed document instance
  // DApp Connect messages
  | 'DAPP_URI' // Deep link URI forwarded to WebView
  | 'DAPP_DISCONNECT' // Request web to disconnect a specific dApp session
  | 'SET_DISPLAY_PREFS' // Set Home card visibility (showTokensCard / showNftsCard)
  | 'RESTORE_CONTACTS' // Send the backed-up address book to the web wallet
  | 'NAVIGATE'; // Ask the web wallet to navigate to an in-app route

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
type BiometricUnlockCallback = (context: NativeSecurityContext) => Promise<void>;

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
type WalletClearStartedCallback = () => void;

/**
 * Callback for PIN verification result
 */
type PinVerifiedCallback = (success: boolean, error?: string) => void;

/**
 * Callback for PIN change result
 */
type PinChangedCallback = (success: boolean, newPin?: string, error?: string) => void;

interface PendingPinChangeRequest {
  requestId: string;
  expectedPin: string;
}

interface PendingPinVerification {
  requestId: string;
  context: NativeSecurityContext;
  finish: PinVerifiedCallback;
}

interface PendingDAppDisconnect {
  requestId: string;
  channelId: string;
  documentGeneration: number;
  finish: (success: boolean, error?: string) => void;
}

interface PendingWalletClearRequest {
  requestId: string;
  documentGeneration: number;
  finish: (success: boolean, error?: string) => void;
}

interface PendingDocumentChallenge {
  documentId: string;
  challengeId: string;
  documentGeneration: number;
}

/**
 * Callback for when dApp requests WebView to be shown/focused
 */
type DAppShowWebViewCallback = () => void;

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
  private walletClearStartedCallback: WalletClearStartedCallback | null = null;
  private pendingPinVerification: PendingPinVerification | null = null;
  private pinVerificationPending = false;
  private pinChangedCallback: PinChangedCallback | null = null;
  private pinChangePending = false;
  private pendingPinChangeRequest: PendingPinChangeRequest | null = null;
  private pinChangeSequence = 0;
  private pinCommitQueue: Promise<void> = Promise.resolve();
  private walletClearInProgress = false;
  private walletClearPromise: Promise<void> | null = null;
  private pendingWalletClearRequest: PendingWalletClearRequest | null = null;
  private walletMutationGeneration = 0;
  private documentGeneration = 0;
  private activeDocumentId: string | null = null;
  private pendingDocumentChallenges = new Map<string, PendingDocumentChallenge>();
  private authorizationGeneration = 0;
  private nativeAuthorized = false;
  private authorizedSyncDocumentGeneration = -1;
  private authorizedSyncPromise: Promise<void> | null = null;
  private pendingDAppDisconnects = new Map<string, PendingDAppDisconnect>();
  private pendingSeedStoreRequestIds = new Set<string>();
  private dappShowWebViewCallback: DAppShowWebViewCallback | null = null;
  private dappStoreWriteQueue: Promise<void> = Promise.resolve();
  private isWebAppReady: boolean = false;
  private webAppReadyResolvers: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = [];

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
   * Check if web app is ready
   */
  getIsWebAppReady(): boolean {
    return this.isWebAppReady;
  }

  captureSecurityContext(): NativeSecurityContext {
    return {
      walletGeneration: this.walletMutationGeneration,
      documentGeneration: this.documentGeneration,
      authorizationGeneration: this.authorizationGeneration,
      documentId: this.activeDocumentId,
    };
  }

  isSecurityContextCurrent(context: NativeSecurityContext): boolean {
    return (
      !this.walletClearInProgress &&
      context.walletGeneration === this.walletMutationGeneration &&
      context.documentGeneration === this.documentGeneration &&
      context.authorizationGeneration === this.authorizationGeneration &&
      (context.documentId === null || context.documentId === this.activeDocumentId)
    );
  }

  /** Invalidate auth work when the native lock is engaged. */
  invalidateAuthorization(): void {
    this.nativeAuthorized = false;
    this.authorizationGeneration += 1;
    this.cancelPendingPinVerification('App authorization changed');
  }

  setNativeAuthorization(authorized: boolean): void {
    this.nativeAuthorized = authorized && !this.walletClearInProgress;
    if (!this.nativeAuthorized) this.authorizedSyncDocumentGeneration = -1;
    if (this.nativeAuthorized && this.isWebAppReady) {
      this.synchronizeAuthorizedDocument().catch((error) => {
        Logger.error('NativeBridge', 'Authorized document sync failed:', error);
      });
    }
  }

  private async synchronizeAuthorizedDocument(): Promise<void> {
    if (!this.nativeAuthorized || !this.isWebAppReady) return;
    const generation = this.documentGeneration;
    if (this.authorizedSyncDocumentGeneration === generation && this.authorizedSyncPromise) {
      return this.authorizedSyncPromise;
    }
    if (this.authorizedSyncDocumentGeneration === generation) return;

    this.authorizedSyncDocumentGeneration = generation;
    const operation = (async () => {
      const displayPrefs = await WebViewService.getUserPreferences();
      if (!this.nativeAuthorized || generation !== this.documentGeneration) return;
      this.sendDisplayPrefs({
        showTokensCard: displayPrefs.showTokensCard ?? true,
        showNftsCard: displayPrefs.showNftsCard ?? true,
      });

      const contactsJson = await WebViewService.getContactsBackup();
      if (!this.nativeAuthorized || generation !== this.documentGeneration) return;
      if (contactsJson) {
        const contacts: unknown = JSON.parse(contactsJson);
        if (
          Array.isArray(contacts) &&
          contacts.length <= MAX_CONTACTS &&
          contacts.every(isValidContact) &&
          contactsJson.length <= MAX_CONTACTS_JSON_CHARS
        ) {
          this.sendToWeb({ type: 'RESTORE_CONTACTS', payload: { contacts } });
        }
      }

      if (
        this.webAppReadyCallback &&
        this.nativeAuthorized &&
        generation === this.documentGeneration
      ) {
        await this.webAppReadyCallback();
      }
    })();
    const checked = operation.catch((error) => {
      if (this.authorizedSyncDocumentGeneration === generation) {
        this.authorizedSyncDocumentGeneration = -1;
      }
      throw error;
    });
    const inFlight = checked.finally(() => {
      if (this.authorizedSyncPromise === inFlight) this.authorizedSyncPromise = null;
    });
    this.authorizedSyncPromise = inFlight;
    return inFlight;
  }

  private cancelPendingPinVerification(error: string): void {
    const pending = this.pendingPinVerification;
    this.pendingPinVerification = null;
    if (pending) pending.finish(false, error);
  }

  private cancelDocumentRequests(
    error: string,
    pinChangeError: string = NATIVE_PIN_CHANGE_AMBIGUOUS_ERROR,
  ): void {
    this.cancelPendingPinVerification(error);

    const disconnects = [...this.pendingDAppDisconnects.values()];
    for (const pending of disconnects) pending.finish(false, error);

    const walletClear = this.pendingWalletClearRequest;
    if (walletClear) walletClear.finish(false, error);

    if (this.pinChangedCallback) {
      this.pinChangedCallback(false, undefined, pinChangeError);
    }
  }

  /**
   * Flush all pending web app ready resolvers
   * @param action 'resolve' to fulfill promises, 'reject' to reject with error
   * @param error Error message when rejecting (ignored for resolve)
   */
  private flushWebAppReadyResolvers(action: 'resolve' | 'reject', error?: string) {
    // Iterate over a copy to prevent concurrent modification issues
    const resolvers = this.webAppReadyResolvers;
    this.webAppReadyResolvers = [];
    for (const resolver of resolvers) {
      clearTimeout(resolver.timeout);
      if (action === 'resolve') {
        resolver.resolve();
      } else {
        resolver.reject(new Error(error || 'Web app ready state was reset'));
      }
    }
  }

  /**
   * Reset web app ready state (call when app goes to background or WebView reloads)
   * Rejects any pending waitForWebAppReady promises to prevent stale operations
   */
  resetWebAppReady() {
    Logger.debug('NativeBridge', 'Resetting web app ready state');
    this.isWebAppReady = false;
    this.nativeAuthorized = false;
    this.authorizedSyncDocumentGeneration = -1;
    this.activeDocumentId = null;
    this.pendingDocumentChallenges.clear();
    this.documentGeneration += 1;
    this.cancelDocumentRequests('Web app document changed');
    this.flushWebAppReadyResolvers('reject', 'Web app ready state was reset');
  }

  /**
   * Wait for web app to be ready
   * @param timeoutMs Maximum time to wait (default 15 seconds)
   * @returns Promise that resolves when ready or rejects on timeout or reset
   */
  waitForWebAppReady(timeoutMs: number = 15000): Promise<void> {
    Logger.debug('NativeBridge', `waitForWebAppReady called, isWebAppReady=${this.isWebAppReady}`);
    if (this.isWebAppReady) {
      Logger.debug('NativeBridge', 'Web app already ready, resolving immediately');
      return Promise.resolve();
    }
    Logger.debug('NativeBridge', `Web app not ready, waiting up to ${timeoutMs}ms`);

    return new Promise((resolve, reject) => {
      const resolver = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          // Remove this resolver from the list
          this.webAppReadyResolvers = this.webAppReadyResolvers.filter((r) => r !== resolver);
          reject(new Error('Timeout waiting for web app to be ready'));
        }, timeoutMs),
      };

      this.webAppReadyResolvers.push(resolver);
    });
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

  onWalletClearStarted(callback: WalletClearStartedCallback) {
    this.walletClearStartedCallback = callback;
  }

  /** Invalidate credential mutations before native wallet storage is wiped. */
  beginWalletClear(): void {
    if (this.walletClearInProgress) return;
    this.walletClearInProgress = true;
    this.nativeAuthorized = false;
    this.walletMutationGeneration += 1;
    this.authorizationGeneration += 1;
    if (this.walletClearStartedCallback) this.walletClearStartedCallback();
    this.cancelDocumentRequests('Wallet clear is in progress', 'Wallet clear is in progress');
  }

  /** Release the mutation guard only after native and web cleanup has ended. */
  endWalletClear(): void {
    this.walletClearInProgress = false;
  }

  /**
   * Register callback for when dApp requests WebView to be shown/focused
   */
  onDAppShowWebView(callback: DAppShowWebViewCallback) {
    this.dappShowWebViewCallback = callback;
  }

  /**
   * Forward a qrlconnect:// deep link URI to the WebView
   */
  sendDAppURI(uri: string): boolean {
    if (
      !this.nativeAuthorized ||
      uri.length === 0 ||
      uri.length > 4096 ||
      !uri.startsWith('qrlconnect:')
    ) {
      return false;
    }
    return this.sendToWeb({
      type: 'DAPP_URI',
      payload: { uri },
    }) ?? false;
  }

  /**
   * Request web to disconnect a specific dApp session
   */
  async requestDAppDisconnect(
    channelId: string,
    timeoutMs: number = 15000
  ): Promise<{ success: boolean; error?: string }> {
    if (!CHANNEL_ID_PATTERN.test(channelId)) {
      return { success: false, error: 'Invalid dApp channel ID' };
    }
    if (!this.nativeAuthorized) {
      return { success: false, error: 'Unlock the wallet app first' };
    }
    const context = this.captureSecurityContext();
    try {
      await this.waitForWebAppReady(timeoutMs);
    } catch {
      return { success: false, error: 'Web app not ready. Please try again.' };
    }
    if (!this.nativeAuthorized || !this.isSecurityContextCurrent(context)) {
      return { success: false, error: 'App authorization changed. Please try again.' };
    }

    const requestId = createRequestId();
    const documentGeneration = this.documentGeneration;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (success: boolean, error?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.pendingDAppDisconnects.delete(requestId);
        resolve({ success, error });
      };
      const timeout = setTimeout(
        () => finish(false, 'dApp disconnect confirmation timed out'),
        timeoutMs,
      );
      this.pendingDAppDisconnects.set(requestId, {
        requestId,
        channelId,
        documentGeneration,
        finish,
      });
      if (
        !this.sendToWeb({
          type: 'DAPP_DISCONNECT',
          payload: { requestId, channelId },
        })
      ) {
        finish(false, 'Web app is unavailable');
      }
    });
  }

  /**
   * Push Home card-visibility prefs to the WebView. The web wallet stores
   * these in its WalletSettings and the Home screen re-reads them live.
   * Fire-and-forget: if sent while the WebView is throttled (Settings tab),
   * it is queued and applied when the WebView becomes active again.
   */
  sendDisplayPrefs(prefs: { showTokensCard?: boolean; showNftsCard?: boolean }) {
    this.sendToWeb({
      type: 'SET_DISPLAY_PREFS',
      payload: { ...prefs },
    });
  }

  /**
   * Unregister wallet cleared callback
   */
  offWalletCleared() {
    this.walletClearedCallback = null;
  }

  /**
   * Send a message to the WebView
   * Uses a try-catch wrapper for iOS compatibility
   */
  sendToWeb(message: BridgeResponse): boolean | undefined {
    let boundMessage: BridgeResponse;
    if (message.type === 'WEB_DOCUMENT_CHALLENGE') {
      const documentId = message.payload?.documentId;
      const challengeId = message.payload?.challengeId;
      if (
        typeof documentId !== 'string' ||
        !REQUEST_ID_PATTERN.test(documentId) ||
        typeof challengeId !== 'string' ||
        !REQUEST_ID_PATTERN.test(challengeId)
      ) {
        return false;
      }
      boundMessage = message;
    } else {
      if (!this.activeDocumentId || !this.isWebAppReady) {
        Logger.warn('NativeBridge', 'Web document is not authenticated, message not sent:', message.type);
        return false;
      }
      boundMessage = {
        ...message,
        payload: { ...(message.payload ?? {}), documentId: this.activeDocumentId },
      };
    }

    if (this.webViewRef?.current) {
      const serializedMessage = JSON.stringify(boundMessage);
      // JSON-stringify again so it is always a safely quoted JS string literal.
      const escapedSerializedMessage = JSON.stringify(serializedMessage);
      // Wrap in try-catch and IIFE to prevent iOS from interpreting errors as navigation
      // The void(0) at the end ensures no return value that could trigger navigation
      const script =
        '(function() {' +
        'try {' +
        `var detail = JSON.parse(${escapedSerializedMessage});` +
        "window.dispatchEvent(new CustomEvent('nativeMessage', { detail: detail }));" +
        '} catch (e) {' +
        "console.error('[NativeBridge] Error dispatching message:', e);" +
        '}' +
        '})();' +
        'void(0);';
      this.webViewRef.current.injectJavaScript(script);
      return true;
    } else {
      Logger.warn('NativeBridge', 'WebView ref not available, message not sent:', message.type);
      return false;
    }
  }

  /**
   * Handle incoming message from WebView
   */
  async handle(message: BridgeMessage) {
    const { type, payload } = message;

    if (typeof type !== 'string' || type.length === 0 || type.length > 64) {
      Logger.warn('NativeBridge', 'Dropped bridge message with an invalid type');
      return;
    }

    if (
      type !== 'WEB_APP_READY' &&
      type !== 'WEB_DOCUMENT_READY' &&
      (!this.isWebAppReady ||
        !this.activeDocumentId ||
        payload?.documentId !== this.activeDocumentId)
    ) {
      Logger.warn('NativeBridge', 'Dropped bridge message from an unauthenticated document');
      return;
    }

    if (!this.nativeAuthorized && !LOCKED_ALLOWED_MESSAGE_TYPES.has(type)) {
      Logger.warn('NativeBridge', `Dropped ${type} while the native wallet lock is active`);
      return;
    }

    switch (type) {
      case 'SCAN_QR':
        this.handleScanQR();
        break;

      case 'COPY_TO_CLIPBOARD': {
        const text = payload?.text;
        if (typeof text !== 'string' || text.length === 0 || text.length > MAX_CLIPBOARD_CHARS) {
          Logger.warn('NativeBridge', 'COPY_TO_CLIPBOARD missing or invalid text');
          this.sendToWeb({
            type: 'ERROR',
            payload: { message: 'Invalid clipboard text' },
          });
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
        if (
          (title !== undefined && typeof title !== 'string') ||
          (text !== undefined && typeof text !== 'string') ||
          (url !== undefined && typeof url !== 'string') ||
          (typeof title === 'string' && title.length > MAX_SHARE_TITLE_CHARS) ||
          (typeof text === 'string' && text.length > MAX_SHARE_TEXT_CHARS) ||
          (typeof url === 'string' && url.length > 2048)
        ) {
          Logger.warn('NativeBridge', 'SHARE has invalid payload types');
          this.sendToWeb({
            type: 'ERROR',
            payload: { message: 'Invalid share payload' },
          });
          return;
        }
        await this.handleShare(title, text, url);
        break;
      }

      case 'TX_CONFIRMED': {
        const txHash = payload?.txHash;
        const txType = payload?.type;
        if (
          typeof txHash !== 'string' ||
          txHash.length === 0 ||
          txHash.length > 256 ||
          (txType !== 'incoming' && txType !== 'outgoing')
        ) {
          Logger.warn('NativeBridge', 'TX_CONFIRMED has invalid payload');
          return;
        }
        this.handleTxConfirmed(txHash, txType);
        break;
      }

      case 'LOG': {
        const logMessage = payload?.message;
        if (typeof logMessage === 'string' && logMessage.length <= MAX_LOG_CHARS) {
          Logger.debug('WebView', logMessage);
        }
        break;
      }

      case 'HAPTIC':
        if (payload?.style === undefined || typeof payload.style === 'string') {
          this.handleHaptic(payload?.style);
        }
        break;

      case 'OPEN_URL': {
        const url = payload?.url;
        if (typeof url !== 'string') {
          Logger.warn('NativeBridge', 'OPEN_URL missing or invalid url');
          this.sendToWeb({
            type: 'ERROR',
            payload: { message: 'Invalid URL' },
          });
          return;
        }
        await this.handleOpenUrl(url);
        break;
      }

      // Seed persistence messages
      case 'SEED_STORED': {
        const requestId = payload?.requestId;
        const address = payload?.address;
        const encryptedSeed = payload?.encryptedSeed;
        const blockchain = payload?.blockchain;
        const revision = payload?.revision;
        const ciphertextHash = payload?.ciphertextHash;
        if (this.walletClearInProgress) {
          if (typeof requestId === 'string') {
            this.sendSeedStoredResponse(
              requestId,
              false,
              typeof revision === 'number' ? revision : undefined,
              typeof ciphertextHash === 'string' ? ciphertextHash : undefined,
              'STORAGE_ERROR'
            );
          }
          return;
        }
        if (
          typeof requestId !== 'string' ||
          !REQUEST_ID_PATTERN.test(requestId) ||
          typeof address !== 'string' ||
          !Q40_ADDRESS_PATTERN.test(address) ||
          typeof encryptedSeed !== 'string' ||
          encryptedSeed.length === 0 ||
          encryptedSeed.length > 256 * 1024 ||
          typeof blockchain !== 'string' ||
          !['TEST_NET', 'MAIN_NET'].includes(blockchain) ||
          typeof revision !== 'number' ||
          !Number.isSafeInteger(revision) ||
          revision < 1 ||
          typeof ciphertextHash !== 'string' ||
          !/^[0-9a-f]{64}$/.test(ciphertextHash)
        ) {
          Logger.warn('NativeBridge', 'SEED_STORED missing or invalid required fields');
          if (typeof requestId === 'string') {
            this.sendSeedStoredResponse(requestId, false, undefined, undefined, 'INVALID_REQUEST');
          }
          return;
        }
        if (this.pendingSeedStoreRequestIds.has(requestId)) {
          Logger.warn('NativeBridge', 'Ignoring duplicate in-flight SEED_STORED request');
          return;
        }
        if (this.pendingSeedStoreRequestIds.size >= MAX_PENDING_SEED_WRITES) {
          this.sendSeedStoredResponse(requestId, false, revision, ciphertextHash, 'STORAGE_ERROR');
          return;
        }
        this.pendingSeedStoreRequestIds.add(requestId);
        try {
          await this.handleSeedStored(address, encryptedSeed, blockchain, revision, ciphertextHash);
          this.sendSeedStoredResponse(requestId, true, revision, ciphertextHash);
        } catch (error) {
          Logger.error('NativeBridge', 'Seed backup request failed:', error);
          this.sendSeedStoredResponse(requestId, false, revision, ciphertextHash, 'STORAGE_ERROR');
        } finally {
          this.pendingSeedStoreRequestIds.delete(requestId);
        }
        break;
      }

      case 'DEVICE_CREDENTIAL_REQUEST': {
        const requestId = payload?.requestId;
        const createIfMissing = payload?.createIfMissing;
        const candidate = payload?.candidate;
        if (this.walletClearInProgress) {
          if (typeof requestId === 'string') {
            this.sendDeviceCredentialResponse(requestId, undefined, 'STORAGE_ERROR');
          }
          return;
        }
        if (
          typeof requestId !== 'string' ||
          !REQUEST_ID_PATTERN.test(requestId) ||
          typeof createIfMissing !== 'boolean' ||
          (createIfMissing && (typeof candidate !== 'string' || !/^[0-9a-f]{64}$/.test(candidate)))
        ) {
          Logger.warn('NativeBridge', 'DEVICE_CREDENTIAL_REQUEST has an invalid payload');
          if (typeof requestId === 'string') {
            this.sendDeviceCredentialResponse(requestId, undefined, 'INVALID_REQUEST');
          }
          return;
        }

        try {
          const credential = createIfMissing
            ? await SeedStorageService.getOrCreateDeviceCredential(candidate as string)
            : await SeedStorageService.getDeviceCredential();
          if (!credential) {
            this.sendDeviceCredentialResponse(requestId, undefined, 'NOT_FOUND');
          } else {
            this.sendDeviceCredentialResponse(requestId, credential);
          }
        } catch (error) {
          Logger.error('NativeBridge', 'Device credential request failed:', error);
          this.sendDeviceCredentialResponse(requestId, undefined, 'STORAGE_ERROR');
        }
        break;
      }

      case 'CONTACTS_UPDATED': {
        // Durable backup of the web address book (plain public data:
        // names + addresses). Survives WebView data loss; deleted only by
        // the Remove All Wallets wipe.
        const contacts = payload?.contacts;
        if (this.walletClearInProgress) return;
        if (
          !Array.isArray(contacts) ||
          contacts.length > MAX_CONTACTS ||
          !contacts.every(isValidContact)
        ) {
          Logger.warn('NativeBridge', 'CONTACTS_UPDATED has an invalid contacts array');
          return;
        }
        const contactsJson = JSON.stringify(contacts);
        if (contactsJson.length > MAX_CONTACTS_JSON_CHARS) {
          Logger.warn('NativeBridge', 'CONTACTS_UPDATED exceeds the storage budget');
          return;
        }
        await WebViewService.saveContactsBackupStrict(contactsJson);
        break;
      }

      case 'REQUEST_BIOMETRIC_UNLOCK':
        await this.handleBiometricUnlockRequest();
        break;

      case 'WALLET_CLEARED': {
        const requestId = typeof payload?.requestId === 'string' ? payload.requestId : '';
        const pending = this.pendingWalletClearRequest;
        if (
          !pending ||
          !REQUEST_ID_PATTERN.test(requestId) ||
          requestId !== pending.requestId ||
          pending.documentGeneration !== this.documentGeneration
        ) {
          Logger.warn('NativeBridge', 'Ignoring stale or unsolicited wallet clear response');
          break;
        }
        const success = payload?.success === true;
        const error =
          typeof payload?.error === 'string' && payload.error.length <= 256
            ? payload.error
            : undefined;
        pending.finish(success, error);
        break;
      }

      case 'WEB_APP_READY': {
        const documentId = typeof payload?.documentId === 'string' ? payload.documentId : '';
        if (!REQUEST_ID_PATTERN.test(documentId)) {
          Logger.warn('NativeBridge', 'Ignoring WEB_APP_READY with an invalid document ID');
          break;
        }
        if (this.isWebAppReady && this.activeDocumentId === documentId) break;

        // The frontend retries readiness while native storage checks are slow.
        // Coalesce those retries so an in-flight exact echo is not invalidated.
        let challenge = this.pendingDocumentChallenges.get(documentId);
        if (!challenge || challenge.documentGeneration !== this.documentGeneration) {
          challenge = {
            documentId,
            challengeId: createRequestId(),
            documentGeneration: this.documentGeneration,
          };
          this.pendingDocumentChallenges.set(documentId, challenge);
        }
        while (this.pendingDocumentChallenges.size > 4) {
          const oldest = this.pendingDocumentChallenges.keys().next().value;
          if (typeof oldest !== 'string') break;
          this.pendingDocumentChallenges.delete(oldest);
        }
        if (
          !this.sendToWeb({
            type: 'WEB_DOCUMENT_CHALLENGE',
            payload: { documentId, challengeId: challenge.challengeId },
          })
        ) {
          if (this.pendingDocumentChallenges.get(documentId) === challenge) {
            this.pendingDocumentChallenges.delete(documentId);
          }
        }
        break;
      }

      case 'WEB_DOCUMENT_READY': {
        const documentId = typeof payload?.documentId === 'string' ? payload.documentId : '';
        const challengeId = typeof payload?.challengeId === 'string' ? payload.challengeId : '';
        const challenge = this.pendingDocumentChallenges.get(documentId);
        if (
          !challenge ||
          !REQUEST_ID_PATTERN.test(documentId) ||
          !REQUEST_ID_PATTERN.test(challengeId) ||
          challenge.documentId !== documentId ||
          challenge.challengeId !== challengeId ||
          challenge.documentGeneration !== this.documentGeneration
        ) {
          Logger.warn('NativeBridge', 'Ignoring stale or invalid web document challenge echo');
          break;
        }

        let pendingWipe;
        try {
          pendingWipe = await SeedStorageService.getPendingWalletWipe();
        } catch (error) {
          Logger.error('NativeBridge', 'Cannot read wallet wipe journal:', error);
          return;
        }

        // Storage access above yields. A reset, eviction, or failed challenge
        // resend may have invalidated this echo while it was pending.
        if (this.pendingDocumentChallenges.get(documentId) !== challenge) {
          Logger.warn('NativeBridge', 'Ignoring superseded web document challenge echo');
          return;
        }

        this.pendingDocumentChallenges.clear();
        this.activeDocumentId = documentId;
        if (pendingWipe) this.beginWalletClear();

        // Resolve ready waiters only after the exact document challenge echo.
        Logger.debug('NativeBridge', 'Web document challenge completed');
        this.isWebAppReady = true;
        this.flushWebAppReadyResolvers('resolve');

        if (pendingWipe) {
          try {
            await this.clearWalletDurably();
          } catch (error) {
            Logger.error('NativeBridge', 'Pending wallet wipe remains incomplete:', error);
          }
          return;
        }

        await this.synchronizeAuthorizedDocument();
        break;
      }

      case 'OPEN_NATIVE_SETTINGS':
        Logger.debug('NativeBridge', 'Opening native settings');
        if (this.openNativeSettingsCallback) {
          this.openNativeSettingsCallback();
        }
        break;

      case 'PIN_VERIFIED': {
        const requestId = typeof payload?.requestId === 'string' ? payload.requestId : '';
        const pending = this.pendingPinVerification;
        if (
          !pending ||
          !REQUEST_ID_PATTERN.test(requestId) ||
          requestId !== pending.requestId ||
          !this.isSecurityContextCurrent(pending.context)
        ) {
          Logger.warn('NativeBridge', 'Ignoring stale or unsolicited PIN verification response');
          break;
        }
        const success = payload?.success === true;
        const error =
          typeof payload?.error === 'string' && payload.error.length <= 256
            ? payload.error
            : undefined;
        Logger.debug('NativeBridge', `PIN verification result: ${success ? 'success' : 'failed'}`);
        pending.finish(success, error);
        break;
      }

      case 'PIN_CHANGED': {
        const requestId = typeof payload?.requestId === 'string' ? payload.requestId : undefined;
        const pendingRequest = this.pendingPinChangeRequest;
        const callback = this.pinChangedCallback;
        if (
          this.walletClearInProgress ||
          !requestId ||
          !pendingRequest ||
          !callback ||
          requestId !== pendingRequest.requestId
        ) {
          Logger.warn('NativeBridge', 'Ignoring stale or unsolicited PIN change response');
          break;
        }

        let success = payload?.success === true;
        const newPin = typeof payload?.newPin === 'string' ? payload.newPin : undefined;
        let error = typeof payload?.error === 'string' ? payload.error : undefined;
        const expectedPin = pendingRequest.expectedPin;
        if (success) {
          if (newPin !== expectedPin) {
            success = false;
            error = 'PIN change response did not match the pending request';
          } else {
            try {
              // The web reports success only after every cross-network
              // ciphertext backup is acknowledged. Commit the one global PIN
              // before resolving the native caller, closing the prior gap in
              // which the UI reported success while SecureStore was still old.
              await this.enqueuePinCommit(expectedPin);
            } catch (storageError) {
              Logger.error('NativeBridge', 'Failed to commit changed PIN:', storageError);
              success = false;
              error = NATIVE_PIN_COMMIT_ERROR;
            }
          }
        }

        // A timeout may have installed a compensating request while the
        // SecureStore write above was still pending. Never resolve or clear
        // that newer request with this late response.
        if (
          this.pendingPinChangeRequest?.requestId !== requestId ||
          this.pinChangedCallback !== callback
        ) {
          Logger.warn('NativeBridge', 'Ignoring PIN change result superseded by compensation');
          break;
        }

        Logger.debug('NativeBridge', `PIN change result: ${success ? 'success' : 'failed'}`);
        callback(success, expectedPin, error);
        break;
      }

      // DApp Connect messages
      case 'DAPP_SHOW_WEBVIEW':
        Logger.debug('NativeBridge', 'dApp requesting WebView focus');
        if (this.dappShowWebViewCallback) {
          this.dappShowWebViewCallback();
        }
        break;

      case 'DAPP_CONNECTED': {
        if (this.walletClearInProgress) break;
        const name = typeof payload?.name === 'string' ? payload.name : 'Unknown dApp';
        const channelId = typeof payload?.channelId === 'string' ? payload.channelId : '';
        const url = typeof payload?.url === 'string' ? payload.url : '';
        const safeDAppUrl = parseDAppMetadataUrl(url);
        const connectedAccount =
          typeof payload?.connectedAccount === 'string' ? payload.connectedAccount : '';
        if (
          !Q40_ADDRESS_PATTERN.test(connectedAccount) ||
          !CHANNEL_ID_PATTERN.test(channelId) ||
          name.length === 0 ||
          name.length > MAX_DAPP_NAME_CHARS ||
          url.length > MAX_DAPP_URL_CHARS ||
          safeDAppUrl === null
        ) {
          Logger.warn('NativeBridge', 'DAPP_CONNECTED has an invalid payload');
          return;
        }
        Logger.debug('NativeBridge', `dApp connected: ${name} (${channelId})`);
        if (channelId) {
          await this.enqueueDAppStoreWrite(async () => {
            await DAppConnectionStore.onConnected({
              channelId,
              name,
              url: safeDAppUrl,
              connectedAccount,
              connectedAt: Date.now(),
            });
          });
        }
        break;
      }

      case 'DAPP_DISCONNECTED': {
        const disconnectChannelId = typeof payload?.channelId === 'string' ? payload.channelId : '';
        const explicit = payload?.explicit === true;
        if (!CHANNEL_ID_PATTERN.test(disconnectChannelId)) {
          Logger.warn('NativeBridge', 'DAPP_DISCONNECTED has an invalid channel ID');
          return;
        }
        if (
          [...this.pendingDAppDisconnects.values()].some(
            (pending) => pending.channelId === disconnectChannelId,
          )
        ) {
          Logger.debug('NativeBridge', 'Deferring uncorrelated disconnect during explicit request');
          return;
        }
        Logger.debug(
          'NativeBridge',
          `dApp disconnected: ${disconnectChannelId} (explicit: ${explicit})`
        );
        if (disconnectChannelId) {
          await this.enqueueDAppStoreWrite(async () => {
            await DAppConnectionStore.onDisconnected(disconnectChannelId, explicit);
          });
        }
        break;
      }

      case 'DAPP_DISCONNECT_RESPONSE': {
        const requestId = typeof payload?.requestId === 'string' ? payload.requestId : '';
        const channelId = typeof payload?.channelId === 'string' ? payload.channelId : '';
        const pending = this.pendingDAppDisconnects.get(requestId);
        if (
          !pending ||
          !REQUEST_ID_PATTERN.test(requestId) ||
          channelId !== pending.channelId ||
          pending.documentGeneration !== this.documentGeneration
        ) {
          Logger.warn('NativeBridge', 'Ignoring stale or unsolicited dApp disconnect response');
          break;
        }
        let success = payload?.success === true;
        let error =
          typeof payload?.error === 'string' && payload.error.length <= 256
            ? payload.error
            : undefined;
        if (success) {
          try {
            await this.enqueueDAppStoreWrite(() =>
              DAppConnectionStore.onDisconnected(channelId, true),
            );
          } catch {
            success = false;
            error = 'Native disconnect state could not be persisted';
          }
        }
        pending.finish(success, error);
        break;
      }

      case 'DAPP_HAPTIC':
        if (payload?.style === undefined || typeof payload.style === 'string') {
          this.handleHaptic(payload?.style);
        }
        break;

      case 'DAPP_RETURN': {
        // Peer redirect: after the wallet resolves a restricted request, bounce
        // the user back to the originating dApp so a same-device deep-link flow
        // does not strand them in the wallet. The user just tapped Approve, so
        // this is a user-initiated navigation.
        const redirectUrl = typeof payload?.redirectUrl === 'string' ? payload.redirectUrl : '';
        // The redirect URL is attacker controlled. Keep the same credential-free
        // HTTP(S) boundary as OPEN_URL and never log the raw bearer/query data.
        const safeRedirectUrl = parseExternalHttpUrl(redirectUrl);
        if (safeRedirectUrl !== null) {
          Logger.debug('NativeBridge', 'Opening validated dApp return URL');
          try {
            await Linking.openURL(safeRedirectUrl);
          } catch {
            Logger.warn('NativeBridge', 'Failed to open validated return URL');
          }
        } else {
          Logger.warn('NativeBridge', 'Ignoring unsafe dApp return URL');
        }
        break;
      }

      default:
        Logger.warn('NativeBridge', `Unknown message type: ${type}`);
    }
  }

  private enqueueDAppStoreWrite(writeFn: () => Promise<void>): Promise<void> {
    const operation = this.dappStoreWriteQueue.catch(() => undefined).then(writeFn);
    this.dappStoreWriteQueue = operation.catch((err) => {
      Logger.error('NativeBridge', 'Failed to persist dApp connection state:', err);
    });
    return operation;
  }

  /**
   * Handle QR scan request - trigger the registered callback
   */
  private handleScanQR() {
    if (this.qrScanCallback) {
      this.qrScanCallback();
    } else {
      Logger.warn('NativeBridge', 'QR scan requested but no callback registered');
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
      Logger.error('NativeBridge', 'Clipboard error:', error);
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
          activityType: result.activityType,
        },
      });
    } catch (error) {
      Logger.error('NativeBridge', 'Share error:', error);
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
    Logger.debug('NativeBridge', `Transaction ${txType}: ${txHash}`);
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
        if (style === undefined) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
    }
  }

  /**
   * Handle open URL request - opens in device's default browser
   */
  private async handleOpenUrl(url: string) {
    const safeUrl = parseExternalHttpUrl(url);
    if (safeUrl === null) {
      Logger.warn('NativeBridge', 'Rejected unsafe external URL');
      this.sendToWeb({
        type: 'ERROR',
        payload: { message: 'Invalid URL' },
      });
      return;
    }
    try {
      const canOpen = await Linking.canOpenURL(safeUrl);
      if (canOpen) {
        await Linking.openURL(safeUrl);
      } else {
        Logger.warn('NativeBridge', 'Cannot open validated external URL');
        this.sendToWeb({
          type: 'ERROR',
          payload: { message: 'Cannot open this URL' },
        });
      }
    } catch {
      Logger.error('NativeBridge', 'Failed to open validated external URL');
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
    if (address.length === 0 || address.length > 4096) return;
    this.sendToWeb({
      type: 'QR_RESULT',
      payload: { address },
    });
  }

  /**
   * Send QR scan cancelled notification to WebView
   * Called when user closes scanner without scanning
   */
  sendQRCancelled() {
    this.sendToWeb({
      type: 'QR_CANCELLED',
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
    blockchain: string,
    revision: number,
    ciphertextHash: string
  ) {
    Logger.debug('NativeBridge', `Backing up seed for ${address}`);

    // Backup the encrypted seed to AsyncStorage
    await SeedStorageService.backupSeed(
      address,
      encryptedSeed,
      blockchain,
      revision,
      ciphertextHash
    );

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
      const context = this.captureSecurityContext();
      await this.biometricUnlockCallback(context);
    } else {
      Logger.warn('NativeBridge', 'Biometric unlock requested but no callback registered');
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
  private sendUnlockWithPin(pin: string): boolean {
    return this.sendToWeb({
      type: 'UNLOCK_WITH_PIN',
      payload: { pin },
    }) ?? false;
  }

  /** Inject a PIN only for the still-current wallet, document, and auth attempt. */
  sendUnlockWithPinForContext(pin: string, context: NativeSecurityContext): boolean {
    if (
      !PIN_PATTERN.test(pin) ||
      !this.isWebAppReady ||
      !this.isSecurityContextCurrent(context)
    ) {
      return false;
    }
    return this.sendUnlockWithPin(pin);
  }

  /**
   * Inject a PIN only when the current WebView has completed its ready
   * handshake. Callers retain it temporarily when a cold load is still pending.
   */
  sendUnlockWithPinIfReady(pin: string, context: NativeSecurityContext): boolean {
    return this.sendUnlockWithPinForContext(pin, context);
  }

  /**
   * Send backed up seed to web for restoration
   */
  sendRestoreSeed(
    address: string,
    encryptedSeed: string,
    blockchain: string,
    revision: number,
    ciphertextHash?: string
  ) {
    this.sendToWeb({
      type: 'RESTORE_SEED',
      payload: {
        address,
        encryptedSeed,
        blockchain,
        revision,
        ...(ciphertextHash ? { ciphertextHash } : {}),
      },
    });
  }

  private sendSeedStoredResponse(
    requestId: string,
    success: boolean,
    revision?: number,
    ciphertextHash?: string,
    error?: 'INVALID_REQUEST' | 'STORAGE_ERROR'
  ) {
    this.sendToWeb({
      type: 'SEED_STORED_RESPONSE',
      payload: {
        requestId,
        success,
        ...(revision !== undefined ? { revision } : {}),
        ...(ciphertextHash ? { ciphertextHash } : {}),
        ...(error ? { error } : {}),
      },
    });
  }

  private sendDeviceCredentialResponse(
    requestId: string,
    credential?: string,
    error?: 'INVALID_REQUEST' | 'NOT_FOUND' | 'STORAGE_ERROR'
  ) {
    this.sendToWeb({
      type: 'DEVICE_CREDENTIAL_RESPONSE',
      payload: {
        requestId,
        ...(credential ? { credential } : {}),
        ...(error ? { error } : {}),
      },
    });
  }

  /** Request correlation only; this identifier is not an authentication secret. */
  private nextPinChangeRequestId(): string {
    this.pinChangeSequence += 1;
    if (!Number.isSafeInteger(this.pinChangeSequence)) this.pinChangeSequence = 1;
    const timestamp = Date.now().toString(16).padStart(12, '0').slice(-12);
    const sequence = this.pinChangeSequence.toString(16).padStart(20, '0').slice(-20);
    return `${timestamp}${sequence}`;
  }

  /** Ensure a timed-out old commit cannot finish after its compensating commit. */
  private enqueuePinCommit(pin: string): Promise<void> {
    const operation = this.pinCommitQueue
      .catch(() => undefined)
      .then(() => SeedStorageService.storePinSecurely(pin));
    this.pinCommitQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  /**
   * Ask the web wallet to navigate to an in-app route (e.g. /address-book)
   */
  sendNavigate(path: string) {
    this.sendToWeb({
      type: 'NAVIGATE',
      payload: { path },
    });
  }

  /**
   * Request web to clear all wallet data (from native settings)
   */
  private requestWebWalletClear(
    requestId: string,
    timeoutMs: number,
  ): Promise<{ success: boolean; error?: string }> {
    if (this.pendingWalletClearRequest) {
      return Promise.resolve({ success: false, error: 'A wallet clear request is already pending' });
    }
    const documentGeneration = this.documentGeneration;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (success: boolean, error?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (this.pendingWalletClearRequest?.requestId === requestId) {
          this.pendingWalletClearRequest = null;
        }
        resolve({ success, error });
      };
      const timeout = setTimeout(
        () => finish(false, 'Wallet clear confirmation timed out'),
        timeoutMs,
      );
      this.pendingWalletClearRequest = {
        requestId,
        documentGeneration,
        finish,
      };
      if (
        !this.sendToWeb({
          type: 'CLEAR_WALLET',
          payload: { requestId },
        })
      ) {
        finish(false, 'Web app is unavailable');
      }
    });
  }

  /**
   * Converge native storage, hosted wallet storage, and dApp history under a
   * durable request marker. Any failure leaves the marker for a later retry.
   */
  async clearWalletDurably(timeoutMs: number = 15000): Promise<void> {
    if (this.walletClearPromise) return this.walletClearPromise;

    const operation = (async () => {
      const existing = await SeedStorageService.getPendingWalletWipe();
      this.beginWalletClear();

      let pending;
      try {
        pending = existing ?? (await SeedStorageService.beginWalletWipe(createRequestId()));
      } catch (error) {
        if (!existing) this.endWalletClear();
        throw error;
      }

      await SeedStorageService.clearWallet();
      await WebViewService.clearContactsBackupStrict();
      await this.waitForWebAppReady(timeoutMs);

      const webResult = await this.requestWebWalletClear(pending.requestId, timeoutMs);
      if (!webResult.success) {
        throw new Error(webResult.error || 'Hosted wallet clear failed');
      }

      await DAppConnectionStore.clear();
      await SeedStorageService.completeWalletWipe(pending.requestId);
      this.endWalletClear();
      if (this.walletClearedCallback) this.walletClearedCallback();
    })();

    const inFlight = operation.finally(() => {
      if (this.walletClearPromise === inFlight) this.walletClearPromise = null;
    });
    this.walletClearPromise = inFlight;
    return inFlight;
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
   * Waits for web app to be ready before sending the request
   * @param pin The PIN to verify
   * @param timeoutMs Timeout in milliseconds for verification (default 10 seconds)
   * @returns Promise that resolves with verification result
   */
  async verifyPin(
    pin: string,
    timeoutMs: number = 10000
  ): Promise<{ success: boolean; error?: string }> {
    if (!PIN_PATTERN.test(pin)) {
      return { success: false, error: 'PIN must contain 4 to 6 digits' };
    }
    if (this.walletClearInProgress) {
      return { success: false, error: 'Wallet clear is in progress' };
    }
    if (this.pinVerificationPending) {
      return {
        success: false,
        error: 'A PIN verification is already in progress',
      };
    }
    this.pinVerificationPending = true;
    const context = this.captureSecurityContext();

    // Wait for web app to be ready first (with its own timeout)
    try {
      Logger.debug('NativeBridge', 'Waiting for web app to be ready before PIN verification...');
      await this.waitForWebAppReady();
      if (!this.isSecurityContextCurrent(context)) {
        return { success: false, error: 'App authorization changed. Please try again.' };
      }
      Logger.debug('NativeBridge', 'Web app is ready, proceeding with PIN verification');
    } catch (error) {
      Logger.error('NativeBridge', 'Web app not ready for PIN verification:', error);
      return { success: false, error: 'Web app not ready. Please try again.' };
    } finally {
      if (!this.isWebAppReady || !this.isSecurityContextCurrent(context)) {
        this.pinVerificationPending = false;
      }
    }

    const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
      const requestId = createRequestId();
      let settled = false;
      const finish = (success: boolean, error?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (this.pendingPinVerification?.requestId === requestId) {
          this.pendingPinVerification = null;
        }
        resolve({ success, error });
      };
      // Set up timeout
      const timeout = setTimeout(() => {
        finish(false, 'PIN verification timed out');
      }, timeoutMs);

      // Set up callback for response
      this.pendingPinVerification = { requestId, context, finish };

      // Send verification request to web
      if (!this.sendToWeb({ type: 'VERIFY_PIN', payload: { requestId, pin } })) {
        finish(false, 'Web app is unavailable');
      }
    });
    this.pinVerificationPending = false;
    return result;
  }

  /**
   * Request web to change PIN (re-encrypt all seeds)
   * Waits for web app to be ready before sending the request
   * @param oldPin The current PIN to verify
   * @param newPin The new PIN to encrypt seeds with
   * @param options Timeout and compensation behavior
   * @returns Promise that resolves with change result
   */
  async changePin(
    oldPin: string,
    newPin: string,
    options: number | NativePinChangeOptions = {}
  ): Promise<{ success: boolean; error?: string }> {
    const timeoutMs = typeof options === 'number' ? options : (options.timeoutMs ?? 120000);
    const acceptAlreadyTarget =
      typeof options === 'number' ? false : (options.acceptAlreadyTarget ?? false);
    if (this.walletClearInProgress) {
      return { success: false, error: 'Wallet clear is in progress' };
    }
    const walletGeneration = this.walletMutationGeneration;
    // Reserve the operation before the readiness await so two callers cannot
    // both pass the callback check and overwrite each other's expected PIN.
    if (this.pinChangePending) {
      return { success: false, error: 'A PIN change is already in progress' };
    }
    this.pinChangePending = true;

    // Wait for web app to be ready first (with its own timeout)
    try {
      Logger.debug('NativeBridge', 'Waiting for web app to be ready before PIN change...');
      await this.waitForWebAppReady();
      if (this.walletClearInProgress || walletGeneration !== this.walletMutationGeneration) {
        this.pinChangePending = false;
        return { success: false, error: 'Wallet clear is in progress' };
      }
      Logger.debug('NativeBridge', 'Web app is ready, proceeding with PIN change');
    } catch (error) {
      this.pinChangePending = false;
      Logger.error('NativeBridge', 'Web app not ready for PIN change:', error);
      return { success: false, error: 'Web app not ready. Please try again.' };
    }

    return new Promise((resolve) => {
      const requestId = this.nextPinChangeRequestId();

      const finish = (success: boolean, error?: string) => {
        if (this.pendingPinChangeRequest?.requestId !== requestId) return;
        clearTimeout(timeout);
        this.pinChangedCallback = null;
        this.pinChangePending = false;
        this.pendingPinChangeRequest = null;
        resolve({ success, error });
      };

      // Set up timeout
      const timeout = setTimeout(() => {
        finish(false, NATIVE_PIN_CHANGE_AMBIGUOUS_ERROR);
      }, timeoutMs);

      // Set up callback for response
      this.pinChangedCallback = (success: boolean, _newPin?: string, error?: string) => {
        finish(success, error);
      };
      this.pendingPinChangeRequest = { requestId, expectedPin: newPin };

      // Send change request to web
      this.sendToWeb({
        type: 'CHANGE_PIN',
        payload: { requestId, oldPin, newPin, acceptAlreadyTarget },
      });
    });
  }
}

export default new NativeBridge();
