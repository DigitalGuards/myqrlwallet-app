import {
  NATIVE_NETWORK,
  type NativeNetworkSelection,
  type NativeWalletNetworkProfile,
  type PinnedNativeNetwork,
} from './NativeWalletProfile';

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
 * The markers of the network this build selected in
 * services/NativeNetworkProfiles.json: its chain id, its genesis hash and its
 * storage prefix. The frontend selects the profile with
 * `VITE_WALLET_PROFILE=v3-private`, which makes its Vite config define
 * `__QRL_NATIVE_NETWORK__` as the native network's chain id and genesis hash.
 * Both literals are compared at runtime by the frontend's own native-context
 * check, so a minifier cannot fold them away, and a build without the profile
 * defines that constant as null and contains neither. The profile also
 * switches every storage key to the "qrlwallet:v3:" prefix, which survives
 * minification as a string literal for the same reason.
 *
 * A build whose network has no pinned chain id and genesis hash (the mainnet
 * until it launches) accepts no document at all.
 *
 * These are content markers. They answer "was this document built for the
 * right network", which is a build accident. Protection against a tampered
 * bundle comes from the document being inside the signed app binary.
 *
 * scripts/native-network-profile.js applies the same markers in the sync and
 * verify scripts; a unit test keeps the two in step.
 */

export interface EmbeddedProfileMarker {
  /** Short name used in the failure message and in tests. */
  name: string;
  /** Literal that a document built for the network must contain. */
  literal: string;
}

export const EMBEDDED_MARKER_NAMES: readonly string[] = Object.freeze([
  'chain id',
  'genesis hash',
  'v3 storage prefix',
]);

/** The literals a document built for this network carries. */
export function embeddedMarkersFor(network: PinnedNativeNetwork): readonly EmbeddedProfileMarker[] {
  return [
    { name: 'chain id', literal: network.chainId },
    { name: 'genesis hash', literal: network.genesisHash },
    { name: 'v3 storage prefix', literal: network.storagePrefix },
  ];
}

export type EmbeddedProfileVerdict =
  | { profile: NativeWalletNetworkProfile; missing: readonly [] }
  | { profile: 'unknown'; missing: readonly string[] };

/** Which network profile the bundled document was built for. */
export function detectEmbeddedWalletProfile(
  html: string,
  selection: NativeNetworkSelection = NATIVE_NETWORK,
): EmbeddedProfileVerdict {
  if (!selection.ok) return { profile: 'unknown', missing: EMBEDDED_MARKER_NAMES };
  const markers = embeddedMarkersFor(selection.network);
  if (typeof html !== 'string' || html.length === 0) {
    return { profile: 'unknown', missing: markers.map((marker) => marker.name) };
  }
  const missing = markers.filter(
    (marker) => !html.includes(marker.literal),
  ).map((marker) => marker.name);
  return missing.length === 0
    ? { profile: selection.network.networkProfile, missing: [] }
    : { profile: 'unknown', missing };
}

/**
 * The message to show instead of starting the wallet, or null when the
 * document is the right one. Names the network the app speaks so a tester can
 * tell a wrong build from a broken one. A build without a usable network gets
 * the reason it has none.
 */
export function embeddedProfileErrorMessage(
  verdict: EmbeddedProfileVerdict,
  selection: NativeNetworkSelection = NATIVE_NETWORK,
): string | null {
  if (!selection.ok) return selection.error;
  if (verdict.profile === selection.network.networkProfile) return null;
  return (
    `This app build ships a wallet for the wrong network. It needs ` +
    `${selection.network.blockchain} and the bundled wallet does not declare it ` +
    `(missing: ${verdict.missing.join(', ')}). Install a build whose wallet was ` +
    `synced with scripts/sync-embedded-web.sh from a v3 frontend build.`
  );
}
