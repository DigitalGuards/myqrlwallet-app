import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isRecord } from '../guards';

const root = resolve(__dirname, '../..');
const readJson = (name: string): unknown => JSON.parse(readFileSync(resolve(root, name), 'utf8'));

describe('iOS 27 SDK build configuration', () => {
  it('opts in to the scene life cycle the iOS 27 SDK requires, without changing how modules are built', () => {
    const app = readJson('app.json');
    const plugins = isRecord(app) && isRecord(app.expo) && Array.isArray(app.expo.plugins) ? app.expo.plugins : [];
    const entry = plugins.find((plugin): plugin is unknown[] => Array.isArray(plugin) && plugin[0] === 'expo-build-properties');
    expect(entry?.[1]).toEqual({ ios: { enableSceneSupport: true, usePrecompiledModules: false } });
  });

  it('builds every profile on the same public Xcode 27 release image', () => {
    const eas = readJson('eas.json');
    const profiles = isRecord(eas) && isRecord(eas.build) ? Object.entries(eas.build) : [];
    expect(profiles.length).toBeGreaterThan(0);
    for (const [name, profile] of profiles) {
      expect([name, isRecord(profile) ? profile.ios : undefined]).toEqual([
        name,
        { image: 'macos-tahoe-26.6-xcode-27.2' },
      ]);
    }
  });
});
