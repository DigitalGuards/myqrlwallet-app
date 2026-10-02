import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  WALLET_ORIGIN_ALLOWED_PREFIXES,
  classifyEmbeddedRequest,
} from '../EmbeddedRequestPolicy';

const projectRoot = resolve(__dirname, '../..');

const mainFrameGet = (url: string) => ({ url, method: 'GET', isForMainFrame: true });
const subresource = (url: string, method = 'GET') => ({ url, method, isForMainFrame: false });

describe('embedded wallet request policy', () => {
  it('answers a reload of the wallet document from the app bundle', () => {
    // This is the whole point. A WebView does not consult
    // shouldOverrideUrlLoading for its own reload(), so on device a
    // location.reload() fetched the live production bundle into the app's
    // origin. Serving the shipped bytes makes reload() a no-op instead.
    for (const url of [
      'https://qrlwallet.com/',
      'https://qrlwallet.com',
      'https://qrlwallet.com/?x=1',
      'https://qrlwallet.com/#/transfer',
      'https://qrlwallet.com/?#/transfer',
    ]) {
      expect(classifyEmbeddedRequest(mainFrameGet(url))).toEqual({
        action: 'serve-bundled-document',
      });
    }
  });

  it('never lets the network deliver executable content for the wallet origin', () => {
    for (const url of [
      'https://qrlwallet.com/assets/index-B9_LkJmY.js',
      'https://qrlwallet.com/assets/style.css',
      'https://qrlwallet.com/index.html',
      'https://qrlwallet.com/transfer',
      'https://qrlwallet.com/sw.js',
      'https://qrlwallet.com/manifest.webmanifest',
    ]) {
      expect(classifyEmbeddedRequest(subresource(url))).toEqual({ action: 'refuse' });
      expect(classifyEmbeddedRequest(mainFrameGet(url))).toEqual({ action: 'refuse' });
    }
  });

  it('leaves the paths the wallet actually calls to the network', () => {
    for (const url of [
      'https://qrlwallet.com/api/qrl-rpc/testnet',
      'https://qrlwallet.com/api/tx-history/Q00',
      'https://qrlwallet.com/api/ipfs/QmHash',
      // socket.io polling for the dApp relay, which appends the slash.
      'https://qrlwallet.com/relay/?EIO=4&transport=polling',
      'https://qrlwallet.com/relay/',
    ]) {
      expect(classifyEmbeddedRequest(subresource(url, 'POST'))).toEqual({
        action: 'allow',
        reason: 'wallet-api',
      });
    }
  });

  it('does not interfere with any other origin', () => {
    for (const url of [
      'https://zondscan.com/api/blocks',
      'https://ipfs.io/ipfs/QmHash',
      'https://qrlwallet.com.attacker.invalid/assets/x.js',
      'http://localhost:5173/main.js',
    ]) {
      expect(classifyEmbeddedRequest(subresource(url))).toEqual({
        action: 'allow',
        reason: 'other-origin',
      });
    }
  });

  it('refuses an http downgrade, an alternate port and a trailing-dot host', () => {
    expect(classifyEmbeddedRequest(mainFrameGet('http://qrlwallet.com/'))).toEqual({
      action: 'refuse',
    });
    expect(classifyEmbeddedRequest(mainFrameGet('https://qrlwallet.com:8443/'))).toEqual({
      action: 'refuse',
    });
    // A trailing dot is the same host, so it must not dodge the rules.
    expect(classifyEmbeddedRequest(subresource('https://qrlwallet.com./assets/x.js'))).toEqual({
      action: 'refuse',
    });
  });

  it('serves the document only for a main-frame GET', () => {
    expect(classifyEmbeddedRequest(subresource('https://qrlwallet.com/'))).toEqual({
      action: 'refuse',
    });
    expect(
      classifyEmbeddedRequest({ url: 'https://qrlwallet.com/', method: 'POST', isForMainFrame: true }),
    ).toEqual({ action: 'refuse' });
  });

  it('never lets a main-frame document come from the network, even on an API path', () => {
    // Android does not route a POST navigation, a reload or a history
    // traversal through shouldOverrideUrlLoading, so one aimed at an allowed
    // path would commit a server document in the wallet origin.
    for (const url of [
      'https://qrlwallet.com/api/x',
      'https://qrlwallet.com/relay/x',
      'https://qrlwallet.com/api/qrl-rpc/testnet',
    ]) {
      expect(classifyEmbeddedRequest(mainFrameGet(url))).toEqual({ action: 'refuse' });
      expect(
        classifyEmbeddedRequest({ url, method: 'POST', isForMainFrame: true }),
      ).toEqual({ action: 'refuse' });
    }
  });

  it('does not admit a sibling of an allowed prefix', () => {
    for (const url of [
      'https://qrlwallet.com/relay-x.html',
      'https://qrlwallet.com/relayfoo',
      'https://qrlwallet.com/api',
      'https://qrlwallet.com/apikeys.js',
    ]) {
      expect(classifyEmbeddedRequest(subresource(url))).toEqual({ action: 'refuse' });
    }
  });

  it('refuses a request it cannot parse rather than passing it on', () => {
    expect(classifyEmbeddedRequest(mainFrameGet('not a url'))).toEqual({ action: 'refuse' });
  });

  it('keeps the Android patch in step with this policy', () => {
    // The Java side implements the same three decisions. A drift there would
    // silently reopen the hole this policy closes, on the platform that has
    // it.
    const patch = readFileSync(
      resolve(projectRoot, 'patches/react-native-webview+13.16.1.patch'),
      'utf8',
    );
    expect(patch).toContain('shouldInterceptRequest');
    expect(patch).toContain(
      `EMBEDDED_ALLOWED_PATH_PREFIXES = {${WALLET_ORIGIN_ALLOWED_PREFIXES.map(
        (prefix) => `"${prefix}"`,
      ).join(', ')}}`,
    );
    // The main-frame refusal has to exist on the Java side too.
    expect(patch).toContain('if (request.isForMainFrame()) {');
    expect(patch).toContain('volatile @Nullable String embeddedDocumentHtml');
    expect(patch).toContain('bundledDocumentResponse');
    expect(patch).toContain('setStatusCodeAndReasonPhrase(403');
    // And the document has to reach the client in the first place.
    expect(patch).toContain('view.setEmbeddedDocument(html, baseUrl)');
    expect(patch).toContain('view.setEmbeddedDocument(null, null)');
  });
});
