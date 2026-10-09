import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Platform } from 'react-native';
import {
  NATIVE_WALLET_BLOCKCHAIN,
  NATIVE_WALLET_CAPABILITIES,
  NATIVE_WALLET_PLATFORM,
  NATIVE_WEBVIEW_CAPABILITY_SCRIPT,
  NATIVE_WEBVIEW_INJECTED_OBJECT,
} from '../NativeWalletProfile';

describe('native Testnet v3 compatibility contract', () => {
  it('pins the exact QIP-55 network identity and bridge version', () => {
    expect(NATIVE_WALLET_CAPABILITIES).toEqual({
      bridgeVersion: 1,
      addressScheme: 'qip55-64',
      networkProfile: 'v3-private',
      chainId: '0x301825',
      genesisHash: '0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4',
    });
    expect(NATIVE_WALLET_BLOCKCHAIN).toBe('TEST_NET_V3');
  });

  it('exposes a frozen JSON-compatible object through the native WebView property', () => {
    expect(Object.isFrozen(NATIVE_WALLET_CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(NATIVE_WEBVIEW_INJECTED_OBJECT)).toBe(true);
    expect(JSON.parse(JSON.stringify(NATIVE_WEBVIEW_INJECTED_OBJECT))).toEqual({
      qrlWalletCapabilities: {
        ...NATIVE_WALLET_CAPABILITIES,
        platform: NATIVE_WALLET_PLATFORM,
        appLockedSignal: true,
      },
    });
    const source = readFileSync(resolve(__dirname, '../../components/QRLWebView.tsx'), 'utf8');
    expect(source).toContain('injectedJavaScriptObject={NATIVE_WEBVIEW_INJECTED_OBJECT}');
    expect(source).toContain('NativeBridge.resetWebAppReady()');
    expect(source).toContain('isAllowedWalletDocumentUrl');
    // Android only sees the capabilities through these injected scripts. Both
    // hooks compose them with the embedded-mode scripts, so the assertion is
    // on the composed lists rather than on a bare ternary.
    expect(source).toMatch(
      /injectedJavaScriptBeforeContentLoaded: beforeContentScript/,
    );
    expect(source).toMatch(/injectedJavaScript: afterContentScript/);
    for (const name of ['beforeContentScript', 'afterContentScript']) {
      const list = new RegExp(
        `const ${name} = \\[[\\s\\S]*?Platform\\.OS === 'android' \\? NATIVE_WEBVIEW_CAPABILITY_SCRIPT : null,`,
      );
      expect(source).toMatch(list);
    }
  });

  it('defines injectedObjectJson on the document and keeps the installed bridge', () => {
    const run = (win: Record<string, unknown>) =>
      new Function('window', NATIVE_WEBVIEW_CAPABILITY_SCRIPT)(win);
    const postMessage = jest.fn();
    const withBridge: Record<string, unknown> = { ReactNativeWebView: { postMessage } };
    run(withBridge);
    const bridge = withBridge.ReactNativeWebView as {
      postMessage: unknown;
      injectedObjectJson: () => string;
    };
    expect(bridge.postMessage).toBe(postMessage);
    expect(JSON.parse(bridge.injectedObjectJson())).toEqual(
      JSON.parse(JSON.stringify(NATIVE_WEBVIEW_INJECTED_OBJECT)),
    );

    const bare: Record<string, unknown> = {};
    run(bare);
    const created = bare.ReactNativeWebView as { injectedObjectJson: () => string };
    expect(created.injectedObjectJson()).toBe(JSON.stringify(NATIVE_WEBVIEW_INJECTED_OBJECT));
  });

  it('advertises appLockedSignal on both the iOS object and the Android script', () => {
    // iOS reads injectedJavaScriptObject, Android reads the injected script. Both
    // carry the same object, and the page trusts APP_LOCKED only when it sees the flag.
    const win: Record<string, unknown> = {};
    new Function('window', NATIVE_WEBVIEW_CAPABILITY_SCRIPT)(win);
    const bridge = win.ReactNativeWebView as { injectedObjectJson: () => string };
    const fromScript = JSON.parse(bridge.injectedObjectJson()) as {
      qrlWalletCapabilities: { appLockedSignal?: boolean };
    };
    expect(fromScript.qrlWalletCapabilities.appLockedSignal).toBe(true);
    expect(NATIVE_WEBVIEW_INJECTED_OBJECT.qrlWalletCapabilities.appLockedSignal).toBe(true);
    const source = readFileSync(resolve(__dirname, '../../components/QRLWebView.tsx'), 'utf8');
    expect(source).toContain('injectedJavaScriptObject={NATIVE_WEBVIEW_INJECTED_OBJECT}');
  });

  it('tells the page which platform it is on, because the user agent cannot', () => {
    // The WebView is given a fixed iPhone user agent on every platform, so a
    // page asking "am I on iOS" from the user agent got yes on Android.
    const webViewSource = readFileSync(
      resolve(__dirname, '../../components/QRLWebView.tsx'),
      'utf8',
    );
    expect(webViewSource).toContain('iPhone; CPU iPhone OS');

    expect(NATIVE_WALLET_PLATFORM).toBe(Platform.OS);
    const injected = JSON.parse(JSON.stringify(NATIVE_WEBVIEW_INJECTED_OBJECT)) as {
      qrlWalletCapabilities: { platform?: string };
    };
    expect(injected.qrlWalletCapabilities.platform).toBe(Platform.OS);
  });

  it('carries the platform on every path the page can read it from', () => {
    // The WebView installs injectedObjectJson itself at mount, and the script
    // below redefines it at document start and after load on Android. All
    // three have to agree, or the answer depends on which one won.
    const run = (win: Record<string, unknown>) =>
      new Function('window', NATIVE_WEBVIEW_CAPABILITY_SCRIPT)(win);
    const win: Record<string, unknown> = {};
    run(win);
    const bridge = win.ReactNativeWebView as { injectedObjectJson: () => string };
    const fromScript = JSON.parse(bridge.injectedObjectJson()) as {
      qrlWalletCapabilities: { platform?: string; chainId?: string };
    };
    expect(fromScript.qrlWalletCapabilities.platform).toBe(Platform.OS);
    // And the network identity is still there alongside it.
    expect(fromScript.qrlWalletCapabilities.chainId).toBe(NATIVE_WALLET_CAPABILITIES.chainId);
  });

  it('keeps the platform out of the pinned network identity', () => {
    // NATIVE_WALLET_CAPABILITIES is the QIP-55 identity contract. A host fact
    // does not belong in it, and the test above pins it exactly.
    expect(NATIVE_WALLET_CAPABILITIES).not.toHaveProperty('platform');
  });
});
