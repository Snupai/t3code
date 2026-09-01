# Fork releases

> Official releases stay in [Release](./release.md). This runbook is for people shipping a
> personal fork so existing machines can install it once, then auto-update.

## TLDR

1. Merge this branch to your fork and enable Actions (read/write).
2. Actions → **Fork Release** → Run workflow. First version should be **higher than what you
   already have installed** (empty input starts at `10.0.0`).
3. Install that GitHub Release on Windows and both Macs (overwrite the official app).
4. On the Linux server, install the `t3-*.tgz` from the same release, then `t3 service install`.
5. Later **Fork Release** runs publish new GitHub Releases. Desktop rocket-updates. The Linux
   service follows when a connected client offers **Update server**.

The updater watches **GitHub Releases**, not the git branch.

## What this workflow publishes

Workflow: `.github/workflows/fork-release.yml`

It does **not** run on `pingdotgg/t3code`. It builds unsigned desktop artifacts unless you add
the same signing secrets as official, and it never publishes npm package `t3`.

Each run uploads:

- macOS arm64 + x64 DMG/zip
- Linux x64 AppImage
- Windows x64 NSIS installer
- `latest.yml` / `latest-mac.yml` (and blockmaps) so `electron-updater` can see the version
- `t3-<version>.tgz` for headless servers

The desktop feed is your fork (`GITHUB_REPOSITORY`). The CLI tarball URL is baked into that
same build as `https://github.com/<you>/<repo>/releases/download/v{version}/t3-{version}.tgz`.

## First install

Version must be **greater** than the app already on the machine. `1.2.3-fork.1` is older than
`1.2.3` and is ignored on the stable updater channel.

**Windows / macOS desktop:** download the installer from the fork GitHub Release and install it
over the current T3 Code app. Same app id, so `~/.t3` stays. Unsigned Mac builds need a
Gatekeeper override on first launch.

**Linux headless:**

```sh
npx --yes t3@https://github.com/<you>/<repo>/releases/download/v10.0.0/t3-10.0.0.tgz service install
```

Use the exact version from that release. After that, leave the official `npx t3@latest` path
alone; it still installs npm `t3`.

## Later updates

- **Desktop:** rocket control in the app. No reinstall.
- **Linux service:** update from a matching fork desktop/web client (**Update server**), or
  `npx t3@https://github.com/<you>/<repo>/releases/download/v<new>/t3-<new>.tgz service update`.
- **Schedule:** the workflow checks every six hours and bumps the last `vX.Y.Z` tag when HEAD
  moved. Manual **Run workflow** still works. Pushing `vX.Y.Z` also works.

## Keep the fork current

```sh
git remote add upstream https://github.com/pingdotgg/t3code.git
git fetch upstream
git merge upstream/main
git push
```

Then run **Fork Release** (or wait for the scheduled build).

## Actions permissions

GitHub → repo **Settings** → **Actions** → **General** → Workflow permissions → **Read and
write**. Without that, the release job cannot publish.

## What will not follow the fork

- Mobile App Store / Play Store builds
- `app.t3.codes` (use the desktop UI, or the AppImage / `npx` from the fork tarball)
- Official `npx t3@latest` / `winget` / `brew` channels
