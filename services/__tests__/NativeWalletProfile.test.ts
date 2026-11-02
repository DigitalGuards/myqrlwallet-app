import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { Platform } from 'react-native';
import { envString, isRecord } from '../guards';
import {
  NATIVE_NETWORK,
  NATIVE_NETWORK_ERROR,
  NATIVE_NETWORK_TABLE,
  NATIVE_WALLET_BLOCKCHAIN,
  NATIVE_WALLET_CAPABILITIES,
  NATIVE_WALLET_PLATFORM,
  NATIVE_WEBVIEW_CAPABILITY_SCRIPT,
  NATIVE_WEBVIEW_INJECTED_OBJECT,
  parseNativeNetworkTable,
  selectNativeNetwork,
} from '../NativeWalletProfile';

function injectedObjectJson(bridge: unknown): string {
  if (!isRecord(bridge) || typeof bridge.injectedObjectJson !== 'function') {
    throw new TypeError('Expected an injectedObjectJson function');
  }
  const json: unknown = Reflect.apply(bridge.injectedObjectJson, bridge, []);
  if (typeof json !== 'string') throw new TypeError('Expected injected object JSON');
  return json;
}

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
    // hooks compose them with the embedded-mode scripts, so the assertions
    // cover the composed lists.
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
    const run = (win: Record<string, unknown>) => {
      runInNewContext(NATIVE_WEBVIEW_CAPABILITY_SCRIPT, { window: win });
    };
    const postMessage = jest.fn();
    const withBridge: Record<string, unknown> = { ReactNativeWebView: { postMessage } };
    run(withBridge);
    const bridge = withBridge.ReactNativeWebView;
    expect(bridge).toHaveProperty('postMessage', postMessage);
    expect(JSON.parse(injectedObjectJson(bridge))).toEqual(
      JSON.parse(JSON.stringify(NATIVE_WEBVIEW_INJECTED_OBJECT)),
    );

    const bare: Record<string, unknown> = {};
    run(bare);
    const created = bare.ReactNativeWebView;
    expect(injectedObjectJson(created)).toBe(JSON.stringify(NATIVE_WEBVIEW_INJECTED_OBJECT));
  });

  it('reads injected JSON with its bridge receiver and preserves thrown errors', () => {
    const bridge = {
      json: '{"ready":true}',
      injectedObjectJson() { return this.json; },
    };
    expect(injectedObjectJson(bridge)).toBe('{"ready":true}');

    const failure = new Error('Injected JSON unavailable');
    expect(() => injectedObjectJson({
      injectedObjectJson() { throw failure; },
    })).toThrow(failure);
  });

  it.each([null, {}, { injectedObjectJson: false }, { injectedObjectJson: () => null }])(
    'rejects missing or non-string injected JSON (%#)',
    (bridge) => {
      expect(() => injectedObjectJson(bridge)).toThrow(TypeError);
    },
  );

  it('advertises appLockedSignal on both the iOS object and the Android script', () => {
    // iOS reads injectedJavaScriptObject, Android reads the injected script. Both
    // carry the same object, and the page trusts APP_LOCKED only when it sees the flag.
    const win: Record<string, unknown> = {};
    runInNewContext(NATIVE_WEBVIEW_CAPABILITY_SCRIPT, { window: win });
    const bridge = win.ReactNativeWebView;
    const fromScript: unknown = JSON.parse(injectedObjectJson(bridge));
    expect(fromScript).toHaveProperty('qrlWalletCapabilities.appLockedSignal', true);
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
    const injected: unknown = JSON.parse(JSON.stringify(NATIVE_WEBVIEW_INJECTED_OBJECT));
    expect(injected).toHaveProperty('qrlWalletCapabilities.platform', Platform.OS);
  });

  it('carries the platform on every path the page can read it from', () => {
    // The WebView installs injectedObjectJson itself at mount, and the script
    // below redefines it at document start and after load on Android. All
    // three have to agree, or the answer depends on which one won.
    const run = (win: Record<string, unknown>) => {
      runInNewContext(NATIVE_WEBVIEW_CAPABILITY_SCRIPT, { window: win });
    };
    const win: Record<string, unknown> = {};
    run(win);
    const bridge = win.ReactNativeWebView;
    const fromScript: unknown = JSON.parse(injectedObjectJson(bridge));
    expect(fromScript).toHaveProperty('qrlWalletCapabilities.platform', Platform.OS);
    // And the network identity is still there alongside it.
    expect(fromScript).toHaveProperty(
      'qrlWalletCapabilities.chainId', NATIVE_WALLET_CAPABILITIES.chainId,
    );
  });

  it('keeps the platform out of the pinned network identity', () => {
    // NATIVE_WALLET_CAPABILITIES is the QIP-55 identity contract. A host fact
    // does not belong in it, and the test above pins it exactly.
    expect(NATIVE_WALLET_CAPABILITIES).not.toHaveProperty('platform');
  });
});

