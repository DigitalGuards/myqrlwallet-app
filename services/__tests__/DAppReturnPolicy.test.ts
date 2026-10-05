import { resolveDAppReturn } from '../DAppReturnPolicy';

const dapp = 'https://zondscan.com/dapp-example';

describe('returning the user to a dApp', () => {
  it('backgrounds the wallet on Android rather than opening a URL', () => {
    // Opening the URL made Chrome create a new tab every time. That tab
    // hydrates the stored session, loses the connect SDK's cross-tab lock to
    // the original tab and goes silently DISCONNECTED, so the user ended up
    // looking at a page where the answer could never arrive.
    expect(resolveDAppReturn({ platform: 'android', redirectUrl: dapp })).toEqual({
      action: 'background-app',
    });
    expect(
      resolveDAppReturn({ platform: 'android', redirectUrl: dapp, reason: 'approval' }),
    ).toEqual({ action: 'background-app' });
  });

  it('does nothing on iOS, where opening the URL has the same defect', () => {
    // Safari opens a new tab too, and iOS has no public way to move the app
    // to the back. The system's own back-to-app breadcrumb is what the user
    // has, and saying so belongs in the page that owns the approval UI.
    expect(resolveDAppReturn({ platform: 'ios', redirectUrl: dapp })).toEqual({
      action: 'ignore',
      reason: 'no-safe-way-to-return',
    });
  });

  it('never bounces after a wallet-initiated disconnect', () => {
    // The dApp hears about it over the relay, and the user is standing in the
    // wallet's own session list, so making the app vanish would be wrong.
    for (const platform of ['android', 'ios']) {
      expect(resolveDAppReturn({ platform, redirectUrl: dapp, reason: 'disconnect' })).toEqual({
        action: 'ignore',
        reason: 'disconnect',
      });
    }
  });

  it('refuses to act on a URL the wallet would not have opened', () => {
    // The redirect URL is attacker controlled. It no longer opens anything,
    // and it does not get to move the app around either.
    for (const redirectUrl of [null, 'https://qrlwallet.com/', 'https://www.qrlwallet.com/x']) {
      expect(resolveDAppReturn({ platform: 'android', redirectUrl })).toEqual({
        action: 'ignore',
        reason: 'unsafe-url',
      });
    }
  });

  it('puts the disconnect rule ahead of every other check', () => {
    // Even with nothing usable to return to, a disconnect is still a
    // disconnect and must not be reported as a URL problem.
    expect(
      resolveDAppReturn({ platform: 'android', redirectUrl: null, reason: 'disconnect' }),
    ).toEqual({ action: 'ignore', reason: 'disconnect' });
  });

  it('treats an unknown reason as the approval it has always meant', () => {
    expect(
      resolveDAppReturn({ platform: 'android', redirectUrl: dapp, reason: 'something-new' }),
    ).toEqual({ action: 'background-app' });
  });
});
