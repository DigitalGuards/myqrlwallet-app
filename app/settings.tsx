import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, Switch, View, Text, TouchableOpacity, ScrollView, Alert, Image, Linking } from 'react-native';
import WebViewService, { UserPreferences } from '../services/WebViewService';
import BiometricService from '../services/BiometricService';
import SeedStorageService from '../services/SeedStorageService';
import ScreenSecurityService from '../services/ScreenSecurityService';
import NativeBridge from '../services/NativeBridge';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Constants from 'expo-constants';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { ChangePinModal } from '../components/ChangePinModal';
import { PinEntryModal } from '../components/PinEntryModal';
import DAppConnectionStore from '../services/DAppConnectionStore';
import Logger from '../services/Logger';

export default function SettingsScreen() {
  const navigation = useNavigation();
  const [preferences, setPreferences] = useState<UserPreferences>({
    notificationsEnabled: true,
  });

  const [isDeviceLoginAvailable, setIsDeviceLoginAvailable] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);
  const [deviceLoginEnabled, setDeviceLoginEnabled] = useState(false);
  const [preventScreenshots, setPreventScreenshots] = useState(false);
  const [showChangePinModal, setShowChangePinModal] = useState(false);
  const [showDeviceLoginPinModal, setShowDeviceLoginPinModal] = useState(false);
  const [dappConnectionCount, setDappConnectionCount] = useState(0);
  const appVersion = Constants.expoConfig?.version || '1.0.0';

  // Load wallet status - called on mount and when screen gains focus
  const loadWalletStatus = useCallback(async () => {
    const walletExists = await SeedStorageService.hasWallet();
    setHasWallet(walletExists);

    const deviceLoginReady = await BiometricService.isDeviceLoginReady();
    setDeviceLoginEnabled(deviceLoginReady);

    const count = await DAppConnectionStore.activeCount();
    setDappConnectionCount(count);
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
      // Show PIN modal - user enters their wallet PIN to enable Device Login
      setShowDeviceLoginPinModal(true);
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

  // Handle Device Login PIN modal submission
  const handleDeviceLoginPinSubmit = (pin: string) => {
    setShowDeviceLoginPinModal(false);

    // Queue the setup request
    BiometricService.queueDeviceLoginSetup(pin);

    // Navigate back to index - WebView must be active for PIN verification
    // Index screen detects pending setup via BiometricService queue on focus
    router.back();
  };

  // Handle Device Login PIN modal cancel
  const handleDeviceLoginPinCancel = () => {
    setShowDeviceLoginPinModal(false);
    // Toggle stays OFF since we haven't enabled yet
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
                Logger.error('Settings', 'Failed to disable screenshot prevention:', error);
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
        Logger.error('Settings', 'Failed to enable screenshot prevention:', error);
        Alert.alert('Error', 'Could not enable screenshot prevention. Please try again.');
      }
    }
  };

  // Handle Change PIN button press
  const handleChangePinPress = async () => {
    // Require biometric authentication first
    const authResult = await BiometricService.authenticate('Authenticate to change PIN');
    if (!authResult.success) {
      // Auth cancelled or failed - don't show modal
      return;
    }
    // Show the Change PIN modal after successful auth
    setShowChangePinModal(true);
  };

  // Handle Change PIN modal submission
  // Queue the PIN change and navigate to WebView tab for execution
  // This is necessary because WebView JS execution is throttled when Settings tab is active
  const handleChangePinSubmit = (currentPin: string, newPin: string) => {
    setShowChangePinModal(false);

    // Queue the PIN change request
    BiometricService.queuePinChange(currentPin, newPin);

    // Navigate back to index - WebView must be active for PIN change to work
    // Index screen detects pending change via BiometricService queue on focus
    router.back();
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
                      Logger.error('Settings', 'Failed to remove wallet:', error);
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
    Linking.openURL(url).catch((err) => Logger.error('Settings', 'Failed to open link:', err));
  };

  // Add back button functionality to header
  useEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <FontAwesome name="arrow-left" size={16} color="#f8fafc" />
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
            trackColor={{ false: '#1e293b', true: '#f5a62366' }}
            thumbColor={preferences.notificationsEnabled ? '#f5a623' : '#64748b'}
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
              trackColor={{ false: '#1e293b', true: '#f5a62366' }}
              thumbColor={deviceLoginEnabled ? '#f5a623' : '#64748b'}
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
              trackColor={{ false: '#1e293b', true: '#f5a62366' }}
              thumbColor={preventScreenshots ? '#f5a623' : '#64748b'}
            />
          </View>
        )}

        {/* Change PIN Button - available when user has a wallet (PIN exists for seed encryption) */}
        {hasWallet && (
          <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={handleChangePinPress}>
            <FontAwesome name="lock" size={14} color="#f5a623" style={styles.buttonIcon} />
            <Text style={styles.buttonTextSecondary}>Change PIN</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* DApp Connections Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>DApp Connections</Text>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => router.push('/dapp-connections')}
        >
          <View style={styles.settingTextContainer}>
            <View style={styles.dappConnectionTitleContainer}>
              <FontAwesome name="plug" size={12} color="#4aafff" />
              <Text style={styles.settingTitle}>Connected dApps</Text>
              {dappConnectionCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{dappConnectionCount}</Text>
                </View>
              )}
            </View>
            <Text style={styles.settingDescription}>
              Manage your dApp connections and view history
            </Text>
          </View>
          <FontAwesome name="chevron-right" size={10} color="#64748b" />
        </TouchableOpacity>
      </View>

      {/* Wallet Management Section - only show if wallet exists */}
      {hasWallet && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Wallet</Text>

          {/* Remove Wallet Button */}
          <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={removeWallet}>
            <FontAwesome name="warning" size={14} color="#f87171" style={styles.buttonIcon} />
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
          <FontAwesome name="trash" size={14} color="#f87171" style={styles.buttonIcon} />
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
            source={require('../assets/images/myqrlwallet/mqrlwallet.png')}
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
            <FontAwesome name="globe" size={14} color="#f5a623" style={styles.buttonIcon} />
            <Text style={styles.linkText}>QRL Website</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => openLink('https://docs.theqrl.org')}
          >
            <FontAwesome name="book" size={14} color="#f5a623" style={styles.buttonIcon} />
            <Text style={styles.linkText}>Documentation</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => openLink('https://github.com/theqrl')}
          >
            <FontAwesome name="github" size={14} color="#f5a623" style={styles.buttonIcon} />
            <Text style={styles.linkText}>GitHub</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Change PIN Modal */}
      <ChangePinModal
        visible={showChangePinModal}
        onSubmit={handleChangePinSubmit}
        onCancel={() => setShowChangePinModal(false)}
      />

      {/* Device Login PIN Modal */}
      <PinEntryModal
        visible={showDeviceLoginPinModal}
        title="Enable Device Login"
        message="Enter your wallet PIN to enable Device Login"
        onSubmit={handleDeviceLoginPinSubmit}
        onCancel={handleDeviceLoginPinCancel}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  section: {
    marginBottom: 6,
    backgroundColor: '#0f172a',
    borderRadius: 8,
    marginHorizontal: 12,
    marginTop: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    borderLeftWidth: 3,
    borderLeftColor: '#4aafff',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    color: '#f5a623',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#1e293b',
  },
  settingTextContainer: {
    flex: 1,
    marginRight: 10,
  },
  settingTitle: {
    fontSize: 13,
    marginBottom: 2,
    color: '#f8fafc',
  },
  settingDescription: {
    fontSize: 11,
    color: '#94a3b8',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: 6,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  buttonIcon: {
    marginRight: 6,
  },
  buttonTextDanger: {
    color: '#f87171',
    fontSize: 13,
    fontWeight: '500',
  },
  dangerButton: {
    marginTop: 8,
    borderColor: '#f8717144',
    backgroundColor: '#f8717111',
  },
  secondaryButton: {
    marginTop: 8,
    borderColor: '#f5a62344',
    backgroundColor: '#f5a62311',
  },
  buttonTextSecondary: {
    color: '#f5a623',
    fontSize: 13,
    fontWeight: '500',
  },
  warningText: {
    fontSize: 10,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 4,
  },
  noWalletText: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
    fontStyle: 'italic',
    paddingVertical: 4,
  },
  helpText: {
    fontSize: 10,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 14,
  },
  // About section styles
  aboutHeader: {
    alignItems: 'center',
    marginBottom: 10,
  },
  logo: {
    width: 140,
    height: 38,
    marginBottom: 6,
  },
  version: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 4,
  },
  paragraph: {
    fontSize: 12,
    lineHeight: 17,
    color: '#94a3b8',
    marginBottom: 10,
    textAlign: 'center',
  },
  linksContainer: {
    marginTop: 4,
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#1e293b',
  },
  linkText: {
    fontSize: 13,
    color: '#f5a623',
  },
  dappConnectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badge: {
    backgroundColor: '#4aafff',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  backButton: {
    padding: 8,
  },
}); 
