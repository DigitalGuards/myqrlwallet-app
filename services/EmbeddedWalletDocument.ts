import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import buildInfo from '../assets/web/BUILD_INFO.json';

/**
 * The wallet document shipped inside the app bundle.
 *
 * `assets/web/index.html` is one self-contained file: the whole web wallet,
 * its stylesheet, its fonts and its crypto worker inlined. It is produced by
 * the frontend's `build:embedded` target and copied here by
 * `scripts/sync-embedded-web.sh`, which refuses any output that still
 * references a remote script, stylesheet or asset path.
 */

export interface EmbeddedWalletBuildInfo {
  /** Frontend commit the document was built from. */
  frontendCommit: string;
  /** Short form for display. */
  frontendCommitShort: string;
  /** ISO-8601 build timestamp. */
  builtAt: string;
  /** sha256 of assets/web/index.html, hex. */
  sha256: string;
  /** Byte length of the document. */
  bytes: number;
}

export const EMBEDDED_WALLET_BUILD_INFO: EmbeddedWalletBuildInfo =
  buildInfo as EmbeddedWalletBuildInfo;

/**
 * The wallet router reads this flag once, while its module graph evaluates,
 * and picks hash routing when it is true. A path push would otherwise make a
 * reload fetch that path from the live server.
 *
 * It is set twice on purpose. `injectedJavaScriptBeforeContentLoaded` is the
 * documented hook, but on Android it is delivered from onPageStarted and can
 * lose the race against the document's own script. Writing the flag into the
 * document head before handing the string to the WebView removes the race:
 * the app owns these bytes, and the embedded CSP allows inline script.
 */
export const EMBEDDED_FLAG_SCRIPT = 'window.__QRL_EMBEDDED__ = true; true;';

const BOOTSTRAP_TAG = '<script>window.__QRL_EMBEDDED__ = true;</script>';

/** Insert the embedded flag as the first script in the document head. */
export function withEmbeddedFlag(html: string): string {
  const headIndex = html.indexOf('<head>');
  if (headIndex === -1) {
    throw new Error('Embedded wallet document has no <head>');
  }
  const cut = headIndex + '<head>'.length;
  return html.slice(0, cut) + BOOTSTRAP_TAG + html.slice(cut);
}

let cachedHtml: string | null = null;
let inFlight: Promise<string> | null = null;

async function readEmbeddedDocument(): Promise<string> {
  // Required lazily so the asset is resolved only when embedded mode runs.
  // The literal path keeps it statically visible to Metro, so the document is
  // bundled into every build regardless.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const moduleId = require('../assets/web/index.html') as number;
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  const localUri = asset.localUri ?? asset.uri;
  if (!localUri) {
    throw new Error('Embedded wallet asset has no local URI');
  }
  return withEmbeddedFlag(await new File(localUri).text());
}

/**
 * Read the embedded document. The result is cached for the process: it is a
 * few megabytes of immutable text, and a crash recovery re-load must not pay
 * for a second read from disk.
 */
export function loadEmbeddedWalletHtml(): Promise<string> {
  if (cachedHtml !== null) return Promise.resolve(cachedHtml);
  if (inFlight) return inFlight;
  inFlight = readEmbeddedDocument()
    .then((html) => {
      cachedHtml = html;
      inFlight = null;
      return html;
    })
    .catch((error: unknown) => {
      inFlight = null;
      throw error;
    });
  return inFlight;
}

/** Test seam: drop the cached document. */
export function resetEmbeddedWalletCache(): void {
  cachedHtml = null;
  inFlight = null;
}
