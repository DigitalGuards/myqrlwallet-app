import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(__dirname, '../..');
const read = (file: string) => readFileSync(resolve(projectRoot, file), 'utf8');
const appJson = JSON.parse(read('app.json')) as { expo: Record<string, any> };
const easJson = JSON.parse(read('eas.json')) as {
  build: Record<string, { channel?: string; env?: Record<string, string> }>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const appConfig = require('../../app.config.js') as (ctx: { config: any }) => any;

function withVariant(variant: string | undefined, fn: () => void) {
  const previous = process.env.APP_VARIANT;
  if (variant === undefined) delete process.env.APP_VARIANT;
  else process.env.APP_VARIANT = variant;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previous;
  }
}

describe('signed over-the-air updates configuration', () => {
  const updates = appJson.expo.updates;

  it('loads only updates signed with the bundled certificate', () => {
    expect(updates.enabled).toBe(true);
    expect(updates.url).toBe(`https://u.expo.dev/${appJson.expo.extra.eas.projectId}`);
    expect(updates.codeSigningCertificate).toBe('./certs/certificate.pem');
    expect(updates.codeSigningMetadata).toEqual({ keyid: 'main', alg: 'rsa-v1_5-sha256' });
    // Ignored files do not reach EAS builds or fresh clones, so the certificate must be tracked.
    const tracked = execFileSync('git', ['ls-files', 'certs/certificate.pem'], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    expect(tracked.trim()).toBe('certs/certificate.pem');
    expect(read('certs/certificate.pem')).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect(read('certs/certificate.pem')).not.toMatch(/PRIVATE KEY/);
  });

  it('applies updates on the next cold start and pins them to the native build', () => {
    expect(updates.checkAutomatically).toBe('ON_LOAD');
    expect(updates.fallbackToCacheTimeout).toBe(0);
    expect(appJson.expo.runtimeVersion).toEqual({ policy: 'fingerprint' });
  });

  it('has no setting that allows unsigned manifests', () => {
    expect(JSON.stringify(updates)).not.toMatch(/disableAntiBrickingMeasures|allowUnsigned/i);
  });

  it('gives every build profile a channel', () => {
    const channels = Object.fromEntries(
      Object.entries(easJson.build).map(([name, profile]) => [name, profile.channel]),
    );
    expect(channels).toEqual({
      development: 'development',
      'development-embedded': 'development',
      preview: 'preview',
      'preview-embedded': 'preview',
      production: 'production',
    });
  });

  it('keeps updates enabled and signed in the production configuration', () => {
    withVariant(undefined, () => {
      const config = appConfig({ config: { ...appJson.expo } });
      expect(config.updates).toEqual(updates);
    });
  });

  it('disables updates for the embedded-dev variant', () => {
    withVariant('embedded-dev', () => {
      const config = appConfig({ config: { ...appJson.expo } });
      expect(config.updates.enabled).toBe(false);
      expect(config.updates.checkAutomatically).toBe('NEVER');
      expect(config.updates.codeSigningCertificate).toBe(updates.codeSigningCertificate);
    });
  });

  it('keeps the production bundle environment aligned with the publish script', () => {
    expect(easJson.build.production?.env?.EXPO_PUBLIC_WEB_SOURCE).toBe('embedded');
    expect(easJson.build.production?.env?.APP_VARIANT).toBeUndefined();
    expect(read('scripts/publish-update.sh')).toContain('export EXPO_PUBLIC_WEB_SOURCE=embedded');
  });
});
