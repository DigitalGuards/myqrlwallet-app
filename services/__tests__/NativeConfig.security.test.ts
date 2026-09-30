import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(__dirname, '../..');
const easConfig = JSON.parse(readFileSync(resolve(projectRoot, 'eas.json'), 'utf8')) as {
  cli: { requireCommit?: boolean };
  build: Record<string, { env?: Record<string, string>; developmentClient?: boolean }>;
};
const appConfig = JSON.parse(readFileSync(resolve(projectRoot, 'app.json'), 'utf8')) as {
  expo: {
    scheme?: string | string[];
    ios: { associatedDomains?: string[] };
    plugins?: Array<string | [string, Record<string, unknown>]>;
    android: {
      allowBackup?: boolean;
      blockedPermissions?: string[];
      intentFilters?: Array<Record<string, unknown>>;
    };
  };
};
const webViewSource = readFileSync(resolve(projectRoot, 'components/QRLWebView.tsx'), 'utf8');
const secureStoreBackupRules = readFileSync(
  resolve(
    projectRoot,
    'node_modules/expo-secure-store/android/src/main/res/xml/secure_store_backup_rules.xml',
  ),
  'utf8',
);
const secureStoreExtractionRules = readFileSync(
  resolve(
    projectRoot,
    'node_modules/expo-secure-store/android/src/main/res/xml/secure_store_data_extraction_rules.xml',
  ),
  'utf8',
);

describe('generated native security configuration', () => {
  it('disables Android backup and removes unused privileged permissions', () => {
    expect(appConfig.expo.android.allowBackup).toBe(false);
    expect(appConfig.expo.android.blockedPermissions).toEqual(
      expect.arrayContaining([
        'android.permission.RECORD_AUDIO',
        'android.permission.SYSTEM_ALERT_WINDOW',
      ]),
    );
    expect(appConfig.expo.plugins).toEqual(
      expect.arrayContaining([
        'expo-secure-store',
        [
          'expo-camera',
          expect.objectContaining({
            microphonePermission: false,
            recordAudioAndroid: false,
          }),
        ],
      ]),
    );
    expect(secureStoreBackupRules).toContain(
      '<exclude domain="sharedpref" path="SecureStore"/>',
    );
    expect(secureStoreExtractionRules.match(/path="SecureStore"/g)).toHaveLength(2);
  });

  it('keeps custom and verified connect links in Expo source config', () => {
    expect(appConfig.expo.scheme).toEqual(['qrlconnect']);
    expect(appConfig.expo.android.intentFilters).toEqual([
      expect.objectContaining({
        action: 'VIEW',
        autoVerify: true,
        data: [
          {
            scheme: 'https',
            host: 'qrlwallet.com',
            path: '/connect',
          },
        ],
        category: expect.arrayContaining(['BROWSABLE', 'DEFAULT']),
      }),
    ]);
    expect(appConfig.expo.ios.associatedDomains).toContain('applinks:qrlwallet.com');
  });

  it('keeps the production variant identical to app.json and isolates the embedded one', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const appConfigFactory = require('../../app.config.js') as (input: {
      config: Record<string, unknown>;
    }) => Record<string, unknown>;

    const original = process.env.APP_VARIANT;
    try {
      delete process.env.APP_VARIANT;
      expect(appConfigFactory({ config: appConfig.expo as unknown as Record<string, unknown> })).toEqual(appConfig.expo);
      process.env.APP_VARIANT = 'production';
      expect(appConfigFactory({ config: appConfig.expo as unknown as Record<string, unknown> })).toEqual(appConfig.expo);

      process.env.APP_VARIANT = 'embedded-dev';
      const embedded = appConfigFactory({ config: appConfig.expo as unknown as Record<string, unknown> }) as {
        name: string;
        scheme: string[];
        ios: { bundleIdentifier: string; associatedDomains?: string[] };
        android: { package: string; intentFilters?: unknown[] };
      };
      expect(embedded.name).toBe('MyQRLWallet Embedded');
      expect(embedded.ios.bundleIdentifier).toBe('com.chiefdg.myqrlwallet.embedded');
      expect(embedded.android.package).toBe('com.chiefdg.myqrlwallet.embedded');
      // A second claimant for qrlconnect:// or for qrlwallet.com links would
      // let the OS hand a pairing to the wrong installed build.
      expect(embedded.scheme).toEqual(['qrlconnect-embedded']);
      expect(embedded.ios.associatedDomains).toBeUndefined();
      expect(embedded.android.intentFilters).toBeUndefined();
      // The variant must not have mutated the production config in place.
      expect(appConfig.expo.ios.associatedDomains).toContain('applinks:qrlwallet.com');
    } finally {
      if (original === undefined) delete process.env.APP_VARIANT;
      else process.env.APP_VARIANT = original;
    }
  });

  it('explicitly disables Android form retention and local-file access', () => {
    expect(webViewSource).toContain('saveFormDataDisabled={true}');
    expect(webViewSource).toContain('allowFileAccess={false}');
    expect(webViewSource).toContain('allowFileAccessFromFileURLs={false}');
    expect(webViewSource).toContain('allowUniversalAccessFromFileURLs={false}');
  });

  it('keeps the dev client from claiming a URL scheme of its own', () => {
    // The expo-dev-client plugin adds an exp+<slug> scheme to every variant
    // unless it is listed explicitly with the option turned off.
    expect(appConfig.expo.plugins).toEqual(
      expect.arrayContaining([['expo-dev-client', { addGeneratedScheme: false }]]),
    );
  });

  it('pins the wallet source in every profile that ships a binary', () => {
    for (const profile of ['production', 'preview', 'preview-embedded', 'development-embedded']) {
      expect(easConfig.build[profile]?.env?.EXPO_PUBLIC_WEB_SOURCE).toBe('embedded');
    }
  });

  it('keeps production identifiers off every development-client profile', () => {
    // A dev-client build loads whatever bundle a link hands it. Sharing the
    // production bundle id would let one replace the installed wallet on the
    // same device and inherit its container and keychain.
    for (const [name, profile] of Object.entries(easConfig.build)) {
      if (profile.developmentClient !== true) continue;
      expect([name, profile.env?.APP_VARIANT]).toEqual([name, 'embedded-dev']);
    }
  });

  it('never lets the reproduce gate pass by default when the pin is unreachable', () => {
    const ci = readFileSync(resolve(projectRoot, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('permissions:');
    expect(ci).toContain('contents: read');
    // The escape hatch is a manual input only.
    expect(ci).toMatch(/ALLOW_UNREACHABLE_PIN:\s*\$\{\{ github\.event_name == 'workflow_dispatch'/);
    expect(ci).not.toMatch(/ALLOW_UNREACHABLE_PIN:\s*'1'/);
    // Third-party actions are pinned by commit.
    expect(ci).not.toMatch(/uses: actions\/[a-z-]+@v\d/);
    expect(ci).toMatch(/uses: actions\/checkout@[0-9a-f]{40}/);
    expect(ci).toMatch(/uses: actions\/setup-node@[0-9a-f]{40}/);
  });

  it('requires a committed tree for a cloud build', () => {
    expect(easConfig.cli.requireCommit).toBe(true);
  });

  it('verifies the bundled wallet digest during a cloud build and in CI', () => {
    const pkg = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['eas-build-post-install']).toContain('verify-embedded-web');
    const ci = readFileSync(resolve(projectRoot, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('npm run verify:embedded-web');
    expect(ci).toContain('reproduce-embedded-web.sh');
  });
});
