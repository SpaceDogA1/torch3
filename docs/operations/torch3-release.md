# Releasing Torch3

> For maintainers. Upstream's pipeline in [release.md](./release.md) only runs in
> `pingdotgg/t3code`; Torch3 ships from `.github/workflows/torch3-release.yml`.

A release builds unsigned desktop installers, packs the `@torch3/cli` npm package, attaches everything
to a GitHub Release, and publishes the package to npm. It takes about 30 minutes, almost all of it
the desktop builds.

## Before you start

- `main` is green in CI. The workflow builds `main`'s current commit and does not run tests.
- The repository is public. While it is private, release downloads, the README badges and the
  desktop app's update check work only for people signed in with access.
- The `torch3` organization exists on npm and your account can publish to it. The package is
  `@torch3/cli` because npm refuses the bare name `torch3` as too close to `touch`.
- The `NPM_TOKEN` secret holds a token that can publish (see [npm token](#npm-token)).
- GitHub Actions has minutes left. A private repository uses the account's paid minutes, and a
  failed payment or a spent limit stops jobs before they start.
- Pick the version. Torch3 has one stable track, `X.Y.Z`, with no nightlies. Do not reuse a version
  that is already on npm: npm never accepts the same version twice, even after an unpublish.

## Run it

**Actions → Torch3 release → Run workflow**, select `main`, enter the version without a `v`
(`0.1.1`), and run. Or from a terminal:

```sh
gh workflow run torch3-release.yml -R SpaceDogA1/torch3 --ref main -f version=0.1.1
```

Pushing a `vX.Y.Z` tag runs the same workflow for the tagged commit.

## What it does

| Job                 | Runner         | Produces                                                               |
| ------------------- | -------------- | ---------------------------------------------------------------------- |
| Resolve version     | Ubuntu         | Checks the version is semantic                                         |
| Desktop macOS arm64 | `macos-latest` | `Torch3-X.Y.Z-arm64.dmg`, `.zip`, blockmaps, `latest-mac.yml`          |
| Desktop Linux x64   | Ubuntu         | `Torch3-x86_64.AppImage`, `Torch3-X.Y.Z-amd64.deb`, `latest-linux.yml` |
| Desktop Windows x64 | `windows-2025` | `Torch3-X.Y.Z-x64.exe`, blockmap, `latest.yml`                         |
| npm package         | Ubuntu         | `torch3-cli-X.Y.Z.tgz`, after running its `--help` through `npx`       |
| Publish             | Ubuntu         | The GitHub Release `vX.Y.Z`, then `npm publish`                        |

Each build job first sets every workspace package to the release version with
`scripts/update-release-package-versions.ts`. Publish waits for all of them, so a failed build
publishes nothing.

The `latest*.yml` files are the desktop update feed. The build points it at this repository, so an
installed app finds the next release here. Windows and Linux install updates in place; macOS cannot
update an unsigned app, so Mac users download each release.

The installers are unsigned on purpose until signing certificates exist: macOS asks the user to
right-click and **Open** once, and Windows SmartScreen shows **More info → Run anyway**.

## If a step fails

Fix the cause on `main`, then either:

- **Run the workflow again** with the same version. Publish skips a GitHub Release that already
  exists and a version that is already on npm, so a second run only finishes what is missing. It
  rebuilds the installers but keeps the files already attached to the release.
- **Re-run failed jobs** from the run's page, when only Publish failed and its cause was outside the
  repository, such as the npm token. A re-run reuses the original run's artifacts and its copy of the
  workflow, so it does not pick up fixes pushed since.

Failures seen so far:

| Symptom                                                                                                            | Cause and fix                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `npm error 403 … Two-factor authentication or granular access token with bypass 2fa enabled is required`           | `NPM_TOKEN` cannot publish. Replace it (see [npm token](#npm-token)) and re-run failed jobs.                                             |
| `WindowsPackagedPayloadValidationError: … contains N files; expected at most 100`                                  | The Windows app grew. Find what added files before raising `WINDOWS_PACKAGED_PAYLOAD_FILE_LIMIT` in `scripts/build-desktop-artifact.ts`. |
| `403 … Package name too similar to existing package touch`                                                         | npm refuses unscoped `torch3`. Publish as `@torch3/cli`, which the pack script already names.                                            |
| `The job was not started because recent account payments have failed or your spending limit needs to be increased` | Fix **Settings → Billing and plans** on GitHub, or publish the release's `.tgz` by hand as below.                                        |
| `react-native-enriched-markdown postinstall: tar: Error is not recoverable` in the Windows log                     | Harmless: a mobile-only package's install step. The desktop build does not use it.                                                       |

## npm token

Create a **granular access token** at
[npmjs.com → Access Tokens](https://www.npmjs.com/settings/~/tokens/granular-access-tokens/new) with:

- **Bypass two-factor authentication** turned on, so CI can publish without a one-time code;
- **Packages and scopes: Read and write**. Before `@torch3/cli` exists on npm, choose **All packages**;
  after the first publish you can narrow a new token to `@torch3/cli` only;
- an expiry you will remember to renew.

Store it without printing it:

```sh
gh secret set NPM_TOKEN -R SpaceDogA1/torch3   # paste the token when asked
```

To publish a release's package by hand instead, for example with a one-time code:

```sh
gh release download vX.Y.Z -R SpaceDogA1/torch3 -p 'torch3-cli-X.Y.Z.tgz'
npm publish ./torch3-cli-X.Y.Z.tgz --access public
```

Keep the `./`: without it npm reads the path as a GitHub `owner/repo`.

## Check the release

```sh
gh release view vX.Y.Z -R SpaceDogA1/torch3     # three installers, the .tgz and three latest*.yml
npm view @torch3/cli version                          # the new version
npx --yes @torch3/cli@X.Y.Z --help                    # usage says `torch3`
```

Then install the Windows `.exe` or another installer on a clean machine, open a project and turn on
Orchestry. The workflow does not launch the packaged apps, so this is the only check that they start.
