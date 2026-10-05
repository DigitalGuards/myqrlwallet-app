import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isSameDocumentHistoryUpdate } from '../WebViewLoadStart';

describe('isSameDocumentHistoryUpdate', () => {
  it('believes the tag the patch adds, whatever the progress reading says', () => {
    // This is the regression. React Router calls history.replaceState during
    // module init, while the page is still loading, so that event arrives
    // with loading:true and used to be indistinguishable from a document
    // swap. On device it put the app on the "replaced by another page" screen
    // on every cold start.
    expect(isSameDocumentHistoryUpdate('android', { newDocument: false, loading: true })).toBe(true);
    expect(isSameDocumentHistoryUpdate('android', { newDocument: false, loading: false })).toBe(true);
    expect(isSameDocumentHistoryUpdate('android', { newDocument: true, loading: true })).toBe(false);
    expect(isSameDocumentHistoryUpdate('android', { newDocument: true, loading: false })).toBe(false);
  });

  it('falls back to the progress reading when the tag is absent', () => {
    // A build where the patch has not been applied.
    expect(isSameDocumentHistoryUpdate('android', { loading: false })).toBe(true);
    expect(isSameDocumentHistoryUpdate('android', { loading: true })).toBe(false);
    expect(isSameDocumentHistoryUpdate('android', {})).toBe(false);
    expect(isSameDocumentHistoryUpdate('android', undefined)).toBe(false);
  });

  it('never skips a load start on iOS', () => {
    // iOS emits one only for a real navigation, tag or no tag.
    expect(isSameDocumentHistoryUpdate('ios', { loading: false })).toBe(false);
    expect(isSameDocumentHistoryUpdate('ios', { loading: true })).toBe(false);
    expect(isSameDocumentHistoryUpdate('ios', { newDocument: false, loading: true })).toBe(false);
  });

  it('keeps the Android patch emitting the tag this module reads', () => {
    const patch = readFileSync(
      resolve(__dirname, '../../patches/react-native-webview+13.15.0.patch'),
      'utf8',
    );
    // onPageStarted is the only callback that means a document is being
    // replaced, and upstream dispatches nothing from it.
    expect(patch).toContain('startEvent.putBoolean("newDocument", true)');
    expect(patch).toContain('historyEvent.putBoolean("newDocument", false)');
    // The tag is emitted from onPageStarted, where upstream dispatches nothing.
    expect(patch).toContain('super.onPageStarted(webView, url, favicon);');
    expect(patch.indexOf('startEvent.putBoolean("newDocument", true)')).toBeGreaterThan(
      patch.indexOf('super.onPageStarted(webView, url, favicon);'),
    );
  });
});
