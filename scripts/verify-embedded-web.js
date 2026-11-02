#!/usr/bin/env node
/**
 * Verify the wallet document that is about to be packaged.
 *
 * `assets/web/PIN.json` is the reviewed digest. Changing the wallet the app
 * ships therefore means changing a small, readable file in a commit someone
 * approves, rather than swapping a three megabyte blob that no reviewer reads.
 *
 * This runs in three places:
 *   - `npm run verify:embedded-web` locally,
 *   - the `eas-build-post-install` hook, so a cloud build that somehow got a
 *     different document fails before it is signed,
 *   - CI on every push.
 *
 * It refuses a document that does not match the pin, a build recorded from a
 * dirty frontend checkout, and a profile that is not the one the native bridge
 * speaks. That profile is the network EXPO_PUBLIC_QRL_NETWORK_PROFILE selects
 * in services/NativeNetworkProfiles.json (testnet when unset), so a build for
 * a network without a pinned chain id and genesis hash fails here too.
 */
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { missingMarkers, resolveNativeNetworkProfile } = require('./native-network-profile.js');

const projectRoot = resolve(__dirname, '..');
const documentPath = resolve(projectRoot, 'assets/web/index.html');
const pinPath = resolve(projectRoot, 'assets/web/PIN.json');
const buildInfoPath = resolve(projectRoot, 'assets/web/BUILD_INFO.json');

function fail(message) {
  console.error(`verify-embedded-web: ${message}`);
  process.exit(1);
}

let selection;
try {
  selection = resolveNativeNetworkProfile(process.env.EXPO_PUBLIC_QRL_NETWORK_PROFILE);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
if (!selection.ok) fail(selection.error);
const { network } = selection;
const EXPECTED_PROFILE = network.networkProfile;

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`cannot read ${label}: ${error.message}`);
  }
}

const pin = readJson(pinPath, 'assets/web/PIN.json');
const buildInfo = readJson(buildInfoPath, 'assets/web/BUILD_INFO.json');

let bytes;
try {
  bytes = readFileSync(documentPath);
} catch (error) {
  fail(`cannot read assets/web/index.html: ${error.message}`);
}

const digest = createHash('sha256').update(bytes).digest('hex');

if (typeof pin.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(pin.sha256)) {
  fail('PIN.json has no usable sha256');
}
if (digest !== pin.sha256) {
  fail(
    `the wallet document does not match the reviewed pin\n` +
      `  pinned  ${pin.sha256}\n` +
      `  actual  ${digest}\n` +
      'Re-run scripts/sync-embedded-web.sh and update assets/web/PIN.json in the same commit.',
  );
}
if (bytes.length !== pin.bytes) {
  fail(`the wallet document is ${bytes.length} bytes, the pin says ${pin.bytes}`);
}
if (buildInfo.sha256 !== pin.sha256) {
  fail('BUILD_INFO.json and PIN.json disagree about the document digest');
}
if (buildInfo.frontendCommit !== pin.frontendCommit) {
  fail('BUILD_INFO.json and PIN.json disagree about the frontend commit');
}
if (buildInfo.frontendDirty !== false) {
  fail('the wallet document was built from a dirty frontend checkout; rebuild from a clean tree');
}
if (buildInfo.walletProfile !== EXPECTED_PROFILE || pin.walletProfile !== EXPECTED_PROFILE) {
  fail(`the wallet document is not the ${EXPECTED_PROFILE} build`);
}
const missing = missingMarkers(bytes.toString('utf8'), network);
if (missing.length > 0) {
  fail(`the wallet document lacks the ${EXPECTED_PROFILE} markers (missing: ${missing.join(', ')})`);
}

console.log(
  `verify-embedded-web: ok\n` +
    `  frontend ${pin.frontendCommit}\n` +
    `  sha256   ${pin.sha256}\n` +
    `  bytes    ${pin.bytes}\n` +
    `  profile  ${pin.walletProfile} (${network.name})`,
);
