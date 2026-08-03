const PRODUCTION_HOSTS = new Set(['qrlwallet.com']);

export function isAllowedWalletDocumentUrl(
  value: string,
  development: boolean,
  developmentHosts: string[] = [],
): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (development) {
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        developmentHosts.includes(url.hostname)
      );
    }
    return (
      url.protocol === "https:" &&
      url.port === "" &&
      PRODUCTION_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}

/** Return only a non-secret origin label for navigation diagnostics. */
export function walletUrlOriginForLog(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.origin
      : 'non-http URL';
  } catch {
    return 'invalid URL';
  }
}
