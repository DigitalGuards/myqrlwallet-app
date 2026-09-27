import type { Platform } from 'react-native';

/**
 * Android's react-native-webview also emits onLoadStart from
 * doUpdateVisitedHistory, which fires for same-document history updates such
 * as the web wallet's own route changes. On Android those arrive on a fully
 * loaded page (`loading: false`) and keep the same document, so they must not
 * reset the bridge's document authority or the native lock. Android new
 * document loads report `loading: true`. iOS emits load starts only for real
 * navigations, so every iOS load start counts as a new document.
 */
export function isSameDocumentHistoryUpdate(
  platform: typeof Platform.OS,
  nativeEvent: { loading?: boolean } | undefined,
): boolean {
  return platform === 'android' && nativeEvent?.loading === false;
}
