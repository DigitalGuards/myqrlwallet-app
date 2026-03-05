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
import NativeBridge from '../services/NativeBridge';
import Logger from '../services/Logger';

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
      primary: '#ff8700', // QRL Orange
      background: '#0A0A17', // Dark navy
      card: '#0A0A17',
      text: '#FFFFFF',
      border: '#0A0A17',
    },
  };

  // We always use dark theme regardless of system setting
  const appTheme = customDarkTheme;

  return (
    <ThemeProvider value={appTheme}>
      <View style={{ flex: 1, backgroundColor: '#0A0A17' }}>
        <StatusBar style="light" backgroundColor="#0A0A17" />
        <Stack screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: '#0A0A17'
          }
        }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="settings"
            options={{
              headerShown: true,
              title: 'Settings',
              headerStyle: {
                backgroundColor: '#0A0A17',
              },
              headerTintColor: '#fff',
              headerTitleStyle: {
                fontWeight: 'bold',
                fontSize: 18,
              },
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
