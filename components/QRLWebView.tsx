import React, { useState, useRef, useCallback, useEffect, useMemo, useImperativeHandle, forwardRef } from 'react';
import { StyleSheet, View, BackHandler, Linking, Text, TouchableOpacity, Platform, StatusBar } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import NativeBridge, { BridgeMessage, NativeQrScanRequest } from '../services/NativeBridge';
import Logger from '../services/Logger';
import {
  NATIVE_WEBVIEW_CAPABILITY_SCRIPT,
  NATIVE_WEBVIEW_INJECTED_OBJECT,
} from '../services/NativeWalletProfile';
import {
  isSameDocumentHistoryUpdate,
  type WebViewLoadStartEvent,
} from '../services/WebViewLoadStart';
import {
  isAllowedWalletDocumentUrl,
  walletUrlOriginForLog,
} from '../services/WalletWebOrigin';
import { resolveWebSource, type WebSourceMode } from '../services/WebSource';
import {
  BRIDGE_TOKEN_SEPARATOR,
  EMBEDDED_FLAG_SCRIPT,
  EMBEDDED_REBIND_SCRIPT,
  createDocumentToken,
  loadEmbeddedWalletHtml,
  withEmbeddedFlag,
} from '../services/EmbeddedWalletDocument';
import {
  EMBEDDED_BASE_URL,
  classifyEmbeddedNavigation,
} from '../services/EmbeddedNavigationPolicy';
import {
  detectEmbeddedWalletProfile,
  embeddedProfileErrorMessage,
} from '../services/EmbeddedWalletProfile';
import { externalOpenDecision } from '../services/ExternalLinkPolicy';
import {
  NATIVE_BACK_MESSAGE_TYPE,
  NATIVE_BACK_TIMEOUT_MS,
  isBackAnswer,
  resolveBackPress,
  type BackAnswer,
} from '../services/EmbeddedBackPolicy';
import {
  EMBEDDED_STORAGE_MIGRATION_SCRIPT,
  isMigrationAcknowledgement,
  isStorageMigrationPending,
  markStorageMigrationDone,
} from '../services/EmbeddedStorageMigration';
import QuantumLoadingScreen from './QuantumLoadingScreen';

// ============================================================
// DEV MODE - Automatically detected via __DEV__ flag
// ============================================================
// __DEV__ is true when running in Expo Go / dev builds, false in production
// For Android emulator: 10.0.2.2 maps to host localhost
// For physical device: set EXPO_PUBLIC_DEV_URL to your computer's LAN IP (e.g., http://192.168.1.x:5173)
const DEV_URL = process.env.EXPO_PUBLIC_DEV_URL || 'http://10.0.2.2:5173';

// Where the wallet document comes from. See services/WebSource.ts.
const CONFIGURED_WEB_SOURCE_RESOLUTION = resolveWebSource({
  requested: process.env.EXPO_PUBLIC_WEB_SOURCE,
  isDevelopment: __DEV__,
});
const CONFIGURED_WEB_SOURCE = CONFIGURED_WEB_SOURCE_RESOLUTION.mode;

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
  /**
   * Fires with the message whenever the document itself cannot be shown, and
   * with null when that clears. The screen needs it: a failure raised before
   * any load start leaves the screen in its "no document yet" state, where
   * its lock overlay would cover this component's own error and Retry.
   */
  onDocumentError?: (message: string | null) => void;
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
// How long the shipped document has to send its first bridge message before
// the binding is reported as broken. The wallet sends WEB_APP_READY as soon as
// it boots, so silence this long means the bootstrap did not wrap the bridge.
export const BRIDGE_BIND_TIMEOUT_MS = 20000;
// How many times a foreign document is pushed back out before the app stops
// and says so. A bounded count, because a WebView that somehow reports two
// document starts per load would otherwise loop.
export const MAX_FOREIGN_DOCUMENT_RECOVERIES = 3;
export const BRIDGE_UNBOUND_MESSAGE =
  'The bundled wallet could not connect to this app. Reload to try again.';

