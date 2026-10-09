import { act } from 'react';
import { Platform } from 'react-native';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import QRLWebView from '../../components/QRLWebView';
import NativeBridge from '../NativeBridge';

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

describe('URI-loaded (dev) QRLWebView lifecycle and media policy', () => {
  let screen: ReactTestRenderer;
  const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
  const originalDev = __DEV__;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    runtime.__DEV__ = false;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    if (screen) await act(async () => screen.unmount());
    runtime.__DEV__ = originalDev;
    jest.useRealTimers();
  });

  it('allows inline autoplay and loads only the local dev server in dev mode', async () => {
    await act(async () => {
      screen = create(<QRLWebView webSource="dev" />);
    });
    const props = screen.root.findByType('NativeWebView' as never).props;
    expect(props.mediaPlaybackRequiresUserAction).toBe(false);
    expect(props.allowsInlineMediaPlayback).toBe(true);
    // No mode loads https://qrlwallet.com any more: release builds serve the
    // bundled document and development runs the local frontend server.
    expect(props.source).toEqual({ uri: 'http://10.0.2.2:5173' });
    expect(props.mixedContentMode).toBe('compatibility');
    for (const url of ['https://qrlwallet.com.attacker.invalid', 'file:///wallet']) {
      expect(props.onShouldStartLoadWithRequest({ url })).toBe(false);
    }
  });

  it('resets document authority before notifying the screen on every load', async () => {
    const onDocumentLoadStart = jest.fn(() => {
      expect(NativeBridge.resetWebAppReady).toHaveBeenCalledTimes(
        onDocumentLoadStart.mock.calls.length
      );
    });
    await act(async () => {
      screen = create(<QRLWebView webSource="dev" onDocumentLoadStart={onDocumentLoadStart} />);
    });
    const nativeView = screen.root.findByType('NativeWebView' as never);
    await act(async () => nativeView.props.onLoadStart());
    await act(async () => nativeView.props.onLoadStart());
    expect(onDocumentLoadStart).toHaveBeenCalledTimes(2);
  });

  it('ignores Android same-document history updates and resets on new documents', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const onDocumentLoadStart = jest.fn();
    await act(async () => {
      screen = create(<QRLWebView webSource="dev" onDocumentLoadStart={onDocumentLoadStart} />);
    });
    const nativeView = screen.root.findByType('NativeWebView' as never);
    const event = (url: string, loading: boolean) => ({ nativeEvent: { url, loading } });
    // The first load start is a document start even when it reports 100%.
    await act(async () => nativeView.props.onLoadStart(event('https://qrlwallet.com/', false)));
    expect(NativeBridge.resetWebAppReady).toHaveBeenCalledTimes(1);
    expect(onDocumentLoadStart).toHaveBeenCalledTimes(1);
    // A route change inside the loaded wallet page.
    await act(async () =>
      nativeView.props.onLoadStart(event('https://qrlwallet.com/import-account', false)),
    );
    expect(NativeBridge.resetWebAppReady).toHaveBeenCalledTimes(1);
    expect(onDocumentLoadStart).toHaveBeenCalledTimes(1);
    // A new document load.
    await act(async () => nativeView.props.onLoadStart(event('https://qrlwallet.com/', true)));
    expect(NativeBridge.resetWebAppReady).toHaveBeenCalledTimes(2);
    expect(onDocumentLoadStart).toHaveBeenCalledTimes(2);
  });
});
