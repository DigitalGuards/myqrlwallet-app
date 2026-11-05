import { isWalletOwnHost } from './ExternalLinkPolicy';

/**
 * What to do when the wallet is asked to send the user back to a dApp.
 *
 * The old answer was to open the dApp's URL. There is no way to target an
 * existing browser tab from a URL open, so Chrome made a new one every time:
 * on an emulator the count reached eight. The new tab hydrates the stored
 * session, asks the connect SDK for its cross-tab Web Lock, loses it to the
 * original tab and goes DISCONNECTED without emitting anything. The original
 * tab is still holding the pending request promise, and the user is looking
 * at the tab where nothing will ever happen. So the same-device flow showed a
 * dead page after every approval.
 *
 * The user came from a tab. The right gesture is to put the browser back in
 * front rather than to open a URL.
 *
 * On Android the wallet can do that from its own side by moving its task to
 * the back, which returns the user to the task they came from. That is
 * `BackHandler.exitApp()`, which reaches `invokeDefaultOnBackPressed`, which
 * `plugins/withBackgroundOnBack.js` makes `moveTaskToBack(true)` on every API
 * level.
 *
 * iOS has no public equivalent, and opening the URL there creates a Safari
 * tab with exactly the same defect, so the wallet does nothing and leaves the
 * user the system's own back-to-app breadcrumb. Telling them so belongs in
 * the page, which owns the approval UI.
 */
export type DAppReturnOutcome =
  /** Move the wallet's task to the back, revealing the task behind it. */
  | { action: 'background-app' }
  | {
      action: 'ignore';
      reason:
        /** Opening a URL here would only add another orphaned tab. */
        | 'no-safe-way-to-return'
        /** The dApp hears about a disconnect over the relay. */
        | 'disconnect'
        /** Not a URL this wallet would ever have opened. */
        | 'unsafe-url';
    };

/** Why the page asked for the bounce. Absent means an approval. */
export type DAppReturnReason = 'approval' | 'disconnect';

export interface DAppReturnContext {
  platform: string;
  /** Already parsed and normalized, or null when it did not pass. */
  redirectUrl: string | null;
  reason?: string | undefined;
}

export function resolveDAppReturn(context: DAppReturnContext): DAppReturnOutcome {
  // A wallet-initiated disconnect needs no bounce at all. The dApp learns
  // about it over the relay, and the user is standing in the wallet's own
  // session list, where making the app vanish would be the wrong answer.
  if (context.reason === 'disconnect') {
    return { action: 'ignore', reason: 'disconnect' };
  }

  // The redirect URL is attacker controlled and is kept as the gate even
  // though nothing opens it any more: a URL the wallet would have refused to
  // open does not get to move the app around either, and the checks stay
  // live if a platform ever regains a way to return without a new tab.
  if (context.redirectUrl === null || isWalletOwnHost(context.redirectUrl)) {
    return { action: 'ignore', reason: 'unsafe-url' };
  }

  if (context.platform === 'android') {
    return { action: 'background-app' };
  }

  return { action: 'ignore', reason: 'no-safe-way-to-return' };
}
