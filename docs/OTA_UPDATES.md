# Signed over-the-air updates

The app can receive JavaScript updates between store releases. This page
describes who can publish one, what a device accepts, and how the owner
publishes and recovers.

## Trust model

- A device loads an update only if its manifest is signed with the DigitalGuards
  code-signing key. The matching public certificate ships inside the app at
  `certs/certificate.pem`. An unsigned or differently signed update is ignored
  and the app keeps running what it already has.
- Expo hosts the update files and serves the manifests. Expo holds no signing
  key, so it can serve an update and it can withhold one, and it cannot alter
  one. A modified manifest or asset fails verification on the device.
- The private key lives encrypted with GPG, under the owner's
  passphrase-protected key. Every publish decrypts it, so every publish needs
  the owner at the keyboard. The decrypted copy exists only in a temporary file
  in memory-backed storage while the publish command runs and is shredded on
  every exit path.
- `runtimeVersion` uses the `fingerprint` policy. The fingerprint covers the
  native layer (expo config, `eas.json`, patches, plugins and native package
  versions), so an update reaches only the exact native build it was created
  for. A change to a native dependency or native config value produces a new
  fingerprint and needs a store build. The embedded wallet document is a bundled
  asset and ships inside the update, so a re-pinned wallet reaches installed
  builds over the air. `verify:embedded-web` in the publish script is the gate
  that protects the pin. The fingerprint is computed per platform, so a publish
  for all platforms creates one update group per platform.
- Updates download in the background and apply on the next cold start
  (`fallbackToCacheTimeout: 0`). A running session never switches bundle.
- The `embedded-dev` variant disables updates entirely. It is a separate app
  for testing and never loads a production update.
- Channels: `production` for store builds, `preview` for preview builds,
  `development` for development builds. A build only sees updates published to
  its own channel.

### Older updates and rollback

A device runs the newest update that matches its channel and runtime version.
It does not step back to an older update by itself. To undo a bad update the
owner publishes a new update (for example the previous commit's content), or a
signed `rollBackToEmbedded` directive, which sends devices back to the bundle
that shipped in their store build. Directives are signed like manifests, so
only the owner can issue one. Devices pick either up on the next launch and
apply them on the launch after that.

## Publish procedure

1. Land the change on `dev` or `main` and push it. The script refuses a dirty
   tree and a HEAD that is not on `origin`.
2. If the embedded wallet changed, re-pin it first:
   `scripts/sync-embedded-web.sh`, then commit `assets/web/PIN.json` and the
   document. See [EMBEDDED_WEB_WALLET.md](./EMBEDDED_WEB_WALLET.md).
3. Check whether the change alters the fingerprint (`npx @expo/fingerprint .`
   against the last store build). A changed fingerprint means the update would
   reach no device and a store build is required.
4. Publish to `preview` first and check a preview build on a device.
5. The owner runs:

   ```
   scripts/publish-update.sh --channel production --message "short description"
   ```

   Production publishes only from `main` or `dev`. The script runs
   `lint`, `typecheck`, `test:ci` and `verify:embedded-web`, builds the bundle
   with the environment of the production EAS build
   (`EXPO_PUBLIC_WEB_SOURCE=embedded`, no `APP_VARIANT`), decrypts the key, runs
   `eas update` and prints one update group id per platform. The script passes no EAS environment to `eas update`, because eas-cli would merge that environment's server-side variables over the script's own and could shape the bundle that gets signed. EAS environments stay empty, and the publish script does not read them. Dotenv files are ignored, `npm ci` runs first so `node_modules` matches the lockfile, and eas-cli major version 21 is required. `--dry-run` runs every check and
   prints the command without decrypting or publishing.
6. Confirm on a device: Settings, Copy Diagnostics shows the update id, channel,
   runtime version and creation time, and whether the embedded bundle is
   running.

The encrypted key path defaults to
`$HOME/.config/myqrlwallet-update-signing/private-key.pem.gpg`. Set
`UPDATE_SIGNING_KEY_GPG` to use another file.

## Key rotation

The certificate is part of the native build, so a new certificate needs a new
store build. Ship the build containing the new certificate first and wait until
it is the version most users run, then sign updates with the new key. Devices on
the old build keep trusting only the old key. Losing the key stops over-the-air
updates and nothing else: store releases continue and every installed build
keeps working.

## Compromise response

If the signing key or its passphrase may be exposed:

1. Stop publishing and tell the team.
2. Publish a signed `rollBackToEmbedded` directive if a malicious update could
   be live and the key is still under the owner's control.
3. Generate a new key and certificate, ship a store build that carries the new
   certificate and ask users to update. Old builds trust the old certificate for
   as long as they run, so a store release is the way to retire it.
4. Rotate the passphrase and review where the encrypted file was stored.

A compromised Expo account alone cannot ship code to devices, because every
manifest must carry the owner's signature. It can stop updates from arriving.

Two limits come with the protocol. Keep every production update on one EAS
branch, because the manifest filter header that selects the branch is unsigned.
A fresh install whose embedded build predates a withdrawn signed update can
still be served that update, so ship a store build after a security-relevant
update.