const QRLWebView = forwardRef<QRLWebViewRef, QRLWebViewProps>(({
  uri,
  userAgent,
  webSource,
  onQRScanRequest,
  onLoad,
  onDocumentLoadStart,
  onDocumentError,
  skipLoadingScreen = false
}, ref) => {
  const insets = useSafeAreaInsets();
  const [isLoading, setIsLoading] = useState(true);
  const [showLoadingScreen, setShowLoadingScreen] = useState(!skipLoadingScreen);
  const [loadProgress, setLoadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const webViewRef = useRef<WebView>(null);

  const mode = webSource ?? CONFIGURED_WEB_SOURCE;

  // A build profile that asked for something a release build will not serve.
  useEffect(() => {
    const refused = CONFIGURED_WEB_SOURCE_RESOLUTION.refused;
    if (webSource === undefined && refused) {
      Logger.error(
        'QRLWebView',
        `Refused the configured web source "${refused.requested}" (${refused.reason}); serving ${CONFIGURED_WEB_SOURCE}`,
      );
    }
  }, [webSource]);
  const isEmbedded = mode === 'embedded';
  // Development runs load a local frontend dev server; release builds always
  // serve the embedded document.
  const devUri = uri ?? DEV_URL;

  // The embedded document, read once from the app bundle, without the
  // bootstrap. The bootstrap carries a per-load token, so it is applied for
  // each epoch rather than cached with the document.
  const [embeddedRawHtml, setEmbeddedRawHtml] = useState<string | null>(null);
  // Proves a bridge message came from the document this app served. The
  // origin check alone cannot: it accepts any document on qrlwallet.com.
  const documentToken = useRef<string>('');
  if (isEmbedded && documentToken.current === '') {
    documentToken.current = createDocumentToken();
  }
  // Whether this launch still owes the one-time pass over storage inherited
  // from the days the WebView loaded the live site. The document has to know
  // before its own stores initialise, so it is read before the document is
  // served and passed in through the bootstrap.
  // Held in a ref on purpose. The value goes into the document the WebView is
  // handed, so making it state would rebuild that document the moment the page
  // acknowledges, the WebView would call loadDataWithBaseURL again mid-session,
  // and the wallet would reload under the user, possibly through a PIN entry.
  // The document must be a function of the epoch alone; the acknowledgement
  // reaches the next one.
  const migrationPendingRef = useRef<boolean | null>(null);
  // Flips once, when the first read resolves, so the document can be built.
  const [migrationResolved, setMigrationResolved] = useState(false);
  // What the document currently on screen was actually told. The live ref can
  // flip after that document was built, and the native half must agree with
  // the document it is running against rather than with the newer value.
  const servedMigrationPending = useRef(false);
  // The two halves of the pass. The marker is written when both have run, so
  // an install where only one completed retries on the next launch.
  const pageAcknowledged = useRef(false);
  const cachesCleared = useRef(false);
  // Written once per install. Also what stops a remount from re-reading a
  // marker whose write may not have landed yet and telling the next document
  // it owes a pass that has already run.
  const markerWritten = useRef(false);
  // Cleared once a message has arrived carrying the token, so a bridge that
  // never binds is reported instead of failing silently.
  const [bridgeUnbound, setBridgeUnbound] = useState(false);
  const bridgeBound = useRef(false);
  const [documentLoadedAt, setDocumentLoadedAt] = useState<number | null>(null);
  // The bind deadline is armed here rather than at the load end. A document
  // that wedges mid-parse never reports a load end, and the loading screen
  // releases itself after 8 s, so the user would be left looking at a black
  // WebView with no message and no Retry.
  const [documentStartedAt, setDocumentStartedAt] = useState<number | null>(null);
  const foreignDocumentRecoveries = useRef(0);
  // Bumped to force a fresh loadDataWithBaseURL. The navigation guard refuses
  // a second load of the base URL, so recovering a dead content process means
  // handing the WebView the document again rather than calling reload().
  const [documentEpoch, setDocumentEpoch] = useState(0);
  // The same number, advanced synchronously. A WebView that is being replaced
  // keeps delivering callbacks while it tears down, and those arrive after the
  // state update that replaced it. Every callback therefore carries the epoch
  // that rendered it and is dropped unless it matches this.
  const documentEpochRef = useRef(0);
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

  // Read the embedded wallet document out of the app bundle. Re-runs on a new
  // epoch so Retry after a failed read or a rejected document reaches this
  // again instead of leaving the loading screen up forever.
  useEffect(() => {
    if (!isEmbedded) return;
    let cancelled = false;
    if (markerWritten.current) {
      // Already done in this process. Re-reading could see a write that has
      // not landed and tell the next document it owes a pass that has run.
      migrationPendingRef.current = false;
      setMigrationResolved(true);
    } else {
      isStorageMigrationPending()
      .then((pending) => {
        if (cancelled) return;
        migrationPendingRef.current = pending;
        setMigrationResolved(true);
      })
      .catch(() => {
        // Erring towards running the pass: it only drops caches and pairings.
        if (cancelled) return;
        migrationPendingRef.current = true;
        setMigrationResolved(true);
      });
    }
    loadEmbeddedWalletHtml()
      .then((html) => {
        if (cancelled) return;
        // Refuse a document built for another network before the wallet can
        // run. Without this the mismatch only surfaces as a failed seed
        // backup, after the user has imported a seed and set a PIN.
        const profileError = embeddedProfileErrorMessage(detectEmbeddedWalletProfile(html));
        if (profileError) {
          Logger.error('QRLWebView', 'Bundled wallet network mismatch', profileError);
          setError(profileError);
          return;
        }
        setEmbeddedRawHtml(html);
      })
      .catch((loadError: unknown) => {
        Logger.error('QRLWebView', 'Failed to read the embedded wallet document:', loadError);
        if (!cancelled) setError('Could not open the wallet bundled with this app');
      });
    return () => {
      cancelled = true;
    };
  }, [isEmbedded, documentEpoch]);

  // The caches half of the one-time hygiene pass: service workers, the Cache
  // Storage API and the WebView HTTP cache. It runs after load because it
  // needs a live document, and it is safe there because none of it is state
  // the wallet's stores read at boot.
  //
  // The sessions half runs inside the document instead. dApp sessions are
  // restored and reconnected while the stores initialise, so clearing them
  // from here would race: a restored pairing would write itself back at its
  // next checkpoint and survive. The bootstrap therefore carries a migration
  // flag the page reads before its stores start, and the native marker is
  // written only once the page acknowledges over the bridge.
  // Writes the marker once both halves have run. Either half may finish
  // first: the page acknowledges during script evaluation, which is before
  // the load event, so on a real device the acknowledgement usually arrives
  // first and the caches half has not started yet.
  const markMigrationDoneIfComplete = useCallback(async () => {
    if (markerWritten.current) return;
    if (!pageAcknowledged.current || !cachesCleared.current) return;
    markerWritten.current = true;
    await markStorageMigrationDone();
  }, []);

  const clearInheritedCaches = useCallback(async () => {
    if (cachesCleared.current || !servedMigrationPending.current) return;
    const view = webViewRef.current;
    if (!view) return;
    cachesCleared.current = true;
    Logger.debug('QRLWebView', 'Clearing web caches inherited from the hosted wallet');
    try {
      view.clearCache?.(true);
    } catch (clearError) {
      Logger.warn('QRLWebView', 'Could not clear the WebView cache:', clearError);
    }
    view.injectJavaScript(EMBEDDED_STORAGE_MIGRATION_SCRIPT);
  }, []);

  useEffect(() => {
    if (!isEmbedded || documentLoadedAt === null) return;
    void clearInheritedCaches().then(() => markMigrationDoneIfComplete());
  }, [isEmbedded, documentLoadedAt, clearInheritedCaches, markMigrationDoneIfComplete]);

  // Every message the shipped document sends carries the token, so the first
  // one proves the bootstrap bound the bridge. If none arrives the wallet is
  // on screen but no native feature works, which is worth saying out loud
  // rather than leaving the user to discover at the first PIN prompt.
  useEffect(() => {
    if (!isEmbedded || documentStartedAt === null || bridgeBound.current) return;
    const timer = setTimeout(() => {
      if (bridgeBound.current) return;
      Logger.error(
        'QRLWebView',
        'No bridge message carried the document token; the wallet cannot reach native features',
      );
      setBridgeUnbound(true);
    }, BRIDGE_BIND_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isEmbedded, documentStartedAt]);

  // Tell the screen whenever the document cannot be shown, so it can get its
  // lock overlay out of the way of this component's error and Retry.
  const documentErrorMessage = error ?? (bridgeUnbound ? BRIDGE_UNBOUND_MESSAGE : null);
  useEffect(() => {
    onDocumentError?.(documentErrorMessage);
  }, [documentErrorMessage, onDocumentError]);

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

  // Whether the WebView reports history to walk, from onNavigationStateChange.
  // Used only when the page does not answer a back press.
  const canGoBack = useRef(false);
  // The back press waiting for the page, if any.
  const pendingBackPress = useRef<{
    settle: (answer: BackAnswer | null) => void;
  } | null>(null);

  const applyBackOutcome = useCallback((answer: BackAnswer | null) => {
    const outcome = resolveBackPress({ answer, canGoBack: canGoBack.current });
    if (outcome.action === 'consume') return;
    if (outcome.action === 'go-back') {
      webViewRef.current?.goBack();
      return;
    }
    // Android 12 and later background the root task rather than finishing it,
    // so the wallet stays warm and the lock still applies on return.
    BackHandler.exitApp();
  }, []);

  // Handle back button press for Android
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        // Always consume the press here. The outcome is decided once the page
        // answers or the deadline passes, and exiting is done explicitly.
        if (pendingBackPress.current) return true;

        const bound = bridgeBound.current && webViewRef.current !== null;
        if (!bound) {
          applyBackOutcome(null);
          return true;
        }

        let settled = false;
        const settle = (answer: BackAnswer | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          pendingBackPress.current = null;
          applyBackOutcome(answer);
        };
        const timer = setTimeout(() => settle(null), NATIVE_BACK_TIMEOUT_MS);
        pendingBackPress.current = { settle };
        NativeBridge.sendToWeb({ type: NATIVE_BACK_MESSAGE_TYPE });
        return true;
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => {
        subscription.remove();
        pendingBackPress.current?.settle(null);
      };
    }, [applyBackOutcome])
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
      // A new document gets a new token, so a message held by an old one
      // cannot be replayed into the new document's bridge.
      documentToken.current = createDocumentToken();
      bridgeBound.current = false;
      cachesCleared.current = false;
      pageAcknowledged.current = false;
      setBridgeUnbound(false);
      setDocumentLoadedAt(null);
      setDocumentStartedAt(null);
      documentEpochRef.current += 1;
      setDocumentEpoch(documentEpochRef.current);
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

  // True while the view that raised a callback is still the one on screen.
  // A dying WebView's trailing events would otherwise write document state
  // for its replacement: a doUpdateVisitedHistory from the old view arriving
  // after the epoch bump claimed the new document's first-load slot, and the
  // new view's real onPageStarted then looked like a second document.
  const isCurrentEpoch = (eventEpoch: number): boolean =>
    eventEpoch === documentEpochRef.current;

  const handleLoadStart = (
    event: { nativeEvent?: WebViewLoadStartEvent } | undefined,
    eventEpoch: number,
  ) => {
    if (!isCurrentEpoch(eventEpoch)) return;
    // The wallet's own route changes keep the same document; resetting there
    // would drop the bridge handshake and re-lock the app on every tap.
    //
    // With the patch applied the event says which it is, and a tagged history
    // update never starts a document, whatever else is going on. Without the
    // tag the only signal is a progress reading, so the old rule stands there:
    // the first load start starts a document, so the screen's initial
    // authorization check runs even when a warm-cache load reports 100%.
    const loadStartEvent = event?.nativeEvent;
    const isTagged = typeof loadStartEvent?.newDocument === 'boolean';
    // The Android protections all live in the react-native-webview patch: the
    // request interceptor, the fail-closed navigation check and this tag. A
    // patch that applied but lost content would leave the wallet running with
    // none of them and no sign of it, so the missing tag is treated as the
    // missing patch.
    if (isEmbedded && Platform.OS === 'android' && !isTagged) {
      Logger.error('QRLWebView', 'The WebView patch is missing: load events carry no document tag');
      NativeBridge.resetWebAppReady();
      setError(
        'This app build is missing a required WebView protection. Reinstall the app from the store.',
      );
      return;
    }
    if (
      isSameDocumentHistoryUpdate(Platform.OS, loadStartEvent) &&
      (isTagged || documentStarted.current)
    ) {
      return;
    }
    // A second document inside one epoch is not ours. Android reports no
    // navigation type, so a page-initiated reload of a hash URL satisfies the
    // fragment rule and the guard lets it through; what it cannot fake is
    // being the only document this epoch served. Re-serve the shipped string
    // with a fresh token instead of letting the new document settle.
    //
    // Reaching here means the event was tagged as a new document, or came
    // from iOS where every load start is one. A same-document history update
    // returned above, which is what keeps the wallet's own replaceState
    // during module init from being read as a page swap.
    if (isEmbedded && documentStarted.current) {
      foreignDocumentRecoveries.current += 1;
      if (foreignDocumentRecoveries.current > MAX_FOREIGN_DOCUMENT_RECOVERIES) {
        Logger.error('QRLWebView', 'A foreign document keeps replacing the shipped wallet');
        NativeBridge.resetWebAppReady();
        setError('The bundled wallet was replaced by another page. Reload to try again.');
        return;
      }
      Logger.warn('QRLWebView', 'A second document started in this load; re-serving the shipped wallet');
      NativeBridge.resetWebAppReady();
      reloadDocument();
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
    setDocumentStartedAt(Date.now());
    setIsLoading(true);
    setError(null);
  };

  const handleLoadEnd = (eventEpoch: number) => {
    if (!isCurrentEpoch(eventEpoch)) return;
    setIsLoading(false);
    contentLoaded.current = true;
    setDocumentLoadedAt(Date.now());
    tryHideLoadingScreen();
    // Notify parent that WebView content is loaded
    if (onLoad) {
      onLoad();
    }
  };

  const handleNavigationStateChange = (
    newNavState: { url: string; loading: boolean; canGoBack?: boolean },
    eventEpoch: number,
  ) => {
    if (!isCurrentEpoch(eventEpoch)) return;
    Logger.debug('QRLWebView', 'Navigation state changed', {
      origin: walletUrlOriginForLog(newNavState.url),
      loading: newNavState.loading,
    });
    canGoBack.current = newNavState.canGoBack === true;
    // If page has loaded completely, ensure loading indicator is hidden
    if (newNavState.loading === false) {
      setIsLoading(false);
      contentLoaded.current = true;
      tryHideLoadingScreen();
    }
  };

  const handleError = (
    syntheticEvent: { nativeEvent: { description?: string } },
    eventEpoch: number,
  ) => {
    if (!isCurrentEpoch(eventEpoch)) return;
    const { nativeEvent } = syntheticEvent;
    setError(nativeEvent.description || 'Failed to load QRL Wallet');
    setIsLoading(false);
  };

  const retryLoading = () => {
    setError(null);
    setBridgeUnbound(false);
    setDocumentLoadedAt(null);
    setDocumentStartedAt(null);
    foreignDocumentRecoveries.current = 0;
    setIsLoading(true);
    reloadDocument();
  };

  // The content process can be killed under memory pressure. Both platforms
  // then leave a blank WebView behind, so the document is handed back
  // explicitly instead of waiting for a navigation that will never come.
  const handleContentProcessDidTerminate = useCallback((eventEpoch: number) => {
    if (eventEpoch !== documentEpochRef.current) return;
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
  const handleMessage = async (event: WebViewMessageEvent, eventEpoch: number) => {
    if (!isCurrentEpoch(eventEpoch)) return;
    const { url } = event.nativeEvent;
    let data = event.nativeEvent.data;
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
    if (isEmbedded) {
      // The origin check above accepts any document on qrlwallet.com. Only
      // the document this app served knows the token, so anything without it
      // is not the shipped wallet and gets no bridge authority.
      const expected = documentToken.current + BRIDGE_TOKEN_SEPARATOR;
      if (!data.startsWith(expected)) {
        Logger.warn('QRLWebView', 'Dropped a bridge message that did not present the document token');
        return;
      }
      data = data.slice(expected.length);
      if (!bridgeBound.current) {
        bridgeBound.current = true;
        // The document that replaced the last one has proved it is ours, so
        // the burst budget starts again. Without this a fourth well-spaced
        // reload over the app's lifetime would land on the error screen.
        foreignDocumentRecoveries.current = 0;
        setBridgeUnbound(false);
      }
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
    if (isBackAnswer(message.type)) {
      pendingBackPress.current?.settle(message.type);
      return;
    }
    if (isEmbedded && isMigrationAcknowledgement(message.type)) {
      // The page cleared its own inherited sessions. Only now is the marker
      // written, so a launch where the page never acknowledged retries.
      Logger.debug('QRLWebView', 'The wallet acknowledged the inherited storage migration');
      migrationPendingRef.current = false;
      pageAcknowledged.current = true;
      // The page acknowledges while its scripts evaluate, before the load
      // event, so this is usually where the caches half gets its chance.
      void clearInheritedCaches().then(() => markMigrationDoneIfComplete());
      return;
    }
    Logger.debug('QRLWebView', 'Bridge message received', message.type);
    try {
      await NativeBridge.handle(message);
    } catch (error) {
      Logger.error('QRLWebView', 'Bridge message handling failed:', error);
    }
  };

  // The only path out of the app. react-native-webview would otherwise hand
  // anything outside originWhitelist straight to Linking.openURL, including
  // tel:, intent: and the app's own qrlconnect: pairing scheme, so embedded
  // mode whitelists every origin to force each request through this policy.
  const openExternally = useCallback((url: string) => {
    const decision = externalOpenDecision(url);
    if (decision.action !== 'open') {
      Logger.warn('QRLWebView', `Refused to open a link outside the app (${decision.reason})`);
      return;
    }
    Logger.debug('QRLWebView', 'Opening an external link outside the wallet', walletUrlOriginForLog(url));
    Linking.openURL(decision.url).catch((openError: unknown) => {
      Logger.warn('QRLWebView', 'Could not open an external link:', openError);
    });
  }, []);

  // Handle navigation requests
  const onShouldStartLoadWithRequest = (
    request: {
      url: string;
      navigationType?: string;
      isTopFrame?: boolean;
    },
    eventEpoch: number,
  ): boolean => {
    // A WebView that is being replaced can still ask to navigate. Refusing
    // without touching any state is the only safe answer: that view is going
    // away, and on iOS the guard spends the one-shot base-URL allowance, so
    // answering a stale request would consume the allowance belonging to the
    // replacement and block its own loadHTMLString, leaving a blank screen.
    if (!isCurrentEpoch(eventEpoch)) {
      Logger.warn('QRLWebView', 'Refused a navigation from a WebView that is being replaced');
      return false;
    }
    const { url } = request;

    if (isEmbedded) {
      const decision = classifyEmbeddedNavigation(request, {
        initialDocumentPending: initialDocumentPending.current,
        platform: Platform.OS,
        baseUrl: EMBEDDED_BASE_URL,
      });
      if (decision.action === 'allow') {
        if (decision.reason === 'initial-document') {
          initialDocumentPending.current = false;
        }
        return true;
      }
      if (decision.action === 'open-external') {
        openExternally(url);
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
  // storage that goes with it. There is deliberately no remote fallback in
  // this branch: a source object holding a URL must not be constructible in
  // embedded mode at all, so a future rendering mistake cannot put the live
  // page on screen.
  // Built once per epoch and then left alone. Anything that changed this
  // object mid-session would hand the WebView a new document and reload the
  // wallet under the user, so the token and the migration flag are read from
  // refs here and a new document is produced only when the epoch advances.
  const embeddedSource = useMemo(
    () => {
      if (!isEmbedded) return { uri: devUri };
      if (embeddedRawHtml === null || !migrationResolved) return null;
      const owesMigration = migrationPendingRef.current === true;
      servedMigrationPending.current = owesMigration;
      return {
        html: withEmbeddedFlag(embeddedRawHtml, documentToken.current, owesMigration),
        baseUrl: EMBEDDED_BASE_URL,
      };
    },
    // documentEpoch is what makes a new document: reloadDocument rotates the
    // token and advances the epoch together. The linter cannot see that,
    // because the token and the migration flag are read from refs so that
    // changing either cannot rebuild the document under a live session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isEmbedded, devUri, embeddedRawHtml, migrationResolved, documentEpoch],
  );

  // Embedded mode admits every origin here on purpose. This list is not a
  // security boundary: react-native-webview opens whatever falls outside it
  // with Linking.openURL before the component sees the request, so widening
  // it is what makes classifyEmbeddedNavigation the only gate.
  const originWhitelist = isEmbedded ? ['*'] : ['http://*', 'https://*'];

  // Runs at document end. Re-binds the bridge if the WebView installed
  // window.ReactNativeWebView after the document head script ran. Carries no
  // token: injected scripts run in every document the WebView loads.
  const afterContentScript = [
    isEmbedded ? EMBEDDED_REBIND_SCRIPT : null,
    Platform.OS === 'android' ? NATIVE_WEBVIEW_CAPABILITY_SCRIPT : null,
  ]
    .filter((script): script is string => script !== null)
    .join('\n') || undefined;

  const beforeContentScript = [
    isEmbedded ? EMBEDDED_FLAG_SCRIPT : null,
    Platform.OS === 'android' ? NATIVE_WEBVIEW_CAPABILITY_SCRIPT : null,
  ]
    .filter((script): script is string => script !== null)
    .join('\n') || undefined;

  // Nothing to render yet in embedded mode: the document is still being read
  // from the bundle. The loading screen below stays up.
  const documentReady = embeddedSource !== null;

  // Captured at render so every callback the WebView raises can say which
  // view it came from.
  const renderEpoch = documentEpoch;

  return (
    <View style={[styles.outerContainer, { backgroundColor: '#080C16' }]}>
      <StatusBar backgroundColor="#080C16" barStyle="light-content" />
      <View style={[styles.container, {
        backgroundColor: '#080C16',
        paddingTop: insets.top || 40,
        paddingBottom: insets.bottom
      }]}>
        {documentErrorMessage !== null ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{documentErrorMessage}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={retryLoading}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {embeddedSource ? (
            <WebView
              ref={webViewRef}
              // Remounted on a new epoch so the shipped document is handed to
              // a fresh WebView after a content-process death.
              key={isEmbedded ? `embedded-${documentEpoch}` : 'dev'}
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
              injectedJavaScript={afterContentScript}
              style={styles.webView}
              originWhitelist={originWhitelist}
              userAgent={customUserAgent}
              onShouldStartLoadWithRequest={(request) =>
                onShouldStartLoadWithRequest(request, renderEpoch)
              }
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
              onLoadStart={(event) => handleLoadStart(event, renderEpoch)}
              onLoadEnd={() => handleLoadEnd(renderEpoch)}
              onLoadProgress={({ nativeEvent }) => {
                if (!isCurrentEpoch(renderEpoch)) return;
                setLoadProgress(nativeEvent.progress);
              }}
              onNavigationStateChange={(state) =>
                handleNavigationStateChange(state, renderEpoch)
              }
              onMessage={(event) => handleMessage(event, renderEpoch)}
              onError={(event) => handleError(event, renderEpoch)}
              onContentProcessDidTerminate={() => handleContentProcessDidTerminate(renderEpoch)}
              onRenderProcessGone={() => handleContentProcessDidTerminate(renderEpoch)}

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
