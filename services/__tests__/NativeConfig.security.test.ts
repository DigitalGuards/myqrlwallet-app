import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(__dirname, '../..');
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

  it('explicitly disables Android form retention and local-file access', () => {
    expect(webViewSource).toContain('saveFormDataDisabled={true}');
    expect(webViewSource).toContain('allowFileAccess={false}');
    expect(webViewSource).toContain('allowFileAccessFromFileURLs={false}');
    expect(webViewSource).toContain('allowUniversalAccessFromFileURLs={false}');
  });
});
