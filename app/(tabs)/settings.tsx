import React, { useEffect, useState } from 'react';
import { StyleSheet, Switch, View, Text, TouchableOpacity, ScrollView, Platform, Alert, Image, Linking } from 'react-native';
import WebViewService, { UserPreferences } from '../../services/WebViewService';
import BiometricService from '../../services/BiometricService';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Constants from 'expo-constants';
import { useNavigation } from '@react-navigation/native';
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
  const appVersion = Constants.expoConfig?.version || '1.0.0';

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
    }
    
    loadPreferences();
  }, []);

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

  // Clear all cached data
  const clearCache = async () => {
    Alert.alert(
      'Clear Cache',
      'This will clear all stored wallet data from the app. You will need to log in again. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Clear', 
          style: 'destructive',
          onPress: async () => {
            await WebViewService.clearSessionData();
            Alert.alert('Cache Cleared', 'All cached data has been cleared.');
          }
        }
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
            trackColor={{ false: '#767577', true: '#8561c5' }}
            thumbColor={preferences.autoLock ? '#5e35b1' : '#f4f3f4'}
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
              trackColor={{ false: '#767577', true: '#8561c5' }}
              thumbColor={preferences.biometricEnabled ? '#5e35b1' : '#f4f3f4'}
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
            trackColor={{ false: '#767577', true: '#8561c5' }}
            thumbColor={preferences.notificationsEnabled ? '#5e35b1' : '#f4f3f4'}
          />
        </View>
      </View>
      
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data</Text>
        
        {/* Clear Cache Button */}
        <TouchableOpacity style={styles.button} onPress={clearCache}>
          <FontAwesome name="trash" size={18} color="#d32f2f" style={styles.buttonIcon} />
          <Text style={styles.buttonTextDanger}>Clear Cache</Text>
        </TouchableOpacity>
      </View>

      {/* About Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        
        <View style={styles.aboutHeader}>
          <Image
            source={require('../../assets/images/icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.appTitle}>MyQRL Wallet</Text>
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
            <FontAwesome name="globe" size={18} color="#5e35b1" style={styles.buttonIcon} />
            <Text style={styles.linkText}>QRL Website</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.linkButton} 
            onPress={() => openLink('https://docs.theqrl.org')}
          >
            <FontAwesome name="book" size={18} color="#5e35b1" style={styles.buttonIcon} />
            <Text style={styles.linkText}>Documentation</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.linkButton} 
            onPress={() => openLink('https://github.com/theqrl')}
          >
            <FontAwesome name="github" size={18} color="#5e35b1" style={styles.buttonIcon} />
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
    backgroundColor: '#f7f7f7',
  },
  section: {
    marginBottom: 24,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#5e35b1',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e0e0e0',
  },
  settingTextContainer: {
    flex: 1,
    marginRight: 16,
  },
  settingTitle: {
    fontSize: 16,
    marginBottom: 4,
    color: '#333',
  },
  settingDescription: {
    fontSize: 14,
    color: '#666',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 4,
    backgroundColor: '#f8f8f8',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  buttonIcon: {
    marginRight: 8,
  },
  buttonTextDanger: {
    color: '#d32f2f',
    fontSize: 16,
    fontWeight: '500',
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
    color: '#333',
    marginBottom: 5,
  },
  version: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
  },
  paragraph: {
    fontSize: 14,
    lineHeight: 22,
    color: '#444',
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
    borderBottomColor: '#e0e0e0',
  },
  linkText: {
    fontSize: 16,
    color: '#5e35b1',
  },
  backButton: {
    padding: 10,
  },
}); 