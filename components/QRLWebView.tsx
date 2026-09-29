import React, { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react';
import { StyleSheet, View, BackHandler, Linking, Text, TouchableOpacity, Platform, StatusBar } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import NativeBridge, { BridgeMessage, NativeQrScanRequest } from '../services/NativeBridge';
import Logger from '../services/Logger';
import {
  NATIVE_WEBVIEW_CAPABILITY_SCRIPT,
  NATIVE_WEBVIEW_INJECTED_OBJECT,
} from '../services/NativeWalletProfile';
import { isSameDocumentHistoryUpdate } from '../services/WebViewLoadStart';
import {
  isAllowedWalletDocumentUrl,
  walletUrlOriginForLog,
} from '../services/WalletWebOrigin';
import { resolveWebSourceMode, type WebSourceMode } from '../services/WebSource';
import {
  EMBEDDED_FLAG_SCRIPT,
  loadEmbeddedWalletHtml,
} from '../services/EmbeddedWalletDocument';
import {
  EMBEDDED_BASE_URL,
  classifyEmbeddedNavigation,
  normalizeEmbeddedDocumentUrl,
} from '../services/EmbeddedNavigationPolicy';
import QuantumLoadingScreen from './QuantumLoadingScreen';

// ============================================================
// DEV MODE - Automatically detected via __DEV__ flag
// ============================================================
// __DEV__ is true when running in Expo Go / dev builds, false in production
// For Android emulator: 10.0.2.2 maps to host localhost
// For physical device: set EXPO_PUBLIC_DEV_URL to your computer's LAN IP (e.g., http://192.168.1.x:5173)
const DEV_URL = process.env.EXPO_PUBLIC_DEV_URL || 'http://10.0.2.2:5173';

// Where the wallet document comes from. See services/WebSource.ts.
const CONFIGURED_WEB_SOURCE = resolveWebSourceMode(process.env.EXPO_PUBLIC_WEB_SOURCE, __DEV__);

// Routes handed to the embedded document from a system link. Kept tight
// because the value ends up in an injected assignment.
const EMBEDDED_ROUTE_PATTERN = /^#\/[A-Za-z0-9\-._~/]*$/;

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
  /** Overrides the configured source. Used by tests and by a fallback build. */
  webSource?: WebSourceMode;
  onQRScanRequest?: (request: NativeQrScanRequest) => void;
  onLoad?: () => void;  // Called when WebView content is loaded
  onDocumentLoadStart?: () => void;
  skipLoadingScreen?: boolean;  // Skip the quantum loading animation
}

export interface QRLWebViewRef {
  sendQRResult: (address: string, request: NativeQrScanRequest) => boolean;
  reload: () => void;
  /** Move the embedded wallet to a hash route. No-op outside embedded mode. */
  navigateToEmbeddedRoute: (route: string) => boolean;
}

// Minimum time to show loading screen (in ms)
// Long enough for the entrance animation to land, short enough that a
// warm cache load is not artificially delayed (was 3000ms of forced wait).
const MIN_LOADING_TIME = 1200;
export const MAX_BRIDGE_MESSAGE_CHARS = 300 * 1024;

