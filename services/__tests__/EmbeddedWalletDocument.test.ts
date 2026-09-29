import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { withEmbeddedFlag } from '../EmbeddedWalletDocument';

const projectRoot = resolve(__dirname, '../..');
const documentPath = resolve(projectRoot, 'assets/web/index.html');
const buildInfo = JSON.parse(
  readFileSync(resolve(projectRoot, 'assets/web/BUILD_INFO.json'), 'utf8'),
) as { sha256: string; bytes: number; frontendCommit: string; frontendCommitShort: string };

describe('embedded wallet document', () => {
  it('puts the embedded flag first inside the head', () => {
    const html = withEmbeddedFlag('<!doctype html><html><head><title>x</title></head></html>');
    expect(html).toContain('<head><script>window.__QRL_EMBEDDED__ = true;</script><title>');
  });

  it('refuses a document without a head rather than shipping a broken one', () => {
    expect(() => withEmbeddedFlag('<html><body></body></html>')).toThrow(/no <head>/);
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
