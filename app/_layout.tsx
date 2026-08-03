import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import 'react-native-reanimated';
import { View, InteractionManager, Platform, Settings } from 'react-native';
import * as Linking from 'expo-linking';

import ScreenSecurityService from '../services/ScreenSecurityService';
import DAppConnectionStore from '../services/DAppConnectionStore';
import SeedStorageService from '../services/SeedStorageService';
import NativeBridge from '../services/NativeBridge';
import Logger from '../services/Logger';
import { normalizeQrlConnectDeepLink } from '../services/DAppDeepLink';

const APP_BACKGROUND = '#09090c';
const APP_TEXT = '#f5f3f0';
const APP_ACCENT = '#f5a623';
const HEADER_TITLE_STYLE = {
  fontWeight: 'bold' as const,
  fontSize: 16,
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// Boot resilience: the iOS 26 cold-start NSException is suppressed instead of
// crashing (see patches/react-native), but the native module that threw can
// leave its in-flight promise unsettled forever. Every awaited boot step is
// therefore raced against a timeout, and splash-hide has an independent
// failsafe, so a single wedged native call degrades boot instead of freezing
// the app on the splash screen (TestFlight feedback 2026-07-10, build 22).
const BOOT_STEP_TIMEOUT_MS = 4000;
const SPLASH_FAILSAFE_MS = 8000;

function withBootTimeout(promise: Promise<unknown>, label: string): Promise<unknown> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const timeout = new Promise<void>((resolve) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      Logger.error('RootLayout', `Boot step timed out after ${BOOT_STEP_TIMEOUT_MS}ms: ${label}`);
      resolve();
    }, BOOT_STEP_TIMEOUT_MS);
  });

  // Settle handling: clear the timer on completion so a healthy step does
  // not log a false timeout 4s later, and absorb rejections that arrive
  // after the race already moved on (would otherwise be unhandled).
  const settled = promise
    .then((value) => {
      clearTimeout(timeoutId);
      return value;
    })
    .catch((err: unknown) => {
      clearTimeout(timeoutId);
      if (timedOut) {
        Logger.warn('RootLayout', `Boot step ${label} rejected after timeout:`, err);
        return;
      }
      throw err;
    });

  return Promise.race([settled, timeout]);
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });
  // Font loading is a native round-trip too; if it neither resolves nor
  // rejects within the timeout, render with system fonts rather than never.
  const [fontsTimedOut, setFontsTimedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setFontsTimedOut(true), BOOT_STEP_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);
  const bootReady = fontsLoaded || fontError != null || fontsTimedOut;

  useEffect(() => {
    if (bootReady) {
      (async () => {
        // Initialize screen security (screenshot prevention)
        try {
          await withBootTimeout(ScreenSecurityService.initialize(), 'screen security');
        } catch (error) {
          Logger.error('RootLayout', 'Failed to initialize screen security:', error);
        }
        // Load dApp connection history (triggers 30-day cleanup). Deferred
        // past first paint: nothing needs it at boot, and its AsyncStorage
        // reads/writes were part of the concurrent first-150ms storm inside
        // the fragile TurboModule-init window (iOS 26 cold-start SIGABRT).
        InteractionManager.runAfterInteractions(() => {
          DAppConnectionStore.load().catch((err) => {
            Logger.error('RootLayout', 'Failed to load dApp connections:', err);
          });
          // Surface any fatal native exception recorded by the
          // RCTTurboModule patch on a previous launch (iOS only; written to
          // NSUserDefaults just before the process died).
          if (Platform.OS === 'ios') {
            try {
              const record = Settings.get('MyQRLWalletLastFatalNSException');
              if (record) {
                Logger.error('RootLayout', 'Previous launch fatal native exception:', record);
                // One-shot: clear it so healthy launches stop re-logging.
                Settings.set({ MyQRLWalletLastFatalNSException: null });
              }
            } catch {
              // Settings unavailable; nothing to surface.
            }
          }
        });
        // One-shot: mirror the legacy-install keychain PIN into the
        // AsyncStorage existence marker so hasPinStored() never needs to hit
        // the keychain again. Awaited before splash-hide so the initial
        // authCheck in WalletScreen sees a consistent marker; otherwise
        // 1.2.1 upgraders can race into the redundant Device Login setup
        // prompt even though they already have it enabled.
        await withBootTimeout(
          SeedStorageService.repairPinExistsMarker().catch((err) => {
            Logger.error('RootLayout', 'Failed pin_exists marker repair:', err);
          }),
          'pin_exists marker repair',
        );
        // Hide splash only after security is initialized
        await SplashScreen.hideAsync();
      })();
    }
  }, [bootReady]);

  // Last-resort splash release, independent of the boot chain above.
  // hideAsync is idempotent, so this is a no-op on healthy boots.
  useEffect(() => {
    const timer = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, SPLASH_FAILSAFE_MS);
    return () => clearTimeout(timer);
  }, []);

  // Listen for qrlconnect:// deep links and forward to WebView
  useEffect(() => {
    const handleDeepLink = (event: { url: string }) => {
      const { url } = event;
      const normalizedUrl = normalizeQrlConnectDeepLink(url);
      if (normalizedUrl) {
        // Wait for WebView to be ready, then forward the URI. Generous
        // timeout: a degraded boot (timed-out boot steps above) can delay
        // WebView mount by several seconds.
        NativeBridge.waitForWebAppReady(20000)
          .then(() => {
            NativeBridge.sendDAppURI(normalizedUrl);
          })
          .catch((err) => {
            Logger.error('RootLayout', 'Failed to forward dApp URI:', err);
          });
      }
    };

    // Registered synchronously so no 'url' event emitted during the boot
    // window can be missed; registration itself is a main-queue call and not
    // part of the fragile background-queue init window.
    const subscription = Linking.addEventListener('url', handleDeepLink);

    // The initial-URL retrieval IS deferred past first paint: a URL-launched
    // cold start otherwise piles its forwarding chain onto the boot storage
    // storm inside the fragile TurboModule-init window (intermittent iOS 26
    // cold-start SIGABRT; see patches/react-native for the companion fix).
    // Nothing is lost: the WebView takes seconds to become ready and
    // waitForWebAppReady already spans the gap.
    const task = InteractionManager.runAfterInteractions(() => {
      Linking.getInitialURL()
        .then((url) => {
          if (url) handleDeepLink({ url });
        })
        .catch((err) => {
          Logger.error('RootLayout', 'Failed to get initial URL:', err);
        });
    });

    return () => {
      task.cancel();
      subscription.remove();
    };
  }, []);

  if (!bootReady) {
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
