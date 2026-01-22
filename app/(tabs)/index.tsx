import React, { useEffect, useState, useRef, useCallback } from 'react';
import { StyleSheet, View as RNView, StatusBar, AppState, AppStateStatus, Alert, InteractionManager, Platform } from 'react-native';
import QRLWebView, { QRLWebViewRef } from '../../components/QRLWebView';
import PinEntryModal from '../../components/PinEntryModal';
import QRScannerModal from '../../components/QRScannerModal';
import QuantumLoadingScreen from '../../components/QuantumLoadingScreen';
import WebViewService from '../../services/WebViewService';
import BiometricService from '../../services/BiometricService';
import SeedStorageService from '../../services/SeedStorageService';
import NativeBridge from '../../services/NativeBridge';
import Logger from '../../services/Logger';
import { useIsFocused } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';

// Track if PIN change is in progress (avoids React closure issues)
let pinChangeTriggered = false;

// Time to wait before treating iOS 'inactive' state as actual backgrounding
// iOS triggers 'inactive' briefly for modals, keyboards, and biometric prompts
const IOS_INACTIVE_TIMEOUT_MS = 300;

// Time threshold for showing loading screen (5 minutes in ms)
const LOADING_SCREEN_THRESHOLD_MS = 5 * 60 * 1000;

// Module-level flag to track settings navigation (avoids React closure issues)
let isNavigatingToSettings = false;

