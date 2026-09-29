import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  BRIDGE_TOKEN_SEPARATOR,
  createDocumentToken,
  embeddedBootstrapScript,
  withEmbeddedFlag,
} from '../EmbeddedWalletDocument';

const projectRoot = resolve(__dirname, '../..');
const documentPath = resolve(projectRoot, 'assets/web/index.html');
const buildInfo = JSON.parse(
  readFileSync(resolve(projectRoot, 'assets/web/BUILD_INFO.json'), 'utf8'),
) as { sha256: string; bytes: number; frontendCommit: string; frontendCommitShort: string };

describe('embedded wallet document', () => {
  const token = 'a'.repeat(64);

  it('puts the bootstrap first inside a head with no policy', () => {
    const html = withEmbeddedFlag('<!doctype html><html><head><title>x</title></head></html>', token);
    expect(html).toContain('<head><script>');
    expect(html.indexOf('window.__QRL_EMBEDDED__ = true;')).toBeLessThan(html.indexOf('<title>'));
  });

  it('puts the bootstrap after the policy the document declares', () => {
    // A meta policy only governs what follows it, so the one script the app
    // adds has to come after it, and ahead of the wallet's own scripts.
    const source =
      '<!doctype html><html><head>\n' +
      '    <meta http-equiv="Content-Security-Policy" content="script-src \'unsafe-inline\'" />\n' +
      '    <title>x</title><script>wallet()</script></head></html>';
    const html = withEmbeddedFlag(source, token);
    const csp = html.indexOf('Content-Security-Policy');
    const bootstrap = html.indexOf('window.__QRL_EMBEDDED__ = true;');
    expect(csp).toBeGreaterThan(-1);
    expect(bootstrap).toBeGreaterThan(csp);
    expect(bootstrap).toBeLessThan(html.indexOf('<title>'));
    expect(bootstrap).toBeLessThan(html.indexOf('wallet()'));
    // The policy tag itself is untouched.
    expect(html).toContain('<meta http-equiv="Content-Security-Policy" content="script-src \'unsafe-inline\'" />');
  });

  it('lands after the policy in the document actually shipped', () => {
    const shipped = readFileSync(documentPath, 'utf8');
    const html = withEmbeddedFlag(shipped, token);
    const csp = html.indexOf('Content-Security-Policy');
    const bootstrap = html.indexOf('window.__QRL_EMBEDDED__ = true;');
    expect(bootstrap).toBeGreaterThan(csp);
    // And the policy still allows an inline script with no nonce, which is
    // what the per-load token script is.
    const metaTag = shipped.slice(shipped.lastIndexOf('<meta', csp), shipped.indexOf('>', csp) + 1);
    const policy = /content="([^"]*)"/.exec(metaTag)?.[1] ?? '';
    expect(policy).toContain("script-src 'unsafe-inline'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("child-src 'none'");
  });

  it('refuses a document whose policy tag it cannot find the end of', () => {
    expect(() =>
      withEmbeddedFlag('<html><head><meta http-equiv="Content-Security-Policy" content="x"', token),
    ).toThrow(/malformed Content-Security-Policy/);
  });

  it('refuses a document without a head rather than shipping a broken one', () => {
    expect(() => withEmbeddedFlag('<html><body></body></html>', token)).toThrow(/no <head>/);
  });

  it('wraps the bridge so every message carries the document token', () => {
    const script = embeddedBootstrapScript(token);
    const body = script.replace(/^<script>/, '').replace(/<\/script>$/, '');
    const posted: string[] = [];
    const win: Record<string, unknown> = {
      ReactNativeWebView: { postMessage: (m: string) => posted.push(m) },
    };
    // eslint-disable-next-line no-new-func
    new Function('window', body)(win);
    const bridge = win.ReactNativeWebView as { postMessage: (m: string) => void };
    bridge.postMessage('{"type":"WEB_APP_READY"}');
    expect(posted).toEqual([`${token}${BRIDGE_TOKEN_SEPARATOR}{"type":"WEB_APP_READY"}`]);
  });

  it('wraps a bridge the WebView installs after the head script ran', () => {
    const script = embeddedBootstrapScript(token);
    const body = script.replace(/^<script>/, '').replace(/<\/script>$/, '');
    const posted: string[] = [];
    const win: Record<string, unknown> = {};
    // eslint-disable-next-line no-new-func
    new Function('window', body)(win);
    win.ReactNativeWebView = { postMessage: (m: string) => posted.push(m) };
    (win.ReactNativeWebView as { postMessage: (m: string) => void }).postMessage('PAGE_LOADED');
    expect(posted).toEqual([`${token}${BRIDGE_TOKEN_SEPARATOR}PAGE_LOADED`]);
  });

  it('wraps only once, so a rebind cannot double-prefix a message', () => {
    const script = embeddedBootstrapScript(token);
    const body = script.replace(/^<script>/, '').replace(/<\/script>$/, '');
    const posted: string[] = [];
    const win: Record<string, unknown> = {
      ReactNativeWebView: { postMessage: (m: string) => posted.push(m) },
    };
    // eslint-disable-next-line no-new-func
    new Function('window', body)(win);
    (win.__qrlBindBridge as () => void)();
    (win.__qrlBindBridge as () => void)();
    (win.ReactNativeWebView as { postMessage: (m: string) => void }).postMessage('x');
    expect(posted).toEqual([`${token}${BRIDGE_TOKEN_SEPARATOR}x`]);
  });

  it('refuses a token that is not 256 bits of hex', () => {
    for (const bad of ['', 'nothex', 'A'.repeat(64), 'a'.repeat(63), `a'.repeat(64)`]) {
      expect(() => embeddedBootstrapScript(bad)).toThrow(/64 hex/);
    }
  });

  it('generates a distinct token per call', () => {
    const tokens = new Set(Array.from({ length: 16 }, () => createDocumentToken()));
    expect(tokens.size).toBe(16);
    for (const value of tokens) expect(value).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ships a document that matches its recorded hash', () => {
    const bytes = readFileSync(documentPath);
    expect(bytes.length).toBe(buildInfo.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(buildInfo.sha256);
    expect(buildInfo.frontendCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(buildInfo.frontendCommitShort).toBe(buildInfo.frontendCommit.slice(0, 12));
  });

  it('ships a document that fetches no code from the network', () => {
    const html = readFileSync(documentPath, 'utf8');
    expect(html).toMatch(/<head>/);
    expect(html).not.toMatch(/<script[^>]+\ssrc\s*=/i);
    expect(html).not.toMatch(/<link[^>]+rel\s*=\s*"?(stylesheet|modulepreload|preload|manifest)/i);
    expect(html).not.toMatch(/<link[^>]+href\s*=\s*"[^"]+\.(js|css)"/i);
    expect(html).not.toMatch(/["']\/assets\//);
  });
});
