import React, { useEffect, useLayoutEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  Switch,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  Image,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';

import WebViewService, { UserPreferences } from '../services/WebViewService';
import BiometricService from '../services/BiometricService';
import SeedStorageService from '../services/SeedStorageService';
import ScreenSecurityService from '../services/ScreenSecurityService';
import NativeBridge from '../services/NativeBridge';
import { ChangePinModal } from '../components/ChangePinModal';
import { PinEntryModal } from '../components/PinEntryModal';
import DAppConnectionStore from '../services/DAppConnectionStore';
import Logger from '../services/Logger';

// Visual tokens — kept local to this screen per user scope.
const C = {
  bg: '#0f172a',
  card: '#1e293b',
  cardPressed: '#273548',
  divider: '#334155',
  textPrimary: '#f8fafc',
  textSecondary: '#94a3b8',
  textTertiary: '#64748b',
  chevron: '#64748b',
  brandOrange: '#ff8700',
  pinOrange: '#ff9500',
  blue: '#3b82f6',
  purple: '#a855f7',
  teal: '#06b6d4',
  green: '#22c55e',
  red: '#ef4444',
  gray: '#64748b',
  github: '#6e7681',
};

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

type RowProps = {
  icon: IoniconName;
  tint: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  destructive?: boolean;
};

function Row({ icon, tint, title, subtitle, right, onPress, destructive }: RowProps) {
  const content = (
    <View style={styles.row}>
      <View style={[styles.tile, { backgroundColor: tint }]}>
        <Ionicons name={icon} size={18} color="#ffffff" />
      </View>
      <View style={styles.rowText}>
        <Text
          style={[styles.rowTitle, destructive && { color: C.red }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right !== undefined ? (
        <View style={styles.rowRight}>{right}</View>
      ) : onPress ? (
        <Ionicons name="chevron-forward" size={18} color={C.chevron} />
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.6} onPress={onPress}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  if (items.length === 0) return null;
  return (
    <View style={styles.sectionWrap}>
      <Text style={styles.sectionLabel}>{title}</Text>
      <View style={styles.card}>
        {items.map((child, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <View style={styles.divider} /> : null}
            {child}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

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

  // Hide the stack header so we can render an iOS large-title inline.
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const loadWalletStatus = useCallback(async () => {
    const walletExists = await SeedStorageService.hasWallet();
    setHasWallet(walletExists);

    const deviceLoginReady = await BiometricService.isDeviceLoginReady();
    setDeviceLoginEnabled(deviceLoginReady);

    const count = await DAppConnectionStore.activeCount();
    setDappConnectionCount(count);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadWalletStatus();
    }, [loadWalletStatus])
  );

  useEffect(() => {
    async function loadPreferences() {
      const storedPreferences = await WebViewService.getUserPreferences();
      setPreferences(storedPreferences);

      const deviceLoginAvailable = await BiometricService.isBiometricAvailable();
      setIsDeviceLoginAvailable(deviceLoginAvailable);

      const screenshotPrevention = await ScreenSecurityService.isEnabled();
      setPreventScreenshots(screenshotPrevention);

      await loadWalletStatus();
    }

    loadPreferences();
  }, [loadWalletStatus]);

  const updatePreference = async (key: keyof UserPreferences, value: boolean) => {
    const updatedPreferences = { ...preferences, [key]: value };
    setPreferences(updatedPreferences);
    await WebViewService.saveUserPreferences(updatedPreferences);
  };

  const handleDeviceLoginToggle = async (newValue: boolean) => {
    if (newValue) {
      setShowDeviceLoginPinModal(true);
    } else {
      const authResult = await BiometricService.authenticate('Authenticate to disable Device Login');
      if (!authResult.success) return;
      await BiometricService.disableDeviceLogin();
      setDeviceLoginEnabled(false);
      Alert.alert('Disabled', 'Device Login has been disabled.');
    }
  };

  const handleDeviceLoginPinSubmit = (pin: string) => {
    setShowDeviceLoginPinModal(false);
    BiometricService.queueDeviceLoginSetup(pin);
    router.back();
  };

  const handleDeviceLoginPinCancel = () => {
    setShowDeviceLoginPinModal(false);
  };

  const handleScreenshotPreventionToggle = async (newValue: boolean) => {
    if (!newValue) {
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

  const handleChangePinPress = async () => {
    const authResult = await BiometricService.authenticate('Authenticate to change PIN');
    if (!authResult.success) return;
    setShowChangePinModal(true);
  };

  const handleChangePinSubmit = (currentPin: string, newPin: string) => {
    setShowChangePinModal(false);
    BiometricService.queuePinChange(currentPin, newPin);
    router.back();
  };

  const removeWallet = async () => {
    if (deviceLoginEnabled) {
      const authResult = await BiometricService.authenticate('Authenticate to remove wallet');
      if (!authResult.success) return;
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
                      await SeedStorageService.clearWallet();

                      const clearConfirmed = await new Promise<boolean>((resolve) => {
                        const timeout = setTimeout(() => {
                          NativeBridge.offWalletCleared();
                          resolve(false);
                        }, 3000);

                        NativeBridge.onWalletCleared(() => {
                          clearTimeout(timeout);
                          NativeBridge.offWalletCleared();
                          resolve(true);
                        });

                        NativeBridge.sendClearWallet();
                      });

                      setHasWallet(false);
                      setDeviceLoginEnabled(false);

                      if (clearConfirmed) {
                        Alert.alert('Wallet Removed', 'Your wallet has been removed from this device.');
                      } else {
                        Alert.alert(
                          'Wallet Removed',
                          'Your wallet has been removed. Web data may need manual clearing.'
                        );
                      }
                    } catch (error) {
                      Logger.error('Settings', 'Failed to remove wallet:', error);
                      Alert.alert('Error', 'Failed to remove wallet. Please try again.', [{ text: 'OK' }]);
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

  const openLink = (url: string) => {
    Linking.openURL(url).catch((err) => Logger.error('Settings', 'Failed to open link:', err));
  };

  const switchTrack = { false: C.divider, true: `${C.brandOrange}66` };
  const switchThumb = (on: boolean) => (on ? C.brandOrange : '#94a3b8');

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={28} color={C.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* General */}
        <Section title="General">
          <Row
            icon="notifications"
            tint={C.red}
            title="Notifications"
            subtitle="Transaction alerts and app updates"
            right={
              <Switch
                value={preferences.notificationsEnabled ?? true}
                onValueChange={(value) => updatePreference('notificationsEnabled', value)}
                trackColor={switchTrack}
                thumbColor={switchThumb(preferences.notificationsEnabled ?? true)}
                ios_backgroundColor={C.divider}
              />
            }
          />
        </Section>

        {/* Security */}
        <Section title="Security">
          {!hasWallet && (
            <Row
              icon="lock-closed-outline"
              tint={C.gray}
              title="Security options"
              subtitle="Import or create a wallet to access security settings"
            />
          )}
          {hasWallet && isDeviceLoginAvailable && (
            <Row
              icon="finger-print"
              tint={C.blue}
              title="Device Login"
              subtitle="Unlock with Face ID, Touch ID, or passcode"
              right={
                <Switch
                  value={deviceLoginEnabled}
                  onValueChange={handleDeviceLoginToggle}
                  trackColor={switchTrack}
                  thumbColor={switchThumb(deviceLoginEnabled)}
                  ios_backgroundColor={C.divider}
                />
              }
            />
          )}
          {hasWallet && (
            <Row
              icon="eye-off"
              tint={C.purple}
              title="Prevent Screenshots"
              subtitle="Block screen capture and recording"
              right={
                <Switch
                  value={preventScreenshots}
                  onValueChange={handleScreenshotPreventionToggle}
                  trackColor={switchTrack}
                  thumbColor={switchThumb(preventScreenshots)}
                  ios_backgroundColor={C.divider}
                />
              }
            />
          )}
          {hasWallet && (
            <Row
              icon="keypad"
              tint={C.pinOrange}
              title="Change PIN"
              subtitle="Update the PIN that encrypts your seed"
              onPress={handleChangePinPress}
            />
          )}
        </Section>

        {/* Connections */}
        <Section title="Connections">
          <Row
            icon="apps"
            tint={C.teal}
            title="Connected dApps"
            subtitle="Manage connections and view history"
            onPress={() => router.push('/dapp-connections')}
            right={
              <View style={styles.rowRightInline}>
                {dappConnectionCount > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{dappConnectionCount}</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={18} color={C.chevron} />
              </View>
            }
          />
        </Section>

        {/* Data */}
        <Section title="Data">
          <Row
            icon="refresh"
            tint={C.gray}
            title="Clear Session"
            subtitle="Log out and refresh app state"
            onPress={clearCache}
          />
        </Section>

        {/* Wallet danger zone */}
        {hasWallet && (
          <Section title="Wallet">
            <Row
              icon="trash"
              tint={C.red}
              title="Remove All Wallets"
              subtitle="Permanently delete all wallets from this device"
              onPress={removeWallet}
              destructive
            />
          </Section>
        )}

        {/* About */}
        <View style={styles.aboutHeader}>
          <Image
            source={require('../assets/images/myqrlwallet/mqrlwallet.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.version}>Version {appVersion}</Text>
          <Text style={styles.aboutParagraph}>
            The Quantum Resistant Ledger (QRL) is a blockchain designed to be secure against
            quantum computing attacks.
          </Text>
        </View>

        <Section title="About">
          <Row
            icon="globe"
            tint={C.brandOrange}
            title="QRL Website"
            onPress={() => openLink('https://theqrl.org')}
          />
          <Row
            icon="book"
            tint={C.blue}
            title="Documentation"
            onPress={() => openLink('https://docs.theqrl.org')}
          />
          <Row
            icon="logo-github"
            tint={C.github}
            title="GitHub"
            onPress={() => openLink('https://github.com/theqrl')}
          />
        </Section>

        <View style={styles.footer} />
      </ScrollView>

      <ChangePinModal
        visible={showChangePinModal}
        onSubmit={handleChangePinSubmit}
        onCancel={() => setShowChangePinModal(false)}
      />

      <PinEntryModal
        visible={showDeviceLoginPinModal}
        title="Enable Device Login"
        message="Enter your wallet PIN to enable Device Login"
        onSubmit={handleDeviceLoginPinSubmit}
        onCancel={handleDeviceLoginPinCancel}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginLeft: -6,
    marginBottom: 4,
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    color: C.textPrimary,
    letterSpacing: 0.4,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 12,
    paddingBottom: 32,
  },
  sectionWrap: {
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textSecondary,
    marginBottom: 10,
    marginLeft: 4,
  },
  card: {
    backgroundColor: C.card,
    borderRadius: 14,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 60,
  },
  tile: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  rowText: {
    flex: 1,
    justifyContent: 'center',
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: C.textPrimary,
  },
  rowSubtitle: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
  rowRight: {
    marginLeft: 10,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  rowRightInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.divider,
    marginLeft: 60,
  },
  badge: {
    backgroundColor: C.brandOrange,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  aboutHeader: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 20,
    paddingTop: 4,
  },
  logo: {
    width: 150,
    height: 40,
    marginBottom: 8,
  },
  version: {
    fontSize: 13,
    color: C.textSecondary,
    marginBottom: 12,
  },
  aboutParagraph: {
    fontSize: 13,
    lineHeight: 18,
    color: C.textTertiary,
    textAlign: 'center',
  },
  footer: {
    height: 24,
  },
});
