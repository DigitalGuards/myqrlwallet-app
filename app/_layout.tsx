import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { View } from 'react-native';
import * as Linking from 'expo-linking';

import ScreenSecurityService from '../services/ScreenSecurityService';
import DAppConnectionStore from '../services/DAppConnectionStore';
import SeedStorageService from '../services/SeedStorageService';
import NativeBridge from '../services/NativeBridge';
import Logger from '../services/Logger';

const APP_BACKGROUND = '#0f172a';
const APP_TEXT = '#f8fafc';
const APP_ACCENT = '#f5a623';
const HEADER_TITLE_STYLE = {
  fontWeight: 'bold' as const,
  fontSize: 16,
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (loaded) {
      (async () => {
        // Initialize screen security (screenshot prevention)
        try {
          await ScreenSecurityService.initialize();
        } catch (error) {
          Logger.error('RootLayout', 'Failed to initialize screen security:', error);
        }
        // Load dApp connection history (triggers 30-day cleanup)
        DAppConnectionStore.load().catch((err) => {
          Logger.error('RootLayout', 'Failed to load dApp connections:', err);
        });
        // One-shot: mirror the legacy-install keychain PIN into the
        // AsyncStorage existence marker so hasPinStored() never needs to hit
        // the keychain again. Safe to run at cold launch — foreground state.
        SeedStorageService.repairPinExistsMarker().catch((err) => {
          Logger.error('RootLayout', 'Failed pin_exists marker repair:', err);
        });
        // Hide splash only after security is initialized
        await SplashScreen.hideAsync();
      })();
    }
  }, [loaded]);

  // Listen for qrlconnect:// deep links and forward to WebView
  useEffect(() => {
    const handleDeepLink = (event: { url: string }) => {
      const { url } = event;
      if (url.startsWith('qrlconnect:')) {
        Logger.debug('RootLayout', 'qrlconnect deep link received:', url);
        // Wait for WebView to be ready, then forward the URI
        NativeBridge.waitForWebAppReady(10000)
          .then(() => {
            NativeBridge.sendDAppURI(url);
          })
          .catch((err) => {
            Logger.error('RootLayout', 'Failed to forward dApp URI:', err);
          });
      }
    };

    // Handle deep links that opened the app
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink({ url });
    });

    // Handle deep links while app is running
    const subscription = Linking.addEventListener('url', handleDeepLink);

    return () => {
      subscription.remove();
    };
  }, []);

  if (!loaded) {
    return null;
  }

  // Create custom dark theme based on QRL colors
  const customDarkTheme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      primary: APP_ACCENT, // QRL Orange
      background: APP_BACKGROUND, // Dark navy
      card: APP_BACKGROUND,
      text: APP_TEXT,
      border: APP_BACKGROUND,
    },
  };

  // We always use dark theme regardless of system setting
  const appTheme = customDarkTheme;

  return (
    <ThemeProvider value={appTheme}>
      <View style={{ flex: 1, backgroundColor: APP_BACKGROUND }}>
        <StatusBar style="light" backgroundColor={APP_BACKGROUND} />
        <Stack screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: APP_BACKGROUND
          }
        }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="settings"
            options={{
              headerShown: true,
              title: 'Settings',
              headerStyle: {
                backgroundColor: APP_BACKGROUND,
              },
              headerTintColor: APP_TEXT,
              headerTitleStyle: HEADER_TITLE_STYLE,
              headerTitleAlign: 'center',
              headerShadowVisible: false,
              gestureEnabled: true,
            }}
          />
          <Stack.Screen
            name="dapp-connections"
            options={{
              headerShown: true,
              title: 'DApp Connections',
              headerStyle: {
                backgroundColor: APP_BACKGROUND,
              },
              headerTintColor: APP_TEXT,
              headerTitleStyle: HEADER_TITLE_STYLE,
              headerTitleAlign: 'center',
              headerShadowVisible: false,
              gestureEnabled: true,
            }}
          />
          <Stack.Screen name="+not-found" />
        </Stack>
      </View>
    </ThemeProvider>
  );
}