const QRLWebView = forwardRef<QRLWebViewRef, QRLWebViewProps>(({
  uri,
  userAgent,
  webSource,
  onQRScanRequest,
  onLoad,
  onDocumentLoadStart,
  skipLoadingScreen = false
}, ref) => {
  const insets = useSafeAreaInsets();
  const [isLoading, setIsLoading] = useState(true);
  const [showLoadingScreen, setShowLoadingScreen] = useState(!skipLoadingScreen);
  const [loadProgress, setLoadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const webViewRef = useRef<WebView>(null);

  const mode = webSource ?? CONFIGURED_WEB_SOURCE;
  const isEmbedded = mode === 'embedded';
  const remoteUri = uri ?? (mode === 'dev' ? DEV_URL : 'https://qrlwallet.com');

  // The embedded document, read once from the app bundle.
  const [embeddedHtml, setEmbeddedHtml] = useState<string | null>(null);
  // Bumped to force a fresh loadDataWithBaseURL. The navigation guard refuses
  // a second load of the base URL, so recovering a dead content process means
  // handing the WebView the document again rather than calling reload().
  const [documentEpoch, setDocumentEpoch] = useState(0);
  // False once the injected document has been admitted for the current epoch.
  const initialDocumentPending = useRef(true);

  // Track when loading started for minimum display time
  const loadStartTime = useRef<number>(Date.now());
  const documentStarted = useRef(false);
  const minTimeElapsed = useRef<boolean>(false);
  const contentLoaded = useRef<boolean>(false);

  // Timeout reference to force loading to complete after a set time
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const minTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Allowed domains for security
  const ALLOWED_DOMAINS = mode === 'dev'
    ? ['10.0.2.2', 'localhost', '127.0.0.1', getDevHostname()]
    : ['qrlwallet.com'];

  // Custom user agent to improve compatibility
  const customUserAgent = userAgent || 
    `Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1 MyQRLWallet/${Constants.expoConfig?.version || '1.0.0'}`;

  // Read the embedded wallet document out of the app bundle.
  useEffect(() => {
    if (!isEmbedded) return;
    let cancelled = false;
    loadEmbeddedWalletHtml()
      .then((html) => {
        if (!cancelled) setEmbeddedHtml(html);
      })
      .catch((loadError: unknown) => {
        Logger.error('QRLWebView', 'Failed to read the embedded wallet document:', loadError);
        if (!cancelled) setError('Could not open the wallet bundled with this app');
      });
    return () => {
      cancelled = true;
    };
  }, [isEmbedded]);

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

  // Reload the wallet document.
  //
  // In embedded mode reload() is not enough: the WebView would re-request the
  // base URL, which the navigation guard refuses, and on Android a reload of
  // a loadDataWithBaseURL document goes to the network. Remounting the
  // WebView makes the shipped string the document again.
  const reloadDocument = useCallback(() => {
    if (isEmbedded) {
      initialDocumentPending.current = true;
      documentStarted.current = false;
      setDocumentEpoch((epoch) => epoch + 1);
      return;
    }
    webViewRef.current?.reload();
  }, [isEmbedded]);

  // Send the embedded wallet to one of its own routes. Used for a
  // qrlwallet.com link tapped outside the app, which can no longer be loaded
  // as a document. Same-document fragment change, so no navigation request.
  const navigateToEmbeddedRoute = useCallback((route: string): boolean => {
    if (!isEmbedded || !webViewRef.current) return false;
    if (typeof route !== 'string' || route.length > 256 || !EMBEDDED_ROUTE_PATTERN.test(route)) {
      Logger.warn('QRLWebView', 'Refused an unsupported embedded route');
      return false;
    }
    webViewRef.current.injectJavaScript(
      `(function(){try{window.location.hash=${JSON.stringify(route.slice(1))};}catch(e){}})();true;`,
    );
    return true;
  }, [isEmbedded]);

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    sendQRResult: (address: string, request: NativeQrScanRequest) => {
      return NativeBridge.sendQRResult(address, request);
    },
    reload: reloadDocument,
    navigateToEmbeddedRoute,
  }), [reloadDocument, navigateToEmbeddedRoute]);

  // The single place a URL reported by the WebView is turned into the URL the
  // document actually runs on. Every trust decision and every origin log goes
  // through it, so Android's about:blank quirk cannot be handled in one caller
  // and missed in another. Outside embedded mode it is the identity function:
  // a document at about:blank is not the wallet when the wallet is loaded from
  // a URL, and accepting it would hand bridge authority to a blank page.
  // See normalizeEmbeddedDocumentUrl for why the rewrite is safe.
  const documentUrlForTrust = useCallback(
    (url: string): string => (isEmbedded ? normalizeEmbeddedDocumentUrl(url) : url),
    [isEmbedded],
  );

  const handleLoadStart = (event?: { nativeEvent?: { loading?: boolean } }) => {
    // The wallet's own route changes keep the same document; resetting there
    // would drop the bridge handshake and re-lock the app on every tap. The
    // first load start always starts a document, so the screen's initial
    // authorization check runs even when a warm-cache load reports 100%.
    if (
      documentStarted.current &&
      isSameDocumentHistoryUpdate(Platform.OS, event?.nativeEvent)
    ) {
      return;
    }
    documentStarted.current = true;
    // Consume the one allowed base-URL load here rather than only in the
    // navigation guard. Android's loadDataWithBaseURL never goes through
    // shouldOverrideUrlLoading, so on Android the guard is not called for the
    // injected document and the allowance would still be unspent: the first
    // real navigation to https://qrlwallet.com/ would then be admitted and
    // would fetch the live page over the shipped one. iOS calls the guard
    // before this, so there the flag is already false and this is a no-op.
    initialDocumentPending.current = false;
    NativeBridge.resetWebAppReady();
    onDocumentLoadStart?.();
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
    Logger.debug('QRLWebView', 'Navigation state changed', {
      origin: walletUrlOriginForLog(documentUrlForTrust(newNavState.url)),
      loading: newNavState.loading,
    });
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
    reloadDocument();
  };

  // The content process can be killed under memory pressure. Both platforms
  // then leave a blank WebView behind, so the document is handed back
  // explicitly instead of waiting for a navigation that will never come.
  const handleContentProcessDidTerminate = useCallback(() => {
    Logger.warn('QRLWebView', 'WebView content process terminated, reloading the wallet document');
    NativeBridge.resetWebAppReady();
    reloadDocument();
  }, [reloadDocument]);

  // Check if a URL belongs to the one document allowed to hold wallet bridge
  // authority. Production requires the exact HTTPS origins, including the
  // default port; hostname-only checks would accept an HTTP downgrade or an
  // attacker-controlled service on an alternate port.
  const isUrlAllowed = (url: string): boolean => {
    return isAllowedWalletDocumentUrl(url, __DEV__, ALLOWED_DOMAINS);
  };

  // Handle messages from the WebView
  const handleMessage = async (event: WebViewMessageEvent) => {
    const { data } = event.nativeEvent;
    const url = documentUrlForTrust(event.nativeEvent.url);
    if (typeof url !== 'string' || !isUrlAllowed(url)) {
      Logger.warn(
        'QRLWebView',
        'Dropped bridge message from an untrusted document',
        walletUrlOriginForLog(url),
      );
      return;
    }
    if (typeof data !== 'string' || data.length > MAX_BRIDGE_MESSAGE_CHARS) {
      Logger.warn('QRLWebView', 'Dropped bridge message outside the size budget');
      return;
    }

    // Handle legacy PAGE_LOADED message
    if (data === 'PAGE_LOADED') {
      Logger.debug('QRLWebView', 'Legacy PAGE_LOADED message received');
      setIsLoading(false);
      return;
    }

    let message: BridgeMessage;
    try {
      message = JSON.parse(data) as BridgeMessage;
    } catch {
      // Not a JSON message - ignore
      return;
    }
    if (
      !message ||
      typeof message !== 'object' ||
      typeof message.type !== 'string' ||
      (message.payload !== undefined &&
        (!message.payload || typeof message.payload !== 'object' || Array.isArray(message.payload)))
    ) {
      Logger.warn('QRLWebView', 'Dropped malformed bridge message');
      return;
    }
    Logger.debug('QRLWebView', 'Bridge message received', message.type);
    try {
      await NativeBridge.handle(message);
    } catch (error) {
      Logger.error('QRLWebView', 'Bridge message handling failed:', error);
    }
  };

  // Handle navigation requests
  const onShouldStartLoadWithRequest = (request: { url: string }): boolean => {
    const { url } = request;

    if (isEmbedded) {
      const decision = classifyEmbeddedNavigation(url, {
        initialDocumentPending: initialDocumentPending.current,
        baseUrl: EMBEDDED_BASE_URL,
      });
      if (decision.action === 'allow') {
        if (decision.reason === 'initial-document') {
          initialDocumentPending.current = false;
        }
        return true;
      }
      if (decision.action === 'open-external') {
        Logger.debug('QRLWebView', 'Opening an external link outside the wallet', walletUrlOriginForLog(url));
        Linking.openURL(url).catch((openError: unknown) => {
          Logger.warn('QRLWebView', 'Could not open an external link:', openError);
        });
        return false;
      }
      Logger.warn(
        'QRLWebView',
        `Blocked navigation (${decision.reason})`,
        walletUrlOriginForLog(url),
      );
      return false;
    }

    const allowed = isUrlAllowed(url);

    if (!allowed) {
      Logger.warn(
        'QRLWebView',
        'Blocked navigation to disallowed URL',
        walletUrlOriginForLog(url),
      );
    }

    // Allow initial load and allowed domains
    return allowed;
  };

  // In embedded mode the WebView is given the document itself, under the
  // production base URL so the wallet keeps the qrlwallet.com origin and the
  // storage that goes with it.
  const embeddedSource = isEmbedded && embeddedHtml !== null
    ? { html: embeddedHtml, baseUrl: EMBEDDED_BASE_URL }
    : { uri: remoteUri };

  const originWhitelist = isEmbedded
    ? ['https://qrlwallet.com', 'about:*']
    : mode === 'dev'
      ? ['http://*', 'https://*']
      : ['https://qrlwallet.com'];

  const beforeContentScript = [
    isEmbedded ? EMBEDDED_FLAG_SCRIPT : null,
    Platform.OS === 'android' ? NATIVE_WEBVIEW_CAPABILITY_SCRIPT : null,
  ]
    .filter((script): script is string => script !== null)
    .join('\n') || undefined;

  // Nothing to render yet in embedded mode: the document is still being read
  // from the bundle. The loading screen below stays up.
  const documentReady = !isEmbedded || embeddedHtml !== null;

  return (
    <View style={[styles.outerContainer, { backgroundColor: '#080C16' }]}>
      <StatusBar backgroundColor="#080C16" barStyle="light-content" />
      <View style={[styles.container, {
        backgroundColor: '#080C16',
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
            {documentReady ? (
            <WebView
              ref={webViewRef}
              // Remounted on a new epoch so the shipped document is handed to
              // a fresh WebView after a content-process death.
              key={isEmbedded ? `embedded-${documentEpoch}` : 'remote'}
              source={embeddedSource}
              injectedJavaScriptObject={NATIVE_WEBVIEW_INJECTED_OBJECT}
              // Android defines injectedObjectJson() with a one-off evaluate
              // at mount, before the wallet document has loaded. These scripts
              // define it on the wallet document after each successful page
              // start and page finish, so the web wallet sees the v3
              // capabilities. iOS injects the object as a document-start user
              // script. In embedded mode the same hook also sets
              // window.__QRL_EMBEDDED__, which the document head already
              // carries; both are needed because Android can deliver this one
              // after the document's own scripts have run.
              injectedJavaScriptBeforeContentLoaded={beforeContentScript}
              injectedJavaScript={
                Platform.OS === 'android' ? NATIVE_WEBVIEW_CAPABILITY_SCRIPT : undefined
              }
              style={styles.webView}
              originWhitelist={originWhitelist}
              userAgent={customUserAgent}
              onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              startInLoadingState={true}
              scrollEnabled={true}
              decelerationRate={Platform.OS === 'ios' ? 'normal' : 0.985}
              automaticallyAdjustContentInsets={true}
              contentInsetAdjustmentBehavior="automatic"
              overScrollMode="never"
              bounces={true}
              directionalLockEnabled={false}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={true}
              cacheEnabled={true}
              mixedContentMode={mode === 'dev' ? 'compatibility' : 'never'}
              onLoadStart={handleLoadStart}
              onLoadEnd={handleLoadEnd}
              onLoadProgress={({ nativeEvent }) =>
                setLoadProgress(nativeEvent.progress)
              }
              onNavigationStateChange={handleNavigationStateChange}
              onMessage={handleMessage}
              onError={handleError}
              onContentProcessDidTerminate={handleContentProcessDidTerminate}
              onRenderProcessGone={handleContentProcessDidTerminate}

              // Additional settings
              incognito={false}
              thirdPartyCookiesEnabled={false}
              pullToRefreshEnabled={false} // Disabled to fix Android scroll issues; feature is also blocked by frontend CSS.
              javaScriptCanOpenWindowsAutomatically={false}
              setSupportMultipleWindows={false}
              saveFormDataDisabled={true}
              allowFileAccess={false}
              allowFileAccessFromFileURLs={false}
              allowUniversalAccessFromFileURLs={false}
              allowsInlineMediaPlayback={true}
              mediaPlaybackRequiresUserAction={false}
              accessible={true}
              accessibilityLabel="QRL Wallet web content"
              nestedScrollEnabled={true}
            />
            ) : null}
            <QuantumLoadingScreen visible={showLoadingScreen || !documentReady} progress={loadProgress} />
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
    backgroundColor: '#080C16',
  },
  errorText: {
    fontSize: 16,
    marginBottom: 20,
    textAlign: 'center',
    color: '#F2F5F8',
  },
  retryButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginTop: 10,
    backgroundColor: '#33ADE6',
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#041725',
  },
});

export default QRLWebView;
