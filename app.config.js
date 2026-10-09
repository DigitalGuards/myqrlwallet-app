/**
 * Expo app config.
 *
 * app.json stays the single source of the production configuration and is
 * still read directly by the native security regression test. This file only
 * layers a build variant on top of it, selected with APP_VARIANT.
 *
 *   (unset) or "production"  production identifiers, unchanged from app.json
 *   "embedded-dev"           a separate app that can be installed next to the
 *                            production one for testing the embedded wallet
 *
 * The embedded-dev variant deliberately takes a different bundle identifier,
 * a different URL scheme and no associated domains. Installed beside the
 * production app it must never compete for qrlconnect:// pairing links or for
 * qrlwallet.com universal links: the OS picks a claimant on its own and the
 * user would silently pair with the wrong build.
 */
const EMBEDDED_DEV = 'embedded-dev';
const EMBEDDED_DEV_ID = 'com.chiefdg.myqrlwallet.embedded';
const EMBEDDED_DEV_SCHEME = 'qrlconnect-embedded';

/**
 * Copies the config app.json produced, never mutating it in place, and
 * spreads it so every own property carries over. Expo tags the object it
 * hands in and checks the returned one for that tag to tell whether the
 * static config was used; a JSON round trip would drop it.
 */
function applyEmbeddedDevVariant(config) {
  const ios = { ...config.ios, bundleIdentifier: EMBEDDED_DEV_ID };
  // No universal links for this variant: qrlwallet.com applinks belong to the
  // production app alone.
  delete ios.associatedDomains;

  const android = { ...config.android, package: EMBEDDED_DEV_ID };
  // Same reasoning for the Android https://qrlwallet.com/connect intent
  // filter. A second, unverifiable claimant only produces a chooser dialog.
  delete android.intentFilters;

  // Over-the-air updates are signed and published for the production app
  // only. This variant is a different app with its own native build, so it
  // never checks for or loads one.
  const updates = { ...config.updates, enabled: false, checkAutomatically: 'NEVER' };

  return {
    ...config,
    updates,
    name: 'MyQRLWallet Embedded',
    scheme: [EMBEDDED_DEV_SCHEME],
    ios,
    android,
  };
}

module.exports = ({ config }) => {
  if (process.env.APP_VARIANT === EMBEDDED_DEV) {
    return applyEmbeddedDevVariant(config);
  }

  // Production: app.json is the whole configuration, handed back untouched.
  return config;
};
