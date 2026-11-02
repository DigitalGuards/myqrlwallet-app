import { Platform } from 'react-native';
import { envString, isRecord } from './guards';
import nativeNetworkProfiles from './NativeNetworkProfiles.json';

/**
 * The networks this app can be built for, and the one this build speaks.
 *
 * services/NativeNetworkProfiles.json holds one entry per network. A binary
 * speaks exactly one of them: EXPO_PUBLIC_QRL_NETWORK_PROFILE picks it at
 * build time, and the testnet is the default when the variable is unset. The
 * embedded-wallet sync and verify scripts read the same file through
 * scripts/native-network-profile.js, so the markers a bundled document is
 * checked against and the identity the bridge advertises share one source. A
 * unit test holds that script and this module to the same answers.
 *
 * An entry runs only with both its chain ID and genesis hash pinned, and those
 * must differ from the testnet's. The mainnet entry carries neither pin until
 * the network launches; a build that selects it refuses to load any wallet
 * document, advertises no network and accepts no seed backup.
 */

export const NATIVE_NETWORK_NAMES = ['testnet', 'mainnet'] as const;
export type NativeNetworkName = (typeof NATIVE_NETWORK_NAMES)[number];

/** The network a build gets when EXPO_PUBLIC_QRL_NETWORK_PROFILE is unset. */
export const DEFAULT_NATIVE_NETWORK: NativeNetworkName = 'testnet';

/**
 * The capability `networkProfile` each network is advertised under. The web
 * wallet compares it with the profile its own build expects.
 */
export const NATIVE_NETWORK_PROFILE_BY_NAME = Object.freeze({
  testnet: 'v3-private',
  mainnet: 'v3-mainnet',
} as const);
export type NativeWalletNetworkProfile = (typeof NATIVE_NETWORK_PROFILE_BY_NAME)[NativeNetworkName];

export interface NativeNetworkProfile {
  readonly name: NativeNetworkName;
  readonly networkProfile: NativeWalletNetworkProfile;
  /** The blockchain id the wallet document sends with seed backups. */
  readonly blockchain: string;
  readonly chainId: string | null;
  readonly genesisHash: string | null;
  /** The storage key prefix the wallet document uses on this network. */
  readonly storagePrefix: string;
}

export interface PinnedNativeNetwork extends NativeNetworkProfile {
  readonly chainId: string;
  readonly genesisHash: string;
}

export type NativeNetworkTable = Readonly<Record<NativeNetworkName, NativeNetworkProfile>>;

export type NativeNetworkSelection =
  | { readonly ok: true; readonly network: PinnedNativeNetwork }
  | { readonly ok: false; readonly requested: string; readonly error: string };

const TABLE_FILE = 'services/NativeNetworkProfiles.json';
const SELECTOR = 'EXPO_PUBLIC_QRL_NETWORK_PROFILE';
// The web wallet canonicalises its pins to these forms and compares the
// advertised strings exactly, so the table must hold them the same way.
const CHAIN_ID_PATTERN = /^0x[1-9a-f][0-9a-f]*$/;
const GENESIS_HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const BLOCKCHAIN_PATTERN = /^[A-Z][A-Z0-9_]*$/;
// The v2 ids. SeedStorageService reads backups under them as legacy v2
// backups, so no network in the table may use one.
const LEGACY_BLOCKCHAINS: readonly string[] = ['TEST_NET', 'MAIN_NET'];

function tableEntry(name: NativeNetworkName, raw: unknown): NativeNetworkProfile {
  const where = `${TABLE_FILE} profiles.${name}`;
  if (!isRecord(raw)) throw new TypeError(`${where} must be an object`);
  const { networkProfile, blockchain, chainId, genesisHash, storagePrefix } = raw;
  if (networkProfile !== NATIVE_NETWORK_PROFILE_BY_NAME[name]) {
    throw new TypeError(`${where}.networkProfile must be ${NATIVE_NETWORK_PROFILE_BY_NAME[name]}`);
  }
  if (typeof blockchain !== 'string' || !BLOCKCHAIN_PATTERN.test(blockchain)) {
    throw new TypeError(`${where}.blockchain must be an upper-case network id`);
  }
  if (LEGACY_BLOCKCHAINS.includes(blockchain)) {
    throw new TypeError(`${where}.blockchain ${blockchain} is a legacy v2 id that seed storage reserves`);
  }
  if (chainId !== null && typeof chainId !== 'string') {
    throw new TypeError(`${where}.chainId must be a string or null`);
  }
  if (genesisHash !== null && typeof genesisHash !== 'string') {
    throw new TypeError(`${where}.genesisHash must be a string or null`);
  }
  if (typeof storagePrefix !== 'string' || storagePrefix.length === 0) {
    throw new TypeError(`${where}.storagePrefix must be a non-empty string`);
  }
  return Object.freeze({
    name,
    networkProfile: NATIVE_NETWORK_PROFILE_BY_NAME[name],
    blockchain,
    chainId,
    genesisHash,
    storagePrefix,
  });
}

/**
 * Reads the table file. Throws on a malformed one: the file is committed and
 * covered by tests, so a bad shape is a programming error.
 */
