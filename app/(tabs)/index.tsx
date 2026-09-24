import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  BackHandler,
  InteractionManager,
  Linking,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View as RNView,
} from 'react-native';
import QRLWebView, { QRLWebViewRef } from '../../components/QRLWebView';
import PinEntryModal from '../../components/PinEntryModal';
import QRScannerModal from '../../components/QRScannerModal';
import QuantumLoadingScreen from '../../components/QuantumLoadingScreen';
import WebViewService from '../../services/WebViewService';
import BiometricService from '../../services/BiometricService';
import SeedStorageService from '../../services/SeedStorageService';
import NativeBridge, { NativeSecurityContext, type NativeQrScanRequest } from '../../services/NativeBridge';
import Logger from '../../services/Logger';
import { createBackgroundLock } from '../../services/BackgroundLock';
import { waitForForegroundAuthorization } from '../../services/ForegroundAuthorization';
import { useIsFocused, useFocusEffect } from '@react-navigation/native';
import { router, usePathname } from 'expo-router';

// Time threshold for showing loading screen (5 minutes in ms)
const LOADING_SCREEN_THRESHOLD_MS = 5 * 60 * 1000;

interface PendingUnlockPin {
  pin: string;
  context: NativeSecurityContext;
}

export default function WalletScreen() {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinModalTitle, setPinModalTitle] = useState('Enter Your PIN');
  const [pinModalMessage, setPinModalMessage] = useState('Enter your wallet PIN');
  const [pendingPinAction, setPendingPinAction] = useState<((pin: string) => Promise<void>) | null>(null);
  const [qrScanRequest, setQrScanRequest] = useState<NativeQrScanRequest | null>(null);
  const [skipLoadingScreen, setSkipLoadingScreen] = useState(false);
  const [processingMessage, setProcessingMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isDeviceAuthenticating, setIsDeviceAuthenticating] = useState(false);
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);
  const [authCheckNonce, setAuthCheckNonce] = useState(0);
  const isFocused = useIsFocused();
  const pathname = usePathname();
  const appState = useRef(AppState.currentState);
  const webViewRef = useRef<QRLWebViewRef>(null);
  const pendingUnlockPin = useRef<PendingUnlockPin | null>(null);
  const hasRestoredSeeds = useRef<boolean>(false);
  const deviceLoginSetupTriggered = useRef<boolean>(false);
  const needsReauth = useRef(AppState.currentState !== 'active');
  const manualRetryRequired = useRef(false);
  const pinVerificationGeneration = useRef<number | null>(null);
  const activeQrScan = useRef<NativeQrScanRequest | null>(null);
  // Track when biometric auth is showing - iOS marks app as 'inactive' during biometric prompt
  const isAuthenticating = useRef(false);
  // Track when app went to background for loading screen threshold
  const backgroundedAt = useRef<number | null>(null);
  // Track if PIN change is in progress
  const pinChangeTriggered = useRef(false);
  // Show the "biometric is off for this app" hint at most once per app session
  const biometricOffNudgeShown = useRef(false);
  const initialDocumentStarted = useRef(false);
  const authAttemptGeneration = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Navigate to settings
  const navigateToSettings = useCallback(() => {
    Logger.debug('WalletScreen', 'Navigating to settings');
    router.push('/settings');
  }, []);

  // Hint shown only when a biometric IS enrolled on the device but turned OFF
  // for this app (the per-app Face ID / Touch ID toggle in Settings is off, from
  // a sticky "Don't Allow"). BiometricService classifies this precisely via a
  // biometrics-only probe, so not-enrolled and lockout never reach here. Without
  // the nudge, iOS silently presents the device-passcode sheet and the user
  // concludes Face ID is broken. Shown at most once per session.
  const showBiometricOffNudge = useCallback((biometricType?: 'face' | 'fingerprint' | 'iris' | null) => {
    if (biometricOffNudgeShown.current) return;
    biometricOffNudgeShown.current = true;
    const isIOS = Platform.OS === 'ios';
    const label =
      biometricType === 'fingerprint'
        ? (isIOS ? 'Touch ID' : 'fingerprint unlock')
        : biometricType === 'iris'
        ? 'iris unlock'
        : biometricType === 'face'
        ? (isIOS ? 'Face ID' : 'face unlock')
        : 'biometric unlock';
    InteractionManager.runAfterInteractions(() => {
      Alert.alert(
        `${label} is turned off for MyQRLWallet`,
        `Turn ${label} back on for MyQRLWallet in Settings to unlock with it. You can still unlock by entering your wallet PIN.`,
        [
          { text: 'Open Settings', onPress: () => { Linking.openSettings().catch(() => {}); } },
          { text: 'Not Now', style: 'cancel' },
        ]
      );
    });
  }, []);

  const resumePendingReauth = useCallback(() => {
    if (
      !needsReauth.current ||
      !initialDocumentStarted.current ||
      manualRetryRequired.current ||
      isAuthenticating.current ||
      AppState.currentState !== 'active'
    ) {
      return;
    }

    needsReauth.current = false;
    const timeSinceBackground = backgroundedAt.current
      ? Date.now() - backgroundedAt.current
      : Infinity;
    setSkipLoadingScreen(timeSinceBackground < LOADING_SCREEN_THRESHOLD_MS);
    setIsAuthorized(false);
    setAuthCheckNonce((value) => value + 1);
  }, []);

  // Handle device login unlock and send PIN to web
  const performDeviceLoginUnlock = useCallback(async (context: NativeSecurityContext) => {
    if (isAuthenticating.current) return;
    const attemptGeneration = authAttemptGeneration.current;
    const isAttemptBound = () => mounted.current &&
      attemptGeneration === authAttemptGeneration.current &&
      NativeBridge.isSecurityContextCurrent(context);
    Logger.debug('WalletScreen', 'Device Login unlock requested');
    isAuthenticating.current = true;
    setIsDeviceAuthenticating(true);
    try {
      const result = await BiometricService.getPinWithBiometric(isAttemptBound);
      if (!(await waitForForegroundAuthorization(isAttemptBound))) return;
      if (
        result.success &&
        result.pin &&
        NativeBridge.sendUnlockWithPinForContext(result.pin, context)
      ) {
        Logger.debug('WalletScreen', 'Device Login succeeded');
      } else {
        Logger.debug('WalletScreen', 'Device Login failed, cancelled, or became stale');
        if (result.biometricOffForApp) {
          showBiometricOffNudge(result.biometricType);
        }
      }
    } finally {
      isAuthenticating.current = false;
      if (mounted.current) setIsDeviceAuthenticating(false);
      resumePendingReauth();
    }
  }, [resumePendingReauth, showBiometricOffNudge]);

  // Handle PIN modal submission
  const handlePinSubmit = useCallback(async (pin: string) => {
    setPinModalVisible(false);
    if (pendingPinAction) {
      setPendingPinAction(null);
      await pendingPinAction(pin);
    }
  }, [pendingPinAction]);

  // Handle PIN modal cancel
  const handlePinCancel = useCallback(() => {
    setPinModalVisible(false);
    setPendingPinAction(null);
  }, []);

  // Show PIN modal with a callback
  const showPinModal = useCallback((
    action: (pin: string) => Promise<void>,
    title = 'Enter Your PIN',
    message = 'Enter your wallet PIN to enable Device Login',
  ) => {
    setPinModalTitle(title);
    setPinModalMessage(message);
    setPendingPinAction(() => action);
    setPinModalVisible(true);
  }, []);

  // Handle seed stored event - Device Login prompt shown on next launch
  const handleSeedStored = useCallback(async (_address: string) => {
    // Device Login setup prompt is shown on app reopen, not immediately during import
  }, []);

  // Prompt user to enable Device Login
  const promptDeviceLoginSetup = useCallback(() => {
    Alert.alert(
      'Enable Device Login?',
      'Would you like to use Device Login to unlock your wallet? You won\'t need to enter your PIN each time.',
      [
        {
          text: 'Not Now',
          style: 'cancel',
          onPress: async () => {
            // Mark prompt as shown so we don't ask again
            await SeedStorageService.setBiometricPromptShown(true);
          },
        },
        {
          text: 'Enable',
          onPress: () => {
            // Show secure PIN modal
            showPinModal(async (pin: string) => {
              const setupResult = await BiometricService.setupDeviceLogin(pin);
              if (setupResult.success) {
                await SeedStorageService.setBiometricPromptShown(true);
                Alert.alert('Success', 'Device Login enabled!');
              } else {
                Alert.alert('Error', setupResult.error || 'Failed to enable Device Login');
              }
            });
          },
        },
      ]
    );
  }, [showPinModal]);

  const closeQrScanner = useCallback(() => {
    activeQrScan.current = null;
    setQrScanRequest(null);
  }, []);

  // Handle QR scan request from web
  const handleQRScanRequest = useCallback((request: NativeQrScanRequest) => {
    Logger.debug('WalletScreen', 'QR scan requested from web');
    activeQrScan.current = request;
    setQrScanRequest(request);
  }, []);

  // Handle QR scan result
  const handleQRScanResult = useCallback((data: string, request: NativeQrScanRequest | null) => {
    if (!request || activeQrScan.current !== request) return;
    if (data.length === 0 || data.length > 4096) {
      Logger.warn('WalletScreen', 'QR scan result exceeded the bridge budget');
      return;
    }
    Logger.debug('WalletScreen', `QR scan completed (${data.length} characters, payload redacted)`);
    // Send the scanned data to the WebView
    NativeBridge.sendQRResult(data, request);
    closeQrScanner();
  }, [closeQrScanner]);

  // Close QR scanner
  const handleQRScannerClose = useCallback((request: NativeQrScanRequest | null) => {
    if (!request || activeQrScan.current !== request) return;
    NativeBridge.sendQRCancelled(request);
    closeQrScanner();
  }, [closeQrScanner]);

  useEffect(() => {
    const unsubscribe = NativeBridge.onAuthorizationInvalidated(closeQrScanner);
    return () => {
      unsubscribe();
      if (activeQrScan.current) NativeBridge.sendQRCancelled(activeQrScan.current);
      activeQrScan.current = null;
    };
  }, [closeQrScanner]);

  // Handle DAPP_SHOW_WEBVIEW - switch to WebView tab when dApp needs approval
  const handleDAppShowWebView = useCallback(() => {
    Logger.debug('WalletScreen', 'dApp requesting WebView focus');
    // Only navigate if we're actually on a different tab. Calling replace('/')
    // while already on '/' re-mounts the WebView, which reloads the wallet
    // page and orphans any live socket.io connection. The fresh page then
    // hits a reconnect storm behind CF's cold polling path.
    if (pathname !== '/') {
      router.replace('/');
    }
  }, [pathname]);

  const handleWalletClearStarted = useCallback(() => {
    manualRetryRequired.current = true;
    needsReauth.current = false;
    pinVerificationGeneration.current = null;
    setIsVerifyingPin(false);
    authAttemptGeneration.current += 1;
    BiometricService.clearPendingSecurityOperations();
    pendingUnlockPin.current = null;
    hasRestoredSeeds.current = false;
    deviceLoginSetupTriggered.current = false;
    pinChangeTriggered.current = false;
    setPinModalVisible(false);
    setPendingPinAction(null);
    setProcessingMessage(null);
    setIsUnlocking(false);
    setIsAuthorized(false);
    setAuthError('Finishing wallet removal...');
    closeQrScanner();
  }, [closeQrScanner]);

  const handleWalletCleared = useCallback(() => {
    if (!mounted.current) return;
    authAttemptGeneration.current += 1;
    manualRetryRequired.current = false;
    needsReauth.current = true;
    pendingUnlockPin.current = null;
    setAuthError(null);
    // NativeBridge emits completion only after native and hosted storage agree.
    // A fresh state check can then open the empty wallet for a new import.
    resumePendingReauth();
  }, [resumePendingReauth]);

  // Register bridge callbacks
  useEffect(() => {
    NativeBridge.onBiometricUnlockRequest(performDeviceLoginUnlock);
    NativeBridge.onSeedStored(handleSeedStored);
    NativeBridge.onOpenNativeSettings(navigateToSettings);
    NativeBridge.onQRScanRequest(handleQRScanRequest);
    NativeBridge.onDAppShowWebView(handleDAppShowWebView);
    NativeBridge.onWalletClearStarted(handleWalletClearStarted);
    NativeBridge.onWalletCleared(handleWalletCleared);
  }, [
    performDeviceLoginUnlock,
    handleSeedStored,
    handleQRScanRequest,
    navigateToSettings,
    handleDAppShowWebView,
    handleWalletClearStarted,
    handleWalletCleared,
  ]);

  // Check wallet state and authenticate. Every error leaves an existing wallet
  // behind the native lock so transient storage failures cannot bypass it.
  useEffect(() => {
    if (
      !isFocused ||
      !initialDocumentStarted.current ||
      isAuthorized ||
      manualRetryRequired.current ||
      isAuthenticating.current ||
      AppState.currentState !== 'active'
    ) {
      return;
    }

    let cancelled = false;
    const attemptGeneration = ++authAttemptGeneration.current;
    const isAttemptBound = () =>
      mounted.current &&
      !cancelled &&
      attemptGeneration === authAttemptGeneration.current;
    const isAttemptCurrent = () => {
      if (!isAttemptBound()) return false;
      if (AppState.currentState !== 'active') {
        // A short inactive interval can finish a storage read before the
        // background lock runs. Resume this preflight when active returns.
        needsReauth.current = true;
        return false;
      }
      return true;
    };

    const authCheck = async () => {
      setIsUnlocking(true);
      setAuthError(null);
      try {
        const pendingWipe = await SeedStorageService.getPendingWalletWipe();
        if (pendingWipe) {
          BiometricService.clearPendingSecurityOperations();
          setAuthError('Finishing wallet removal...');
          await NativeBridge.clearWalletDurably();
          if (isAttemptCurrent()) {
            setAuthError(null);
            setIsAuthorized(true);
          }
          return;
        }

        const hasWallet = await SeedStorageService.hasWallet();
        if (!isAttemptCurrent()) return;
        if (!hasWallet) {
          setIsAuthorized(true);
          return;
        }

        const deviceLoginEnabled = await SeedStorageService.isBiometricEnabled();
        if (!isAttemptCurrent()) return;
        if (deviceLoginEnabled) {
          const context = NativeBridge.captureSecurityContext();
          isAuthenticating.current = true;
          setIsDeviceAuthenticating(true);
          let result;
          try {
            const isContextCurrent = () =>
              isAttemptBound() && NativeBridge.isSecurityContextCurrent(context);
            result = await BiometricService.getPinWithBiometric(isContextCurrent);
            // Successful login waits for foreground inside the service before
            // it reads the PIN. Keep a final delivery fence for all callers.
            if (result.success && !(await waitForForegroundAuthorization(isContextCurrent))) {
              if (isAttemptBound()) {
                manualRetryRequired.current = true;
                needsReauth.current = false;
                setAuthError('Device Login was interrupted. Try again or use your wallet PIN.');
              }
              return;
            }
          } finally {
            isAuthenticating.current = false;
            if (mounted.current) setIsDeviceAuthenticating(false);
            resumePendingReauth();
          }
          if (!isAttemptBound() || !NativeBridge.isSecurityContextCurrent(context)) return;

          if (result.success && result.pin && isAttemptCurrent()) {
            const pending = { pin: result.pin, context };
            if (!NativeBridge.sendUnlockWithPinIfReady(result.pin, context)) {
              pendingUnlockPin.current = pending;
            }
            setIsAuthorized(true);
            return;
          }

          manualRetryRequired.current = true;
          needsReauth.current = false;
          setAuthError(result.error || 'Device Login did not complete. Try again or use your wallet PIN.');
          if (result.biometricOffForApp) {
            showBiometricOffNudge(result.biometricType);
          }
          return;
        }

        // Device Login is disabled, so the hosted wallet retains responsibility
        // for its normal PIN screen. The native overlay is not an extra factor.
        const [deviceLoginAvailable, promptAlreadyShown] = await Promise.all([
          BiometricService.isBiometricAvailable(),
          SeedStorageService.wasBiometricPromptShown(),
        ]);
        if (!isAttemptCurrent()) return;
        setIsAuthorized(true);
        if (deviceLoginAvailable && !promptAlreadyShown) promptDeviceLoginSetup();
      } catch (error) {
        Logger.error('WalletScreen', 'Wallet authorization check failed:', error);
        if (isAttemptBound()) {
          manualRetryRequired.current = true;
          needsReauth.current = false;
          setIsAuthorized(false);
          setAuthError('Wallet security state could not be verified. Please try again.');
        }
      } finally {
        if (isAttemptBound()) setIsUnlocking(false);
      }
    };

    authCheck();
    return () => {
      cancelled = true;
      if (mounted.current && attemptGeneration === authAttemptGeneration.current) {
        setIsUnlocking(false);
        if (isAuthenticating.current) {
          manualRetryRequired.current = true;
          needsReauth.current = false;
        }
      }
    };
  }, [
    authCheckNonce,
    isAuthorized,
    isFocused,
    promptDeviceLoginSetup,
    resumePendingReauth,
    showBiometricOffNudge,
  ]);

  const retryAuthentication = useCallback(() => {
    if (
      isAuthenticating.current ||
      pinVerificationGeneration.current !== null ||
      AppState.currentState !== 'active'
    ) return;
    manualRetryRequired.current = false;
    needsReauth.current = false;
    authAttemptGeneration.current += 1;
    NativeBridge.invalidateAuthorization({ preservePendingDAppIntent: true });
    pendingUnlockPin.current = null;
    setAuthError(null);
    setIsUnlocking(false);
    setAuthCheckNonce((value) => value + 1);
  }, []);

  const unlockWithWalletPin = useCallback(() => {
    if (pinVerificationGeneration.current !== null || AppState.currentState !== 'active') return;
    // Choosing PIN immediately supersedes a pending Device Login result,
    // including when the user later cancels the PIN dialog.
    manualRetryRequired.current = true;
    needsReauth.current = false;
    const attemptGeneration = ++authAttemptGeneration.current;
    NativeBridge.invalidateAuthorization({ preservePendingDAppIntent: true });
    const context = NativeBridge.captureSecurityContext();
    pendingUnlockPin.current = null;
    setIsUnlocking(false);
    setAuthError(null);
    showPinModal(
      async (pin: string) => {
        const isCurrent = () =>
          mounted.current &&
          attemptGeneration === authAttemptGeneration.current &&
          AppState.currentState === 'active' &&
          NativeBridge.isSecurityContextCurrent(context);
        if (!isCurrent() || pinVerificationGeneration.current !== null) return;
        pinVerificationGeneration.current = attemptGeneration;
        setIsVerifyingPin(true);
        setIsUnlocking(true);
        setAuthError(null);
        try {
          const result = await NativeBridge.verifyPin(pin, 30000);
          if (!isCurrent()) return;
          if (!result.success) {
            setAuthError(result.error || 'Incorrect wallet PIN.');
            return;
          }

          if (!NativeBridge.sendUnlockWithPinIfReady(pin, context)) {
            pendingUnlockPin.current = { pin, context };
          }
          manualRetryRequired.current = false;
          setIsAuthorized(true);
        } catch {
          if (isCurrent()) setAuthError('Wallet PIN could not be verified. Please try again.');
        } finally {
          if (pinVerificationGeneration.current === attemptGeneration) {
            pinVerificationGeneration.current = null;
            if (mounted.current) setIsVerifyingPin(false);
          }
          if (mounted.current && attemptGeneration === authAttemptGeneration.current) {
            setIsUnlocking(false);
          }
        }
      },
      'Unlock Wallet',
      'Enter your wallet PIN to unlock this app session.',
    );
  }, [showPinModal]);

  // Helper to mark app as needing re-auth
  const markForReauth = useCallback(() => {
    Logger.debug('WalletScreen', 'App backgrounded, marking for re-auth');
    manualRetryRequired.current =
      manualRetryRequired.current ||
      isAuthenticating.current ||
      pinVerificationGeneration.current !== null;
    needsReauth.current = !manualRetryRequired.current;
    pinVerificationGeneration.current = null;
    setIsVerifyingPin(false);
    if (manualRetryRequired.current) {
      setAuthError('Login was interrupted. Try again or use your wallet PIN.');
    }
    authAttemptGeneration.current += 1;
    NativeBridge.invalidateAuthorization();
    BiometricService.clearPendingSecurityOperations();
    hasRestoredSeeds.current = false;
    // Drop any PIN held between a successful biometric unlock and WEB_APP_READY.
    // A later authorized attempt must repopulate it.
    pendingUnlockPin.current = null;
    setPinModalVisible(false);
    setPendingPinAction(null);
    setIsUnlocking(false);
    setIsAuthorized(false);
    closeQrScanner();
    backgroundedAt.current = Date.now();
    // Don't reset web app ready - WebView is always mounted (off-screen) and maintains state
  }, [closeQrScanner]);

  // Auto-lock app when it goes to background
  // Platform-specific handling for iOS lifecycle quirks
  useEffect(() => {
    const backgroundLock = createBackgroundLock({
      isIOS: Platform.OS === 'ios',
      getCurrentState: () => AppState.currentState,
      isAuthenticating: () => BiometricService.isAuthenticationTransitionActive(),
      onLock: markForReauth,
    });
    const unsubscribeAuthentication = BiometricService.onAuthenticationPromptSettled(
      () => backgroundLock.onAuthenticationSettled(),
    );
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      backgroundLock.onChange(appState.current, nextAppState);

      // A previously unlocked session may authenticate once when it returns.
      if (appState.current !== 'active' && nextAppState === 'active') {
        resumePendingReauth();
      }

      // Notify WebView of every app state transition (single source of truth)
      NativeBridge.sendAppState(nextAppState as 'active' | 'background' | 'inactive');
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
      unsubscribeAuthentication();
      backgroundLock.dispose();
    };
  }, [markForReauth, resumePendingReauth]);

  // Handle WebView load
  // Device Login auth is already handled in authCheck effect, which stores PIN in pendingUnlockPin
  const handleWebViewLoad = useCallback(() => {
    // WebView content loaded - web app will signal WEB_APP_READY when fully initialized
  }, []);

  const handleDocumentLoadStart = useCallback(() => {
    // The wrapper has reset bridge document authority before this callback.
    // Start initial auth in that context without waiting for authorized-only
    // WEB_APP_READY delivery. Later loads still invalidate every old attempt.
    initialDocumentStarted.current = true;
    manualRetryRequired.current =
      manualRetryRequired.current ||
      isAuthenticating.current ||
      pinVerificationGeneration.current !== null;
    needsReauth.current = !manualRetryRequired.current && AppState.currentState !== 'active';
    pinVerificationGeneration.current = null;
    setIsVerifyingPin(false);
    setPinModalVisible(false);
    setPendingPinAction(null);
    authAttemptGeneration.current += 1;
    // resetWebAppReady already discarded intents bound to an earlier document.
    NativeBridge.invalidateAuthorization({ preservePendingDAppIntent: true });
    closeQrScanner();
    pendingUnlockPin.current = null;
    hasRestoredSeeds.current = false;
    setIsAuthorized(false);
    setIsUnlocking(false);
    setAuthError(null);
    setAuthCheckNonce((value) => value + 1);
  }, [closeQrScanner]);

  // Handle WEB_APP_READY message from web - safe to send data now
  const handleWebAppReady = useCallback(async () => {
    Logger.debug('WalletScreen', 'Web app ready signal received');
    const documentSecurityContext = NativeBridge.captureSecurityContext();

    // Prevent double execution (web app may send WEB_APP_READY multiple times)
    if (hasRestoredSeeds.current) {
      Logger.debug('WalletScreen', 'Seeds already restored, skipping');
      return;
    }
    hasRestoredSeeds.current = true;

    // Send pending unlock PIN if we have one
    const pendingUnlock = pendingUnlockPin.current;
    if (pendingUnlock) {
      Logger.debug('WalletScreen', 'Sending pending unlock PIN to web');
      NativeBridge.sendUnlockWithPinForContext(pendingUnlock.pin, pendingUnlock.context);
      pendingUnlockPin.current = null;
    }

    // Check if we need to restore any seeds
    let restoreSnapshot: Awaited<ReturnType<typeof SeedStorageService.getRestoreSnapshot>>;
    try {
      restoreSnapshot = await SeedStorageService.getRestoreSnapshot();
    } catch (error) {
      Logger.warn('WalletScreen', `Skipping stale seed restore: ${String(error)}`);
      return;
    }
    const { backups, generation, legacyAddressBackupCount } = restoreSnapshot;
    if (legacyAddressBackupCount > 0) {
      Logger.warn(
        'WalletScreen',
        `Preserved ${legacyAddressBackupCount} pre-QIP-55 seed backup(s) pending seed-aware migration`,
      );
      Alert.alert(
        'Earlier Wallet Backup Preserved',
        [
          'This device contains a preserved wallet backup with legacy address metadata.',
          'Your earlier wallet data has not been changed. Keep this app installed and do not clear its data.',
          'Use your original recovery phrase or seed to import a Testnet v3 account. Its address will be different.',
          'Automatic conversion of the earlier encrypted backup is not available. Contact support before removing the app if you need help recovering it.',
        ].join(' '),
      );
    }
    if (backups.length > 0) {
      Logger.debug('WalletScreen', `Restoring ${backups.length} seed backup(s)`);
      for (const backup of backups) {
        // A wipe invalidates the whole snapshot synchronously, even if this
        // callback was already awaiting AsyncStorage when removal began. An
        // app lock or document change independently invalidates bridge access.
        if (
          !SeedStorageService.isWalletGenerationCurrent(generation) ||
          !NativeBridge.isSecurityContextCurrent(documentSecurityContext)
        ) {
          Logger.debug('WalletScreen', 'Wallet changed during restore; dropping stale backups');
          return;
        }
        NativeBridge.sendRestoreSeed(
          backup.address,
          backup.encryptedSeed,
          backup.blockchain,
          backup.revision,
          backup.ciphertextHash,
        );
      }
    }
  }, []);

  // Register WEB_APP_READY handler
  useEffect(() => {
    NativeBridge.onWebAppReady(handleWebAppReady);
  }, [handleWebAppReady]);

  useEffect(() => {
    NativeBridge.setNativeAuthorization(isAuthorized);
  }, [isAuthorized]);

  // Handle pending operations from Settings screen when this screen regains focus.
  // Settings queues operations in BiometricService and calls router.back().
  // When this screen regains focus, we detect and execute the pending operation.
  // WebView must be active (visible) for the JS bridge to process messages reliably.
  useFocusEffect(
    useCallback(() => {
      if (!isAuthorized) return;

      // Check for pending Device Login setup
      if (BiometricService.hasPendingDeviceLoginSetup() && !deviceLoginSetupTriggered.current) {
        deviceLoginSetupTriggered.current = true;
        setProcessingMessage('Enabling Device Login...');

        InteractionManager.runAfterInteractions(async () => {
          Logger.debug('WalletScreen', 'Executing queued Device Login setup');
          const result = await BiometricService.executePendingDeviceLoginSetup();

          setProcessingMessage(null);

          if (result.success) {
            Alert.alert('Success', 'Device Login enabled!', [
              { text: 'OK', onPress: () => router.push('/settings') }
            ]);
          } else {
            Alert.alert('Error', result.error || 'Failed to enable Device Login', [
              { text: 'OK', onPress: () => router.push('/settings') }
            ]);
          }

          deviceLoginSetupTriggered.current = false;
        });
      }

      // Check for pending PIN change
      if (BiometricService.hasPendingPinChange() && !pinChangeTriggered.current) {
        pinChangeTriggered.current = true;
        setProcessingMessage('Changing PIN...');

        InteractionManager.runAfterInteractions(async () => {
          Logger.debug('WalletScreen', 'Executing queued PIN change');
          const result = await BiometricService.executePendingPinChange();

          setProcessingMessage(null);

          if (result.success) {
            if (result.error) {
              Alert.alert('Warning', result.error, [
                { text: 'OK', onPress: () => router.push('/settings') }
              ]);
            } else {
              Alert.alert('Success', 'Your PIN has been changed successfully.', [
                { text: 'OK', onPress: () => router.push('/settings') }
              ]);
            }
          } else {
            Alert.alert('Error', result.error || 'Failed to change PIN. Please try again.', [
              { text: 'OK', onPress: () => router.push('/settings') }
            ]);
          }

          pinChangeTriggered.current = false;
        });
      }
    }, [isAuthorized])
  );

  // Update session timestamp on screen focus
  useEffect(() => {
    if (isFocused && isAuthorized) {
      WebViewService.updateLastSession();
    }
  }, [isFocused, isAuthorized]);

  // Log WebView visibility changes
  useEffect(() => {
    Logger.debug('WalletScreen', `WebView visibility changed: isAuthorized=${isAuthorized}, webViewRef=${webViewRef.current ? 'exists' : 'null'}`);
  }, [isAuthorized]);

  // While locked, swallow the Android hardware back button. The WebView now
  // stays mounted under the lock overlay, so without this the back button
  // could navigate the WebView behind the lock. Returning true marks the
  // event handled; when unlocked we return false so normal back behaviour
  // (and the WebView's own back handler) applies.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => !isAuthorized);
    return () => sub.remove();
  }, [isAuthorized]);

  return (
    <RNView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#080C16" />
      {/* Keep the WebView mounted AND on-screen at full size even while locked.
          Moving it off-screen (left/top:-9999) throttles its JS, which stalled
          the dApp-connect relay reconnect (reconnectAll) during re-auth on
          resume. Instead we leave it un-throttled and cover wallet content with
          an opaque lock overlay below while re-auth is pending. */}
      <RNView style={styles.webViewVisible}>
        <QRLWebView
          ref={webViewRef}
          onLoad={handleWebViewLoad}
          onDocumentLoadStart={handleDocumentLoadStart}
          skipLoadingScreen={skipLoadingScreen}
        />
      </RNView>
      {/* Opaque lock cover: hides wallet content during re-auth and blocks
          touches to the WebView underneath, while letting its JS keep running. */}
      {!isAuthorized && (
        <RNView
          style={styles.lockOverlay}
          pointerEvents="auto"
          accessibilityViewIsModal
          accessibilityLabel="Wallet locked"
        >
          <Text style={styles.lockTitle}>Wallet Locked</Text>
          <Text style={styles.lockMessage}>
            {authError || 'Authenticate with Device Login to continue.'}
          </Text>
          {isUnlocking ? <ActivityIndicator color="#33ADE6" size="small" /> : null}
          {!authError?.startsWith('Finishing wallet removal') ? (
            <RNView style={styles.lockActions}>
              <TouchableOpacity
                style={[styles.lockButton, styles.lockButtonPrimary]}
                onPress={retryAuthentication}
                disabled={isUnlocking || isDeviceAuthenticating}
                accessibilityRole="button"
              >
                <Text style={styles.lockButtonPrimaryText}>Try Device Login Again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.lockButton, styles.lockButtonSecondary]}
                onPress={unlockWithWalletPin}
                disabled={isVerifyingPin}
                accessibilityRole="button"
              >
                <Text style={styles.lockButtonSecondaryText}>Use Wallet PIN</Text>
              </TouchableOpacity>
            </RNView>
          ) : null}
        </RNView>
      )}
      <PinEntryModal
        visible={pinModalVisible}
        title={pinModalTitle}
        message={pinModalMessage}
        onSubmit={handlePinSubmit}
        onCancel={handlePinCancel}
      />
      <QRScannerModal
        key={qrScanRequest?.requestId ?? 'closed'}
        visible={qrScanRequest !== null}
        onScan={(data) => handleQRScanResult(data, qrScanRequest)}
        onClose={() => handleQRScannerClose(qrScanRequest)}
      />
      {/* Processing overlay - shown during operations like PIN change */}
      <QuantumLoadingScreen
        visible={!!processingMessage}
        customMessage={processingMessage || undefined}
      />
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080C16',
  },
  webViewVisible: {
    flex: 1,
  },
  // Opaque full-bleed cover shown over the (still on-screen, still running)
  // WebView while re-auth is pending, so wallet content is hidden without
  // throttling the WebView's JS by relocating it off-screen.
  lockOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#080C16',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  lockTitle: {
    color: '#F2F5F8',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 10,
  },
  lockMessage: {
    color: '#9BA6B5',
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 360,
    textAlign: 'center',
    marginBottom: 20,
  },
  lockActions: {
    width: '100%',
    maxWidth: 340,
    gap: 10,
    marginTop: 18,
  },
  lockButton: {
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignItems: 'center',
  },
  lockButtonPrimary: {
    backgroundColor: '#33ADE6',
  },
  lockButtonSecondary: {
    backgroundColor: '#171D2B',
    borderColor: '#1E2738',
    borderWidth: 1,
  },
  lockButtonPrimaryText: {
    color: '#041725',
    fontSize: 15,
    fontWeight: '700',
  },
  lockButtonSecondaryText: {
    color: '#F2F5F8',
    fontSize: 15,
    fontWeight: '600',
  },
});
