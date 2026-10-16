import React, { act, createRef } from 'react';
import { BackHandler, Linking, Platform } from 'react-native';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import QRLWebView, { type QRLWebViewRef } from '../../components/QRLWebView';
import NativeBridge from '../NativeBridge';
import { isRecord } from '../guards';
import { runAsPromise } from '../runAsPromise';

function isNativeTestRenderer(value: unknown): value is {
  create: (element: React.ReactElement) => Promise<ReactTestRenderer>;
} {
  return isRecord(value) && typeof value.create === 'function';
}

const nativeTestRenderer: unknown = jest.requireActual('@react-native/jest-preset/jest/renderer');
if (!isNativeTestRenderer(nativeTestRenderer)) throw new TypeError('Missing native test renderer');

const mockWebViewNode = {
  injectJavaScript: jest.fn<undefined, [string]>(),
  reload: jest.fn(),
  goBack: jest.fn(),
  clearCache: jest.fn<undefined, [boolean]>(),
};

// Carries the markers a v3 frontend build bakes in, so the profile gate in
// QRLWebView lets it through. EmbeddedWalletProfile.test.ts covers the gate.
const V3_MARKERS =
  '<script>var n={chainId:"0x301825",genesisHash:' +
  '"0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4"};' +
  'var k="qrlwallet:v3:"+key;</script>';
const EMBEDDED_HTML =
  `<!doctype html><html lang="en"><head><title>wallet</title>${V3_MARKERS}</head><body></body></html>`;

