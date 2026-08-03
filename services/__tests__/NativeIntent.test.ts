import { redirectSystemPath } from '../../app/+native-intent';

describe('native deep-link routing boundary', () => {
  it('intercepts only the canonical lowercase qrlconnect scheme', () => {
    expect(
      redirectSystemPath({ path: 'qrlconnect://?q=ABC%25DEF', initial: true }),
    ).toBe('/');
    expect(
      redirectSystemPath({ path: 'QrLcOnNeCt://?q=ABC%25DEF', initial: true }),
    ).toBe('QrLcOnNeCt://?q=ABC%25DEF');
  });
});
