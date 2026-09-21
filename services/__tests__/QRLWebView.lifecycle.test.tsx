import React, { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import QRLWebView from '../../components/QRLWebView';
import NativeBridge from '../NativeBridge';

jest.mock('react-native-webview', () => ({ WebView: 'NativeWebView' }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: jest.fn() }));
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

describe('production QRLWebView lifecycle and media policy', () => {
  let screen: ReactTestRenderer;
  const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
  const originalDev = __DEV__;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    runtime.__DEV__ = false;
  });
  afterEach(async () => {
    if (screen) await act(async () => screen.unmount());
    runtime.__DEV__ = originalDev;
    jest.useRealTimers();
  });

  it('allows inline autoplay while preserving the exact production origin policy', async () => {
    await act(async () => {
      screen = create(<QRLWebView />);
    });
    const props = screen.root.findByType('NativeWebView' as never).props;
    expect(props.mediaPlaybackRequiresUserAction).toBe(false);
    expect(props.allowsInlineMediaPlayback).toBe(true);
    expect(props.source).toEqual({ uri: 'https://qrlwallet.com' });
    expect(props.originWhitelist).toEqual(['https://qrlwallet.com']);
    expect(props.mixedContentMode).toBe('never');
    expect(props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/transfer' })).toBe(true);
    for (const url of ['http://qrlwallet.com', 'https://qrlwallet.com.attacker.invalid', 'file:///wallet']) {
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
      screen = create(<QRLWebView onDocumentLoadStart={onDocumentLoadStart} />);
    });
    const nativeView = screen.root.findByType('NativeWebView' as never);
    await act(async () => nativeView.props.onLoadStart());
    await act(async () => nativeView.props.onLoadStart());
    expect(onDocumentLoadStart).toHaveBeenCalledTimes(2);
  });
});
