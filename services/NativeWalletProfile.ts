import { Platform } from 'react-native';

/** Compatibility metadata. Privileged bridge calls still require document binding and authorization. */
export const NATIVE_WALLET_CAPABILITIES = Object.freeze({
  bridgeVersion: 1,
  addressScheme: 'qip55-64',
  networkProfile: 'v3-private',
  chainId: '0x301825',
  genesisHash: '0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4',
});

/**
 * The device platform, told to the page rather than guessed by it.
 *
 * The WebView is given a fixed iPhone user agent on every platform, because
 * the web wallet keys its native detection off the "MyQRLWallet" token in it.
 * That makes every user-agent platform test read as iOS, so a page asking
 * "am I on iOS" got yes on Android. It cannot answer that from the user agent
 * at all, so the app states it.
 */
export const NATIVE_WALLET_PLATFORM: typeof Platform.OS = Platform.OS;

export const NATIVE_WEBVIEW_INJECTED_OBJECT = Object.freeze({
  qrlWalletCapabilities: Object.freeze({
    ...NATIVE_WALLET_CAPABILITIES,
    platform: NATIVE_WALLET_PLATFORM,
  }),
});

/**
 * Defines window.ReactNativeWebView.injectedObjectJson() on the wallet
 * document itself. On Android, react-native-webview evaluates its own
 * definition once at mount, before qrlwallet.com has loaded, so the web
 * wallet would never see the capabilities. Keeps any bridge object the
 * WebView already installed.
 *
 * The platform field rides along here too, so the value the page reads is the
 * same one on the document-start injection, on the after-load reinjection and
 * on the injectedObjectJson the WebView installs itself.
 */
export const NATIVE_WEBVIEW_CAPABILITY_SCRIPT = `(function () {
  var bridge = (window.ReactNativeWebView = window.ReactNativeWebView || {});
  var json = ${JSON.stringify(JSON.stringify(NATIVE_WEBVIEW_INJECTED_OBJECT))};
  bridge.injectedObjectJson = function () { return json; };
})();
true;`;

export const NATIVE_WALLET_BLOCKCHAIN = 'TEST_NET_V3';
