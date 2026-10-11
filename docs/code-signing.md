# Code signing

WA Stay's Windows releases are **not code-signed yet**. Windows SmartScreen therefore warns the
first time someone runs the installer or the portable exe: they choose **More info**, then
**Run anyway**. This page says how to turn signing on.

## Windows

electron-builder signs the installer, the portable exe and the app executable itself when it
finds a certificate in the environment. The release workflow (`.github/workflows/build.yml`,
job "Build Windows") passes one through only when the repository has these secrets:

| Secret | Value |
| --- | --- |
| `CSC_LINK` | The code-signing certificate (`.pfx`/`.p12`), base64-encoded, or a path or URL to it |
| `CSC_KEY_PASSWORD` | The certificate's password |

Without them the build runs unsigned, as today. `electron-builder.json` signs with SHA-256
(`win.signtoolOptions.signingHashAlgorithms`) and signs the executables only, not the DLLs
(electron-builder's default; `win.signExts` would add other file types). The Electron fuses are
flipped before signing ([security](security.md#the-packaged-app-electron-fuses)).

- **Getting a certificate.** An OV (organisation-validated) certificate stops the "unknown
  publisher" text, but SmartScreen still warns until the certificate builds a reputation over
  many downloads. An EV certificate is trusted at once, but lives on a hardware token or a
  cloud signing service, which a plain `CSC_LINK` cannot use; that would need a signing step
  of its own.
- **Signing locally:** set `CSC_LINK` and `CSC_KEY_PASSWORD` in the shell, then
  `npm run dist:win`. Check the result in the exe's Properties → Digital Signatures, or with
  `signtool verify /pa /v release\WA-Stay-Setup-x.y.z.exe`.
- **Auto-update** does not check the publisher's signature (`win.verifyUpdateCodeSignature:
  false`), so a later signed release still updates an unsigned install, and the reverse.
- `scripts/sign-windows.js` is a custom `signtool` hook that `electron-builder.json` does not
  use; electron-builder's built-in signing is enough for a `.pfx` certificate.

## macOS and Linux

Windows is the only shipped platform. `electron-builder.json` keeps macOS (`dmg`, `zip`; hardened
runtime with `resources/entitlements.mac.plist`) and Linux (`AppImage`, `deb`, `rpm`) targets so
nothing blocks them later. A macOS release would need a Developer ID certificate in `CSC_LINK`
and notarisation; `scripts/notarize.js` is a starting point, but it is not wired into
`electron-builder.json` (`afterSign`) and expects `@electron/notarize`, which is not installed.

## Related

- [Release process](release-process.md)
- [Installation](installation.md), for what users see
