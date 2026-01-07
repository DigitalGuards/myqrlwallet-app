import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, Switch, View, Text, TouchableOpacity, ScrollView, Platform, Alert, Image, Linking } from 'react-native';
import WebViewService, { UserPreferences } from '../../services/WebViewService';
import BiometricService from '../../services/BiometricService';
import SeedStorageService from '../../services/SeedStorageService';
import NativeBridge from '../../services/NativeBridge';
import PinEntryModal from '../../components/PinEntryModal';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Constants from 'expo-constants';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';

export default function SettingsScreen() {
  const navigation = useNavigation();
  const [preferences, setPreferences] = useState<UserPreferences>({
    autoLock: true,
    lockTimeoutMinutes: 5,
    biometricEnabled: false,
    notificationsEnabled: true,
  });
  
  const [isBiometricAvailable, setIsBiometricAvailable] = useState(false);
  const [biometricType, setBiometricType] = useState<string[]>([]);
  const [hasWallet, setHasWallet] = useState(false);
  const [biometricUnlockEnabled, setBiometricUnlockEnabled] = useState(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const appVersion = Constants.expoConfig?.version || '1.0.0';

  // Load wallet status - called on mount and when screen gains focus
  const loadWalletStatus = useCallback(async () => {
    const walletExists = await SeedStorageService.hasWallet();
    setHasWallet(walletExists);

    const biometricReady = await BiometricService.isBiometricUnlockReady();
    setBiometricUnlockEnabled(biometricReady);
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

      // Check biometric availability
      const biometricAvailable = await BiometricService.isBiometricAvailable();
      setIsBiometricAvailable(biometricAvailable);

      if (biometricAvailable) {
        const types = await BiometricService.getAvailableBiometricTypes();
        setBiometricType(types);
      }

      // Initial wallet status check
      await loadWalletStatus();
    }

    loadPreferences();
  }, [loadWalletStatus]);

  // Save preferences when they change
  const updatePreference = async (key: keyof UserPreferences, value: any) => {
    const updatedPreferences = { ...preferences, [key]: value };
    setPreferences(updatedPreferences);
    await WebViewService.saveUserPreferences(updatedPreferences);
  };

  // Handle biometric toggle with authentication test
  const handleBiometricToggle = async (newValue: boolean) => {
    if (newValue === true) {
      // Test authentication before enabling
      const authResult = await BiometricService.authenticate(
        'Authenticate to enable biometric login'
      );
      
      if (authResult.success) {
        updatePreference('biometricEnabled', true);
      } else {
        Alert.alert(
          'Authentication Failed',
          'Unable to verify biometric authentication. Biometric login not enabled.',
          [{ text: 'OK' }]
        );
      }
    } else {
      updatePreference('biometricEnabled', false);
    }
  };

  // Handle PIN modal submission for biometric unlock setup
  const handlePinSubmit = useCallback(async (pin: string) => {
    setPinModalVisible(false);
    const result = await BiometricService.setupBiometricUnlock(pin);
    if (result.success) {
      setBiometricUnlockEnabled(true);
      Alert.alert('Success', 'Biometric unlock enabled!');
    } else {
      Alert.alert('Error', result.error || 'Failed to enable biometric unlock');
    }
  }, []);

  // Handle PIN modal cancel
  const handlePinCancel = useCallback(() => {
    setPinModalVisible(false);
  }, []);

  // Handle biometric unlock toggle
  const handleBiometricUnlockToggle = async (newValue: boolean) => {
    if (newValue) {
      // Enable biometric unlock - show secure PIN modal
      setPinModalVisible(true);
    } else {
      // Disable biometric unlock
      await BiometricService.disableBiometricUnlock();
      setBiometricUnlockEnabled(false);
      Alert.alert('Disabled', 'Biometric unlock has been disabled.');
    }
  };

  // Remove wallet - clears all wallet data from native storage
  const removeWallet = async () => {
    Alert.alert(
      'Remove Wallet',
      'This will permanently delete your wallet data from this device. Your seed phrase will be removed and you will need to re-import it to access your wallet again.\n\nMake sure you have backed up your seed phrase before continuing!',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove Wallet',
          style: 'destructive',
          onPress: async () => {
            // Second confirmation
            Alert.alert(
              'Are you sure?',
              'This action cannot be undone. Your wallet will be completely removed from this device.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Yes, Remove',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      // Clear native storage
                      await SeedStorageService.clearWallet();

                      // Tell web app to clear its data
                      NativeBridge.sendClearWallet();

                      // Update state
                      setHasWallet(false);
                      setBiometricUnlockEnabled(false);

                      // Wait a moment for the WebView to process the clear message
                      // before navigating back
                      setTimeout(() => {
                        Alert.alert('Wallet Removed', 'Your wallet has been removed from this device.');
                        router.back();
                      }, 500);
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
    <>
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Security</Text>
        
        {/* Auto Lock Setting */}
        <View style={styles.settingRow}>
          <View style={styles.settingTextContainer}>
            <Text style={styles.settingTitle}>Auto-lock App</Text>
            <Text style={styles.settingDescription}>Automatically lock the app after a period of inactivity</Text>
          </View>
          <Switch
            value={preferences.autoLock}
            onValueChange={(value) => updatePreference('autoLock', value)}
            trackColor={{ false: '#3a3a4a', true: '#ff870066' }}
            thumbColor={preferences.autoLock ? '#ff8700' : '#888'}
          />
        </View>
        
        {/* Biometric Authentication */}
        {isBiometricAvailable && (
          <View style={styles.settingRow}>
            <View style={styles.settingTextContainer}>
              <Text style={styles.settingTitle}>{BiometricService.getBiometricName()}</Text>
              <Text style={styles.settingDescription}>
                Use {biometricType.includes('facial') ? 'Face Recognition' : 'Fingerprint'} to unlock the app
              </Text>
            </View>
            <Switch
              value={preferences.biometricEnabled}
              onValueChange={handleBiometricToggle}
              trackColor={{ false: '#3a3a4a', true: '#ff870066' }}
              thumbColor={preferences.biometricEnabled ? '#ff8700' : '#888'}
            />
          </View>
        )}
        
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
      
      {/* Wallet Management Section - only show if wallet exists */}
      {hasWallet && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Wallet</Text>

          {/* Biometric Unlock Toggle */}
          {isBiometricAvailable && (
            <View style={styles.settingRow}>
              <View style={styles.settingTextContainer}>
                <Text style={styles.settingTitle}>Biometric Unlock</Text>
                <Text style={styles.settingDescription}>
                  Use {BiometricService.getBiometricName()} to unlock your wallet automatically
                </Text>
              </View>
              <Switch
                value={biometricUnlockEnabled}
                onValueChange={handleBiometricUnlockToggle}
                trackColor={{ false: '#3a3a4a', true: '#ff870066' }}
                thumbColor={biometricUnlockEnabled ? '#ff8700' : '#888'}
              />
            </View>
          )}

          {/* Remove Wallet Button */}
          <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={removeWallet}>
            <FontAwesome name="warning" size={18} color="#ff6b6b" style={styles.buttonIcon} />
            <Text style={styles.buttonTextDanger}>Remove Wallet</Text>
          </TouchableOpacity>
          <Text style={styles.warningText}>
            This will permanently delete your wallet data from this device.
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
      </View>

      {/* About Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        
        <View style={styles.aboutHeader}>
          <Image
            source={require('../../assets/images/myqrlwallet/icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.appTitle}>MyQRLWallet</Text>
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
    <PinEntryModal
      visible={pinModalVisible}
      title="Enter Your PIN"
      message="Enter your wallet PIN to enable biometric unlock"
      onSubmit={handlePinSubmit}
      onCancel={handlePinCancel}
    />
    </>
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
  // About section styles
  aboutHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logo: {
    width: 80,
    height: 80,
    marginBottom: 10,
  },
  appTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#f8fafc',
    marginBottom: 5,
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