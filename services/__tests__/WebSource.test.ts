import {
  REMOTE_WALLET_ACKNOWLEDGEMENT,
  resolveWebSource,
  resolveWebSourceMode,
} from '../WebSource';

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
    for (const requested of ['embedded', 'remote', 'dev']) {
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

  it('requires a second explicit flag before a release build loads the wallet remotely', () => {
    expect(resolveWebSource({ requested: 'remote', isDevelopment: false })).toEqual({
      mode: 'embedded',
      refused: { requested: 'remote', reason: 'needs-acknowledgement' },
    });
    expect(
      resolveWebSource({
        requested: 'remote',
        isDevelopment: false,
        remoteAcknowledgement: 'yes',
      }).mode,
    ).toBe('embedded');
    expect(
      resolveWebSource({
        requested: 'remote',
        isDevelopment: false,
        remoteAcknowledgement: REMOTE_WALLET_ACKNOWLEDGEMENT,
      }),
    ).toEqual({ mode: 'remote' });
    expect(
      resolveWebSource({
        requested: '  Remote  ',
        isDevelopment: false,
        remoteAcknowledgement: ` ${REMOTE_WALLET_ACKNOWLEDGEMENT.toUpperCase()} `,
      }),
    ).toEqual({ mode: 'remote' });
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
    expect(resolveWebSourceMode('remote', false, REMOTE_WALLET_ACKNOWLEDGEMENT)).toBe('remote');
  });
});
