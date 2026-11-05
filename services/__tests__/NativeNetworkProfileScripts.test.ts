import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { embeddedMarkersFor } from '../EmbeddedWalletProfile';
import {
  NATIVE_NETWORK_TABLE,
  parseNativeNetworkTable,
  selectNativeNetwork,
} from '../NativeWalletProfile';
import { isRecord } from '../guards';

const projectRoot = resolve(__dirname, '../..');
const SELECTOR = 'EXPO_PUBLIC_QRL_NETWORK_PROFILE';
const UNPINNED_MAINNET_ERROR =
  'This app build selects the mainnet network, whose chain ID and genesis hash are not set in ' +
  'services/NativeNetworkProfiles.json yet. Set both, or build with ' +
  'EXPO_PUBLIC_QRL_NETWORK_PROFILE=testnet.';

// The build scripts read the table through this CommonJS helper. Loaded as
// unknown and narrowed, so the test makes no claim about its types.
const helperModule: unknown = jest.requireActual('../../scripts/native-network-profile.js');

function helper(name: string): (...args: unknown[]) => unknown {
  if (!isRecord(helperModule)) throw new TypeError('Expected the helper module object');
  const fn = helperModule[name];
  if (typeof fn !== 'function') throw new TypeError(`Expected helper function ${name}`);
  return (...args: unknown[]): unknown => {
    const result: unknown = Reflect.apply(fn, undefined, args);
    return result;
  };
}

const resolveInScript = helper('resolveNativeNetworkProfile');
const markersInScript = helper('markersFor');
const missingInScript = helper('missingMarkers');
const parseInScript = helper('parseNativeNetworkTable');

function committedTable(): Record<string, unknown> {
  const raw: unknown = JSON.parse(
    readFileSync(resolve(projectRoot, 'services/NativeNetworkProfiles.json'), 'utf8'),
  );
  if (!isRecord(raw)) throw new TypeError('Expected the committed network table');
  return raw;
}

function withMainnet(mainnet: Record<string, unknown>): Record<string, unknown> {
  const raw = committedTable();
  if (!isRecord(raw.profiles) || !isRecord(raw.profiles.mainnet)) {
    throw new TypeError('Expected a network table');
  }
  return { ...raw, profiles: { ...raw.profiles, mainnet: { ...raw.profiles.mainnet, ...mainnet } } };
}

function withTestnet(testnet: Record<string, unknown>): Record<string, unknown> {
  const raw = committedTable();
  if (!isRecord(raw.profiles) || !isRecord(raw.profiles.testnet)) {
    throw new TypeError('Expected a network table');
  }
  return { ...raw, profiles: { ...raw.profiles, testnet: { ...raw.profiles.testnet, ...testnet } } };
}

const MAINNET_PINS = { chainId: '0xabc123', genesisHash: `0x${'7e'.repeat(32)}` };
const TABLE_VARIANTS: readonly [string, Record<string, unknown>][] = [
  ['the committed table', committedTable()],
  ['a pinned mainnet', withMainnet(MAINNET_PINS)],
  ['a chain-ID-only mainnet', withMainnet({ chainId: MAINNET_PINS.chainId })],
  ['a mainnet reusing the testnet chain ID', withMainnet({ ...MAINNET_PINS, chainId: '0x301825' })],
  ['a mainnet with an upper-case genesis', withMainnet({ ...MAINNET_PINS, genesisHash: `0x${'AB'.repeat(32)}` })],
];
const SELECTORS = [undefined, '', 'testnet', ' MAINNET ', 'mainnet', 'mainet', 'v3-mainnet'];

function run(command: string, args: readonly string[], selector: string | undefined) {
  const env: NodeJS.ProcessEnv = { ...process.env, FRONTEND_DIR: '/nonexistent-frontend-checkout' };
  if (selector === undefined) delete env.EXPO_PUBLIC_QRL_NETWORK_PROFILE;
  else env.EXPO_PUBLIC_QRL_NETWORK_PROFILE = selector;
  return spawnSync(command, [...args], { cwd: projectRoot, env, encoding: 'utf8' });
}

