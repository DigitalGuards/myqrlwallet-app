import { resolveWebSource, resolveWebSourceMode } from '../WebSource';

describe('web source selection', () => {
  it('defaults a release build to the wallet shipped in the bundle', () => {
    expect(resolveWebSource({ requested: undefined, isDevelopment: false })).toEqual({
      mode: 'embedded',
    });
    expect(resolveWebSource({ requested: '', isDevelopment: false })).toEqual({
      mode: 'embedded',
    });
    expect(resolveWebSource({ requested: 'embedded', isDevelopment: false })).toEqual({
      mode: 'embedded',
    });
  });

  it('keeps a development run pointed at the dev server', () => {
    expect(resolveWebSource({ requested: undefined, isDevelopment: true })).toEqual({ mode: 'dev' });
    for (const requested of ['embedded', 'dev']) {
      expect(resolveWebSource({ requested, isDevelopment: true }).mode).toBe(requested);
    }
  });

  it('refuses the dev server in a release build', () => {
    // EXPO_PUBLIC_ values are baked in at build time, so a stray one would
    // otherwise ship a wallet pointed at someone's laptop.
    expect(resolveWebSource({ requested: 'dev', isDevelopment: false })).toEqual({
      mode: 'embedded',
      refused: { requested: 'dev', reason: 'release-build' },
    });
  });

  it('refuses the retired remote mode like any unknown value', () => {
    // The hosted build no longer carries the native bridge, so a profile that
    // still asks for the live site gets the bundled wallet instead.
    expect(resolveWebSource({ requested: 'remote', isDevelopment: false })).toEqual({
      mode: 'embedded',
      refused: { requested: 'remote', reason: 'unknown' },
    });
    expect(resolveWebSource({ requested: 'remote', isDevelopment: true })).toEqual({
      mode: 'dev',
      refused: { requested: 'remote', reason: 'unknown' },
    });
  });

  it('falls back to the default rather than throwing on a typo, and says so', () => {
    expect(resolveWebSource({ requested: 'embeded', isDevelopment: false })).toEqual({
      mode: 'embedded',
      refused: { requested: 'embeded', reason: 'unknown' },
    });
    expect(resolveWebSource({ requested: 'live', isDevelopment: true })).toEqual({
      mode: 'dev',
      refused: { requested: 'live', reason: 'unknown' },
    });
  });

  it('exposes a plain mode helper for call sites that do not report refusals', () => {
    expect(resolveWebSourceMode(undefined, false)).toBe('embedded');
    expect(resolveWebSourceMode('dev', true)).toBe('dev');
    expect(resolveWebSourceMode('remote', false)).toBe('embedded');
  });
});
