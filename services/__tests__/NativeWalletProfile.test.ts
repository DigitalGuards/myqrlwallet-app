import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  NATIVE_WALLET_BLOCKCHAIN,
  NATIVE_WALLET_CAPABILITIES,
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
      qrlWalletCapabilities: NATIVE_WALLET_CAPABILITIES,
    });
    const source = readFileSync(resolve(__dirname, '../../components/QRLWebView.tsx'), 'utf8');
    expect(source).toContain('injectedJavaScriptObject={NATIVE_WEBVIEW_INJECTED_OBJECT}');
    expect(source).toContain('NativeBridge.resetWebAppReady()');
    expect(source).toContain('isAllowedWalletDocumentUrl');
  });
});
