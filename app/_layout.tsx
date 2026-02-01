import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { View } from 'react-native';

import ScreenSecurityService from '../services/ScreenSecurityService';
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