export function parseNativeNetworkTable(raw: unknown): NativeNetworkTable {
  if (!isRecord(raw) || !isRecord(raw.profiles)) {
    throw new TypeError(`${TABLE_FILE} must hold a profiles object`);
  }
  const { profiles } = raw;
  const unexpected = Object.keys(profiles).filter(
    (key) => !NATIVE_NETWORK_NAMES.some((name) => name === key),
  );
  if (unexpected.length > 0) {
    throw new TypeError(`${TABLE_FILE} has unknown profiles: ${unexpected.join(', ')}`);
  }
  const table: NativeNetworkTable = Object.freeze({
    testnet: tableEntry('testnet', profiles.testnet),
    mainnet: tableEntry('mainnet', profiles.mainnet),
  });
  // Seed backups are keyed by blockchain id, so two networks sharing one
  // would read each other's backups.
  if (table.testnet.blockchain === table.mainnet.blockchain) {
    throw new TypeError(`${TABLE_FILE} gives two networks the blockchain id ${table.testnet.blockchain}`);
  }
  return table;
}

/** The pinned identity of a network, or why it cannot run. */
function pinnedIdentity(
  network: NativeNetworkProfile,
  table: NativeNetworkTable,
): { chainId: string; genesisHash: string } | string {
  const { name, chainId, genesisHash } = network;
  if (chainId === null && genesisHash === null) {
    return (
      `This app build selects the ${name} network, whose chain ID and genesis hash are not ` +
      `set in ${TABLE_FILE} yet. Set both, or build with ${SELECTOR}=testnet.`
    );
  }
  if (chainId === null || genesisHash === null) {
    return `The ${name} network in ${TABLE_FILE} needs its chain ID and genesis hash set together.`;
  }
  if (!CHAIN_ID_PATTERN.test(chainId)) {
    return `The ${name} chain ID in ${TABLE_FILE} must be lower-case 0x hex without leading zeros.`;
  }
  if (!GENESIS_HASH_PATTERN.test(genesisHash)) {
    return `The ${name} genesis hash in ${TABLE_FILE} must be a lower-case 0x 32-byte hash.`;
  }
  if (
    name !== 'testnet' &&
    (chainId === table.testnet.chainId || genesisHash === table.testnet.genesisHash)
  ) {
    return `The ${name} chain ID and genesis hash in ${TABLE_FILE} must both differ from the testnet ones.`;
  }
  return { chainId, genesisHash };
}

/**
 * Picks the network for a build. An unset or empty selector means the
 * testnet. An unknown value is refused, and so is a network without a usable
 * pinned identity. Neither falls back to another network.
 */
export function selectNativeNetwork(
  requested: string | undefined,
  table: NativeNetworkTable,
): NativeNetworkSelection {
  const normalized = (requested ?? '').trim().toLowerCase();
  const wanted = normalized === '' ? DEFAULT_NATIVE_NETWORK : normalized;
  const name = NATIVE_NETWORK_NAMES.find((candidate) => candidate === wanted);
  if (name === undefined) {
    return {
      ok: false,
      requested: wanted,
      error: `Unknown network profile "${wanted}" in ${SELECTOR}. Use testnet or mainnet.`,
    };
  }
  const network = table[name];
  const identity = pinnedIdentity(network, table);
  if (typeof identity === 'string') return { ok: false, requested: name, error: identity };
  return { ok: true, network: Object.freeze({ ...network, ...identity }) };
}

export const NATIVE_NETWORK_TABLE: NativeNetworkTable = parseNativeNetworkTable(nativeNetworkProfiles);

/** The network this build speaks, or why it speaks none. */
export const NATIVE_NETWORK: NativeNetworkSelection = selectNativeNetwork(
  envString(process.env.EXPO_PUBLIC_QRL_NETWORK_PROFILE),
  NATIVE_NETWORK_TABLE,
);

/** Set when this build must not run any wallet document. */
export const NATIVE_NETWORK_ERROR: string | null = NATIVE_NETWORK.ok ? null : NATIVE_NETWORK.error;

const PINNED_NETWORK: PinnedNativeNetwork | null = NATIVE_NETWORK.ok ? NATIVE_NETWORK.network : null;

/**
 * Compatibility metadata. Privileged bridge calls still require document
 * binding and authorization. A build without a usable network advertises
 * nulls, which no web wallet build accepts.
 */
export const NATIVE_WALLET_CAPABILITIES = Object.freeze({
  bridgeVersion: 1,
  addressScheme: 'qip55-64',
  networkProfile: PINNED_NETWORK?.networkProfile ?? null,
  chainId: PINNED_NETWORK?.chainId ?? null,
  genesisHash: PINNED_NETWORK?.genesisHash ?? null,
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
    // This build sends APP_LOCKED on every lock, so the page may keep an injected
    // Device Login PIN across inactive/active transitions.
    appLockedSignal: true,
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

/**
 * The one blockchain id this build stores and restores seeds for. Null when
 * the build has no usable network, so every seed message is refused.
 */
export const NATIVE_WALLET_BLOCKCHAIN: string | null = PINNED_NETWORK?.blockchain ?? null;
