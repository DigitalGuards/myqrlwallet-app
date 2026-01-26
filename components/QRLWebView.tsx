import React, { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react';
import { StyleSheet, View, BackHandler, Text, TouchableOpacity, Platform, StatusBar } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import NativeBridge, { BridgeMessage } from '../services/NativeBridge';
import Logger from '../services/Logger';
import QuantumLoadingScreen from './QuantumLoadingScreen';

// ============================================================
// DEV MODE - Automatically detected via __DEV__ flag
// ============================================================
// __DEV__ is true when running in Expo Go / dev builds, false in production
// For Android emulator: 10.0.2.2 maps to host localhost
// For physical device: set EXPO_PUBLIC_DEV_URL to your computer's LAN IP (e.g., http://192.168.1.x:5173)
const DEV_URL = process.env.EXPO_PUBLIC_DEV_URL || 'http://10.0.2.2:5173';

// Extract hostname from DEV_URL for allowed domains
const getDevHostname = (): string => {
  try {
    return new URL(DEV_URL).hostname;
  } catch {
    return '10.0.2.2';
  }
};

// Type definitions
interface QRLWebViewProps {
  uri?: string;
  userAgent?: string;
  onQRScanRequest?: () => void;
  onLoad?: () => void;  // Called when WebView content is loaded
  skipLoadingScreen?: boolean;  // Skip the quantum loading animation
}

export interface QRLWebViewRef {
  sendQRResult: (address: string) => void;
  reload: () => void;
}

// Minimum time to show loading screen (in ms)
const MIN_LOADING_TIME = 3000;

const QRLWebView = forwardRef<QRLWebViewRef, QRLWebViewProps>(({
  uri = __DEV__ ? DEV_URL : 'https://qrlwallet.com',
  userAgent,
  onQRScanRequest,
  onLoad,
  skipLoadingScreen = false
}, ref) => {
  const insets = useSafeAreaInsets();
  const [isLoading, setIsLoading] = useState(true);
  const [showLoadingScreen, setShowLoadingScreen] = useState(!skipLoadingScreen);
  const [error, setError] = useState<string | null>(null);
  const webViewRef = useRef<WebView>(null);

  // Track when loading started for minimum display time
  const loadStartTime = useRef<number>(Date.now());
  const minTimeElapsed = useRef<boolean>(false);
  const contentLoaded = useRef<boolean>(false);

  // Timeout reference to force loading to complete after a set time
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const minTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Allowed domains for security
  const ALLOWED_DOMAINS = __DEV__
    ? ['10.0.2.2', 'localhost', '127.0.0.1', getDevHostname()]
    : ['qrlwallet.com', 'www.qrlwallet.com'];

  // Custom user agent to improve compatibility
  const customUserAgent = userAgent || 
    `Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1 MyQRLWallet/${Constants.expoConfig?.version || '1.0.0'}`;

  // Helper to check if we can hide loading screen
  const tryHideLoadingScreen = useCallback(() => {
    if (minTimeElapsed.current && contentLoaded.current) {
      setShowLoadingScreen(false);
    }
  }, []);

  // Set up minimum display time timer on mount
  useEffect(() => {
    // If skipping loading screen, mark everything as ready immediately
    if (skipLoadingScreen) {
      minTimeElapsed.current = true;
      contentLoaded.current = true;
      return;
    }

    loadStartTime.current = Date.now();
    minTimeElapsed.current = false;
    contentLoaded.current = false;

    minTimeoutRef.current = setTimeout(() => {
      minTimeElapsed.current = true;
      tryHideLoadingScreen();
    }, MIN_LOADING_TIME);

    return () => {
      if (minTimeoutRef.current) {
        clearTimeout(minTimeoutRef.current);
      }
    };
  }, [tryHideLoadingScreen, skipLoadingScreen]);

  // Add a safety timeout to hide spinner after a maximum time
  useEffect(() => {
    if (isLoading) {
      // Set a 8-second maximum loading time
      loadingTimeoutRef.current = setTimeout(() => {
        Logger.warn('QRLWebView', 'Loading timeout reached (8s), forcing load complete');
        setIsLoading(false);
        contentLoaded.current = true;
        tryHideLoadingScreen();
      }, 8000);
    } else if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }

    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, [isLoading, tryHideLoadingScreen]);

  // Handle back button press for Android
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (webViewRef.current) {
          webViewRef.current.goBack();
          return true; // Prevent default behavior
        }
        return false;
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [])
  );

  // Set up Native Bridge
  useEffect(() => {
    NativeBridge.setWebViewRef(webViewRef);

    // Register QR scan callback
    if (onQRScanRequest) {
      NativeBridge.onQRScanRequest(onQRScanRequest);
    }
  }, [onQRScanRequest]);

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    sendQRResult: (address: string) => {
      NativeBridge.sendQRResult(address);
    },
    reload: () => {
      if (webViewRef.current) {
        webViewRef.current.reload();
      }
    }
  }));

  const handleLoadStart = () => {
    setIsLoading(true);
    setError(null);
  };

  const handleLoadEnd = () => {
    setIsLoading(false);
    contentLoaded.current = true;
    tryHideLoadingScreen();
    // Notify parent that WebView content is loaded
    if (onLoad) {
      onLoad();
    }
  };

  const handleNavigationStateChange = (newNavState: { url: string; loading: boolean }) => {
    Logger.debug('QRLWebView', 'Navigation state changed', { url: newNavState.url, loading: newNavState.loading });
    // If page has loaded completely, ensure loading indicator is hidden
    if (newNavState.loading === false) {
      setIsLoading(false);
      contentLoaded.current = true;
      tryHideLoadingScreen();
    }
  };

  const handleError = (syntheticEvent: { nativeEvent: { description?: string } }) => {
    const { nativeEvent } = syntheticEvent;
    setError(nativeEvent.description || 'Failed to load QRL Wallet');
    setIsLoading(false);
  };

  const retryLoading = () => {
    setError(null);
    setIsLoading(true);
    if (webViewRef.current) {
      webViewRef.current.reload();
    }
  };

  // Handle messages from the WebView
  const handleMessage = (event: WebViewMessageEvent) => {
    const { data } = event.nativeEvent;

    // Handle legacy PAGE_LOADED message
    if (data === 'PAGE_LOADED') {
      Logger.debug('QRLWebView', 'Legacy PAGE_LOADED message received');
      setIsLoading(false);
      return;
    }

    // Try to parse as JSON bridge message
    try {
      const message: BridgeMessage = JSON.parse(data);
      Logger.debug('QRLWebView', 'Bridge message received', message.type);
      NativeBridge.handle(message);
    } catch {
      // Not a JSON message - ignore
    }
  };

  // Check if URL is allowed
  const isUrlAllowed = (url: string): boolean => {
    try {
      const urlObj = new URL(url);
      return ALLOWED_DOMAINS.includes(urlObj.hostname);
    } catch {
      return false;
    }
  };

  // Handle navigation requests
  const onShouldStartLoadWithRequest = (request: { url: string }): boolean => {
    const { url } = request;
    const allowed = isUrlAllowed(url);

    if (!allowed) {
      Logger.warn('QRLWebView', 'Blocked navigation to disallowed URL', url);
    }

    // Allow initial load and allowed domains
    return allowed;
  };

  return (
    <View style={[styles.outerContainer, { backgroundColor: '#0A0A17' }]}>
      <StatusBar backgroundColor="#0A0A17" barStyle="light-content" />
      <View style={[styles.container, {
        backgroundColor: '#0A0A17',
        paddingTop: insets.top || 40,
        paddingBottom: insets.bottom
      }]}>
        {error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Error: {error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={retryLoading}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <WebView
              ref={webViewRef}
              source={{ uri }}
              style={styles.webView}
              originWhitelist={__DEV__ ? ['http://*', 'https://*'] : ['https://qrlwallet.com', 'https://www.qrlwallet.com']}
              userAgent={customUserAgent}
              onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              startInLoadingState={true}
              scalesPageToFit={true}
              scrollEnabled={true}
              decelerationRate={Platform.OS === 'ios' ? 'normal' : 0.985}
              automaticallyAdjustContentInsets={true}
              contentInsetAdjustmentBehavior="automatic"
              overScrollMode="always"
              bounces={true}
              directionalLockEnabled={false}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={true}
              cacheEnabled={true}
              mixedContentMode="compatibility"
              onLoadStart={handleLoadStart}
              onLoadEnd={handleLoadEnd}
              onNavigationStateChange={handleNavigationStateChange}
              onMessage={handleMessage}
              onError={handleError}
              
              // Additional settings
              incognito={false}
              thirdPartyCookiesEnabled={false}
              pullToRefreshEnabled={true}
              javaScriptCanOpenWindowsAutomatically={false}
              allowsInlineMediaPlayback={true}
              mediaPlaybackRequiresUserAction={true}
              accessible={true}
              accessibilityLabel="QRL Wallet web content"
              nestedScrollEnabled={true}
            />
            <QuantumLoadingScreen visible={showLoadingScreen} />
          </>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    width: '100%',
  },
  container: {
    flex: 1,
    overflow: 'hidden',
    // paddingTop and paddingBottom applied dynamically via useSafeAreaInsets
  },
  webView: {
    flex: 1,
    overflow: 'hidden',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#0A0A17',
  },
  errorText: {
    fontSize: 16,
    marginBottom: 20,
    textAlign: 'center',
    color: '#f8fafc',
  },
  retryButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginTop: 10,
    backgroundColor: '#ff8700',
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
});

export default QRLWebView;