const TESTNET_CHAIN_ID = '0x301825';
const TESTNET_GENESIS = '0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4';
// Stand-ins for a future mainnet identity. Only ever used in variant tables.
const MAINNET_CHAIN_ID = '0xabc123';
const MAINNET_GENESIS = `0x${'7e'.repeat(32)}`;

/** The committed table file with the mainnet entry changed. */
function tableWithMainnet(mainnet: Record<string, unknown>): Record<string, unknown> {
  const raw: unknown = JSON.parse(
    readFileSync(resolve(__dirname, '../NativeNetworkProfiles.json'), 'utf8'),
  );
  if (!isRecord(raw) || !isRecord(raw.profiles) || !isRecord(raw.profiles.mainnet)) {
    throw new TypeError('Expected the committed network table');
  }
  return { ...raw, profiles: { ...raw.profiles, mainnet: { ...raw.profiles.mainnet, ...mainnet } } };
}

type ProfileModule = typeof import('../NativeWalletProfile');

/** Loads the module fresh, as a build with this selector would see it. */
function loadProfileModule(selector: string | undefined): ProfileModule {
  const previous = envString(process.env.EXPO_PUBLIC_QRL_NETWORK_PROFILE);
  if (selector === undefined) delete process.env.EXPO_PUBLIC_QRL_NETWORK_PROFILE;
  else process.env.EXPO_PUBLIC_QRL_NETWORK_PROFILE = selector;
  const holder: { module?: ProfileModule } = {};
  try {
    jest.isolateModules(() => {
      holder.module = jest.requireActual<ProfileModule>('../NativeWalletProfile');
    });
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_QRL_NETWORK_PROFILE;
    else process.env.EXPO_PUBLIC_QRL_NETWORK_PROFILE = previous;
  }
  if (holder.module === undefined) throw new Error('NativeWalletProfile did not load');
  return holder.module;
}

