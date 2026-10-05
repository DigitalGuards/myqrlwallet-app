import type { Platform } from 'react-native';

export interface WebViewLoadStartEvent {
  /**
   * Android only, added by patches/react-native-webview+13.15.0.patch. True
   * when the event came from onPageStarted, which is the one callback that
   * means a document is being replaced.
   */
  newDocument?: boolean;
  loading?: boolean;
}

/**
 * Android's react-native-webview emits its loading-start event from
 * doUpdateVisitedHistory, which fires for same-document history updates such
 * as the web wallet's own route changes. On Android those must not reset the
 * bridge's document authority or the native lock. iOS emits load starts only
 * for real navigations, so every iOS load start counts as a new document.
 *
 * Upstream gives JS nothing to distinguish the two cases with except the
 * `loading` flag, and that flag is a progress reading rather than a statement
 * about the document. React Router calls history.replaceState while the page
 * is still loading, during module init, and that event arrives with
 * `loading: true`, which is indistinguishable from a real document start. On
 * device that made a routine router call look like a page swap: the guard
 * re-served the document, the router replaced state again, and the app ended
 * on its "replaced by another page" screen on every cold start.
 *
 * The patch therefore tags the events at the source: onPageStarted carries
 * `newDocument: true`, doUpdateVisitedHistory carries `newDocument: false`.
 * When the tag is present it decides, so the result no longer depends on the
 * order of the two callbacks or on a progress value. The `loading` heuristic
 * stays as a fallback for a build where the patch has not been applied.
 */
export function isSameDocumentHistoryUpdate(
  platform: typeof Platform.OS,
  nativeEvent: WebViewLoadStartEvent | undefined,
): boolean {
  if (platform !== 'android') return false;
  if (typeof nativeEvent?.newDocument === 'boolean') return !nativeEvent.newDocument;
  return nativeEvent?.loading === false;
}
