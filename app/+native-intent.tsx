// expo-router calls this BEFORE parsing any incoming system URL into a route,
// for both cold-start initial URLs and warm 'url' events.
//
// qrlconnect:// URIs are not routes. Their q= payload is base45, whose
// alphabet includes a literal '%', and expo-router's parser double-decodes
// query values (URLSearchParams already decodes once, then it runs
// decodeURIComponent on the result), so ~5 of 6 pairing URIs throw
// "URIError: URI malformed" synchronously during the first render of a
// URL-launched cold start. That fatal render error is what killed builds
// 18-21 (SIGABRT via RCTFatal) and zombified builds 22-23 behind the splash
// (expo/expo#42075, #25323; fix PR #42114 unmerged).
//
// Routing can safely ignore these URIs entirely: the WebView bridge reads
// the raw URL independently via expo-linking in app/_layout.tsx, which this
// hook does not consume. Returning '/' lands on the WebView tab, exactly
// where dApp flows want to be.
//
// Per the Expo docs, this function must never throw.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (typeof path === 'string' && path.startsWith('qrlconnect:')) {
      return '/';
    }
    return path;
  } catch {
    return '/';
  }
}
