import React, { useEffect, useState, useRef, useCallback } from 'react';
import { StyleSheet, View as RNView, StatusBar, AppState, AppStateStatus, Alert, InteractionManager, Platform } from 'react-native';
import QRLWebView, { QRLWebViewRef } from '../../components/QRLWebView';
import PinEntryModal from '../../components/PinEntryModal';
import QRScannerModal from '../../components/QRScannerModal';
import WebViewService from '../../services/WebViewService';
import BiometricService from '../../services/BiometricService';
import SeedStorageService from '../../services/SeedStorageService';
import NativeBridge from '../../services/NativeBridge';
import { useIsFocused } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';

export default function WalletScreen() {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [webViewReady, setWebViewReady] = useState(false);
  const [webAppReady, setWebAppReady] = useState(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pendingPinAction, setPendingPinAction] = useState<((pin: string) => Promise<void>) | null>(null);
  const [qrScannerVisible, setQrScannerVisible] = useState(false);
  const isFocused = useIsFocused();
  const params = useLocalSearchParams<{ enableDeviceLogin?: string }>();
  const appState = useRef(AppState.currentState);
  const webViewRef = useRef<QRLWebViewRef>(null);
  const pendingUnlockPin = useRef<string | null>(null);
  const hasRestoredSeeds = useRef<boolean>(false);
  const deviceLoginSetupTriggered = useRef<boolean>(false);
  const needsReauth = useRef(false);
  const iosInactiveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Navigate to settings
  const navigateToSettings = () => {
    router.push('/settings');
  };

  // Handle device login unlock and send PIN to web
  const performDeviceLoginUnlock = useCallback(async () => {
    const result = await BiometricService.getPinWithBiometric();
    if (result.success && result.pin) {
      console.log('[WalletScreen] Device Login successful, sending PIN to web');
      NativeBridge.sendUnlockWithPin(result.pin);
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

  // Handle seed stored event - just log for now, Device Login prompt shown on next launch
  const handleSeedStored = useCallback(async (address: string) => {
    console.log(`[WalletScreen] Seed stored for ${address}`);
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
    console.log('[WalletScreen] QR scan requested');
    qrScanSuccessful.current = false;
    setQrScannerVisible(true);
  }, []);

  // Handle QR scan result
  const handleQRScanResult = useCallback((data: string) => {
    console.log('[WalletScreen] QR scanned:', data);
    qrScanSuccessful.current = true;
    // Send the scanned data to the WebView
    NativeBridge.sendQRResult(data);
  }, []);

  // Close QR scanner
  const handleQRScannerClose = useCallback(() => {
    setQrScannerVisible(false);
    // If scanner was closed without successful scan, notify web app
    if (!qrScanSuccessful.current) {
      console.log('[WalletScreen] QR scan cancelled');
      NativeBridge.sendQRCancelled();
    }
  }, []);

  // Register bridge callbacks
  useEffect(() => {
    NativeBridge.onBiometricUnlockRequest(performDeviceLoginUnlock);
    NativeBridge.onSeedStored(handleSeedStored);
    NativeBridge.onOpenNativeSettings(navigateToSettings);
    NativeBridge.onQRScanRequest(handleQRScanRequest);
  }, [performDeviceLoginUnlock, handleSeedStored, handleQRScanRequest]);

  // Check device login settings and authenticate if needed
  useEffect(() => {
    async function authCheck() {
      setIsLoading(true);

      try {
        // Check if we have a stored wallet with Device Login enabled
        const hasWallet = await SeedStorageService.hasWallet();
        const deviceLoginReady = await BiometricService.isDeviceLoginReady();

        if (hasWallet && deviceLoginReady) {
          // Perform Device Login and store PIN for later
          const result = await BiometricService.getPinWithBiometric();
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
      } catch (error) {
        console.error('Authentication error:', error);
        setIsAuthorized(true); // Fallback to authorized on error
      } finally {
        setIsLoading(false);
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
    console.log('[WalletScreen] Marking app for re-authentication');
    needsReauth.current = true;
    setWebAppReady(false);
    hasRestoredSeeds.current = false;
    NativeBridge.resetWebAppReady();
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
          console.log('[WalletScreen] Android: App going to background');
          markForReauth();
        }
      }

      // iOS: handle the inactive → background ambiguity
      // Modals/keyboards trigger 'inactive' briefly, so we use a timer to distinguish
      if (Platform.OS === 'ios') {
        if (appState.current === 'active' && nextAppState === 'inactive') {
          // Start a timer - if we don't return to 'active' within 300ms,
          // treat it as actually leaving the app
          iosInactiveTimer.current = setTimeout(() => {
            if (appState.current !== 'active') {
              console.log('[WalletScreen] iOS: App left active state (via inactive)');
              markForReauth();
            }
          }, 300);
        }

        // Also catch direct background (can happen on iOS 13+)
        if (appState.current === 'active' && nextAppState === 'background') {
          console.log('[WalletScreen] iOS: App going directly to background');
          markForReauth();
        }
      }

      // App coming back to active - trigger re-auth if needed
      if ((appState.current === 'inactive' || appState.current === 'background') && nextAppState === 'active') {
        if (needsReauth.current) {
          console.log('[WalletScreen] App returning to active, triggering re-authentication');
          needsReauth.current = false;
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

  // Handle WebView load - just mark as ready
  // Device Login auth is already handled in authCheck effect, which stores PIN in pendingUnlockPin
  const handleWebViewLoad = useCallback(() => {
    setWebViewReady(true);
  }, []);

  // Handle WEB_APP_READY message from web - safe to send data now
  const handleWebAppReady = useCallback(async () => {
    // Prevent double execution (web app may send WEB_APP_READY multiple times)
    if (hasRestoredSeeds.current) {
      return;
    }
    hasRestoredSeeds.current = true;
    setWebAppReady(true);

    // Send pending unlock PIN if we have one
    if (pendingUnlockPin.current) {
      NativeBridge.sendUnlockWithPin(pendingUnlockPin.current);
      pendingUnlockPin.current = null;
    }

    // Check if we need to restore any seeds
    const backups = await SeedStorageService.getAllBackups();
    if (backups.length > 0) {
      console.log(`[WalletScreen] Restoring ${backups.length} wallet(s) from backup`);
      for (const backup of backups) {
        console.log(` -> Restoring seed for ${backup.address}`);
        NativeBridge.sendRestoreSeed(backup.address, backup.encryptedSeed, backup.blockchain);
      }
    }
  }, []);

  // Register WEB_APP_READY handler
  useEffect(() => {
    NativeBridge.onWebAppReady(handleWebAppReady);
  }, [handleWebAppReady]);

  // Handle Device Login setup request from Settings tab
  // Note: We only need isAuthorized (WebView mounted) since verifyPin waits for web app ready internally
  useEffect(() => {
    if (params.enableDeviceLogin === 'true' && isAuthorized && !deviceLoginSetupTriggered.current) {
      // Mark as triggered to prevent re-execution
      deviceLoginSetupTriggered.current = true;

      // Clear the param to prevent re-triggering on subsequent renders
      router.setParams({ enableDeviceLogin: undefined });

      // Show PIN modal for Device Login setup
      // The PIN verification will wait for web app to be ready internally
      showPinModal(async (pin: string) => {
        const setupResult = await BiometricService.setupDeviceLogin(pin);
        if (setupResult.success) {
          Alert.alert('Success', 'Device Login enabled!', [
            { text: 'OK', onPress: () => router.push('/settings') }
          ]);
        } else {
          Alert.alert('Error', setupResult.error || 'Failed to enable Device Login', [
            { text: 'OK', onPress: () => router.push('/settings') }
          ]);
        }
        deviceLoginSetupTriggered.current = false;
      });
    }
  }, [params.enableDeviceLogin, isAuthorized, showPinModal]);

  // Update session timestamp on screen focus
  useEffect(() => {
    if (isFocused && isAuthorized) {
      WebViewService.updateLastSession();
    }
  }, [isFocused, isAuthorized]);

  return (
    <RNView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A17" />
      {isAuthorized && (
        <QRLWebView ref={webViewRef} onLoad={handleWebViewLoad} />
      )}
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
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A17',
  },
});