export default function WalletScreen() {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pendingPinAction, setPendingPinAction] = useState<((pin: string) => Promise<void>) | null>(null);
  const [qrScannerVisible, setQrScannerVisible] = useState(false);
  const [skipLoadingScreen, setSkipLoadingScreen] = useState(false);
  const [processingMessage, setProcessingMessage] = useState<string | null>(null);
  const isFocused = useIsFocused();
  const params = useLocalSearchParams<{ enableDeviceLogin?: string; changePin?: string }>();
  const appState = useRef(AppState.currentState);
  const webViewRef = useRef<QRLWebViewRef>(null);
  const pendingUnlockPin = useRef<string | null>(null);
  const hasRestoredSeeds = useRef<boolean>(false);
  const deviceLoginSetupTriggered = useRef<boolean>(false);
  const needsReauth = useRef(false);
  const iosInactiveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track when biometric auth is showing - iOS marks app as 'inactive' during biometric prompt
  const isAuthenticating = useRef(false);
  // Track when app went to background for loading screen threshold
  const backgroundedAt = useRef<number | null>(null);

  // Navigate to settings
  const navigateToSettings = useCallback(() => {
    Logger.debug('WalletScreen', `navigateToSettings called, setting flag`);
    isNavigatingToSettings = true;
    router.push('/settings');
    // Reset after navigation and any app state transitions settle
    // iOS can take 3+ seconds for background/foreground cycle during tab switch
    setTimeout(() => {
      Logger.debug('WalletScreen', 'Resetting isNavigatingToSettings flag');
      isNavigatingToSettings = false;
    }, 10000);  // 10 seconds to be safe
  }, []);

  // Handle device login unlock and send PIN to web
  const performDeviceLoginUnlock = useCallback(async () => {
    Logger.debug('WalletScreen', 'Device Login unlock requested');
    const result = await BiometricService.getPinWithBiometric();
    if (result.success && result.pin) {
      Logger.debug('WalletScreen', 'Device Login succeeded, sending PIN to web');
      NativeBridge.sendUnlockWithPin(result.pin);
    } else {
      Logger.debug('WalletScreen', 'Device Login failed or cancelled', result.error);
    }
  }, []);

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
    // If we came from Settings for Device Login, go back
    if (params.enableDeviceLogin === 'true') {
      router.setParams({ enableDeviceLogin: undefined });
      deviceLoginSetupTriggered.current = false;
      router.push('/settings');
    }
  }, [params.enableDeviceLogin]);

  // Show PIN modal with a callback
  const showPinModal = useCallback((action: (pin: string) => Promise<void>) => {
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
    Logger.debug('WalletScreen', 'QR scan completed', data);
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

  // Register bridge callbacks
  useEffect(() => {
    NativeBridge.onBiometricUnlockRequest(performDeviceLoginUnlock);
    NativeBridge.onSeedStored(handleSeedStored);
    NativeBridge.onOpenNativeSettings(navigateToSettings);
    NativeBridge.onQRScanRequest(handleQRScanRequest);
  }, [performDeviceLoginUnlock, handleSeedStored, handleQRScanRequest, navigateToSettings]);

  // Check device login settings and authenticate if needed
  useEffect(() => {
    async function authCheck() {
      try {
        // Check if we have a stored wallet with Device Login enabled
        const hasWallet = await SeedStorageService.hasWallet();
        const deviceLoginReady = await BiometricService.isDeviceLoginReady();

        if (hasWallet && deviceLoginReady) {
          // Mark that we're showing biometric prompt - prevents iOS inactive state from triggering reauth
          isAuthenticating.current = true;
          // Perform Device Login and store PIN for later
          const result = await BiometricService.getPinWithBiometric();
          isAuthenticating.current = false;
          if (result.success && result.pin) {
            // Store PIN to send when web app signals ready
            pendingUnlockPin.current = result.pin;
            setIsAuthorized(true);
          } else {
            // Device Login failed, but still allow access (user can enter PIN manually)
            setIsAuthorized(true);
          }
        } else if (hasWallet) {
          // Wallet exists but Device Login not set up
          // Check if we should prompt for Device Login setup
          const deviceLoginAvailable = await BiometricService.isBiometricAvailable();
          const promptAlreadyShown = await SeedStorageService.wasBiometricPromptShown();

          if (deviceLoginAvailable && !promptAlreadyShown) {
            // Show Device Login setup prompt after UI renders and interactions complete
            setIsAuthorized(true);
            InteractionManager.runAfterInteractions(() => {
              promptDeviceLoginSetup();
            });
          } else {
            setIsAuthorized(true);
          }
        } else {
          // No wallet - just authorize and let web handle it
          setIsAuthorized(true);
        }
      } catch {
        setIsAuthorized(true); // Fallback to authorized on error
      }
    }

    // Only run auth check when screen is focused AND not already authorized
    // This prevents re-authentication when navigating back from settings tab
    if (isFocused && !isAuthorized) {
      authCheck();
    }
  }, [isFocused, isAuthorized, promptDeviceLoginSetup]);

  // Helper to mark app as needing re-auth
  const markForReauth = useCallback(() => {
    // Skip if intentionally navigating to settings - iOS triggers background/foreground on tab switch
    if (isNavigatingToSettings) {
      Logger.debug('WalletScreen', 'Skipping re-auth mark - navigating to settings');
      return;
    }
    Logger.debug('WalletScreen', 'App backgrounded, marking for re-auth');
    needsReauth.current = true;
    hasRestoredSeeds.current = false;
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
          // Only mark for reauth if not currently authenticating
          if (!isAuthenticating.current) {
            markForReauth();
          }
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
        }
      }

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

  // Handle WEB_APP_READY message from web - safe to send data now
  const handleWebAppReady = useCallback(async () => {
    Logger.debug('WalletScreen', 'Web app ready signal received');

    // Prevent double execution (web app may send WEB_APP_READY multiple times)
    if (hasRestoredSeeds.current) {
      Logger.debug('WalletScreen', 'Seeds already restored, skipping');
      return;
    }
    hasRestoredSeeds.current = true;

    // Send pending unlock PIN if we have one
    if (pendingUnlockPin.current) {
      Logger.debug('WalletScreen', 'Sending pending unlock PIN to web');
      NativeBridge.sendUnlockWithPin(pendingUnlockPin.current);
      pendingUnlockPin.current = null;
    }

    // Check if we need to restore any seeds
    const backups = await SeedStorageService.getAllBackups();
    if (backups.length > 0) {
      Logger.debug('WalletScreen', `Restoring ${backups.length} seed backup(s)`);
      for (const backup of backups) {
        NativeBridge.sendRestoreSeed(backup.address, backup.encryptedSeed, backup.blockchain);
      }
    }
  }, []);

  // Register WEB_APP_READY handler
  useEffect(() => {
    NativeBridge.onWebAppReady(handleWebAppReady);
  }, [handleWebAppReady]);

  // Handle Device Login setup request from Settings tab
  // WebView must be active (on this tab) for the JS bridge to process messages reliably
  useEffect(() => {
    if (params.enableDeviceLogin === 'true' && isAuthorized && !deviceLoginSetupTriggered.current) {
      // Mark as triggered to prevent re-execution
      deviceLoginSetupTriggered.current = true;

      // Clear the param AFTER marking as triggered to prevent race conditions
      setTimeout(() => router.setParams({ enableDeviceLogin: undefined }), 0);

      // Show loading overlay
      setProcessingMessage('Enabling Device Login...');

      // Execute the queued Device Login setup after a short delay
      // The delay gives the WebView time to become fully active after navigation
      setTimeout(async () => {
        Logger.debug('WalletScreen', 'Executing queued Device Login setup');
        const result = await BiometricService.executePendingDeviceLoginSetup();

        // Hide loading overlay
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
      }, 500); // 500ms delay for WebView to become active
    }
  }, [params.enableDeviceLogin, isAuthorized]);

  // Handle PIN change request from Settings tab
  // WebView must be active (on this tab) for the JS bridge to process messages reliably
  useEffect(() => {
    if (params.changePin === 'true' && isAuthorized && !pinChangeTriggered) {
      // Mark as triggered to prevent re-execution
      pinChangeTriggered = true;

      // Clear the param AFTER marking as triggered to prevent race conditions
      // Use setTimeout to avoid clearing during this render cycle
      setTimeout(() => router.setParams({ changePin: undefined }), 0);

      // Show loading overlay
      setProcessingMessage('Changing PIN...');

      // Execute the queued PIN change after a short delay
      // The delay gives the WebView time to become fully active after navigation
      setTimeout(async () => {
        Logger.debug('WalletScreen', 'Executing queued PIN change');
        const result = await BiometricService.executePendingPinChange();

        // Hide loading overlay
        setProcessingMessage(null);

        if (result.success) {
          // If there's an error message, it's a warning about a partial success
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

        pinChangeTriggered = false;
      }, 500); // 500ms delay for WebView to become active
    }
  }, [params.changePin, isAuthorized]);

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

  return (
    <RNView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A17" />
      {/* Always render WebView to keep ref available for bridge messages, but hide when not authorized */}
      <RNView style={isAuthorized ? styles.webViewVisible : styles.webViewHidden}>
        <QRLWebView ref={webViewRef} onLoad={handleWebViewLoad} skipLoadingScreen={skipLoadingScreen} />
      </RNView>
      <PinEntryModal
        visible={pinModalVisible}
        title="Enter Your PIN"
        message="Enter your wallet PIN to enable Device Login"
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
    backgroundColor: '#0A0A17',
  },
  webViewVisible: {
    flex: 1,
  },
  webViewHidden: {
    // Keep WebView functional but invisible - 0x0 size can prevent JS execution
    flex: 1,
    position: 'absolute',
    left: -9999,
    top: -9999,
  },
});
