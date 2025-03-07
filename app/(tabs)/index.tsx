import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, View as RNView, useColorScheme, StatusBar, AppState, AppStateStatus, TouchableOpacity, Platform } from 'react-native';
// Import QRLWebView
import QRLWebView from '../../components/QRLWebView';
import WebViewService from '../../services/WebViewService';
import BiometricService from '../../services/BiometricService';
import { useIsFocused } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { usePathname, router } from 'expo-router';
import Colors from '../../constants/Colors';
import FontAwesome from '@expo/vector-icons/FontAwesome';

export default function WalletScreen() {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [lastFocusTime, setLastFocusTime] = useState(0);
  const isFocused = useIsFocused();
  const colorScheme = useColorScheme();
  const pathname = usePathname();
  const appState = useRef(AppState.currentState);
  const lastActiveUrl = useRef<string | undefined>(undefined);

  // Navigate to settings
  const navigateToSettings = () => {
    router.push('/settings');
  };

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
      <StatusBar barStyle="light-content" backgroundColor="#0A0A17" />
      {isAuthorized && (
        <>
          <QRLWebView />
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
