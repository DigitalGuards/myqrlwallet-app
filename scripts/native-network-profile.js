#!/usr/bin/env node
/**
 * The network this app build is for, read from
 * services/NativeNetworkProfiles.json for the build scripts.
 *
 * services/NativeWalletProfile.ts applies the same rules inside the app, and
 * services/EmbeddedWalletProfile.ts the same document markers. A unit test
 * holds this file and those modules to the same answers, so the network a
 * document is synced and verified for is the network the binary speaks.
 *
 * Usage:
 *   node scripts/native-network-profile.js profile
 *       Prints the selected capability profile (v3-private or v3-mainnet).
 *   node scripts/native-network-profile.js check <document.html>
 *       Prints the profile when the document carries every marker of the
 *       selected network, and fails naming the missing ones otherwise.
 *
 * Environment:
 *   EXPO_PUBLIC_QRL_NETWORK_PROFILE   testnet (the default when unset) or
 *                                     mainnet, the same variable the app
 *                                     build reads.
 *
 * Both commands exit 1 when the selection is unknown or the selected network
 * has no usable pinned chain ID and genesis hash.
 */
const { readFileSync } = require('node:fs');

const TABLE_FILE = 'services/NativeNetworkProfiles.json';
const SELECTOR = 'EXPO_PUBLIC_QRL_NETWORK_PROFILE';
const NAMES = ['testnet', 'mainnet'];
const DEFAULT_NAME = 'testnet';
const NETWORK_PROFILE_BY_NAME = { testnet: 'v3-private', mainnet: 'v3-mainnet' };
const CHAIN_ID_PATTERN = /^0x[1-9a-f][0-9a-f]*$/;
const GENESIS_HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const BLOCKCHAIN_PATTERN = /^[A-Z][A-Z0-9_]*$/;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tableEntry(name, raw) {
  const where = `${TABLE_FILE} profiles.${name}`;
  if (!isRecord(raw)) throw new TypeError(`${where} must be an object`);
  const { networkProfile, blockchain, chainId, genesisHash, storagePrefix } = raw;
  if (networkProfile !== NETWORK_PROFILE_BY_NAME[name]) {
    throw new TypeError(`${where}.networkProfile must be ${NETWORK_PROFILE_BY_NAME[name]}`);
  }
  if (typeof blockchain !== 'string' || !BLOCKCHAIN_PATTERN.test(blockchain)) {
    throw new TypeError(`${where}.blockchain must be an upper-case network id`);
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
  return { name, networkProfile, blockchain, chainId, genesisHash, storagePrefix };
}

/** Reads the table file's content. Throws on a malformed one. */
function parseNativeNetworkTable(raw) {
  if (!isRecord(raw) || !isRecord(raw.profiles)) {
    throw new TypeError(`${TABLE_FILE} must hold a profiles object`);
  }
  const { profiles } = raw;
  const unexpected = Object.keys(profiles).filter((key) => !NAMES.includes(key));
  if (unexpected.length > 0) {
    throw new TypeError(`${TABLE_FILE} has unknown profiles: ${unexpected.join(', ')}`);
  }
  const table = {
    testnet: tableEntry('testnet', profiles.testnet),
    mainnet: tableEntry('mainnet', profiles.mainnet),
  };
  if (table.testnet.blockchain === table.mainnet.blockchain) {
    throw new TypeError(
      `${TABLE_FILE} gives two networks the blockchain id ${table.testnet.blockchain}`,
    );
  }
  return table;
}

function pinnedIdentity(network, table) {
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
 * The selected network, or why there is none. `rawTable` defaults to the
 * committed table file; tests pass variants.
 */
function resolveNativeNetworkProfile(requested, rawTable = require('../services/NativeNetworkProfiles.json')) {
  const table = parseNativeNetworkTable(rawTable);
  const normalized = (typeof requested === 'string' ? requested : '').trim().toLowerCase();
  const wanted = normalized === '' ? DEFAULT_NAME : normalized;
  if (!NAMES.includes(wanted)) {
    return {
      ok: false,
      requested: wanted,
      error: `Unknown network profile "${wanted}" in ${SELECTOR}. Use testnet or mainnet.`,
    };
  }
  const network = table[wanted];
  const identity = pinnedIdentity(network, table);
  if (typeof identity === 'string') return { ok: false, requested: wanted, error: identity };
  return { ok: true, network: { ...network, ...identity } };
}

/** The literals a document built for this network carries. */
function markersFor(network) {
  return [
    { name: 'chain id', literal: network.chainId },
    { name: 'genesis hash', literal: network.genesisHash },
    { name: 'v3 storage prefix', literal: network.storagePrefix },
  ];
}

/** Names of the markers the document lacks; empty when it has them all. */
function missingMarkers(html, network) {
  return markersFor(network)
    .filter((marker) => typeof html !== 'string' || !html.includes(marker.literal))
    .map((marker) => marker.name);
}

function fail(message) {
  console.error(`native-network-profile: ${message}`);
  process.exit(1);
}

function main(argv) {
  const [command, documentPath] = argv;
  let selection;
  try {
    selection = resolveNativeNetworkProfile(process.env[SELECTOR]);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (!selection.ok) fail(selection.error);
  const { network } = selection;

  if (command === 'profile' && documentPath === undefined) {
    console.log(network.networkProfile);
    return;
  }
  if (command === 'check' && typeof documentPath === 'string') {
    let html;
    try {
      html = readFileSync(documentPath, 'utf8');
    } catch (error) {
      fail(`cannot read ${documentPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const missing = missingMarkers(html, network);
    if (missing.length > 0) {
      fail(
        `${documentPath} was not built for the ${network.name} network ` +
          `${network.networkProfile} (missing: ${missing.join(', ')})`,
      );
    }
    console.log(network.networkProfile);
    return;
  }
  fail('usage: native-network-profile.js profile | check <document.html>');
}

module.exports = {
  markersFor,
  missingMarkers,
  parseNativeNetworkTable,
  resolveNativeNetworkProfile,
};

if (require.main === module) main(process.argv.slice(2));
