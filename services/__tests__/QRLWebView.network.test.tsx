import React, { act } from 'react';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import QRLWebView from '../../components/QRLWebView';
import { NATIVE_NETWORK_ERROR } from '../NativeWalletProfile';
import { isRecord } from '../guards';
import { runAsPromise } from '../runAsPromise';

// The whole file runs as a build with EXPO_PUBLIC_QRL_NETWORK_PROFILE=mainnet
// while the mainnet identity is still unset. The selector is read when the
// profile module loads, so it is set inside that module's factory.
jest.mock('../NativeWalletProfile', () => {
  process.env.EXPO_PUBLIC_QRL_NETWORK_PROFILE = 'mainnet';
  return jest.requireActual<object>('../NativeWalletProfile');
});

function isNativeTestRenderer(value: unknown): value is {
  create: (element: React.ReactElement) => Promise<ReactTestRenderer>;
} {
  return isRecord(value) && typeof value.create === 'function';
}

const nativeTestRenderer: unknown = jest.requireActual('@react-native/jest-preset/jest/renderer');
if (!isNativeTestRenderer(nativeTestRenderer)) throw new TypeError('Missing native test renderer');

// A document with every testnet marker: the network gate must refuse it anyway.
const TESTNET_HTML =
  '<!doctype html><html><head><script>var n={chainId:"0x301825",genesisHash:' +
  '"0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4",networkProfile:"v3-private"};' +
  'var k="qrlwallet:v3:"+key;</script></head><body></body></html>';

jest.mock('react-native-webview', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    WebView: React.forwardRef((props: Record<string, unknown>, _ref: React.Ref<unknown>) =>
      React.createElement('NativeWebView', props)),
  };
});
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: React.EffectCallback) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(() => callback(), [callback]);
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-constants', () => ({ expoConfig: { version: '1.5.2' } }));
jest.mock('../../components/QuantumLoadingScreen', () => 'QuantumLoadingScreen');
jest.mock('../Logger', () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../EmbeddedStorageMigration', () => {
  const actual = jest.requireActual<typeof import('../EmbeddedStorageMigration')>(
    '../EmbeddedStorageMigration.ts',
  );
  return {
    ...actual,
    isStorageMigrationPending: jest.fn().mockResolvedValue(false),
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
  return { ...actual, loadEmbeddedWalletHtml: jest.fn() };
});

const { loadEmbeddedWalletHtml } = jest.requireMock<{
  loadEmbeddedWalletHtml: jest.Mock<Promise<string>, []>;
}>('../EmbeddedWalletDocument');

const hasType = (type: string) => (view: ReactTestInstance): boolean => view.type === type;

describe('QRLWebView on a build whose network has no pinned identity', () => {
  let screen: ReactTestRenderer | undefined;

  beforeEach(() => {
    loadEmbeddedWalletHtml.mockResolvedValue(TESTNET_HTML);
  });

  afterEach(async () => {
    const current = screen;
    screen = undefined;
    if (current) await act(() => runAsPromise(() => { current.unmount(); }));
  });

  it('selected the mainnet and has no usable network', () => {
    expect(NATIVE_NETWORK_ERROR).toContain('selects the mainnet network');
  });

  it.each(['embedded', 'dev'] as const)('loads no document in %s mode', async (webSource) => {
    await act(async () => {
      screen = await nativeTestRenderer.create(<QRLWebView webSource={webSource} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    if (!screen) throw new Error('nothing rendered');
    expect(screen.root.findAll(hasType('NativeWebView'))).toHaveLength(0);
    const text = JSON.stringify(screen.toJSON());
    expect(text).toContain('chain ID and genesis hash are not set');
    expect(text).toContain('EXPO_PUBLIC_QRL_NETWORK_PROFILE=testnet');
  });
});