describe('build scripts and the app read one network table', () => {
  it.each(TABLE_VARIANTS)('select the same network as the app for %s', (_label, raw) => {
    const table = parseNativeNetworkTable(raw);
    for (const selector of SELECTORS) {
      expect([selector, resolveInScript(selector, raw)]).toEqual([
        selector,
        selectNativeNetwork(selector, table),
      ]);
    }
  });

  it('check documents against the same markers as the app', () => {
    for (const raw of [committedTable(), withMainnet(MAINNET_PINS)]) {
      const table = parseNativeNetworkTable(raw);
      for (const name of ['testnet', 'mainnet'] as const) {
        const selection = selectNativeNetwork(name, table);
        if (!selection.ok) continue;
        expect(markersInScript(selection.network)).toEqual(embeddedMarkersFor(selection.network));
      }
    }
  });

  it('tell a testnet-native document from a mainnet-native one when both carry both identities', () => {
    const table = parseNativeNetworkTable(withMainnet(MAINNET_PINS));
    const testnet = selectNativeNetwork('testnet', table);
    const mainnet = selectNativeNetwork('mainnet', table);
    if (!testnet.ok || !mainnet.ok) throw new Error('Expected both networks pinned');
    const both =
      `VITE_V3_CHAIN_ID:"${testnet.network.chainId}",VITE_V3_GENESIS_HASH:"${testnet.network.genesisHash}",` +
      `VITE_MAINNET_CHAIN_ID:"${mainnet.network.chainId}",VITE_MAINNET_GENESIS_HASH:"${mainnet.network.genesisHash}",` +
      `k="${testnet.network.storagePrefix}"+key`;
    const testnetNative = `${both},n={networkProfile:"v3-private"}`;
    const mainnetNative = `${both},n={networkProfile:"v3-mainnet"}`;
    expect(missingInScript(testnetNative, testnet.network)).toEqual([]);
    expect(missingInScript(testnetNative, mainnet.network)).toEqual(['network profile']);
    expect(missingInScript(mainnetNative, mainnet.network)).toEqual([]);
    expect(missingInScript(mainnetNative, testnet.network)).toEqual(['network profile']);
  });

  it.each([
    ['a missing profiles object', { comment: 'x' }],
    ['an unknown profile', { profiles: { ...NATIVE_NETWORK_TABLE, devnet: NATIVE_NETWORK_TABLE.testnet } }],
    ['a mainnet advertised as v3-private', withMainnet({ networkProfile: 'v3-private' })],
    ['a mainnet sharing the testnet blockchain id', withMainnet({ blockchain: 'TEST_NET_V3' })],
  ])('reject a table with %s', (_label, raw) => {
    expect(() => parseNativeNetworkTable(raw)).toThrow(TypeError);
    expect(() => parseInScript(raw)).toThrow(TypeError);
  });

  it.each([
    ['a mainnet', 'MAIN_NET', withMainnet({ blockchain: 'MAIN_NET' })],
    ['a mainnet', 'TEST_NET', withMainnet({ blockchain: 'TEST_NET' })],
    ['a testnet', 'TEST_NET', withTestnet({ blockchain: 'TEST_NET' })],
    ['a testnet', 'MAIN_NET', withTestnet({ blockchain: 'MAIN_NET' })],
  ])('reject %s on the legacy blockchain id %s', (_label, id, raw) => {
    const reason = `blockchain ${id} is a legacy v2 id`;
    expect(() => parseNativeNetworkTable(raw)).toThrow(reason);
    expect(() => parseInScript(raw)).toThrow(reason);
  });

  it('keep no network literal of their own in the sync script', () => {
    const script = readFileSync(resolve(projectRoot, 'scripts/sync-embedded-web.sh'), 'utf8');
    expect(script).toContain('scripts/native-network-profile.js');
    expect(script).not.toContain('0x301825');
    expect(script).not.toContain('d15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4');
  });
});

describe('sync-embedded-web.sh network gate', () => {
  it.each([
    ['mainnet', UNPINNED_MAINNET_ERROR],
    ['mainet', 'Unknown network profile "mainet"'],
  ])('fails for %p before it touches the frontend', (selector, reason) => {
    const result = run('bash', ['scripts/sync-embedded-web.sh'], selector);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(reason);
    expect(result.stderr).toContain('no usable network profile for this build');
    // Nothing past the gate ran: the missing frontend checkout went unnoticed.
    expect(result.stderr).not.toContain('frontend checkout not found');
    expect(result.stdout).not.toContain('network profile');
  });

  it.each([undefined, 'testnet'])('resolves the testnet for %p and moves on', (selector) => {
    const result = run('bash', ['scripts/sync-embedded-web.sh'], selector);
    expect(result.stdout).toContain('sync-embedded-web: network profile v3-private');
    // The fake frontend path is what stops it, one step after the gate.
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('frontend checkout not found');
  });
});

describe('verify-embedded-web.js network gate', () => {
  it.each([undefined, 'testnet'])('accepts the shipped testnet document for %p', (selector) => {
    const result = run(process.execPath, ['scripts/verify-embedded-web.js'], selector);
    expect([result.status, result.stderr]).toEqual([0, '']);
    expect(result.stdout).toContain('profile  v3-private (testnet)');
  });

  it.each([
    ['mainnet', UNPINNED_MAINNET_ERROR],
    ['mainet', 'Unknown network profile "mainet"'],
  ])('fails a %p build', (selector, reason) => {
    const result = run(process.execPath, ['scripts/verify-embedded-web.js'], selector);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(reason);
  });
});

describe('native-network-profile.js command line', () => {
  it('reports the shipped document as the testnet build', () => {
    const result = run(process.execPath, ['scripts/native-network-profile.js', 'check', 'assets/web/index.html'], undefined);
    expect([result.status, result.stdout.trim()]).toEqual([0, 'v3-private']);
  });

  it('refuses the shipped document on a mainnet build', () => {
    const result = run(process.execPath, ['scripts/native-network-profile.js', 'check', 'assets/web/index.html'], 'mainnet');
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(UNPINNED_MAINNET_ERROR);
  });

  it('refuses a document without the testnet markers', () => {
    const result = run(process.execPath, ['scripts/native-network-profile.js', 'check', 'package.json'], 'testnet');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing: chain id, genesis hash, v3 storage prefix, network profile');
  });
});

describe('EAS build profiles', () => {
  const eas: unknown = JSON.parse(readFileSync(resolve(projectRoot, 'eas.json'), 'utf8'));

  it('each select a network the app can run, and every current one is the testnet', () => {
    if (!isRecord(eas) || !isRecord(eas.build)) throw new TypeError('Expected EAS build profiles');
    const selected: Record<string, unknown> = {};
    for (const [name, profile] of Object.entries(eas.build)) {
      if (!isRecord(profile) || !isRecord(profile.env)) throw new TypeError(`Expected env on ${name}`);
      const selector = profile.env[SELECTOR];
      if (typeof selector !== 'string') throw new TypeError(`${name} does not set ${SELECTOR}`);
      expect([name, selectNativeNetwork(selector, NATIVE_NETWORK_TABLE).ok]).toEqual([name, true]);
      selected[name] = selector;
    }
    expect(selected).toEqual({
      development: 'testnet',
      'development-embedded': 'testnet',
      preview: 'testnet',
      'preview-embedded': 'testnet',
      production: 'testnet',
    });
  });
});
