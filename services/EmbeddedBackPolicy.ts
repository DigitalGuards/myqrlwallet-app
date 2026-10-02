/**
 * What the Android hardware back button does inside the embedded wallet.
 *
 * The old handler called `goBack()` and returned true for every press, so BACK
 * never left the app and an open modal stayed open. It was also blind to how
 * the wallet routes: hash routes replace their history entry, so on device one
 * BACK from any screen landed on the bare base entry rather than on the
 * previous screen.
 *
 * The page knows what BACK should mean, so it is asked. Native sends a bound
 * `NATIVE_BACK` message and the page answers `BACK_HANDLED` when it closed a
 * modal or moved to the previous route, or `BACK_AT_ROOT` when there was
 * nothing left to go back to.
 *
 * The page is web content, so it cannot be relied on to answer. Everything
 * here is therefore bounded: if no answer arrives, or the document has not
 * bound the bridge, the decision falls back to what the WebView itself
 * reports.
 */

/** Native asks the page to handle a back press. */
export const NATIVE_BACK_MESSAGE_TYPE = 'NATIVE_BACK';

/** The page consumed the press. */
export const BACK_HANDLED_MESSAGE_TYPE = 'BACK_HANDLED';

/** The page had nothing left to go back to. */
export const BACK_AT_ROOT_MESSAGE_TYPE = 'BACK_AT_ROOT';

/**
 * How long to wait for the page. Long enough for a React render and a route
 * change on a slow device, short enough that BACK never feels stuck.
 */
export const NATIVE_BACK_TIMEOUT_MS = 400;

export type BackAnswer = typeof BACK_HANDLED_MESSAGE_TYPE | typeof BACK_AT_ROOT_MESSAGE_TYPE;

export type BackOutcome =
  /** The press is consumed, nothing further happens. */
  | { action: 'consume' }
  /** Walk the WebView's own history. */
  | { action: 'go-back' }
  /** Let Android background the app. */
  | { action: 'exit-app' };

export function isBackAnswer(type: string): type is BackAnswer {
  return type === BACK_HANDLED_MESSAGE_TYPE || type === BACK_AT_ROOT_MESSAGE_TYPE;
}

export interface BackPressContext {
  /** The page's answer, or null when it did not answer in time. */
  answer: BackAnswer | null;
  /** From onNavigationStateChange. */
  canGoBack: boolean;
}

/**
 * The decision. `goBack()` is never called blindly: it happens only when the
 * page did not answer and the WebView says there is history to walk.
 */
export function resolveBackPress(context: BackPressContext): BackOutcome {
  if (context.answer === BACK_HANDLED_MESSAGE_TYPE) return { action: 'consume' };
  if (context.answer === BACK_AT_ROOT_MESSAGE_TYPE) return { action: 'exit-app' };
  return context.canGoBack ? { action: 'go-back' } : { action: 'exit-app' };
}