jest.mock('react-native-webview', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    WebView: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<typeof mockWebViewNode>) => {
      React.useImperativeHandle(ref, () => mockWebViewNode);
      return React.createElement('NativeWebView', props);
    }),
  };
});
// useFocusEffect had no coverage at all, so the back handler was never
// exercised. Running the callback immediately is what the real hook does on a
// focused screen.
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: React.EffectCallback) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(() => callback(), [callback]);
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-constants', () => ({ expoConfig: { version: '1.4.2' } }));
jest.mock('../../components/QuantumLoadingScreen', () => 'QuantumLoadingScreen');
jest.mock('../Logger', () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../EmbeddedStorageMigration', () => {
  const actual = jest.requireActual<typeof import('../EmbeddedStorageMigration')>(
    '../EmbeddedStorageMigration.ts',
  );
  return {
    ...actual,
    isStorageMigrationPending: jest.fn().mockResolvedValue(true),
    markStorageMigrationDone: jest.fn().mockResolvedValue(undefined),
  };
});
jest.mock('../NativeBridge', () => ({
  setWebViewRef: jest.fn(),
  resetWebAppReady: jest.fn(),
  sendQRResult: jest.fn(),
  sendToWeb: jest.fn(),
  handle: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../EmbeddedWalletDocument', () => {
  const actual = jest.requireActual<typeof import('../EmbeddedWalletDocument')>(
    '../EmbeddedWalletDocument.ts',
  );
  // jest-expo's expo-crypto returns zero bytes, so a real token would be the
  // same string every time and a re-serve would be indistinguishable from the
  // document it replaced. Counting here keeps each load distinguishable.
  let minted = 0;
  return {
    ...actual,
    createDocumentToken: jest.fn(() => {
      minted += 1;
      return minted.toString(16).padStart(64, '0');
    }),
    loadEmbeddedWalletHtml: jest.fn(),
  };
});

const { loadEmbeddedWalletHtml } = jest.requireMock<{
  loadEmbeddedWalletHtml: jest.Mock<Promise<string>, []>;
}>('../EmbeddedWalletDocument');
const { BRIDGE_TOKEN_SEPARATOR } = jest.requireActual<typeof import('../EmbeddedWalletDocument')>(
  '../EmbeddedWalletDocument.ts',
);
const { markStorageMigrationDone, isStorageMigrationPending } = jest.requireMock<{
  markStorageMigrationDone: jest.Mock<Promise<void>, []>;
  isStorageMigrationPending: jest.Mock<Promise<boolean>, []>;
}>('../EmbeddedStorageMigration');
const nativeBridge: {
  handle: jest.MockedFunction<typeof NativeBridge.handle>;
  resetWebAppReady: jest.MockedFunction<typeof NativeBridge.resetWebAppReady>;
  sendToWeb: jest.MockedFunction<typeof NativeBridge.sendToWeb>;
} = jest.mocked(NativeBridge);

const hasType = (type: string) => (view: ReactTestInstance): boolean => view.type === type;

interface WebViewTestInstance extends ReactTestInstance {
  props: Record<string, unknown>;
}

function isWebViewTestInstance(view: ReactTestInstance): view is WebViewTestInstance {
  const props: unknown = view.props;
  return isRecord(props);
}

function readWebView(view: ReactTestInstance): WebViewTestInstance {
  if (!isWebViewTestInstance(view)) throw new Error('missing WebView props');
  return view;
}

function recordFrom(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('expected an object');
  return value;
}

function isCallback(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
}

function callbackFrom(value: unknown): (...args: unknown[]) => unknown {
  if (!isCallback(value)) throw new TypeError('expected a callback');
  return value;
}

function callProp(props: Record<string, unknown>, key: string, ...args: unknown[]): unknown {
  return Reflect.apply(callbackFrom(props[key]), props, args);
}

/** The token the component minted for the document currently on screen. */
const documentTokenFrom = (html: unknown): string => {
  if (typeof html !== 'string') throw new Error('no document token in the served html');
  const match = /var t="([0-9a-f]{64})/.exec(html);
  if (!match || match[1] === undefined) throw new Error('no document token in the served html');
  return match[1];
};

describe('WebView test callback boundary', () => {
  it('preserves the receiver, argument shapes and return values', () => {
    const callback = jest.fn((...args: unknown[]) => args[0]);
    const props = { onMessage: callback };
    const payload = { nativeEvent: { data: 'message', extra: true } };
    for (const value of [undefined, null, false, 0, 5n, '0x12', [], {}, payload]) {
      expect(callProp(props, 'onMessage', value, payload)).toBe(value);
      expect(callback).toHaveBeenLastCalledWith(value, payload);
      expect(callback.mock.contexts.at(-1)).toBe(props);
    }
  });

  it('returns a callback promise unchanged', async () => {
    const result = Promise.resolve({ success: true });
    const callback = jest.fn(() => result);
    const props = { onMessage: callback };
    expect(callProp(props, 'onMessage')).toBe(result);
    expect(callback).toHaveBeenCalledTimes(1);
    await expect(result).resolves.toEqual({ success: true });
  });

  it('propagates synchronous failures and rejected promises', async () => {
    const failure = new Error('Callback failed');
    expect(() => callProp({ onMessage: () => { throw failure; } }, 'onMessage'))
      .toThrow(failure);
    await expect(callProp({ onMessage: () => Promise.reject(failure) }, 'onMessage'))
      .rejects.toBe(failure);
  });
});

describe('embedded QRLWebView', () => {
  let screen: ReactTestRenderer;
  const runtime: Record<string, unknown> = globalThis;
  const originalDev = __DEV__;

  // BackHandler is not a jest mock under jest-expo, so the registered
  // hardwareBackPress handler is captured here to be pressed directly.
  const backHandlers: Array<() => boolean> = [];
  let exitApp: jest.SpyInstance<ReturnType<typeof BackHandler.exitApp>, []>;

  const renderEmbedded = async (ref?: React.Ref<QRLWebViewRef>) => {
    await act(async () => {
      screen = await nativeTestRenderer.create(<QRLWebView ref={ref} webSource="embedded" />);
    });
    // Let the document read settle.
    await act(async () => {
      await Promise.resolve();
    });
    return readWebView(screen.root.find(hasType('NativeWebView')));
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    runtime.__DEV__ = false;
    mockWebViewNode.injectJavaScript.mockClear();
    mockWebViewNode.clearCache.mockClear();
    mockWebViewNode.goBack.mockClear();
    backHandlers.length = 0;
    exitApp = jest.spyOn(BackHandler, 'exitApp').mockImplementation(() => true);
    jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((_event, handler) => {
        backHandlers.push(() => handler({ type: 'hardwareBackPress', timeStamp: Date.now() }) === true);
        return {
          remove: () => {
            backHandlers.length = 0;
          },
        };
      });
    loadEmbeddedWalletHtml.mockResolvedValue(EMBEDDED_HTML);
    isStorageMigrationPending.mockResolvedValue(true);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await act(() => runAsPromise(() => { screen.unmount(); }));
    runtime.__DEV__ = originalDev;
    jest.useRealTimers();
  });

  it('serves the bundled document under the production base URL', async () => {
    const view = await renderEmbedded();
    const expectedHtml: unknown = expect.stringContaining('window.__QRL_EMBEDDED__ = true;');
    expect(view.props.source).toEqual({
      html: expectedHtml,
      baseUrl: 'https://qrlwallet.com/',
    });
    // The bootstrap has to be the first script in the head, ahead of the
    // wallet's own scripts.
    const html = recordFrom(view.props.source).html;
    if (typeof html !== 'string') throw new Error('missing embedded html');
    expect(html).toContain('<head><script>(function(){window.__QRL_EMBEDDED__ = true;');
    expect(html.indexOf('__QRL_EMBEDDED__')).toBeLessThan(html.indexOf('<title>'));
    // Deliberately open: react-native-webview opens anything outside this
    // list with Linking.openURL before the component sees it, so widening it
    // is what makes the navigation policy the only gate.
    expect(view.props.originWhitelist).toEqual(['*']);
    expect(view.props.mixedContentMode).toBe('never');
    expect(view.props.userAgent).toContain('MyQRLWallet/1.4.2');
  });

  it('sets the embedded flag through the before-content hook as well', async () => {
    const view = await renderEmbedded();
    expect(view.props.injectedJavaScriptBeforeContentLoaded).toContain(
      'window.__QRL_EMBEDDED__ = true;',
    );
  });

  it('keeps the Android capability script alongside the embedded flag', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderEmbedded();
    expect(view.props.injectedJavaScriptBeforeContentLoaded).toContain(
      'window.__QRL_EMBEDDED__ = true;',
    );
    expect(view.props.injectedJavaScriptBeforeContentLoaded).toContain('injectedObjectJson');
    expect(view.props.injectedJavaScript).toContain('injectedObjectJson');
    const capabilities: unknown = expect.any(Object);
    expect(view.props.injectedJavaScriptObject).toEqual(
      expect.objectContaining({ qrlWalletCapabilities: capabilities }),
    );
  });

  it('admits the injected document once and every fragment, and refuses a live reload', async () => {
    const view = await renderEmbedded();
    const guard = callbackFrom(view.props.onShouldStartLoadWithRequest);
    expect(guard({ url: 'https://qrlwallet.com/' })).toBe(true);
    expect(guard({ url: 'https://qrlwallet.com/#/transfer' })).toBe(true);
    expect(guard({ url: 'https://qrlwallet.com/' })).toBe(false);
    expect(guard({ url: 'https://qrlwallet.com/transfer' })).toBe(false);
  });

  it('never admits a base URL navigation on Android', async () => {
    // loadDataWithBaseURL does not go through shouldOverrideUrlLoading, so any
    // base-URL request that reaches the guard is a navigation the page asked
    // for and would fetch the live page.
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderEmbedded();
    expect(callProp(view.props, 'onShouldStartLoadWithRequest', { url: 'https://qrlwallet.com/' })).toBe(false);
    await act(() => runAsPromise(() =>
      callProp(view.props, 'onLoadStart', { nativeEvent: { newDocument: true, loading: true } })));
    expect(callProp(view.props, 'onShouldStartLoadWithRequest', { url: 'https://qrlwallet.com/' })).toBe(false);
    // A hash route inside the document is still fine.
    expect(
      callProp(view.props, 'onShouldStartLoadWithRequest', { url: 'https://qrlwallet.com/#/transfer' }),
    ).toBe(true);
  });

  it('refuses a reload navigation that would fetch the live page', async () => {
    const view = await renderEmbedded();
    for (const navigationType of ['reload', 'backforward', 'formsubmit', 'formresubmit']) {
      expect(
        callProp(view.props, 'onShouldStartLoadWithRequest', {
          url: 'https://qrlwallet.com/',
          navigationType,
        }),
      ).toBe(false);
    }
    // A hash traversal is the wallet's own back arrow, and is allowed.
    expect(
      callProp(view.props, 'onShouldStartLoadWithRequest', {
        url: 'https://qrlwallet.com/#/transfer',
        navigationType: 'backforward',
      }),
    ).toBe(true);
  });

  it('admits the document again after a recovery reload on iOS only', async () => {
    const ref = createRef<QRLWebViewRef>();
    const view = await renderEmbedded(ref);
    callProp(view.props, 'onShouldStartLoadWithRequest', { url: 'https://qrlwallet.com/' });
    expect(callProp(view.props, 'onShouldStartLoadWithRequest', { url: 'https://qrlwallet.com/' })).toBe(false);
    await act(() => runAsPromise(() => { ref.current?.reload(); }));
    const reloaded = readWebView(screen.root.find(hasType('NativeWebView')));
    expect(callProp(reloaded.props, 'onShouldStartLoadWithRequest', { url: 'https://qrlwallet.com/' })).toBe(true);
  });

  it('opens a foreign origin outside the app instead of loading it', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const view = await renderEmbedded();
    expect(callProp(view.props, 'onShouldStartLoadWithRequest', { url: 'https://zondscan.com/tx/0x1' })).toBe(false);
    expect(openURL).toHaveBeenCalledWith('https://zondscan.com/tx/0x1');
  });

  it('refuses to hand a scheme the OS would act on to Linking', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const view = await renderEmbedded();
    for (const url of ['qrlconnect://?q=PAYLOAD', 'intent://x#Intent;scheme=https;end', 'tel:+31']) {
      expect(callProp(view.props, 'onShouldStartLoadWithRequest', { url })).toBe(false);
    }
    expect(openURL).not.toHaveBeenCalled();
  });

  it('never hands a qrlwallet.com document to the system browser', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const view = await renderEmbedded();
    const guard = callbackFrom(view.props.onShouldStartLoadWithRequest);
    guard({ url: 'https://qrlwallet.com/' });
    expect(guard({ url: 'https://qrlwallet.com/' })).toBe(false);
    expect(guard({ url: 'https://qrlwallet.com/transfer' })).toBe(false);
    expect(openURL).not.toHaveBeenCalled();
  });

  it('re-serves the document after the content process dies', async () => {
    const view = await renderEmbedded();
    const servedToken = documentTokenFrom(recordFrom(view.props.source).html);
    // The guard has consumed the one allowed base-URL load.
    callProp(view.props, 'onShouldStartLoadWithRequest', { url: 'https://qrlwallet.com/' });
    expect(callProp(view.props, 'onShouldStartLoadWithRequest', { url: 'https://qrlwallet.com/' })).toBe(false);

    await act(() => runAsPromise(() => callProp(view.props, 'onContentProcessDidTerminate')));
    expect(nativeBridge.resetWebAppReady).toHaveBeenCalled();

    const recovered = readWebView(screen.root.find(hasType('NativeWebView')));
    expect(recordFrom(recovered.props.source).baseUrl).toBe('https://qrlwallet.com/');
    // The same document, with a fresh token.
    expect(documentTokenFrom(recordFrom(recovered.props.source).html)).not.toBe(servedToken);
    // A fresh document load is admitted again.
    expect(callProp(recovered.props, 'onShouldStartLoadWithRequest', { url: 'https://qrlwallet.com/' })).toBe(true);
  });

  it('recovers the same way from an Android render process death', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderEmbedded();
    expect(typeof callbackFrom(view.props.onRenderProcessGone)).toBe('function');
    const servedToken = documentTokenFrom(recordFrom(view.props.source).html);
    callProp(view.props, 'onShouldStartLoadWithRequest', { url: 'https://qrlwallet.com/' });
    await act(() => runAsPromise(() => callProp(view.props, 'onRenderProcessGone', { nativeEvent: { didCrash: true } })));
    const recovered = readWebView(screen.root.find(hasType('NativeWebView')));
    // Android recovery re-serves the string through loadDataWithBaseURL, which
    // never consults the guard, so the base URL stays refused there.
    expect(recordFrom(recovered.props.source).baseUrl).toBe('https://qrlwallet.com/');
    expect(documentTokenFrom(recordFrom(recovered.props.source).html)).not.toBe(servedToken);
    expect(callProp(recovered.props, 'onShouldStartLoadWithRequest', { url: 'https://qrlwallet.com/' })).toBe(false);
    expect(
      callProp(recovered.props, 'onShouldStartLoadWithRequest', { url: 'https://qrlwallet.com/#/' }),
    ).toBe(true);
  });

  it('reloads through the ref by handing the document over again', async () => {
    const ref = createRef<QRLWebViewRef>();
    const view = await renderEmbedded(ref);
    callProp(view.props, 'onShouldStartLoadWithRequest', { url: 'https://qrlwallet.com/' });
    await act(() => runAsPromise(() => { ref.current?.reload(); }));
    const reloaded = readWebView(screen.root.find(hasType('NativeWebView')));
    expect(callProp(reloaded.props, 'onShouldStartLoadWithRequest', { url: 'https://qrlwallet.com/' })).toBe(true);
  });

  it('applies a deep-link route as a fragment change and refuses anything else', async () => {
    const ref = createRef<QRLWebViewRef>();
    await renderEmbedded(ref);
    expect(ref.current?.navigateToEmbeddedRoute('#/transfer')).toBe(true);
    expect(mockWebViewNode.injectJavaScript).toHaveBeenCalledTimes(1);
    const script = mockWebViewNode.injectJavaScript.mock.calls[0]?.[0];
    expect(script).toContain('window.location.hash="/transfer"');

    mockWebViewNode.injectJavaScript.mockClear();
    mockWebViewNode.clearCache.mockClear();
    mockWebViewNode.goBack.mockClear();
    backHandlers.length = 0;
    exitApp = jest.spyOn(BackHandler, 'exitApp').mockImplementation(() => true);
    jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((_event, handler) => {
        backHandlers.push(() => handler({ type: 'hardwareBackPress', timeStamp: Date.now() }) === true);
        return {
          remove: () => {
            backHandlers.length = 0;
          },
        };
      });
    for (const route of [
      '/transfer',
      '#/transfer";window.stealSeed()//',
      '#/transfer?x=<script>',
      `#/${'a'.repeat(300)}`,
      'javascript:alert(1)',
    ]) {
      expect(ref.current?.navigateToEmbeddedRoute(route)).toBe(false);
    }
    expect(mockWebViewNode.injectJavaScript).not.toHaveBeenCalled();
  });

  it('does not route the document in dev mode', async () => {
    const ref = createRef<QRLWebViewRef>();
    await act(async () => {
      screen = await nativeTestRenderer.create(<QRLWebView ref={ref} webSource="dev" />);
    });
    expect(ref.current?.navigateToEmbeddedRoute('#/transfer')).toBe(false);
    expect(mockWebViewNode.injectJavaScript).not.toHaveBeenCalled();
  });

  it('refuses a bundled wallet built for another network', async () => {
    // Without this gate the mismatch only surfaces as a failed seed backup,
    // after the user has imported a seed and set a transaction PIN.
    loadEmbeddedWalletHtml.mockResolvedValue(
      '<!doctype html><html><head><title>v2</title></head><body></body></html>',
    );
    await act(async () => {
      screen = await nativeTestRenderer.create(<QRLWebView webSource="embedded" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.root.findAll(hasType('NativeWebView'))).toHaveLength(0);
    const text = JSON.stringify(screen.toJSON());
    expect(text).toContain('wrong network');
    expect(text).toContain('TEST_NET_V3');
  });

  it('accepts a bridge message only when it carries the document token', async () => {
    // The origin check accepts any document on qrlwallet.com, so the token is
    // what ties bridge authority to the document this app actually served.
    const view = await renderEmbedded();
    const token = documentTokenFrom(recordFrom(view.props.source).html);
    const message = JSON.stringify({ type: 'SEED_STORED', payload: { address: 'Q00' } });

    nativeBridge.handle.mockClear();
    await act(() => runAsPromise(() =>
      callProp(view.props, 'onMessage', {
        nativeEvent: { data: message, url: 'https://qrlwallet.com/' },
      })));
    expect(nativeBridge.handle).not.toHaveBeenCalled();

    await act(() => runAsPromise(() =>
      callProp(view.props, 'onMessage', {
        nativeEvent: {
          data: `${'f'.repeat(64)}${BRIDGE_TOKEN_SEPARATOR}${message}`,
          url: 'https://qrlwallet.com/',
        },
      })));
    expect(nativeBridge.handle).not.toHaveBeenCalled();

    await act(() => runAsPromise(() =>
      callProp(view.props, 'onMessage', {
        nativeEvent: {
          data: `${token}${BRIDGE_TOKEN_SEPARATOR}${message}`,
          url: 'https://qrlwallet.com/',
        },
      })));
    expect(nativeBridge.handle).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SEED_STORED' }),
    );
  });

  it('re-serves the rebind script so a late bridge still gets bound', async () => {
    const view = await renderEmbedded();
    expect(view.props.injectedJavaScript).toContain('__qrlBindBridge');
    // The rebind script must carry no token: injected scripts run in every
    // document the WebView loads, including one that is not ours.
    expect(view.props.injectedJavaScript).not.toMatch(/[0-9a-f]{64}/);
    expect(view.props.injectedJavaScriptBeforeContentLoaded).not.toMatch(/[0-9a-f]{64}/);
  });

  it('takes a bridge message in dev mode without any token', async () => {
    await act(async () => {
      screen = await nativeTestRenderer.create(<QRLWebView webSource="dev" />);
    });
    const view = readWebView(screen.root.find(hasType('NativeWebView')));
    nativeBridge.handle.mockClear();
    await act(() => runAsPromise(() =>
      callProp(view.props, 'onMessage', {
        nativeEvent: {
          data: JSON.stringify({ type: 'SEED_STORED', payload: {} }),
          url: 'https://qrlwallet.com/',
        },
      })));
    expect(nativeBridge.handle).toHaveBeenCalledTimes(1);
  });

  it('pushes a second document in one load back out', async () => {
    // Android reports no navigation type, so a page-initiated reload of a
    // hash URL satisfies the fragment rule. What it cannot fake is being the
    // only document this load served. The native interceptor is the first
    // layer; this is the second.
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderEmbedded();
    const servedToken = documentTokenFrom(recordFrom(view.props.source).html);
    await act(() => runAsPromise(() =>
      callProp(view.props, 'onLoadStart', { nativeEvent: { newDocument: true, loading: true } })));
    expect(nativeBridge.resetWebAppReady).toHaveBeenCalledTimes(1);

    await act(() => runAsPromise(() =>
      callProp(view.props, 'onLoadStart', { nativeEvent: { newDocument: true, loading: true } })));
    const recovered = readWebView(screen.root.find(hasType('NativeWebView')));
    expect(recordFrom(recovered.props.source).baseUrl).toBe('https://qrlwallet.com/');
    // A fresh token, so a message held by the document that was pushed out
    // cannot be replayed into the one that replaced it.
    expect(documentTokenFrom(recordFrom(recovered.props.source).html)).not.toBe(servedToken);
    expect(nativeBridge.resetWebAppReady).toHaveBeenCalledTimes(2);
  });

  it('leaves the wallet router alone when it replaces state during module init', async () => {
    // The regression that put the app on the error screen on every cold
    // start: React Router calls history.replaceState while the page is still
    // loading, and that event arrives with loading:true.
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderEmbedded();
    const servedToken = documentTokenFrom(recordFrom(view.props.source).html);
    await act(() => runAsPromise(() =>
      callProp(view.props, 'onLoadStart', { nativeEvent: { newDocument: true, loading: true } })));
    for (let update = 0; update < 5; update += 1) {
      await act(() => runAsPromise(() =>
        callProp(view.props, 'onLoadStart', { nativeEvent: { newDocument: false, loading: true } })));
    }
    const same = readWebView(screen.root.find(hasType('NativeWebView')));
    expect(documentTokenFrom(recordFrom(same.props.source).html)).toBe(servedToken);
    expect(nativeBridge.resetWebAppReady).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(screen.toJSON())).not.toContain('replaced by another page');
  });

  it('ignores a dying view trailing history update after the epoch moved on', async () => {
    // The exact device sequence. A reload makes the epoch-N view foreign, the
    // guard remounts, and the old view then delivers its own
    // doUpdateVisitedHistory. Before the epoch check that late event claimed
    // the new document's first-load slot, so the replacement's real
    // onPageStarted looked like a second document and the counter climbed to
    // the error screen on about one reload in two.
    jest.replaceProperty(Platform, 'OS', 'android');
    const first = await renderEmbedded();
    // Captured while the view is still mounted: react-test-renderer drops the
    // props of a removed node, and the point here is a callback that outlives
    // the view that raised it.
    const firstLoadStart = callbackFrom(first.props.onLoadStart);
    await act(() => runAsPromise(() => firstLoadStart({ nativeEvent: { newDocument: true, loading: true } })));
    // The page reloads itself: a second document start for this epoch.
    await act(() => runAsPromise(() => firstLoadStart({ nativeEvent: { newDocument: true, loading: true } })));
    const second = readWebView(screen.root.find(hasType('NativeWebView')));
    const secondToken = documentTokenFrom(recordFrom(second.props.source).html);

    // The dying view's trailing event, delivered after the remount.
    await act(() => runAsPromise(() => firstLoadStart({ nativeEvent: { newDocument: false, loading: true } })));
    // The replacement's real document start must be accepted, not counted.
    await act(() => runAsPromise(() =>
      callProp(second.props, 'onLoadStart', { nativeEvent: { newDocument: true, loading: true } })));

    const settled = readWebView(screen.root.find(hasType('NativeWebView')));
    expect(documentTokenFrom(recordFrom(settled.props.source).html)).toBe(secondToken);
    expect(JSON.stringify(screen.toJSON())).not.toContain('replaced by another page');
  });

  it('keeps a dying view from spending the replacement document allowance', async () => {
    // iOS admits the injected document once per load, and the guard spends
    // that allowance. A navigation request from the view being replaced would
    // otherwise consume the allowance belonging to its replacement, so the
    // replacement's own loadHTMLString would be refused and the screen would
    // stay blank.
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const ref = createRef<QRLWebViewRef>();
    const first = await renderEmbedded(ref);
    const staleGuard = callbackFrom(first.props.onShouldStartLoadWithRequest);
    // The first view uses its own allowance.
    expect(staleGuard({ url: 'https://qrlwallet.com/' })).toBe(true);

    await act(() => runAsPromise(() => { ref.current?.reload(); }));
    const second = readWebView(screen.root.find(hasType('NativeWebView')));

    // The dying view asks to navigate after the remount.
    expect(staleGuard({ url: 'https://qrlwallet.com/' })).toBe(false);
    expect(staleGuard({ url: 'https://qrlwallet.com/#/transfer' })).toBe(false);
    expect(staleGuard({ url: 'https://zondscan.com/' })).toBe(false);
    // And a view on its way out cannot launch the browser either.
    expect(openURL).not.toHaveBeenCalled();

    // The replacement's own document load is still admitted.
    expect(callProp(second.props, 'onShouldStartLoadWithRequest', { url: 'https://qrlwallet.com/' })).toBe(true);
  });

  it('drops every callback from a view that is no longer on screen', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const first = await renderEmbedded();
    const stale = {
      loadStart: callbackFrom(first.props.onLoadStart),
      error: callbackFrom(first.props.onError),
      terminate: callbackFrom(first.props.onContentProcessDidTerminate),
      loadEnd: callbackFrom(first.props.onLoadEnd),
    };
    await act(() => runAsPromise(() => stale.loadStart({ nativeEvent: { newDocument: true, loading: true } })));
    await act(() => runAsPromise(() => stale.loadStart({ nativeEvent: { newDocument: true, loading: true } })));
    const second = readWebView(screen.root.find(hasType('NativeWebView')));
    const secondToken = documentTokenFrom(recordFrom(second.props.source).html);

    // A stale error would blank the wallet, and a stale terminate would
    // remount the document that just replaced it.
    await act(() => runAsPromise(() => stale.error({ nativeEvent: { description: 'stale failure' } })));
    await act(() => runAsPromise(() => stale.terminate()));
    await act(() => runAsPromise(() => stale.loadEnd()));

    const settled = readWebView(screen.root.find(hasType('NativeWebView')));
    expect(documentTokenFrom(recordFrom(settled.props.source).html)).toBe(secondToken);
    expect(JSON.stringify(screen.toJSON())).not.toContain('stale failure');
  });

  it('survives repeated reloads once each new document binds the bridge', async () => {
    // The counter used to be reset only by Retry, so a fourth well-spaced
    // reload over the app's lifetime reached the error screen.
    jest.replaceProperty(Platform, 'OS', 'android');
    let view = await renderEmbedded();
    await act(() => runAsPromise(() =>
      callProp(view.props, 'onLoadStart', { nativeEvent: { newDocument: true, loading: true } })));
    for (let reload = 0; reload < 6; reload += 1) {
      await act(() => runAsPromise(() =>
        callProp(view.props, 'onLoadStart', { nativeEvent: { newDocument: true, loading: true } })));
      view = readWebView(screen.root.find(hasType('NativeWebView')));
      await act(() => runAsPromise(() =>
        callProp(view.props, 'onLoadStart', { nativeEvent: { newDocument: true, loading: true } })));
      // The replacement proves it is ours.
      const token = documentTokenFrom(recordFrom(view.props.source).html);
      await act(() => runAsPromise(() =>
        callProp(view.props, 'onMessage', {
          nativeEvent: {
            data: `${token}${BRIDGE_TOKEN_SEPARATOR}${JSON.stringify({ type: 'WEB_APP_READY' })}`,
            url: 'https://qrlwallet.com/',
          },
        })));
    }
    expect(screen.root.findAll(hasType('NativeWebView'))).toHaveLength(1);
    expect(JSON.stringify(screen.toJSON())).not.toContain('replaced by another page');
  });

  it('gives up loudly if a foreign document keeps coming back', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderEmbedded();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const current = screen.root.findAll(hasType('NativeWebView'))[0];
      if (!current) break;
      // One accepted document start, then a second one in the same load.
      await act(() => runAsPromise(() =>
        callProp(readWebView(current).props, 'onLoadStart', { nativeEvent: { newDocument: true, loading: true } })));
      await act(() => runAsPromise(() =>
        callProp(readWebView(current).props, 'onLoadStart', { nativeEvent: { newDocument: true, loading: true } })));
    }
    expect(screen.root.findAll(hasType('NativeWebView'))).toHaveLength(0);
    expect(JSON.stringify(screen.toJSON())).toContain('replaced by another page');
  });

  it('refuses to run on Android when the WebView patch is missing', async () => {
    // The Android protections all live in the patch: the request interceptor,
    // the fail-closed navigation check and the document tag. A patch that
    // applied but lost content would leave the wallet running with none of
    // them, so an untagged load event is treated as the missing patch.
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderEmbedded();
    await act(() => runAsPromise(() => callProp(view.props, 'onLoadStart', { nativeEvent: { loading: true } })));
    const text = JSON.stringify(screen.toJSON());
    expect(text).toContain('missing a required WebView protection');
    expect(screen.root.findAll(hasType('NativeWebView'))).toHaveLength(0);
  });

  it('accepts an untagged load event on iOS, where the patch does not apply', async () => {
    const view = await renderEmbedded();
    await act(() => runAsPromise(() => callProp(view.props, 'onLoadStart', { nativeEvent: { loading: true } })));
    expect(JSON.stringify(screen.toJSON())).not.toContain('missing a required WebView protection');
    expect(screen.root.findAll(hasType('NativeWebView'))).toHaveLength(1);
  });

  it('leaves an Android same-document history update alone', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderEmbedded();
    const servedToken = documentTokenFrom(recordFrom(view.props.source).html);
    await act(() => runAsPromise(() =>
      callProp(view.props, 'onLoadStart', { nativeEvent: { newDocument: true, loading: true } })));
    // The wallet's own hash routes report a history update.
    await act(() => runAsPromise(() =>
      callProp(view.props, 'onLoadStart', { nativeEvent: { newDocument: false, loading: false } })));
    const same = readWebView(screen.root.find(hasType('NativeWebView')));
    expect(documentTokenFrom(recordFrom(same.props.source).html)).toBe(servedToken);
    expect(nativeBridge.resetWebAppReady).toHaveBeenCalledTimes(1);
  });

  it('tells the document whether it still owes the inherited storage pass', async () => {
    const view = await renderEmbedded();
    expect(recordFrom(view.props.source).html).toContain('window.__QRL_EMBEDDED_MIGRATION__ = true;');
  });

  it('tells an already migrated install it owes nothing', async () => {
    isStorageMigrationPending.mockResolvedValue(false);
    const view = await renderEmbedded();
    expect(recordFrom(view.props.source).html).toContain('window.__QRL_EMBEDDED_MIGRATION__ = false;');
    // And it does not clear caches on a launch that has already been through.
    expect(mockWebViewNode.clearCache).not.toHaveBeenCalled();
  });

  it('runs the whole handshake once for an upgraded install', async () => {
    // The real order on device: the page runs its migration while its scripts
    // evaluate, so the acknowledgement reaches native before the load event.
    // Gating the caches half on the live pending flag meant it never ran, and
    // the marker was written anyway so no later launch retried.
    const view = await renderEmbedded();
    const token = documentTokenFrom(recordFrom(view.props.source).html);
    expect(recordFrom(view.props.source).html).toContain('window.__QRL_EMBEDDED_MIGRATION__ = true;');

    const ack = `${token}${BRIDGE_TOKEN_SEPARATOR}${JSON.stringify({
      type: 'EMBEDDED_MIGRATION_DONE',
    })}`;
    await act(() => runAsPromise(() => callProp(view.props, 'onMessage', { nativeEvent: { data: ack, url: 'https://qrlwallet.com/' } })));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Both halves ran, in that order, and only then was the marker written.
    expect(mockWebViewNode.clearCache).toHaveBeenCalledWith(true);
    expect(mockWebViewNode.injectJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('serviceWorker'),
    );
    expect(markStorageMigrationDone).toHaveBeenCalledTimes(1);
    expect(nativeBridge.handle).not.toHaveBeenCalled();

    // A repeat acknowledgement does not record it twice.
    await act(() => runAsPromise(() => callProp(view.props, 'onMessage', { nativeEvent: { data: ack, url: 'https://qrlwallet.com/' } })));
    await act(async () => {
      await Promise.resolve();
    });
    expect(markStorageMigrationDone).toHaveBeenCalledTimes(1);
  });

  it('does not write the marker when only one half has run', async () => {
    // The caches half alone is not the whole pass, and an install that never
    // heard from the page has to retry on the next launch.
    const view = await renderEmbedded();
    await act(() => runAsPromise(() => callProp(view.props, 'onLoadEnd')));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockWebViewNode.clearCache).toHaveBeenCalledWith(true);
    expect(markStorageMigrationDone).not.toHaveBeenCalled();
  });

  it('keeps the native half in step with what the served document was told', async () => {
    // The live flag can flip after the document was built. The native half
    // must agree with the document it is running against, or it clears
    // pairings a document that was told it owes nothing has already restored.
    isStorageMigrationPending.mockResolvedValue(false);
    const view = await renderEmbedded();
    expect(recordFrom(view.props.source).html).toContain('window.__QRL_EMBEDDED_MIGRATION__ = false;');
    await act(() => runAsPromise(() => callProp(view.props, 'onLoadEnd')));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockWebViewNode.clearCache).not.toHaveBeenCalled();
    expect(markStorageMigrationDone).not.toHaveBeenCalled();
  });

  it('does not re-serve the document when the page acknowledges', async () => {
    // The acknowledgement used to change state that fed the document string,
    // so the WebView was handed a new document mid-session and the wallet
    // reloaded under the user, possibly through a PIN entry. The rendered
    // document must be a function of the epoch alone.
    const view = await renderEmbedded();
    const servedSource = recordFrom(view.props.source);
    const token = documentTokenFrom(servedSource.html);
    expect(servedSource.html).toContain('window.__QRL_EMBEDDED_MIGRATION__ = true;');
    await act(() => runAsPromise(() => callProp(view.props, 'onLoadStart', { nativeEvent: { newDocument: true, loading: true } })));
    await act(() => runAsPromise(() => callProp(view.props, 'onLoadEnd')));

    await act(() => runAsPromise(() =>
      callProp(view.props, 'onMessage', {
        nativeEvent: {
          data: `${token}${BRIDGE_TOKEN_SEPARATOR}${JSON.stringify({
            type: 'EMBEDDED_MIGRATION_DONE',
          })}`,
          url: 'https://qrlwallet.com/',
        },
      })));

    const after = readWebView(screen.root.find(hasType('NativeWebView')));
    // Referentially identical, so react-native-webview has nothing to reload.
    expect(after.props.source).toBe(servedSource);
    expect(recordFrom(after.props.source).html).toContain('window.__QRL_EMBEDDED_MIGRATION__ = true;');
    expect(nativeBridge.resetWebAppReady).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(screen.toJSON())).not.toContain('replaced by another page');
  });

  it('hands the next document the acknowledged state, not the old flag', async () => {
    const ref = createRef<QRLWebViewRef>();
    const view = await renderEmbedded(ref);
    const token = documentTokenFrom(recordFrom(view.props.source).html);
    await act(() => runAsPromise(() =>
      callProp(view.props, 'onMessage', {
        nativeEvent: {
          data: `${token}${BRIDGE_TOKEN_SEPARATOR}${JSON.stringify({
            type: 'EMBEDDED_MIGRATION_DONE',
          })}`,
          url: 'https://qrlwallet.com/',
        },
      })));
    await act(() => runAsPromise(() => { ref.current?.reload(); }));
    const next = readWebView(screen.root.find(hasType('NativeWebView')));
    expect(recordFrom(next.props.source).html).toContain('window.__QRL_EMBEDDED_MIGRATION__ = false;');
  });

  it('records the migration only once the page acknowledges it', async () => {
    const view = await renderEmbedded();
    const token = documentTokenFrom(recordFrom(view.props.source).html);
    expect(markStorageMigrationDone).not.toHaveBeenCalled();
    await act(() => runAsPromise(() =>
      callProp(view.props, 'onMessage', {
        nativeEvent: {
          data: `${token}${BRIDGE_TOKEN_SEPARATOR}${JSON.stringify({
            type: 'EMBEDDED_MIGRATION_DONE',
          })}`,
          url: 'https://qrlwallet.com/',
        },
      })));
    expect(markStorageMigrationDone).toHaveBeenCalledTimes(1);
    // It is not a bridge message: NativeBridge never sees it.
    expect(nativeBridge.handle).not.toHaveBeenCalled();
  });

  it('ignores an acknowledgement that does not carry the document token', async () => {
    const view = await renderEmbedded();
    await act(() => runAsPromise(() =>
      callProp(view.props, 'onMessage', {
        nativeEvent: {
          data: JSON.stringify({ type: 'EMBEDDED_MIGRATION_DONE' }),
          url: 'https://qrlwallet.com/',
        },
      })));
    expect(markStorageMigrationDone).not.toHaveBeenCalled();
  });

  const pressBack = async () => {
    const handler = backHandlers.at(-1);
    if (!handler) throw new Error('no hardwareBackPress handler registered');
    let consumed = false;
    await act(() => runAsPromise(() => {
      consumed = handler();
    }));
    return consumed;
  };

  const bindBridge = async (view: WebViewTestInstance) => {
    const props = view.props;
    const token = documentTokenFrom(recordFrom(props.source).html);
    await act(() => runAsPromise(() =>
      callProp(props, 'onMessage', {
        nativeEvent: {
          data: `${token}${BRIDGE_TOKEN_SEPARATOR}${JSON.stringify({ type: 'WEB_APP_READY' })}`,
          url: 'https://qrlwallet.com/',
        },
      })));
    return token;
  };

  it('asks the page what a back press should mean', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderEmbedded();
    const token = await bindBridge(view);
    nativeBridge.sendToWeb.mockClear();

    expect(await pressBack()).toBe(true);
    expect(nativeBridge.sendToWeb).toHaveBeenCalledWith({ type: 'NATIVE_BACK' });
    // Nothing happens to the WebView until the page answers.
    expect(mockWebViewNode.goBack).not.toHaveBeenCalled();
    expect(exitApp).not.toHaveBeenCalled();

    await act(() => runAsPromise(() =>
      callProp(view.props, 'onMessage', {
        nativeEvent: {
          data: `${token}${BRIDGE_TOKEN_SEPARATOR}${JSON.stringify({ type: 'BACK_HANDLED' })}`,
          url: 'https://qrlwallet.com/',
        },
      })));
    expect(mockWebViewNode.goBack).not.toHaveBeenCalled();
    expect(exitApp).not.toHaveBeenCalled();
  });

  it('backgrounds the app when the page is at its root', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderEmbedded();
    const token = await bindBridge(view);
    await pressBack();
    await act(() => runAsPromise(() =>
      callProp(view.props, 'onMessage', {
        nativeEvent: {
          data: `${token}${BRIDGE_TOKEN_SEPARATOR}${JSON.stringify({ type: 'BACK_AT_ROOT' })}`,
          url: 'https://qrlwallet.com/',
        },
      })));
    expect(exitApp).toHaveBeenCalledTimes(1);
    expect(mockWebViewNode.goBack).not.toHaveBeenCalled();
  });

  it('falls back to the WebView history when the page does not answer', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderEmbedded();
    await bindBridge(view);
    await act(() => runAsPromise(() =>
      callProp(view.props, 'onNavigationStateChange', { url: 'https://qrlwallet.com/#/x', loading: false, canGoBack: true })));
    await pressBack();
    await act(() => runAsPromise(() => {
      jest.advanceTimersByTime(1000);
    }));
    expect(mockWebViewNode.goBack).toHaveBeenCalledTimes(1);
    expect(exitApp).not.toHaveBeenCalled();
  });

  it('leaves the app when nothing answers and there is no history', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderEmbedded();
    await bindBridge(view);
    await act(() => runAsPromise(() =>
      callProp(view.props, 'onNavigationStateChange', { url: 'https://qrlwallet.com/', loading: false, canGoBack: false })));
    await pressBack();
    await act(() => runAsPromise(() => {
      jest.advanceTimersByTime(1000);
    }));
    expect(exitApp).toHaveBeenCalledTimes(1);
    expect(mockWebViewNode.goBack).not.toHaveBeenCalled();
  });

  it('never calls goBack blindly when the bridge has not bound', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderEmbedded();
    nativeBridge.sendToWeb.mockClear();
    expect(await pressBack()).toBe(true);
    // No document to ask, and the WebView reports no history.
    expect(nativeBridge.sendToWeb).not.toHaveBeenCalled();
    expect(mockWebViewNode.goBack).not.toHaveBeenCalled();
    expect(exitApp).toHaveBeenCalledTimes(1);
  });

  it('shows the loading screen until the bundled document has been read', async () => {
    let resolveHtml: ((html: string) => void) | undefined;
    loadEmbeddedWalletHtml.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveHtml = resolve;
      }),
    );
    await act(async () => {
      screen = await nativeTestRenderer.create(<QRLWebView webSource="embedded" />);
    });
    expect(screen.root.findAll(hasType('NativeWebView'))).toHaveLength(0);
    expect(screen.root.find(hasType('QuantumLoadingScreen')).props).toEqual(expect.objectContaining({ visible: true }));
    await act(async () => {
      resolveHtml?.(EMBEDDED_HTML);
      await Promise.resolve();
    });
    expect(screen.root.findAll(hasType('NativeWebView'))).toHaveLength(1);
  });

  it('surfaces a readable error when the bundled document cannot be read', async () => {
    loadEmbeddedWalletHtml.mockRejectedValue(new Error('asset missing'));
    await act(async () => {
      screen = await nativeTestRenderer.create(<QRLWebView webSource="embedded" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const text = JSON.stringify(screen.toJSON());
    expect(text).toContain('Could not open the wallet bundled with this app');
  });

  it.each(['resolve', 'reject'])('cleans up before a pending document read can %s', async (outcome) => {
    const ref = createRef<QRLWebViewRef>();
    const onDocumentError = jest.fn<undefined, [string | null]>();
    let finishRead: (() => void) | undefined;
    loadEmbeddedWalletHtml.mockReturnValue(new Promise<string>((resolve, reject) => {
      finishRead = () => {
        if (outcome === 'resolve') resolve(EMBEDDED_HTML);
        else reject(new Error('asset missing'));
      };
    }));
    await act(async () => {
      screen = await nativeTestRenderer.create(<QRLWebView ref={ref} webSource="embedded" onDocumentError={onDocumentError} />);
    });
    expect(ref.current).not.toBeNull();
    expect(backHandlers).toHaveLength(1);
    expect(screen.root.findAll(hasType('NativeWebView'))).toHaveLength(0);

    await act(() => runAsPromise(() => { screen.unmount(); }));
    expect(ref.current).toBeNull();
    expect(backHandlers).toHaveLength(0);
    onDocumentError.mockClear();
    await act(async () => {
      finishRead?.();
      await Promise.resolve();
    });
    expect(onDocumentError).not.toHaveBeenCalled();
    expect(markStorageMigrationDone).not.toHaveBeenCalled();
  });
});
