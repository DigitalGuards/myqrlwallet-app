import React, { useEffect, useState, useRef, useCallback } from 'react';
import { StyleSheet, View as RNView, useColorScheme, StatusBar, AppState, AppStateStatus, Alert } from 'react-native';
// Import QRLWebView
import QRLWebView, { QRLWebViewRef } from '../../components/QRLWebView';
import PinEntryModal from '../../components/PinEntryModal';
import QRScannerModal from '../../components/QRScannerModal';
import WebViewService from '../../services/WebViewService';
import BiometricService from '../../services/BiometricService';
import SeedStorageService from '../../services/SeedStorageService';
import NativeBridge from '../../services/NativeBridge';
import { useIsFocused } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { usePathname, router } from 'expo-router';
import Colors from '../../constants/Colors';

export default function WalletScreen() {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [lastFocusTime, setLastFocusTime] = useState(0);
  const [webViewReady, setWebViewReady] = useState(false);
  const [webAppReady, setWebAppReady] = useState(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pendingPinAction, setPendingPinAction] = useState<((pin: string) => Promise<void>) | null>(null);
  const [qrScannerVisible, setQrScannerVisible] = useState(false);
  const isFocused = useIsFocused();
  const colorScheme = useColorScheme();
  const pathname = usePathname();
  const appState = useRef(AppState.currentState);
  const lastActiveUrl = useRef<string | undefined>(undefined);
  const webViewRef = useRef<QRLWebViewRef>(null);
  const pendingUnlockPin = useRef<string | null>(null);

  // Navigate to settings
  const navigateToSettings = () => {
    router.push('/settings');
  };

  // Handle biometric unlock and send PIN to web
  const performBiometricUnlock = useCallback(async () => {
    const result = await BiometricService.getPinWithBiometric();
    if (result.success && result.pin) {
      console.log('[WalletScreen] Biometric unlock successful, sending PIN to web');
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
  }, []);

  // Show PIN modal with a callback
  const showPinModal = useCallback((action: (pin: string) => Promise<void>) => {
    setPendingPinAction(() => action);
    setPinModalVisible(true);
  }, []);

  // Handle seed stored event - just log for now, biometric prompt shown on next launch
  const handleSeedStored = useCallback(async (address: string) => {
    console.log(`[WalletScreen] Seed stored for ${address}`);
    // Biometric setup prompt is shown on app reopen, not immediately during import
  }, []);

  // Prompt user to enable biometric unlock
  const promptBiometricSetup = useCallback(() => {
    Alert.alert(
      'Enable Biometric Unlock?',
      `Would you like to use ${BiometricService.getBiometricName()} to unlock your wallet? You won't need to enter your PIN each time.`,
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
              const setupResult = await BiometricService.setupBiometricUnlock(pin);
              if (setupResult.success) {
                await SeedStorageService.setBiometricPromptShown(true);
                Alert.alert('Success', 'Biometric unlock enabled!');
              } else {
                Alert.alert('Error', setupResult.error || 'Failed to enable biometric unlock');
              }
            });
          },
        },
      ]
    );
  }, [showPinModal]);

  // Handle QR scan request from web
  const handleQRScanRequest = useCallback(() => {
    console.log('[WalletScreen] QR scan requested');
    setQrScannerVisible(true);
  }, []);

  // Handle QR scan result
  const handleQRScanResult = useCallback((data: string) => {
    console.log('[WalletScreen] QR scanned:', data);
    // Send the scanned data to the WebView
    NativeBridge.sendQRResult(data);
  }, []);

  // Close QR scanner
  const handleQRScannerClose = useCallback(() => {
    setQrScannerVisible(false);
  }, []);

  // Register bridge callbacks
  useEffect(() => {
    NativeBridge.onBiometricUnlockRequest(performBiometricUnlock);
    NativeBridge.onSeedStored(handleSeedStored);
    NativeBridge.onOpenNativeSettings(navigateToSettings);
    NativeBridge.onQRScanRequest(handleQRScanRequest);
  }, [performBiometricUnlock, handleSeedStored, handleQRScanRequest]);

  // Check biometric settings and authenticate if needed
  useEffect(() => {
    async function authCheck() {
      setIsLoading(true);

      try {
        // Check if we have a stored wallet with biometric enabled
        const hasWallet = await SeedStorageService.hasWallet();
        const biometricReady = await BiometricService.isBiometricUnlockReady();

        if (hasWallet && biometricReady) {
          // Perform biometric unlock and store PIN for later
          const result = await BiometricService.getPinWithBiometric();
          if (result.success && result.pin) {
            // Store PIN to send when web app signals ready
            pendingUnlockPin.current = result.pin;
            setIsAuthorized(true);
          } else {
            // Biometric failed, but still allow access (user can enter PIN manually)
            setIsAuthorized(true);
          }
        } else if (hasWallet) {
          // Wallet exists but biometric not set up
          // Check if we should prompt for biometric setup
          const biometricAvailable = await BiometricService.isBiometricAvailable();
          const promptAlreadyShown = await SeedStorageService.wasBiometricPromptShown();

          if (biometricAvailable && !promptAlreadyShown) {
            // Show biometric setup prompt on next tick (after UI renders)
            setIsAuthorized(true);
            setTimeout(() => {
              promptBiometricSetup();
            }, 500);
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

    // Only run auth check when screen is focused
    if (isFocused) {
      authCheck();
    }
  }, [isFocused, promptBiometricSetup]);

  // Handle WebView load - just mark as ready
  // Biometric auth is already handled in authCheck effect, which stores PIN in pendingUnlockPin
  const handleWebViewLoad = useCallback(() => {
    setWebViewReady(true);
  }, []);

  // Handle WEB_APP_READY message from web - safe to send data now
  const handleWebAppReady = useCallback(async () => {
    console.log('[WalletScreen] Web app is ready, sending initialization data');
    setWebAppReady(true);

    // Send pending unlock PIN if we have one
    if (pendingUnlockPin.current) {
      NativeBridge.sendUnlockWithPin(pendingUnlockPin.current);
      pendingUnlockPin.current = null;
    }

    // Check if we need to restore any seeds
    const backups = await SeedStorageService.getAllBackups();
    for (const backup of backups) {
      // Send restore command for each backed up seed
      // The web app will check if it needs it
      NativeBridge.sendRestoreSeed(backup.address, backup.encryptedSeed, backup.blockchain);
    }
  }, []);

  // Register WEB_APP_READY handler
  useEffect(() => {
    NativeBridge.onWebAppReady(handleWebAppReady);
  }, [handleWebAppReady]);

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
        message="Enter your wallet PIN to enable biometric unlock"
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
