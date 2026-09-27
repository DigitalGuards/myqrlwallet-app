/**
 * Android's react-native-webview also emits onLoadStart from
 * doUpdateVisitedHistory, which fires for same-document history updates such
 * as the web wallet's own route changes. Those arrive on a fully loaded page
 * (`loading: false`) and keep the same document, so they must not reset the
 * bridge's document authority or the native lock. A new document load reports
 * `loading: true`; an event without a payload is treated as a new load.
 */
export function isSameDocumentHistoryUpdate(
  platform: string,
  nativeEvent: { loading?: boolean } | undefined,
): boolean {
  return platform === 'android' && nativeEvent?.loading === false;
}
