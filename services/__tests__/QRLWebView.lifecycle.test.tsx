import { act, type ReactElement } from 'react';
import { Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import QRLWebView from '../../components/QRLWebView';
import NativeBridge from '../NativeBridge';
import { isRecord } from '../guards';

interface TestInstance {
  props: Record<string, unknown>;
  findByType: (type: unknown) => TestInstance;
}

interface TestRenderer {
  root: TestInstance;
  unmount: () => void;
}

function isNativeTestRenderer(value: unknown): value is {
  create: (element: ReactElement) => Promise<TestRenderer>;
} {
  return isRecord(value) && typeof value.create === 'function';
}

const rendererModule: unknown = jest.requireActual('@react-native/jest-preset/jest/renderer');
if (!isNativeTestRenderer(rendererModule)) throw new TypeError('Missing native test renderer');
const nativeTestRenderer = rendererModule;

function callProp({ props }: Pick<TestInstance, 'props'>, key: string, ...args: unknown[]): unknown {
  const callback = props[key];
  if (typeof callback !== 'function') throw new TypeError(`Missing callback ${key}`);
  return Reflect.apply(callback, props, args);
}

jest.mock('react-native-webview', () => ({ WebView: 'NativeWebView' }));
jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-constants', () => ({ expoConfig: { version: '1.3.3' } }));
jest.mock('../../components/QuantumLoadingScreen', () => 'QuantumLoadingScreen');
jest.mock('../Logger', () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../NativeBridge', () => ({
  setWebViewRef: jest.fn(),
  resetWebAppReady: jest.fn(),
}));

describe('WebView lifecycle test callback boundary', () => {
  it('passes callback arguments unchanged and preserves the receiver and result', async () => {
    const result = Promise.resolve(false);
    const onLoadStart = jest.fn((_event: unknown, _extra: unknown) => result);
    const props = { onLoadStart, extra: 'retained' };
    const event = { nativeEvent: { url: 'https://qrlwallet.com/', loading: false, extra: 1n } };

    expect(callProp({ props }, 'onLoadStart', event, undefined)).toBe(result);
    expect(onLoadStart.mock.calls).toEqual([[event, undefined]]);
    expect(onLoadStart.mock.calls[0]?.[0]).toBe(event);
    expect(onLoadStart.mock.contexts[0]).toBe(props);
    await expect(result).resolves.toBe(false);
  });

  it('propagates callback errors and rejections', async () => {
    const failure = new Error('Load callback failed');
    const throws = { onLoadStart: () => { throw failure; } };
    const rejects = { onLoadStart: () => Promise.reject(failure) };

    expect(() => callProp({ props: throws }, 'onLoadStart')).toThrow(failure);
    await expect(act<unknown>(() => callProp({ props: rejects }, 'onLoadStart'))).rejects.toBe(failure);
  });

  it.each([undefined, null, false, 0, 'callback', {}])(
    'rejects a non-callable load callback: %p',
    (onLoadStart) => {
      expect(() => callProp({ props: { onLoadStart } }, 'onLoadStart')).toThrow(TypeError);
    }
  );
});

describe('URI-loaded (dev) QRLWebView lifecycle and media policy', () => {
  let screen: TestRenderer | undefined;
  const runtime = globalThis;
  const originalDev = __DEV__;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    Object.assign(runtime, { __DEV__: false });
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    if (screen) {
      await act<undefined>(() => {
        screen?.unmount();
      });
    }
    Object.assign(runtime, { __DEV__: originalDev });
    jest.useRealTimers();
  });

  it('allows inline autoplay and loads only the local dev server in dev mode', async () => {
    await act(async () => {
      screen = await nativeTestRenderer.create(<QRLWebView webSource="dev" />);
    });
    if (!screen) throw new TypeError('Missing WebView screen');
    const props: Record<string, unknown> = screen.root.findByType(WebView).props;
    expect(props.mediaPlaybackRequiresUserAction).toBe(false);
    expect(props.allowsInlineMediaPlayback).toBe(true);
    // No mode loads https://qrlwallet.com any more: release builds serve the
    // bundled document and development runs the local frontend server.
    expect(props.source).toEqual({ uri: 'http://10.0.2.2:5173' });
    expect(props.mixedContentMode).toBe('compatibility');
    for (const url of ['https://qrlwallet.com.attacker.invalid', 'file:///wallet']) {
      expect(callProp({ props }, 'onShouldStartLoadWithRequest', { url })).toBe(false);
    }
  });

  it('resets document authority before notifying the screen on every load', async () => {
    const onDocumentLoadStart = jest.fn(() => {
      expect(jest.mocked(NativeBridge).resetWebAppReady.mock.calls).toHaveLength(
        onDocumentLoadStart.mock.calls.length
      );
    });
    await act(async () => {
      screen = await nativeTestRenderer.create(
        <QRLWebView webSource="dev" onDocumentLoadStart={onDocumentLoadStart} />
      );
    });
    if (!screen) throw new TypeError('Missing WebView screen');
    const nativeView = screen.root.findByType(WebView);
    await act<unknown>(() => callProp(nativeView, 'onLoadStart'));
    await act<unknown>(() => callProp(nativeView, 'onLoadStart'));
    expect(onDocumentLoadStart).toHaveBeenCalledTimes(2);
  });

  it('ignores Android same-document history updates and resets on new documents', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const onDocumentLoadStart = jest.fn();
    await act(async () => {
      screen = await nativeTestRenderer.create(
        <QRLWebView webSource="dev" onDocumentLoadStart={onDocumentLoadStart} />
      );
    });
    if (!screen) throw new TypeError('Missing WebView screen');
    const nativeView = screen.root.findByType(WebView);
    const event = (url: string, loading: boolean) => ({ nativeEvent: { url, loading } });
    // The first load start is a document start even when it reports 100%.
    await act<unknown>(() => callProp(nativeView, 'onLoadStart', event('https://qrlwallet.com/', false)));
    expect(jest.mocked(NativeBridge).resetWebAppReady.mock.calls).toHaveLength(1);
    expect(onDocumentLoadStart).toHaveBeenCalledTimes(1);
    // A route change inside the loaded wallet page.
    await act<unknown>(() =>
      callProp(nativeView, 'onLoadStart', event('https://qrlwallet.com/import-account', false)),
    );
    expect(jest.mocked(NativeBridge).resetWebAppReady.mock.calls).toHaveLength(1);
    expect(onDocumentLoadStart).toHaveBeenCalledTimes(1);
    // A new document load.
    await act<unknown>(() => callProp(nativeView, 'onLoadStart', event('https://qrlwallet.com/', true)));
    expect(jest.mocked(NativeBridge).resetWebAppReady.mock.calls).toHaveLength(2);
    expect(onDocumentLoadStart).toHaveBeenCalledTimes(2);
  });
});
