import React, { useState, useRef, useCallback, useEffect } from 'react';
import { StyleSheet, View, ActivityIndicator, BackHandler, Text, TouchableOpacity, SafeAreaView, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import Constants from 'expo-constants';

// Type definitions
interface QRLWebViewProps {
  uri?: string;
  userAgent?: string;
}

const QRLWebView: React.FC<QRLWebViewProps> = ({
  uri = 'https://qrlwallet.com',
  userAgent,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [navState, setNavState] = useState<any>({ url: uri });
  const webViewRef = useRef<WebView>(null);
  const navigation = useNavigation();
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

  // JavaScript to inject for enhancing the WebView experience
  const injectedJavaScript = `
    // Improve scrolling on the WebView
    document.addEventListener('DOMContentLoaded', function() {
      // Add smooth scrolling behavior to the document
      document.documentElement.style.scrollBehavior = 'smooth';
      
      // Ensure content is properly scaled
      const viewport = document.querySelector('meta[name="viewport"]');
      if (!viewport) {
        const meta = document.createElement('meta');
        meta.name = 'viewport';
        meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
        document.getElementsByTagName('head')[0].appendChild(meta);
      } else {
        viewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
      }

      // Improve scrolling by ensuring proper height and overflow
      document.body.style.height = 'auto';
      document.body.style.minHeight = '100vh';
      document.body.style.overflow = 'auto';
      document.body.style.webkitOverflowScrolling = 'touch';
      document.body.style.overscrollBehavior = 'contain';
      
      // Ensure all scrollable elements have proper settings
      const scrollableElements = document.querySelectorAll('div, section, article, main');
      scrollableElements.forEach(elem => {
        if (window.getComputedStyle(elem).overflow === 'auto' || 
            window.getComputedStyle(elem).overflow === 'scroll' ||
            window.getComputedStyle(elem).overflowY === 'auto' ||
            window.getComputedStyle(elem).overflowY === 'scroll') {
          elem.style.webkitOverflowScrolling = 'touch';
          elem.style.willChange = 'scroll-position';
        }
      });
    });
    
    // Ensure event listeners don't block scrolling
    document.addEventListener('touchstart', function() {}, {passive: true});
    document.addEventListener('touchmove', function(event) {
      // Only prevent pinch zoom, allow scrolling
      if (event.scale !== undefined && event.scale !== 1) { 
        event.preventDefault(); 
      }
    }, {passive: false});
    
    // Simple console logging to help with debugging
    console.log('QRL Wallet WebView initialized with improved scrolling');
    
    true;
  `;

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
    <View style={styles.container}>
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
            injectedJavaScript={injectedJavaScript}
            renderLoading={() => <ActivityIndicator style={styles.loader} size="large" color="#5e35b1" />}
            
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
            <View style={styles.loaderContainer}>
              <ActivityIndicator size="large" color="#5e35b1" />
              {/* Add a manual continue button that appears after a short delay */}
              {navState.url && navState.url !== uri && (
                <TouchableOpacity 
                  style={styles.cancelButton}
                  onPress={() => setIsLoading(false)}
                >
                  <Text style={styles.cancelButtonText}>Continue Anyway</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f7f7',
    overflow: 'hidden', // Prevent content from bleeding outside container
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
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f7f7f7',
  },
  errorText: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#d32f2f',
  },
  errorDescription: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
    color: '#555',
  },
  retryButton: {
    backgroundColor: '#5e35b1',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 4,
  },
  retryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  cancelButton: {
    marginTop: 20,
    backgroundColor: '#5e35b1',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 4,
  },
  cancelButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
});

export default QRLWebView; 