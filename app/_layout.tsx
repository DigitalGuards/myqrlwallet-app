import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { View } from 'react-native';

import { useColorScheme } from '@/hooks/useColorScheme';
import ScreenSecurityService from '../services/ScreenSecurityService';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (loaded) {
      // Initialize screen security (screenshot prevention)
      (async () => {
        try {
          await ScreenSecurityService.initialize();
        } catch (error) {
          console.error('Failed to initialize screen security:', error);
        }
      })();
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  // Create custom theme based on our Colors
  const customLightTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      primary: '#ff8700', // QRL Orange
      background: '#0A0A17', // Dark navy
      card: '#0A0A17',
      text: '#FFFFFF',
      border: '#0A0A17',
    },
  };

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
          <Stack.Screen name="+not-found" />
        </Stack>
      </View>
    </ThemeProvider>
  );
}
