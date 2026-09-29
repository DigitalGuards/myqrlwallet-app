import { resolveWebSourceMode } from '../WebSource';

describe('web source selection', () => {
  it('defaults a release build to the wallet shipped in the bundle', () => {
    expect(resolveWebSourceMode(undefined, false)).toBe('embedded');
    expect(resolveWebSourceMode('', false)).toBe('embedded');
  });

  it('keeps a development run pointed at the dev server', () => {
    expect(resolveWebSourceMode(undefined, true)).toBe('dev');
  });

  it('honours an explicit setting in either environment', () => {
    for (const isDev of [true, false]) {
      expect(resolveWebSourceMode('embedded', isDev)).toBe('embedded');
      expect(resolveWebSourceMode('remote', isDev)).toBe('remote');
      expect(resolveWebSourceMode('dev', isDev)).toBe('dev');
      expect(resolveWebSourceMode('  Remote  ', isDev)).toBe('remote');
    }
  });

  it('falls back to the default rather than throwing on a typo', () => {
    expect(resolveWebSourceMode('embeded', false)).toBe('embedded');
    expect(resolveWebSourceMode('live', true)).toBe('dev');
  });
});
