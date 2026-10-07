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
  native layer, so an update reaches only the exact native build it was
  created for. A change to a native dependency, a native config value or the
  embedded wallet document produces a new fingerprint and needs a store build.
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
   `eas update` against the EAS environment named like the channel (`production` or `preview`) and prints the update group id. Any variable later defined in an EAS environment is injected into the updates published for it, so review that list before publishing. `--dry-run` runs every check and
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
