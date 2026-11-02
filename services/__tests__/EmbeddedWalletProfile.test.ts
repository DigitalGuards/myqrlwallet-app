import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { malformed } from '../../test-utils/malformed';

import {
  EMBEDDED_MARKER_NAMES,
  detectEmbeddedWalletProfile,
  embeddedMarkersFor,
  embeddedProfileErrorMessage,
} from '../EmbeddedWalletProfile';
import {
  NATIVE_NETWORK,
  NATIVE_NETWORK_TABLE,
  parseNativeNetworkTable,
  selectNativeNetwork,
  type NativeNetworkSelection,
  type PinnedNativeNetwork,
} from '../NativeWalletProfile';
import { isRecord } from '../guards';

const projectRoot = resolve(__dirname, '../..');

function pinned(selection: NativeNetworkSelection): PinnedNativeNetwork {
  if (!selection.ok) throw new Error(selection.error);
  return selection.network;
}

const TESTNET = pinned(selectNativeNetwork('testnet', NATIVE_NETWORK_TABLE));
const UNPINNED_MAINNET = selectNativeNetwork('mainnet', NATIVE_NETWORK_TABLE);

// A mainnet as it will look once its identity is published. The values are
// stand-ins and appear only in this variant table.
function committedTable(): Record<string, unknown> {
  const raw: unknown = JSON.parse(
    readFileSync(resolve(projectRoot, 'services/NativeNetworkProfiles.json'), 'utf8'),
  );
  if (!isRecord(raw) || !isRecord(raw.profiles) || !isRecord(raw.profiles.mainnet)) {
    throw new TypeError('Expected the committed network table');
  }
  return raw;
}
function withMainnetPins(raw: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(raw.profiles) || !isRecord(raw.profiles.mainnet)) {
    throw new TypeError('Expected a network table');
  }
  return {
    ...raw,
    profiles: {
      ...raw.profiles,
      mainnet: { ...raw.profiles.mainnet, chainId: '0xabc123', genesisHash: `0x${'7e'.repeat(32)}` },
    },
  };
}
const PINNED_TABLE = parseNativeNetworkTable(withMainnetPins(committedTable()));
const PINNED_MAINNET_SELECTION = selectNativeNetwork('mainnet', PINNED_TABLE);
const PINNED_MAINNET = pinned(PINNED_MAINNET_SELECTION);

const documentFor = (network: PinnedNativeNetwork) =>
  `<!doctype html><html><head><script>
     var n={chainId:"${network.chainId}",genesisHash:"${network.genesisHash}"};
     var k="${network.storagePrefix}"+key;
   </script></head><body></body></html>`;

// A build made without VITE_WALLET_PROFILE=v3-private: the network constant is
// null and every storage key keeps its bare name.
const v2Document = () =>
  '<!doctype html><html><head><script>var n=null;var k=key;</script></head><body></body></html>';

