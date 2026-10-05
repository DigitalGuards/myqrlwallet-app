import {
  BACK_AT_ROOT_MESSAGE_TYPE,
  BACK_HANDLED_MESSAGE_TYPE,
  NATIVE_BACK_TIMEOUT_MS,
  isBackAnswer,
  resolveBackPress,
} from '../EmbeddedBackPolicy';

describe('Android back press policy', () => {
  it('consumes the press when the page handled it', () => {
    // The page closed a modal or moved to the previous route.
    for (const canGoBack of [true, false]) {
      expect(resolveBackPress({ answer: BACK_HANDLED_MESSAGE_TYPE, canGoBack })).toEqual({
        action: 'consume',
      });
    }
  });

  it('leaves the app when the page says it is at its root', () => {
    // The wallet's hash routes replace their history entry, so the WebView
    // can still claim history to walk when the page has none left. The page
    // is the authority here.
    for (const canGoBack of [true, false]) {
      expect(resolveBackPress({ answer: BACK_AT_ROOT_MESSAGE_TYPE, canGoBack })).toEqual({
        action: 'exit-app',
      });
    }
  });

  it('falls back to the WebView when the page does not answer', () => {
    expect(resolveBackPress({ answer: null, canGoBack: true })).toEqual({ action: 'go-back' });
    expect(resolveBackPress({ answer: null, canGoBack: false })).toEqual({ action: 'exit-app' });
  });

  it('never leaves a press with nothing to do', () => {
    // Every combination resolves to one of the three outcomes, so BACK is
    // never silently swallowed the way it was when the handler always called
    // goBack() and returned true.
    const outcomes = new Set<string>();
    for (const answer of [BACK_HANDLED_MESSAGE_TYPE, BACK_AT_ROOT_MESSAGE_TYPE, null] as const) {
      for (const canGoBack of [true, false]) {
        outcomes.add(resolveBackPress({ answer, canGoBack }).action);
      }
    }
    expect(outcomes).toEqual(new Set(['consume', 'exit-app', 'go-back']));
  });

  it('recognises only the two answers the contract defines', () => {
    expect(isBackAnswer(BACK_HANDLED_MESSAGE_TYPE)).toBe(true);
    expect(isBackAnswer(BACK_AT_ROOT_MESSAGE_TYPE)).toBe(true);
    for (const type of ['NATIVE_BACK', 'WEB_APP_READY', 'back_handled', '']) {
      expect(isBackAnswer(type)).toBe(false);
    }
  });

  it('gives the page a deadline a person would not notice', () => {
    expect(NATIVE_BACK_TIMEOUT_MS).toBeGreaterThan(0);
    expect(NATIVE_BACK_TIMEOUT_MS).toBeLessThanOrEqual(600);
  });
});