describe('native network profile table', () => {
  it('keeps the committed testnet entry exactly as the app has always pinned it', () => {
    expect(NATIVE_NETWORK_TABLE.testnet).toEqual({
      name: 'testnet',
      networkProfile: 'v3-private',
      blockchain: 'TEST_NET_V3',
      chainId: TESTNET_CHAIN_ID,
      genesisHash: TESTNET_GENESIS,
      storagePrefix: 'qrlwallet:v3:',
    });
  });

  it('carries a dormant mainnet entry with no identity', () => {
    expect(NATIVE_NETWORK_TABLE.mainnet).toEqual({
      name: 'mainnet',
      networkProfile: 'v3-mainnet',
      blockchain: 'MAIN_NET_V3',
      chainId: null,
      genesisHash: null,
      storagePrefix: 'qrlwallet:v3:',
    });
  });

  it.each([undefined, '', '   ', 'testnet', ' TestNet '])(
    'selects the testnet for the selector %p',
    (selector) => {
      expect(selectNativeNetwork(selector, NATIVE_NETWORK_TABLE)).toEqual({
        ok: true,
        network: NATIVE_NETWORK_TABLE.testnet,
      });
    },
  );

  it('refuses the mainnet while its chain ID and genesis hash are unset', () => {
    const selection = selectNativeNetwork('mainnet', NATIVE_NETWORK_TABLE);
    expect(selection).toEqual({
      ok: false,
      requested: 'mainnet',
      error:
        'This app build selects the mainnet network, whose chain ID and genesis hash are not ' +
        'set in services/NativeNetworkProfiles.json yet. Set both, or build with ' +
        'EXPO_PUBLIC_QRL_NETWORK_PROFILE=testnet.',
    });
  });

  it.each(['mainet', 'main', 'v3-private', 'TEST_NET_V3', 'devnet'])(
    'refuses the unknown selector %p and never falls back to the testnet',
    (selector) => {
      const selection = selectNativeNetwork(selector, NATIVE_NETWORK_TABLE);
      expect(selection.ok).toBe(false);
      if (selection.ok) return;
      expect(selection.error).toContain('Unknown network profile');
      expect(selection.error).toContain('EXPO_PUBLIC_QRL_NETWORK_PROFILE');
    },
  );

  it('selects a mainnet entry once both pins are set and distinct', () => {
    const table = parseNativeNetworkTable(
      tableWithMainnet({ chainId: MAINNET_CHAIN_ID, genesisHash: MAINNET_GENESIS }),
    );
    expect(selectNativeNetwork('mainnet', table)).toEqual({
      ok: true,
      network: {
        name: 'mainnet',
        networkProfile: 'v3-mainnet',
        blockchain: 'MAIN_NET_V3',
        chainId: MAINNET_CHAIN_ID,
        genesisHash: MAINNET_GENESIS,
        storagePrefix: 'qrlwallet:v3:',
      },
    });
    // Pinning the mainnet leaves the default build on the testnet.
    expect(selectNativeNetwork(undefined, table)).toEqual({ ok: true, network: table.testnet });
  });

  it.each([
    ['only a chain ID', { chainId: MAINNET_CHAIN_ID }, 'set together'],
    ['only a genesis hash', { genesisHash: MAINNET_GENESIS }, 'set together'],
    ['the testnet chain ID', { chainId: TESTNET_CHAIN_ID, genesisHash: MAINNET_GENESIS }, 'differ from the testnet'],
    ['the testnet genesis hash', { chainId: MAINNET_CHAIN_ID, genesisHash: TESTNET_GENESIS }, 'differ from the testnet'],
    ['the whole testnet identity', { chainId: TESTNET_CHAIN_ID, genesisHash: TESTNET_GENESIS }, 'differ from the testnet'],
    ['an upper-case chain ID', { chainId: '0xABC123', genesisHash: MAINNET_GENESIS }, 'lower-case 0x hex'],
    ['a zero-padded chain ID', { chainId: '0x0abc123', genesisHash: MAINNET_GENESIS }, 'lower-case 0x hex'],
    ['a decimal chain ID', { chainId: '11259171', genesisHash: MAINNET_GENESIS }, 'lower-case 0x hex'],
    ['chain ID zero', { chainId: '0x0', genesisHash: MAINNET_GENESIS }, 'lower-case 0x hex'],
    ['a short genesis hash', { chainId: MAINNET_CHAIN_ID, genesisHash: '0x1234' }, '32-byte hash'],
    ['an upper-case genesis hash', { chainId: MAINNET_CHAIN_ID, genesisHash: `0x${'AB'.repeat(32)}` }, '32-byte hash'],
  ])('refuses a mainnet entry with %s', (_label, mainnet, reason) => {
    const selection = selectNativeNetwork('mainnet', parseNativeNetworkTable(tableWithMainnet(mainnet)));
    expect(selection.ok).toBe(false);
    if (selection.ok) return;
    expect(selection.error).toContain(reason);
  });

  it.each([
    ['a missing profiles object', { comment: 'x' }],
    ['an unknown profile', {
      profiles: { ...NATIVE_NETWORK_TABLE, devnet: NATIVE_NETWORK_TABLE.testnet },
    }],
    ['a mainnet advertised as v3-private', tableWithMainnet({ networkProfile: 'v3-private' })],
    ['a mainnet sharing the testnet blockchain id', tableWithMainnet({ blockchain: 'TEST_NET_V3' })],
    ['a numeric chain ID', tableWithMainnet({ chainId: 3151909 })],
    ['an empty storage prefix', tableWithMainnet({ storagePrefix: '' })],
  ])('rejects a table with %s', (_label, raw) => {
    expect(() => parseNativeNetworkTable(raw)).toThrow(TypeError);
  });

  // Seed storage reads backups under the v2 ids as legacy v2 backups.
  it.each([
    ['mainnet', 'MAIN_NET', tableWithMainnet({ blockchain: 'MAIN_NET' })],
    ['mainnet', 'TEST_NET', tableWithMainnet({ blockchain: 'TEST_NET' })],
    ['testnet', 'TEST_NET', {
      profiles: { ...NATIVE_NETWORK_TABLE, testnet: { ...NATIVE_NETWORK_TABLE.testnet, blockchain: 'TEST_NET' } },
    }],
  ])('rejects a %s entry on the legacy blockchain id %s', (name, id, raw) => {
    expect(() => parseNativeNetworkTable(raw)).toThrow(new TypeError(
      `services/NativeNetworkProfiles.json profiles.${name}.blockchain ${id} is a legacy v2 id ` +
        'that seed storage reserves',
    ));
  });

  it('advertises networkProfile v3-private with the testnet pins in a default build', () => {
    expect(NATIVE_NETWORK).toEqual({ ok: true, network: NATIVE_NETWORK_TABLE.testnet });
    expect(NATIVE_NETWORK_ERROR).toBeNull();
    // Byte for byte the object every earlier release injected.
    expect(JSON.stringify(NATIVE_WEBVIEW_INJECTED_OBJECT)).toBe(
      '{"qrlWalletCapabilities":{"bridgeVersion":1,"addressScheme":"qip55-64",' +
        '"networkProfile":"v3-private","chainId":"0x301825",' +
        `"genesisHash":"${TESTNET_GENESIS}","platform":"${Platform.OS}","appLockedSignal":true}}`,
    );
  });

  it('builds the same capabilities when the testnet is selected explicitly', () => {
    const explicit = loadProfileModule('testnet');
    expect(explicit.NATIVE_WALLET_CAPABILITIES).toEqual(NATIVE_WALLET_CAPABILITIES);
    expect(explicit.NATIVE_WALLET_CAPABILITIES.networkProfile).toBe('v3-private');
    expect(explicit.NATIVE_WEBVIEW_CAPABILITY_SCRIPT).toBe(NATIVE_WEBVIEW_CAPABILITY_SCRIPT);
    expect(explicit.NATIVE_WALLET_BLOCKCHAIN).toBe('TEST_NET_V3');
    expect(explicit.NATIVE_NETWORK_ERROR).toBeNull();
  });

  it.each(['mainnet', 'mainet'])(
    'gives a %p build no network, no identity and no seed blockchain',
    (selector) => {
      const refused = loadProfileModule(selector);
      expect(refused.NATIVE_NETWORK.ok).toBe(false);
      expect(refused.NATIVE_NETWORK_ERROR).toEqual(expect.any(String));
      expect(refused.NATIVE_WALLET_BLOCKCHAIN).toBeNull();
      expect(refused.NATIVE_WALLET_CAPABILITIES).toEqual({
        bridgeVersion: 1,
        addressScheme: 'qip55-64',
        networkProfile: null,
        chainId: null,
        genesisHash: null,
      });
    },
  );
});