describe('bundled wallet network profile', () => {
  it('runs the testnet in a default build', () => {
    expect(NATIVE_NETWORK).toEqual({ ok: true, network: TESTNET });
  });

  it('accepts a document built for the network this app speaks', () => {
    expect(detectEmbeddedWalletProfile(documentFor(TESTNET))).toEqual({
      profile: 'v3-private',
      missing: [],
    });
    expect(embeddedProfileErrorMessage(detectEmbeddedWalletProfile(documentFor(TESTNET)))).toBeNull();
  });

  it('rejects a document built without the v3 deployment profile', () => {
    const verdict = detectEmbeddedWalletProfile(v2Document());
    expect(verdict.profile).toBe('unknown');
    expect(verdict.missing).toEqual(['chain id', 'genesis hash', 'v3 storage prefix']);
    // The testnet message every earlier release showed, word for word.
    expect(embeddedProfileErrorMessage(verdict)).toBe(
      'This app build ships a wallet for the wrong network. It needs TEST_NET_V3 and the ' +
        'bundled wallet does not declare it (missing: chain id, genesis hash, v3 storage ' +
        'prefix). Install a build whose wallet was synced with scripts/sync-embedded-web.sh ' +
        'from a v3 frontend build.',
    );
  });

  it('checks the testnet against the markers it always used', () => {
    expect(embeddedMarkersFor(TESTNET)).toEqual([
      { name: 'chain id', literal: '0x301825' },
      {
        name: 'genesis hash',
        literal: '0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4',
      },
      { name: 'v3 storage prefix', literal: 'qrlwallet:v3:' },
    ]);
    expect(embeddedMarkersFor(TESTNET).map((marker) => marker.name)).toEqual(EMBEDDED_MARKER_NAMES);
  });

  it('names exactly the markers that are missing', () => {
    for (const marker of embeddedMarkersFor(TESTNET)) {
      const partial = documentFor(TESTNET).split(marker.literal).join('REMOVED');
      expect(detectEmbeddedWalletProfile(partial).missing).toEqual([marker.name]);
    }
  });

  it('rejects an empty or missing document', () => {
    expect(detectEmbeddedWalletProfile('').profile).toBe('unknown');
    expect(detectEmbeddedWalletProfile(malformed(undefined)).profile).toBe('unknown');
  });

  it('agrees with the profile recorded for the document in the bundle', () => {
    const html = readFileSync(resolve(projectRoot, 'assets/web/index.html'), 'utf8');
    const buildInfo: unknown = JSON.parse(
      readFileSync(resolve(projectRoot, 'assets/web/BUILD_INFO.json'), 'utf8'),
    );
    if (!isRecord(buildInfo)) throw new TypeError('Expected build info object');
    expect(detectEmbeddedWalletProfile(html).profile).toBe(buildInfo.walletProfile);
  });
});

describe('bundled wallet check on a mainnet build', () => {
  it('refuses every document while the mainnet identity is unset', () => {
    expect(UNPINNED_MAINNET.ok).toBe(false);
    if (UNPINNED_MAINNET.ok) return;
    const shipped = readFileSync(resolve(projectRoot, 'assets/web/index.html'), 'utf8');
    for (const html of [shipped, documentFor(TESTNET), documentFor(PINNED_MAINNET), v2Document()]) {
      const verdict = detectEmbeddedWalletProfile(html, UNPINNED_MAINNET);
      expect(verdict.profile).toBe('unknown');
      expect(embeddedProfileErrorMessage(verdict, UNPINNED_MAINNET)).toBe(UNPINNED_MAINNET.error);
    }
    expect(UNPINNED_MAINNET.error).toContain('chain ID and genesis hash are not set');
  });

  it('accepts a document built for the mainnet once both pins are set', () => {
    const verdict = detectEmbeddedWalletProfile(documentFor(PINNED_MAINNET), PINNED_MAINNET_SELECTION);
    expect(verdict).toEqual({ profile: 'v3-mainnet', missing: [] });
    expect(embeddedProfileErrorMessage(verdict, PINNED_MAINNET_SELECTION)).toBeNull();
  });

  it('refuses the testnet document on a pinned mainnet build and names MAIN_NET_V3', () => {
    const shipped = readFileSync(resolve(projectRoot, 'assets/web/index.html'), 'utf8');
    for (const html of [shipped, documentFor(TESTNET)]) {
      const verdict = detectEmbeddedWalletProfile(html, PINNED_MAINNET_SELECTION);
      expect(verdict).toEqual({ profile: 'unknown', missing: ['chain id', 'genesis hash'] });
      const message = embeddedProfileErrorMessage(verdict, PINNED_MAINNET_SELECTION);
      expect(message).toContain('wrong network');
      expect(message).toContain('MAIN_NET_V3');
    }
  });

  it('refuses a mainnet document on the testnet build', () => {
    const verdict = detectEmbeddedWalletProfile(documentFor(PINNED_MAINNET));
    expect(verdict).toEqual({ profile: 'unknown', missing: ['chain id', 'genesis hash'] });
    expect(embeddedProfileErrorMessage(verdict)).toContain('TEST_NET_V3');
  });
});
