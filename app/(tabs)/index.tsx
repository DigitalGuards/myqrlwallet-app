import React, { useEffect, useState, useRef, useCallback } from 'react';
import { StyleSheet, View as RNView, useColorScheme, StatusBar, AppState, AppStateStatus, TouchableOpacity, Platform, Alert } from 'react-native';
// Import QRLWebView
import QRLWebView, { QRLWebViewRef } from '../../components/QRLWebView';
import WebViewService from '../../services/WebViewService';
import BiometricService from '../../services/BiometricService';
import SeedStorageService from '../../services/SeedStorageService';
import NativeBridge from '../../services/NativeBridge';
import { useIsFocused } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { usePathname, router } from 'expo-router';
import Colors from '../../constants/Colors';
import FontAwesome from '@expo/vector-icons/FontAwesome';

export default function WalletScreen() {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [lastFocusTime, setLastFocusTime] = useState(0);
  const [webViewReady, setWebViewReady] = useState(false);
  const isFocused = useIsFocused();
  const colorScheme = useColorScheme();
  const pathname = usePathname();
  const appState = useRef(AppState.currentState);
  const lastActiveUrl = useRef<string | undefined>(undefined);
  const webViewRef = useRef<QRLWebViewRef>(null);

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

  // Handle seed stored event - prompt for biometric setup
  const handleSeedStored = useCallback(async (address: string) => {
    const biometricReady = await BiometricService.isBiometricUnlockReady();
    if (biometricReady) {
      // Already set up, no need to prompt
      return;
    }

    const biometricAvailable = await BiometricService.isBiometricAvailable();
    if (!biometricAvailable) {
      // Biometric not available on device
      return;
    }

    // Prompt user to enable biometric unlock
    Alert.alert(
      'Enable Biometric Unlock?',
      `Would you like to use ${BiometricService.getBiometricName()} to unlock your wallet? You won't need to enter your PIN each time.`,
      [
        {
          text: 'Not Now',
          style: 'cancel',
        },
        {
          text: 'Enable',
          onPress: async () => {
            // Ask user for their PIN to set up biometric
            // For now, we'll show a simple alert - in a real implementation,
            // you'd want a PIN entry modal here
            Alert.prompt(
              'Enter Your PIN',
              'Enter your wallet PIN to enable biometric unlock:',
              async (pin) => {
                if (pin) {
                  const setupResult = await BiometricService.setupBiometricUnlock(pin);
                  if (setupResult.success) {
                    Alert.alert('Success', 'Biometric unlock enabled!');
                  } else {
                    Alert.alert('Error', setupResult.error || 'Failed to enable biometric unlock');
                  }
                }
              },
              'secure-text'
            );
          },
        },
      ]
    );
  }, []);

  // Register bridge callbacks
  useEffect(() => {
    NativeBridge.onBiometricUnlockRequest(performBiometricUnlock);
    NativeBridge.onSeedStored(handleSeedStored);
  }, [performBiometricUnlock, handleSeedStored]);

  // Check biometric settings and authenticate if needed
  useEffect(() => {
    async function authCheck() {
      setIsLoading(true);

      try {
        // Check if we have a stored wallet with biometric enabled
        const hasWallet = await SeedStorageService.hasWallet();
        const biometricReady = await BiometricService.isBiometricUnlockReady();

        if (hasWallet && biometricReady) {
          // Perform biometric unlock and send PIN to web
          const result = await BiometricService.getPinWithBiometric();
          if (result.success) {
            // PIN will be sent to web when WebView is ready
            setIsAuthorized(true);
            // We'll send the PIN after WebView loads
          } else {
            // Biometric failed, but still allow access (user can enter PIN manually)
            setIsAuthorized(true);
          }
        } else {
          // No biometric setup or no wallet - just authorize and let web handle it
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
  }, [isFocused]);

  // Send PIN to web after WebView is ready
  const handleWebViewLoad = useCallback(async () => {
    setWebViewReady(true);

    // If biometric unlock is ready, try to unlock automatically
    const biometricReady = await BiometricService.isBiometricUnlockReady();
    if (biometricReady) {
      const result = await BiometricService.getPinWithBiometric();
      if (result.success && result.pin) {
        // Small delay to ensure web app is initialized
        setTimeout(() => {
          NativeBridge.sendUnlockWithPin(result.pin!);
        }, 500);
      }
    }

    // Check if we need to restore any seeds
    const backups = await SeedStorageService.getAllBackups();
    for (const backup of backups) {
      // Send restore command for each backed up seed
      // The web app will check if it needs it
      NativeBridge.sendRestoreSeed(backup.address, backup.encryptedSeed, backup.blockchain);
    }
  }, []);

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
        <>
          <QRLWebView ref={webViewRef} onLoad={handleWebViewLoad} />
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={navigateToSettings}
            activeOpacity={0.7}
          >
            <FontAwesome name="gear" size={24} color="white" />
          </TouchableOpacity>
        </>
      )}
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A17',
  },
  settingsButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 70 : 50,
    left: 15,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(10, 10, 23, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
});
