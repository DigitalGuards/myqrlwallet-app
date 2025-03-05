import React, { useEffect, useState } from 'react';
import { StyleSheet, View as RNView } from 'react-native';
// Although named QRLWebView, this component is defined in the QRLWebView.tsx file
import QRLWebView from '../../components/QRLWebView';
import WebViewService from '../../services/WebViewService';
import BiometricService from '../../services/BiometricService';
import { useIsFocused } from '@react-navigation/native';

export default function WalletScreen() {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const isFocused = useIsFocused();

  // Check biometric settings and authenticate if needed
  useEffect(() => {
    async function authCheck() {
      setIsLoading(true);

      try {
        const preferences = await WebViewService.getUserPreferences();
        
        // Skip biometric check if not enabled in preferences
        if (!preferences.biometricEnabled) {
          setIsAuthorized(true);
          setIsLoading(false);
          return;
        }

        // Check if biometrics are available
        const biometricAvailable = await BiometricService.isBiometricAvailable();
        
        if (biometricAvailable) {
          // Perform biometric authentication
          const authResult = await BiometricService.authenticate();
          setIsAuthorized(authResult.success);
        } else {
          // Fallback if biometrics are not available
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

  // Update session timestamp on screen focus
  useEffect(() => {
    if (isFocused && isAuthorized) {
      WebViewService.updateLastSession();
    }
  }, [isFocused, isAuthorized]);

  return (
    <RNView style={styles.container}>
      {isAuthorized && <QRLWebView />}
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
});
