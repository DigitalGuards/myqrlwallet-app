import { NATIVE_WALLET_BLOCKCHAIN, NATIVE_WALLET_CAPABILITIES } from './NativeWalletProfile';

/**
 * Check that the wallet shipped in the app bundle was built for the network
 * this app speaks.
 *
 * The bundled document is produced from the frontend by a separate build. If
 * that build runs without the v3 deployment profile, the wallet comes up on
 * the old v2 network and looks fine until the first privileged bridge call:
 * SEED_STORED then carries blockchain "TEST_NET" while NativeBridge requires
 * "TEST_NET_V3", the message is refused as an invalid request, and the user
 * sees "Native secure seed backup failed" only after importing a seed and
 * setting a PIN. That is a long way past the point where the mismatch should
 * have been caught.
 *
 * The check runs on the document before it is handed to the WebView, so a
 * mis-built release fails closed with an explicit message instead.
 *
 * ## What it looks for
 *
 * The frontend selects the profile with `VITE_WALLET_PROFILE=v3-private`,
 * which makes its Vite config define `__QRL_NATIVE_NETWORK__` as the v3 chain
 * id and genesis hash. Both literals are compared at runtime by the frontend's
 * own native-context check, so a minifier cannot fold them away, and a build
 * without the profile defines that constant as null and contains neither.
 * The profile also switches every storage key to the "qrlwallet:v3:" prefix,
 * which survives minification as a string literal for the same reason.
 *
 * These are content markers, not a signature. They answer "was this document
 * built for the right network", which is a build accident, and they are not a
 * defence against a tampered bundle. That property comes from the document
 * being inside the signed app binary.
 */

export const V3_STORAGE_PREFIX = 'qrlwallet:v3:';

export interface EmbeddedProfileMarker {
  /** Short name used in the failure message and in tests. */
  name: string;
  /** Literal that a v3 build must contain. */
  literal: string;
}

export const EMBEDDED_V3_MARKERS: readonly EmbeddedProfileMarker[] = [
  { name: 'chain id', literal: NATIVE_WALLET_CAPABILITIES.chainId },
  { name: 'genesis hash', literal: NATIVE_WALLET_CAPABILITIES.genesisHash },
  { name: 'v3 storage prefix', literal: V3_STORAGE_PREFIX },
];

export type EmbeddedProfileVerdict =
  | { profile: 'v3-private'; missing: readonly [] }
  | { profile: 'unknown'; missing: readonly string[] };

/** Which network profile the bundled document was built for. */
export function detectEmbeddedWalletProfile(html: string): EmbeddedProfileVerdict {
  if (typeof html !== 'string' || html.length === 0) {
    return { profile: 'unknown', missing: EMBEDDED_V3_MARKERS.map((marker) => marker.name) };
  }
  const missing = EMBEDDED_V3_MARKERS.filter(
    (marker) => !html.includes(marker.literal),
  ).map((marker) => marker.name);
  return missing.length === 0
    ? { profile: 'v3-private', missing: [] }
    : { profile: 'unknown', missing };
}

/**
 * The message to show instead of starting the wallet, or null when the
 * document is the right one. Names the network the app speaks so a tester can
 * tell a wrong build from a broken one.
 */
export function embeddedProfileErrorMessage(verdict: EmbeddedProfileVerdict): string | null {
  if (verdict.profile === 'v3-private') return null;
  return (
    `This app build ships a wallet for the wrong network. It needs ` +
    `${NATIVE_WALLET_BLOCKCHAIN} and the bundled wallet does not declare it ` +
    `(missing: ${verdict.missing.join(', ')}). Install a build whose wallet was ` +
    `synced with scripts/sync-embedded-web.sh from a v3 frontend build.`
  );
}
