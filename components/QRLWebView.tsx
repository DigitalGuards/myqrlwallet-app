import React, { useState, useRef, useCallback, useEffect } from 'react';
import { StyleSheet, View, ActivityIndicator, BackHandler, Text, TouchableOpacity, Platform, useColorScheme, StatusBar } from 'react-native';
import { WebView } from 'react-native-webview';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import Constants from 'expo-constants';
import Colors from '../constants/Colors';

// Type definitions
interface QRLWebViewProps {
  uri?: string;
  userAgent?: string;
}

const QRLWebView: React.FC<QRLWebViewProps> = ({ 
  uri = 'https://qrlwallet.com',
  userAgent 
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [navState, setNavState] = useState<any>({ url: uri });
  const webViewRef = useRef<WebView>(null);
  const navigation = useNavigation();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  // Timeout reference to force loading to complete after a set time
  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Custom user agent to improve compatibility
  const customUserAgent = userAgent || 
    `Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1 MyQRLWallet/${Constants.expoConfig?.version || '1.0.0'}`;

  // Add a safety timeout to hide spinner after a maximum time
  useEffect(() => {
    if (isLoading) {
      // Set a 8-second maximum loading time
      loadingTimeoutRef.current = setTimeout(() => {
        console.log('Loading timeout reached, forcing loading state to complete');
        setIsLoading(false);
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
  }, [isLoading]);

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

      BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => BackHandler.removeEventListener('hardwareBackPress', onBackPress);
    }, [])
  );

  const handleLoadStart = () => {
    setIsLoading(true);
    setError(null);
  };

  const handleLoadEnd = () => {
    setIsLoading(false);
  };

  const handleNavigationStateChange = (newNavState: any) => {
    // Update navigation state
    setNavState(newNavState);
    
    // If page has loaded completely, ensure loading indicator is hidden
    if (newNavState.loading === false) {
      setIsLoading(false);
    }
    
    console.log(`Navigation state changed: ${newNavState.url}, loading: ${newNavState.loading}`);
  };

  const handleError = (syntheticEvent: any) => {
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
  const handleMessage = (event: any) => {
    const { data } = event.nativeEvent;
    
    if (data === 'PAGE_LOADED') {
      console.log('Page fully loaded message received');
      setIsLoading(false);
    }
    // Log other messages for debugging
    else {
      console.log(`Message from WebView: ${data}`);
    }
  };

  return (
    <View style={[styles.outerContainer, { backgroundColor: '#0A0A17' }]}>
      <StatusBar backgroundColor="#0A0A17" barStyle="light-content" />
      <View style={[styles.container, { backgroundColor: '#0A0A17' }]}>
        {error ? (
          <View style={[styles.errorContainer, { backgroundColor: colors.background }]}>
            <Text style={[styles.errorText, { color: colors.text }]}>Error: {error}</Text>
            <TouchableOpacity 
              style={[styles.retryButton, { backgroundColor: colors.secondary }]} 
              onPress={retryLoading}
            >
              <Text style={[styles.retryButtonText, { color: colors.secondaryForeground }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <WebView
              ref={webViewRef}
              source={{ uri }}
              style={styles.webView}
              originWhitelist={['https://*']}
              userAgent={customUserAgent}
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
              renderLoading={() => <ActivityIndicator style={styles.loader} size="large" color={colors.secondary} />}
              
              // Additional settings
              incognito={false}
              thirdPartyCookiesEnabled={true}
              pullToRefreshEnabled={true}
              javaScriptCanOpenWindowsAutomatically={false}
              allowsInlineMediaPlayback={true}
              mediaPlaybackRequiresUserAction={true}
              accessible={true}
              accessibilityLabel="QRL Wallet web content"
              nestedScrollEnabled={true}
            />
            {isLoading && (
              <View style={[styles.loaderContainer, { backgroundColor: '#0A0A17' }]}>
                <ActivityIndicator size="large" color={colors.secondary} />
                {/* Add a manual continue button that appears after a short delay */}
                {navState.url && navState.url !== uri && (
                  <TouchableOpacity 
                    style={[styles.cancelButton, { backgroundColor: colors.secondary }]}
                    onPress={() => setIsLoading(false)}
                  >
                    <Text style={[styles.cancelButtonText, { color: colors.secondaryForeground }]}>Continue Anyway</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    width: '100%',
  },
  container: {
    flex: 1,
    overflow: 'hidden', // Prevent content from bleeding outside container
    paddingTop: 50, // top padding to allow WebView to fill space
    marginTop: 0,
  },
  webView: {
    flex: 1,
    overflow: 'hidden', // This helps with some scrolling issues
  },
  loaderContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loader: {
    position: 'absolute',
    alignSelf: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    marginBottom: 20,
    textAlign: 'center',
  },
  retryButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginTop: 10,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  cancelButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginTop: 20,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default QRLWebView; 