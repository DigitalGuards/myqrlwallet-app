import {
  isAllowedWalletDocumentUrl,
  walletUrlOriginForLog,
} from "../WalletWebOrigin";

describe("wallet WebView origin policy", () => {
  it.each([
    "https://qrlwallet.com",
    "https://qrlwallet.com/settings",
  ])("allows the exact production HTTPS origins: %s", (url) => {
    expect(isAllowedWalletDocumentUrl(url, false)).toBe(true);
  });

  it.each([
    "http://qrlwallet.com",
    "https://qrlwallet.com:444",
    "https://www.qrlwallet.com/",
    "https://qrlwallet.com.evil.example",
    "https://user@qrlwallet.com",
    "javascript:alert(1)",
  ])("rejects a production origin-confusion URL: %s", (url) => {
    expect(isAllowedWalletDocumentUrl(url, false)).toBe(false);
  });

  it("allows only explicitly configured HTTP(S) development hosts", () => {
    const hosts = ["10.0.2.2", "localhost"];
    expect(
      isAllowedWalletDocumentUrl("http://10.0.2.2:5173", true, hosts),
    ).toBe(true);
    expect(
      isAllowedWalletDocumentUrl("https://localhost:5173", true, hosts),
    ).toBe(true);
    expect(
      isAllowedWalletDocumentUrl("http://attacker.test:5173", true, hosts),
    ).toBe(false);
  });

  it("redacts path, query, fragment, and credentials from URL logs", () => {
    const secret = "do-not-log";
    const label = walletUrlOriginForLog(
      `https://user:${secret}@example.com/private?cap=${secret}#${secret}`,
    );

    expect(label).toBe("https://example.com");
    expect(label).not.toContain(secret);
    expect(walletUrlOriginForLog(`qrlconnect://?q=${secret}`)).toBe(
      "non-http URL",
    );
  });
});
