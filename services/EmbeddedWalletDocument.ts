import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import * as Crypto from 'expo-crypto';

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
 * Set on the document as a fallback for the bootstrap script below.
 *
 * The wallet router reads `window.__QRL_EMBEDDED__` once, while its module
 * graph evaluates, and picks hash routing when it is true. A path push would
 * otherwise make a reload fetch that path from the live server.
 *
 * It carries no token. Injected scripts run in every document the WebView
 * loads, so anything put here would also run in a document that is not ours.
 */
export const EMBEDDED_FLAG_SCRIPT = 'window.__QRL_EMBEDDED__ = true; true;';

/**
 * Runs at document end, inside the document, and re-binds the bridge if the
 * WebView installed `window.ReactNativeWebView` after the head script ran.
 *
 * It names a function the bootstrap stored; a document that is not the shipped
 * one has no such function and this does nothing there. It contains no token,
 * which is why it is safe to hand to every document.
 */
export const EMBEDDED_REBIND_SCRIPT =
  '(function(){try{if(typeof window.__qrlBindBridge==="function")window.__qrlBindBridge();}catch(e){}})();true;';

/** Separator between the document token and the message the wallet sent. */
export const BRIDGE_TOKEN_SEPARATOR = '\u0000';

/** A fresh 256-bit document token, hex encoded. */
export function createDocumentToken(): string {
  const bytes = Crypto.getRandomBytes(32);
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/**
 * The script written into the document head.
 *
 * Two jobs:
 *   1. set `window.__QRL_EMBEDDED__` before any of the wallet's own scripts
 *      run. `injectedJavaScriptBeforeContentLoaded` is the documented hook for
 *      this, but Android delivers it from onPageStarted and can lose the race,
 *      and the app owns these bytes, so the flag is written here as well.
 *   2. prove to native that a bridge message came from this document.
 *
 * The second one is why the token lives here and nowhere else. The origin
 * check that guards the bridge accepts any document on https://qrlwallet.com,
 * so it cannot tell the shipped wallet from another document that somehow
 * reached that origin. The bootstrap wraps `ReactNativeWebView.postMessage`
 * so every message this document sends carries a per-load secret that only
 * native and this document know, and native drops anything that does not
 * carry it. A replacement document has no wrapper and cannot produce one.
 *
 * `__qrlBindBridge` is kept on the window so the document-end injected script
 * can re-run the wrap if `ReactNativeWebView` only appeared after this ran.
 * It closes over the token rather than exposing it.
 */
export function embeddedBootstrapScript(token: string, migrationPending: boolean): string {
  if (!/^[0-9a-f]{64}$/.test(token)) {
    throw new Error('Embedded document token must be 64 hex characters');
  }
  return (
    '<script>(function(){' +
    'window.__QRL_EMBEDDED__ = true;' +
    `window.__QRL_EMBEDDED_MIGRATION__ = ${migrationPending ? 'true' : 'false'};` +
    `var t=${JSON.stringify(token + BRIDGE_TOKEN_SEPARATOR)};` +
    'function wrap(b){' +
    'if(!b||b.__qrlBound)return b;' +
    'var p=b.postMessage;' +
    'if(typeof p!=="function")return b;' +
    'b.postMessage=function(m){return p.call(b,t+String(m));};' +
    'try{Object.defineProperty(b,"__qrlBound",{value:true});}catch(e){b.__qrlBound=true;}' +
    'return b;};' +
    'window.__qrlBindBridge=function(){try{wrap(window.ReactNativeWebView);}catch(e){}};' +
    'window.__qrlBindBridge();' +
    // The bridge object may not exist yet on Android. Wrap whatever is
    // assigned to it later, and keep the property writable so the WebView's
    // own assignment still works.
    'if(!window.ReactNativeWebView){var s;try{Object.defineProperty(window,"ReactNativeWebView",{' +
    'configurable:true,' +
    'get:function(){return s;},' +
    'set:function(v){s=wrap(v);}' +
    '});}catch(e){}}' +
    // Take the tag back out of the DOM. The token stays reachable only
    // through the closure above, so nothing that later reads the document
    // (an error reporter, a screenshot of the DOM, a copy of innerHTML) can
    // pick it up.
    'try{var c=document.currentScript;if(c&&c.parentNode)c.parentNode.removeChild(c);}catch(e){}' +
    '})();</script>'
  );
}

/**
 * Insert the bootstrap as the very first thing in the document head, ahead of
 * the Content-Security-Policy meta.
 *
 * A meta policy governs only what follows it, so a script placed above it runs
 * outside that policy. That is deliberate here: this script is the app's own
 * code, shipped in the app binary, and keeping it out of the policy is what
 * lets the document declare a policy with hashes instead of 'unsafe-inline'.
 * A per-load token cannot be hashed at build time, so as long as the script
 * sits under the policy the document is forced to keep 'unsafe-inline' and
 * every other inline script in the page gets the same permission.
 *
 * The bootstrap removes its own tag once it has run, so the token is not left
 * in the DOM for anything that later reads the document.
 */
export function withEmbeddedFlag(
  html: string,
  token: string,
  migrationPending = false,
): string {
  const headIndex = html.indexOf('<head>');
  if (headIndex === -1) {
    throw new Error('Embedded wallet document has no <head>');
  }
  const cut = headIndex + '<head>'.length;
  return (
    html.slice(0, cut) + embeddedBootstrapScript(token, migrationPending) + html.slice(cut)
  );
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
  return await new File(localUri).text();
}

/**
 * Read the embedded document, without the bootstrap. The result is cached for
 * the process: it is a few megabytes of immutable text, and a crash recovery
 * re-load must not pay for a second read from disk. The bootstrap is applied
 * per load, because its token is per load.
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
