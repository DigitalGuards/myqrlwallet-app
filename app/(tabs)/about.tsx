import React from 'react';
import { StyleSheet, Text, View, ScrollView, Image, Linking, TouchableOpacity, Platform } from 'react-native';
import Constants from 'expo-constants';
import FontAwesome from '@expo/vector-icons/FontAwesome';

export default function AboutScreen() {
  const appVersion = Constants.expoConfig?.version || '1.0.0';
  
  const openLink = (url: string) => {
    Linking.openURL(url).catch((err) => console.error('Failed to open link:', err));
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Image
          source={require('../../assets/images/icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>MyQRL Wallet</Text>
        <Text style={styles.version}>Version {appVersion}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About QRL</Text>
        <Text style={styles.paragraph}>
          The Quantum Resistant Ledger (QRL) is a blockchain technology designed to be secure against 
          quantum computing attacks. This app provides a mobile interface to access your QRL wallet.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Features</Text>
        <View style={styles.featureItem}>
          <FontAwesome name="lock" size={18} color="#5e35b1" style={styles.featureIcon} />
          <Text style={styles.featureText}>Secure WebView integration with qrlwallet.com</Text>
        </View>
        <View style={styles.featureItem}>
          <FontAwesome name="mobile" size={20} color="#5e35b1" style={styles.featureIcon} />
          <Text style={styles.featureText}>Native mobile experience for your QRL wallet</Text>
        </View>
        <View style={styles.featureItem}>
          <FontAwesome name="shield" size={18} color="#5e35b1" style={styles.featureIcon} />
          <Text style={styles.featureText}>Optional biometric authentication for enhanced security</Text>
        </View>
        <View style={styles.featureItem}>
          <FontAwesome name="refresh" size={18} color="#5e35b1" style={styles.featureIcon} />
          <Text style={styles.featureText}>Offline transaction capability</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Official Links</Text>
        <TouchableOpacity style={styles.linkItem} onPress={() => openLink('https://www.theqrl.org/')}>
          <FontAwesome name="globe" size={18} color="#5e35b1" style={styles.linkIcon} />
          <Text style={styles.linkText}>QRL Official Website</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkItem} onPress={() => openLink('https://qrlwallet.com')}>
          <FontAwesome name="laptop" size={18} color="#5e35b1" style={styles.linkIcon} />
          <Text style={styles.linkText}>QRL Web Wallet</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkItem} onPress={() => openLink('https://explorer.theqrl.org/')}>
          <FontAwesome name="search" size={18} color="#5e35b1" style={styles.linkIcon} />
          <Text style={styles.linkText}>QRL Block Explorer</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkItem} onPress={() => openLink('https://github.com/theQRL')}>
          <FontAwesome name="github" size={18} color="#5e35b1" style={styles.linkIcon} />
          <Text style={styles.linkText}>QRL GitHub</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Text style={styles.disclaimer}>
          This app is an unofficial mobile interface for the QRL wallet. It is not affiliated with or endorsed by the official QRL team.
        </Text>
        <Text style={styles.copyright}>© {new Date().getFullYear()} MyQRL Wallet</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f7f7',
  },
  header: {
    alignItems: 'center',
    paddingTop: 32,
    paddingBottom: 24,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  logo: {
    width: 100,
    height: 100,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#5e35b1',
  },
  version: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  section: {
    marginVertical: 16,
    marginHorizontal: 16,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#333',
  },
  paragraph: {
    fontSize: 15,
    lineHeight: 22,
    color: '#444',
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  featureIcon: {
    width: 24,
    textAlign: 'center',
    marginRight: 12,
  },
  featureText: {
    fontSize: 15,
    color: '#333',
    flex: 1,
  },
  linkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  linkIcon: {
    width: 24,
    textAlign: 'center',
    marginRight: 12,
  },
  linkText: {
    fontSize: 15,
    color: '#5e35b1',
  },
  footer: {
    marginTop: 8,
    marginBottom: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  disclaimer: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginBottom: 8,
  },
  copyright: {
    fontSize: 12,
    color: '#666',
  },
}); 