import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  EMBEDDED_V3_MARKERS,
  V3_STORAGE_PREFIX,
  detectEmbeddedWalletProfile,
  embeddedProfileErrorMessage,
} from '../EmbeddedWalletProfile';
import { NATIVE_WALLET_BLOCKCHAIN, NATIVE_WALLET_CAPABILITIES } from '../NativeWalletProfile';

const projectRoot = resolve(__dirname, '../..');

const v3Document = () =>
  `<!doctype html><html><head><script>
     var n={chainId:"${NATIVE_WALLET_CAPABILITIES.chainId}",genesisHash:"${NATIVE_WALLET_CAPABILITIES.genesisHash}"};
     var k="${V3_STORAGE_PREFIX}"+key;
   </script></head><body></body></html>`;

// A build made without VITE_WALLET_PROFILE=v3-private: the network constant is
// null and every storage key keeps its bare name.
const v2Document = () =>
  '<!doctype html><html><head><script>var n=null;var k=key;</script></head><body></body></html>';

describe('bundled wallet network profile', () => {
  it('accepts a document built for the network this app speaks', () => {
    expect(detectEmbeddedWalletProfile(v3Document())).toEqual({
      profile: 'v3-private',
      missing: [],
    });
    expect(embeddedProfileErrorMessage(detectEmbeddedWalletProfile(v3Document()))).toBeNull();
  });

  it('rejects a document built without the v3 deployment profile', () => {
    const verdict = detectEmbeddedWalletProfile(v2Document());
    expect(verdict.profile).toBe('unknown');
    expect(verdict.missing).toEqual(['chain id', 'genesis hash', 'v3 storage prefix']);
    const message = embeddedProfileErrorMessage(verdict);
    expect(message).toContain(NATIVE_WALLET_BLOCKCHAIN);
    expect(message).toContain('chain id, genesis hash, v3 storage prefix');
  });

  it('names exactly the markers that are missing', () => {
    for (const marker of EMBEDDED_V3_MARKERS) {
      const partial = v3Document().split(marker.literal).join('REMOVED');
      expect(detectEmbeddedWalletProfile(partial).missing).toEqual([marker.name]);
    }
  });

  it('rejects an empty or missing document', () => {
    expect(detectEmbeddedWalletProfile('').profile).toBe('unknown');
    expect(detectEmbeddedWalletProfile(undefined as unknown as string).profile).toBe('unknown');
  });

  it('keeps the sync script markers in step with this module', () => {
    // The script gates the copy with the same literals, in bash. A drift there
    // would let a wrong-profile document into the bundle and only fail on a
    // device.
    const script = readFileSync(resolve(projectRoot, 'scripts/sync-embedded-web.sh'), 'utf8');
    for (const marker of EMBEDDED_V3_MARKERS) {
      expect(script).toContain(`${marker.name}=${marker.literal}`);
    }
  });

  it('agrees with the profile recorded for the document in the bundle', () => {
    const html = readFileSync(resolve(projectRoot, 'assets/web/index.html'), 'utf8');
    const buildInfo = JSON.parse(
      readFileSync(resolve(projectRoot, 'assets/web/BUILD_INFO.json'), 'utf8'),
    ) as { walletProfile?: string };
    expect(detectEmbeddedWalletProfile(html).profile).toBe(buildInfo.walletProfile);
  });
});
