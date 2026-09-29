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
    const html = withEmbeddedFlag('<!doctype html><html><head><title>x</title></head></html>', token, false);
    expect(html).toContain('<head><script>');
    expect(html.indexOf('window.__QRL_EMBEDDED__ = true;')).toBeLessThan(html.indexOf('<title>'));
  });

  it('puts the bootstrap above the policy the document declares', () => {
    // A meta policy governs only what follows it. The app's own script is
    // deliberately above it, which is what lets the document declare a policy
    // with hashes instead of 'unsafe-inline': a per-load token cannot be
    // hashed at build time.
    const source =
      '<!doctype html><html><head>\n' +
      '    <meta http-equiv="Content-Security-Policy" content="script-src \'unsafe-inline\'" />\n' +
      '    <title>x</title><script>wallet()</script></head></html>';
    const html = withEmbeddedFlag(source, token, false);
    const csp = html.indexOf('Content-Security-Policy');
    const bootstrap = html.indexOf('window.__QRL_EMBEDDED__ = true;');
    expect(bootstrap).toBeGreaterThan(-1);
    expect(bootstrap).toBeLessThan(csp);
    expect(html).toContain('<head><script>(function(){window.__QRL_EMBEDDED__ = true;');
    expect(html).toContain('<meta http-equiv="Content-Security-Policy" content="script-src \'unsafe-inline\'" />');
  });

  it('lands above the policy in the document actually shipped', () => {
    const shipped = readFileSync(documentPath, 'utf8');
    const html = withEmbeddedFlag(shipped, token, false);
    const csp = html.indexOf('Content-Security-Policy');
    expect(html.indexOf('window.__QRL_EMBEDDED__ = true;')).toBeLessThan(csp);

    const metaTag = shipped.slice(shipped.lastIndexOf('<meta', csp), shipped.indexOf('>', csp) + 1);
    const policy = /content="([^"]*)"/.exec(metaTag)?.[1] ?? '';
    // The document now allows only two hashed scripts, so an inline script
    // with no hash would be refused if the policy governed it. The bootstrap
    // carries a per-load token and cannot be hashed at build time, so its
    // position above the meta is what keeps it running and is what let the
    // frontend drop 'unsafe-inline' for everything else.
    expect(policy).toMatch(/script-src[^;]*'sha256-/);
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("child-src 'none'");
  });

  it('keeps the shipped document reading the migration flag it is handed', () => {
    // The app sets the flag and waits for an acknowledgement. If the document
    // stopped reading it, the pass would never run and never be recorded.
    const shipped = readFileSync(documentPath, 'utf8');
    expect(shipped).toContain('__QRL_EMBEDDED_MIGRATION__');
    expect(shipped).toContain('EMBEDDED_MIGRATION_DONE');
  });

  it('takes its own tag back out of the DOM', () => {
    // Otherwise the token stays readable to anything that later reads the
    // document: an error reporter, a copy of innerHTML, a screenshot tool.
    const script = embeddedBootstrapScript(token, false);
    const body = script.replace(/^<script>/, '').replace(/<\/script>$/, '');
    const removed: unknown[] = [];
    const tag = { parentNode: { removeChild: (node: unknown) => removed.push(node) } };
    const win: Record<string, unknown> = {
      ReactNativeWebView: { postMessage: () => undefined },
      document: { currentScript: tag },
    };
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', body)(win, win.document);
    expect(removed).toEqual([tag]);
  });

  it('tells the page whether it still owes the inherited storage migration', () => {
    // The page has to see this before its own stores initialise, or a
    // restored dApp session writes itself back and survives the pass.
    expect(embeddedBootstrapScript(token, true)).toContain(
      'window.__QRL_EMBEDDED_MIGRATION__ = true;',
    );
    expect(embeddedBootstrapScript(token, false)).toContain(
      'window.__QRL_EMBEDDED_MIGRATION__ = false;',
    );
    const script = embeddedBootstrapScript(token, true);
    expect(script.indexOf('__QRL_EMBEDDED_MIGRATION__')).toBeLessThan(script.indexOf('function wrap'));
  });

  it('refuses a document without a head rather than shipping a broken one', () => {
    expect(() => withEmbeddedFlag('<html><body></body></html>', token, false)).toThrow(/no <head>/);
  });

  it('wraps the bridge so every message carries the document token', () => {
    const script = embeddedBootstrapScript(token, false);
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
    const script = embeddedBootstrapScript(token, false);
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
    const script = embeddedBootstrapScript(token, false);
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
      expect(() => embeddedBootstrapScript(bad, false)).toThrow(/64 hex/);
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
