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
import NativeBridge, { NativeSecurityContext } from '../../services/NativeBridge';
import Logger from '../../services/Logger';
import { useIsFocused, useFocusEffect } from '@react-navigation/native';
import { router, usePathname } from 'expo-router';

// Time to wait before treating iOS 'inactive' state as actual backgrounding
// iOS triggers 'inactive' briefly for modals, keyboards, and biometric prompts
const IOS_INACTIVE_TIMEOUT_MS = 300;

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
  const [qrScannerVisible, setQrScannerVisible] = useState(false);
  const [skipLoadingScreen, setSkipLoadingScreen] = useState(false);
  const [processingMessage, setProcessingMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [authCheckNonce, setAuthCheckNonce] = useState(0);
  const isFocused = useIsFocused();
  const pathname = usePathname();
  const appState = useRef(AppState.currentState);
  const webViewRef = useRef<QRLWebViewRef>(null);
  const pendingUnlockPin = useRef<PendingUnlockPin | null>(null);
  const hasRestoredSeeds = useRef<boolean>(false);
  const deviceLoginSetupTriggered = useRef<boolean>(false);
  const needsReauth = useRef(false);
  const iosInactiveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track when biometric auth is showing - iOS marks app as 'inactive' during biometric prompt
  const isAuthenticating = useRef(false);
  // Track when app went to background for loading screen threshold
  const backgroundedAt = useRef<number | null>(null);
  // Track if PIN change is in progress
  const pinChangeTriggered = useRef(false);
  // Show the "biometric is off for this app" hint at most once per app session
  const biometricOffNudgeShown = useRef(false);
  const authAttemptGeneration = useRef(0);

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

  // Handle device login unlock and send PIN to web
  const performDeviceLoginUnlock = useCallback(async (context: NativeSecurityContext) => {
    if (isAuthenticating.current) return;
    Logger.debug('WalletScreen', 'Device Login unlock requested');
    isAuthenticating.current = true;
    try {
      const result = await BiometricService.getPinWithBiometric();
      if (
        result.success &&
        result.pin &&
        AppState.currentState === 'active' &&
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
    }
  }, [showBiometricOffNudge]);

  // Handle PIN modal submission
  const handlePinSubmit = useCallback(async (pin: string) => {
    setPinModalVisible(false);
    if (pendingPinAction) {
      await pendingPinAction(pin);
      setPendingPinAction(null);
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

  // Track if QR was successfully scanned (to know if we should send cancel on close)
  const qrScanSuccessful = useRef(false);

  // Handle QR scan request from web
  const handleQRScanRequest = useCallback(() => {
    Logger.debug('WalletScreen', 'QR scan requested from web');
    qrScanSuccessful.current = false;
    setQrScannerVisible(true);
  }, []);

  // Handle QR scan result
  const handleQRScanResult = useCallback((data: string) => {
    if (data.length === 0 || data.length > 4096) {
      Logger.warn('WalletScreen', 'QR scan result exceeded the bridge budget');
      return;
    }
    Logger.debug('WalletScreen', `QR scan completed (${data.length} characters, payload redacted)`);
    qrScanSuccessful.current = true;
    // Send the scanned data to the WebView
    NativeBridge.sendQRResult(data);
  }, []);

  // Close QR scanner
  const handleQRScannerClose = useCallback(() => {
    setQrScannerVisible(false);
    // If scanner was closed without successful scan, notify web app
    if (!qrScanSuccessful.current) {
      Logger.debug('WalletScreen', 'QR scan cancelled by user');
      NativeBridge.sendQRCancelled();
    }
  }, []);

  // Handle DAPP_SHOW_WEBVIEW - switch to WebView tab when dApp needs approval
  const handleDAppShowWebView = useCallback(() => {
    Logger.debug('WalletScreen', 'dApp requesting WebView focus');
    // Only navigate if we're actually on a different tab. Calling replace('/')
    // while already on '/' re-mounts the WebView, which reloads the wallet
    // page and orphans any live socket.io connection — the fresh page then
    // hits a reconnect storm behind CF's cold polling path.
    if (pathname !== '/') {
      router.replace('/');
    }
  }, [pathname]);

  const handleWalletClearStarted = useCallback(() => {
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
  }, []);

  // Register bridge callbacks
  useEffect(() => {
    NativeBridge.onBiometricUnlockRequest(performDeviceLoginUnlock);
    NativeBridge.onSeedStored(handleSeedStored);
    NativeBridge.onOpenNativeSettings(navigateToSettings);
    NativeBridge.onQRScanRequest(handleQRScanRequest);
    NativeBridge.onDAppShowWebView(handleDAppShowWebView);
    NativeBridge.onWalletClearStarted(handleWalletClearStarted);
  }, [
    performDeviceLoginUnlock,
    handleSeedStored,
    handleQRScanRequest,
    navigateToSettings,
    handleDAppShowWebView,
    handleWalletClearStarted,
  ]);

  // Check wallet state and authenticate. Every error leaves an existing wallet
  // behind the native lock so transient storage failures cannot bypass it.
  useEffect(() => {
    if (
      !isFocused ||
      isAuthorized ||
      AppState.currentState !== 'active'
    ) {
      return;
    }

    let cancelled = false;
    const attemptGeneration = ++authAttemptGeneration.current;
    const isAttemptCurrent = () =>
      !cancelled &&
      attemptGeneration === authAttemptGeneration.current &&
      AppState.currentState === 'active';

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
          let result;
          try {
            result = await BiometricService.getPinWithBiometric();
          } finally {
            isAuthenticating.current = false;
          }
          if (!isAttemptCurrent() || !NativeBridge.isSecurityContextCurrent(context)) return;

          if (result.success && result.pin) {
            const pending = { pin: result.pin, context };
            if (!NativeBridge.sendUnlockWithPinIfReady(result.pin, context)) {
              pendingUnlockPin.current = pending;
            }
            setIsAuthorized(true);
            return;
          }

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
        if (isAttemptCurrent()) {
          setIsAuthorized(false);
          setAuthError('Wallet security state could not be verified. Please try again.');
        }
      } finally {
        if (isAttemptCurrent()) setIsUnlocking(false);
      }
    };

    authCheck();
    return () => {
      cancelled = true;
    };
  }, [
    authCheckNonce,
    isAuthorized,
    isFocused,
    promptDeviceLoginSetup,
    showBiometricOffNudge,
  ]);

  const retryAuthentication = useCallback(() => {
    authAttemptGeneration.current += 1;
    NativeBridge.invalidateAuthorization();
    pendingUnlockPin.current = null;
    setAuthError(null);
    setIsUnlocking(false);
    setAuthCheckNonce((value) => value + 1);
  }, []);

  const unlockWithWalletPin = useCallback(() => {
    showPinModal(
      async (pin: string) => {
        const attemptGeneration = ++authAttemptGeneration.current;
        NativeBridge.invalidateAuthorization();
        const context = NativeBridge.captureSecurityContext();
        setIsUnlocking(true);
        setAuthError(null);
        try {
          const result = await NativeBridge.verifyPin(pin, 30000);
          if (
            attemptGeneration !== authAttemptGeneration.current ||
            AppState.currentState !== 'active' ||
            !NativeBridge.isSecurityContextCurrent(context)
          ) {
            return;
          }
          if (!result.success) {
            setAuthError(result.error || 'Incorrect wallet PIN.');
            return;
          }

          if (!NativeBridge.sendUnlockWithPinIfReady(pin, context)) {
            pendingUnlockPin.current = { pin, context };
          }
          setIsAuthorized(true);
        } finally {
          if (attemptGeneration === authAttemptGeneration.current) {
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
    needsReauth.current = true;
    authAttemptGeneration.current += 1;
    NativeBridge.invalidateAuthorization();
    BiometricService.clearPendingSecurityOperations();
    hasRestoredSeeds.current = false;
    // Drop any PIN held between a successful biometric unlock and WEB_APP_READY.
    // If the user returns, authCheck will re-run and repopulate this post-auth.
    pendingUnlockPin.current = null;
    setPinModalVisible(false);
    setPendingPinAction(null);
    setIsUnlocking(false);
    setIsAuthorized(false);
    backgroundedAt.current = Date.now();
    // Don't reset web app ready - WebView is always mounted (off-screen) and maintains state
  }, []);

  // Auto-lock app when it goes to background
  // Platform-specific handling for iOS lifecycle quirks
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      // Clear any pending iOS timer on state change
      if (iosInactiveTimer.current) {
        clearTimeout(iosInactiveTimer.current);
        iosInactiveTimer.current = null;
      }

      // Android: straightforward background detection
      if (Platform.OS === 'android') {
        if (appState.current === 'active' && nextAppState === 'background') {
          markForReauth();
        }
      }

      // iOS: handle the inactive → background ambiguity
      // Modals/keyboards trigger 'inactive' briefly, so we use a timer to distinguish
      // IMPORTANT: Skip this logic when showing biometric prompt (it triggers 'inactive' on iOS)
      if (Platform.OS === 'ios') {
        if (appState.current === 'active' && nextAppState === 'inactive') {
          // Skip if we're currently showing biometric authentication
          if (!isAuthenticating.current) {
            // Start a timer - if we don't return to 'active' within the timeout,
            // treat it as actually leaving the app
            iosInactiveTimer.current = setTimeout(() => {
              // Check actual current state AND that we're not authenticating
              if (AppState.currentState !== 'active' && !isAuthenticating.current) {
                markForReauth();
              }
            }, IOS_INACTIVE_TIMEOUT_MS);
          }
        }

        // Also catch direct background (can happen on iOS 13+)
        if (appState.current === 'active' && nextAppState === 'background') {
          markForReauth();
        }
      }

      // App coming back to active - trigger re-auth if needed
      // Skip if we're returning from biometric prompt (isAuthenticating is true)
      if ((appState.current === 'inactive' || appState.current === 'background') && nextAppState === 'active') {
        if (needsReauth.current && !isAuthenticating.current) {
          Logger.debug('WalletScreen', 'App foregrounded, triggering re-auth');
          needsReauth.current = false;

          // Check if we should skip loading screen (backgrounded less than 5 minutes)
          const timeSinceBackground = backgroundedAt.current
            ? Date.now() - backgroundedAt.current
            : Infinity;
          const shouldSkipLoading = timeSinceBackground < LOADING_SCREEN_THRESHOLD_MS;
          Logger.debug('WalletScreen', `Time since background: ${timeSinceBackground}ms, skip loading: ${shouldSkipLoading}`);
          setSkipLoadingScreen(shouldSkipLoading);

          setIsAuthorized(false);
          setAuthCheckNonce((value) => value + 1);
        }
      }

      // Notify WebView of every app state transition (single source of truth)
      NativeBridge.sendAppState(nextAppState as 'active' | 'background' | 'inactive');
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
      if (iosInactiveTimer.current) {
        clearTimeout(iosInactiveTimer.current);
      }
    };
  }, [markForReauth]);

  // Handle WebView load
  // Device Login auth is already handled in authCheck effect, which stores PIN in pendingUnlockPin
  const handleWebViewLoad = useCallback(() => {
    // WebView content loaded - web app will signal WEB_APP_READY when fully initialized
  }, []);

  const handleDocumentLoadStart = useCallback(() => {
    authAttemptGeneration.current += 1;
    NativeBridge.invalidateAuthorization();
    pendingUnlockPin.current = null;
    hasRestoredSeeds.current = false;
    setIsAuthorized(false);
    setIsUnlocking(false);
    setAuthError(null);
    setAuthCheckNonce((value) => value + 1);
  }, []);

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
    const { backups, generation } = restoreSnapshot;
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
      <StatusBar barStyle="light-content" backgroundColor="#09090c" />
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
          {isUnlocking ? <ActivityIndicator color="#fa761e" size="small" /> : null}
          {!authError?.startsWith('Finishing wallet removal') ? (
            <RNView style={styles.lockActions}>
              <TouchableOpacity
                style={[styles.lockButton, styles.lockButtonPrimary]}
                onPress={retryAuthentication}
                disabled={isUnlocking}
                accessibilityRole="button"
              >
                <Text style={styles.lockButtonPrimaryText}>Try Device Login Again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.lockButton, styles.lockButtonSecondary]}
                onPress={unlockWithWalletPin}
                disabled={isUnlocking}
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
        visible={qrScannerVisible}
        onScan={handleQRScanResult}
        onClose={handleQRScannerClose}
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
    backgroundColor: '#09090c',
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
    backgroundColor: '#09090c',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  lockTitle: {
    color: '#f5f3f0',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 10,
  },
  lockMessage: {
    color: '#9c9dab',
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
    backgroundColor: '#fa761e',
  },
  lockButtonSecondary: {
    backgroundColor: '#16171d',
    borderColor: '#2a2b32',
    borderWidth: 1,
  },
  lockButtonPrimaryText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  lockButtonSecondaryText: {
    color: '#f5f3f0',
    fontSize: 15,
    fontWeight: '600',
  },
});
