import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, Switch, View, Text, TouchableOpacity, ScrollView, Alert, Image, Linking } from 'react-native';
import WebViewService, { UserPreferences } from '../../services/WebViewService';
import BiometricService from '../../services/BiometricService';
import SeedStorageService from '../../services/SeedStorageService';
import ScreenSecurityService from '../../services/ScreenSecurityService';
import NativeBridge from '../../services/NativeBridge';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Constants from 'expo-constants';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';

export default function SettingsScreen() {
  const navigation = useNavigation();
  const [preferences, setPreferences] = useState<UserPreferences>({
    notificationsEnabled: true,
  });

  const [isDeviceLoginAvailable, setIsDeviceLoginAvailable] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);
  const [deviceLoginEnabled, setDeviceLoginEnabled] = useState(false);
  const [preventScreenshots, setPreventScreenshots] = useState(false);
  const appVersion = Constants.expoConfig?.version || '1.0.0';

  // Load wallet status - called on mount and when screen gains focus
  const loadWalletStatus = useCallback(async () => {
    const walletExists = await SeedStorageService.hasWallet();
    setHasWallet(walletExists);

    const deviceLoginReady = await BiometricService.isDeviceLoginReady();
    setDeviceLoginEnabled(deviceLoginReady);
  }, []);

  // Refresh wallet status when screen gains focus
  useFocusEffect(
    useCallback(() => {
      loadWalletStatus();
    }, [loadWalletStatus])
  );

  // Load user preferences on component mount
  useEffect(() => {
    async function loadPreferences() {
      const storedPreferences = await WebViewService.getUserPreferences();
      setPreferences(storedPreferences);

      // Check device login availability
      const deviceLoginAvailable = await BiometricService.isBiometricAvailable();
      setIsDeviceLoginAvailable(deviceLoginAvailable);

      // Load screenshot prevention setting
      const screenshotPrevention = await ScreenSecurityService.isEnabled();
      setPreventScreenshots(screenshotPrevention);

      // Initial wallet status check
      await loadWalletStatus();
    }

    loadPreferences();
  }, [loadWalletStatus]);

  // Save preferences when they change
  const updatePreference = async (key: keyof UserPreferences, value: boolean) => {
    const updatedPreferences = { ...preferences, [key]: value };
    setPreferences(updatedPreferences);
    await WebViewService.saveUserPreferences(updatedPreferences);
  };

  // Handle Device Login toggle
  const handleDeviceLoginToggle = async (newValue: boolean) => {
    if (newValue) {
      // Navigate to main tab with intent to enable Device Login
      // WebView must be active for PIN verification to work
      router.replace('/?enableDeviceLogin=true');
    } else {
      // Disable Device Login - require device auth first
      const authResult = await BiometricService.authenticate('Authenticate to disable Device Login');
      if (!authResult.success) {
        // Auth cancelled or failed - don't disable
        return;
      }
      await BiometricService.disableDeviceLogin();
      setDeviceLoginEnabled(false);
      Alert.alert('Disabled', 'Device Login has been disabled.');
    }
  };

  // Handle Screenshot Prevention toggle
  const handleScreenshotPreventionToggle = async (newValue: boolean) => {
    if (!newValue) {
      // Warn user about security risk when disabling
      Alert.alert(
        'Security Warning',
        'Disabling screenshot prevention allows screenshots and screen recordings of your wallet. This could expose sensitive information like your balance and addresses.\n\nAre you sure you want to disable this?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disable Anyway',
            style: 'destructive',
            onPress: async () => {
              try {
                await ScreenSecurityService.setEnabled(false);
                setPreventScreenshots(false);
              } catch (error) {
                console.error('Failed to disable screenshot prevention:', error);
                Alert.alert('Error', 'Could not disable screenshot prevention. Please try again.');
              }
            },
          },
        ]
      );
    } else {
      try {
        await ScreenSecurityService.setEnabled(true);
        setPreventScreenshots(true);
      } catch (error) {
        console.error('Failed to enable screenshot prevention:', error);
        Alert.alert('Error', 'Could not enable screenshot prevention. Please try again.');
      }
    }
  };

  // Remove wallet - clears all wallet data from native storage
  const removeWallet = async () => {
    // If Device Login is enabled, require authentication first
    if (deviceLoginEnabled) {
      const authResult = await BiometricService.authenticate('Authenticate to remove wallet');
      if (!authResult.success) {
        // Auth cancelled or failed - don't proceed
        return;
      }
    }

    Alert.alert(
      'Remove All Wallets',
      'This will permanently delete ALL imported wallets from this device. Device Login will be disabled and you will need to re-import each wallet to access them again.\n\nMake sure you have backed up your seed phrases before continuing!',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove All',
          style: 'destructive',
          onPress: async () => {
            // Second confirmation
            Alert.alert(
              'Delete All Wallets?',
              'ALL wallet data will be permanently removed. This action cannot be undone.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Yes, Delete All',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      // Clear native storage
                      await SeedStorageService.clearWallet();

                      // Tell web app to clear its data and wait for confirmation
                      const clearConfirmed = await new Promise<boolean>((resolve) => {
                        // Set up timeout in case web app doesn't respond
                        const timeout = setTimeout(() => {
                          NativeBridge.offWalletCleared();
                          resolve(false);
                        }, 3000);

                        // Listen for confirmation from web app
                        NativeBridge.onWalletCleared(() => {
                          clearTimeout(timeout);
                          NativeBridge.offWalletCleared();
                          resolve(true);
                        });

                        // Send the clear request
                        NativeBridge.sendClearWallet();
                      });

                      // Update state
                      setHasWallet(false);
                      setDeviceLoginEnabled(false);

                      if (clearConfirmed) {
                        Alert.alert('Wallet Removed', 'Your wallet has been removed from this device.');
                      } else {
                        Alert.alert('Wallet Removed', 'Your wallet has been removed. Web data may need manual clearing.');
                      }
                    } catch (error) {
                      console.error('[Settings] Failed to remove wallet:', error);
                      Alert.alert(
                        'Error',
                        'Failed to remove wallet. Please try again.',
                        [{ text: 'OK' }]
                      );
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  // Clear session data (not wallet seeds)
  const clearCache = async () => {
    Alert.alert(
      'Clear Session',
      'This will clear your current session and log you out. You will need to log in again. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await WebViewService.clearSessionData();
            Alert.alert('Session Cleared', 'Your session has been cleared.');
          },
        },
      ]
    );
  };

  // Open external links
  const openLink = (url: string) => {
    Linking.openURL(url).catch((err) => console.error('Failed to open link:', err));
  };

  // Add back button functionality to header
  useEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <FontAwesome name="arrow-left" size={20} color="#fff" />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  return (
    <ScrollView style={styles.container}>
      {/* General Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>General</Text>

        {/* Notifications */}
        <View style={styles.settingRow}>
          <View style={styles.settingTextContainer}>
            <Text style={styles.settingTitle}>Notifications</Text>
            <Text style={styles.settingDescription}>Receive notifications about transactions and updates</Text>
          </View>
          <Switch
            value={preferences.notificationsEnabled}
            onValueChange={(value) => updatePreference('notificationsEnabled', value)}
            trackColor={{ false: '#3a3a4a', true: '#ff870066' }}
            thumbColor={preferences.notificationsEnabled ? '#ff8700' : '#888'}
          />
        </View>
      </View>

      {/* Security Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Security</Text>

        {/* Show message when no wallet exists */}
        {!hasWallet && (
          <Text style={styles.noWalletText}>
            Import or create a wallet to access security settings
          </Text>
        )}

        {/* Device Login Toggle - only show if wallet exists and biometrics available */}
        {hasWallet && isDeviceLoginAvailable && (
          <View style={styles.settingRow}>
            <View style={styles.settingTextContainer}>
              <Text style={styles.settingTitle}>Device Login</Text>
              <Text style={styles.settingDescription}>
                Use Device Login to unlock your wallet automatically
              </Text>
            </View>
            <Switch
              value={deviceLoginEnabled}
              onValueChange={handleDeviceLoginToggle}
              trackColor={{ false: '#3a3a4a', true: '#ff870066' }}
              thumbColor={deviceLoginEnabled ? '#ff8700' : '#888'}
            />
          </View>
        )}

        {/* Screenshot Prevention Toggle - only show if wallet exists */}
        {hasWallet && (
          <View style={styles.settingRow}>
            <View style={styles.settingTextContainer}>
              <Text style={styles.settingTitle}>Prevent Screenshots</Text>
              <Text style={styles.settingDescription}>
                Block screen capture and recording for security
              </Text>
            </View>
            <Switch
              value={preventScreenshots}
              onValueChange={handleScreenshotPreventionToggle}
              trackColor={{ false: '#3a3a4a', true: '#ff870066' }}
              thumbColor={preventScreenshots ? '#ff8700' : '#888'}
            />
          </View>
        )}
      </View>

      {/* Wallet Management Section - only show if wallet exists */}
      {hasWallet && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Wallet</Text>

          {/* Remove Wallet Button */}
          <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={removeWallet}>
            <FontAwesome name="warning" size={18} color="#ff6b6b" style={styles.buttonIcon} />
            <Text style={styles.buttonTextDanger}>Remove All Wallets</Text>
          </TouchableOpacity>
          <Text style={styles.warningText}>
            This will permanently delete ALL wallets and disable Device Login.
          </Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data</Text>

        {/* Clear Session Button */}
        <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={clearCache}>
          <FontAwesome name="trash" size={18} color="#ff6b6b" style={styles.buttonIcon} />
          <Text style={styles.buttonTextDanger}>Clear Session</Text>
        </TouchableOpacity>
        <Text style={styles.helpText}>
          Use this if you experience display issues or want to refresh the app state. Your wallet and Device Login settings will not be affected.
        </Text>
      </View>

      {/* About Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        
        <View style={styles.aboutHeader}>
          <Image
            source={require('../../assets/images/myqrlwallet/mqrlwallet.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.version}>Version {appVersion}</Text>
        </View>
        
        <Text style={styles.paragraph}>
          The Quantum Resistant Ledger (QRL) is a blockchain technology designed to be secure against 
          quantum computing attacks. This app provides a mobile interface to access your QRL wallet.
        </Text>
        
        <View style={styles.linksContainer}>
          <TouchableOpacity 
            style={styles.linkButton} 
            onPress={() => openLink('https://theqrl.org')}
          >
            <FontAwesome name="globe" size={18} color="#ff8700" style={styles.buttonIcon} />
            <Text style={styles.linkText}>QRL Website</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.linkButton} 
            onPress={() => openLink('https://docs.theqrl.org')}
          >
            <FontAwesome name="book" size={18} color="#ff8700" style={styles.buttonIcon} />
            <Text style={styles.linkText}>Documentation</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.linkButton} 
            onPress={() => openLink('https://github.com/theqrl')}
          >
            <FontAwesome name="github" size={18} color="#ff8700" style={styles.buttonIcon} />
            <Text style={styles.linkText}>GitHub</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A17',
  },
  section: {
    marginBottom: 24,
    backgroundColor: '#16161a',
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a3a',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 16,
    color: '#ff8700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#2a2a3a',
  },
  settingTextContainer: {
    flex: 1,
    marginRight: 16,
  },
  settingTitle: {
    fontSize: 16,
    marginBottom: 4,
    color: '#f8fafc',
  },
  settingDescription: {
    fontSize: 14,
    color: '#888',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#1e1e2e',
    borderWidth: 1,
    borderColor: '#2a2a3a',
  },
  buttonIcon: {
    marginRight: 8,
  },
  buttonTextDanger: {
    color: '#ff6b6b',
    fontSize: 16,
    fontWeight: '500',
  },
  dangerButton: {
    marginTop: 16,
    borderColor: '#ff6b6b44',
    backgroundColor: '#ff6b6b11',
  },
  warningText: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
  },
  noWalletText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  helpText: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 18,
  },
  // About section styles
  aboutHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logo: {
    width: 200,
    height: 56,
    marginBottom: 10,
  },
  version: {
    fontSize: 14,
    color: '#888',
    marginBottom: 10,
  },
  paragraph: {
    fontSize: 14,
    lineHeight: 22,
    color: '#a0a0a0',
    marginBottom: 20,
    textAlign: 'center',
  },
  linksContainer: {
    marginTop: 10,
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#2a2a3a',
  },
  linkText: {
    fontSize: 16,
    color: '#ff8700',
  },
  backButton: {
    padding: 10,
  },
}); 