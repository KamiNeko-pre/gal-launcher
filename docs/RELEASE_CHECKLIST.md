# Release Checklist

Use this checklist before publishing a new Gal Launcher release.

## Repository

- [ ] No game files are committed.
- [ ] No downloaded covers/backgrounds are committed.
- [ ] No `%APPDATA%\gal-launcher` user data is committed.
- [ ] No personal one-off maintenance scripts are committed.
- [ ] `README.md` is up to date.
- [ ] `CHANGELOG.md` includes the new version.
- [ ] `package.json` and `package-lock.json` have the release version.
- [ ] `LICENSE` is present.
- [ ] `docs/DATA_SOURCES.md` is up to date.
- [ ] `docs/PRIVACY.md` is up to date.

## Build

Fast review build:

```powershell
Stop-Process -Name "Gal Launcher" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
npm run dist
```

`npm run dist` runs:

```text
npm run build && electron-builder --win dir
```

Review executable:

```text
release/win-unpacked/Gal Launcher.exe
```

Do not run `npm run dist:portable` for the normal review path. The portable build compresses the full Electron runtime into a single exe and is much slower.

## Manual QA

- [ ] App opens from `release/win-unpacked/Gal Launcher.exe`.
- [ ] Add game dialog works.
- [ ] Launching a game increments play count.
- [ ] Play time is recorded after the game exits.
- [ ] Metadata search works or fails gracefully.
- [ ] Cover picker works or fails gracefully.
- [ ] Backup export/import works.
- [ ] Theme picker can switch all bundled themes.
- [ ] Collection/library views work in every theme.

## Legal / Source Hygiene

- [ ] Third-party source integrations are documented.
- [ ] No third-party artwork is bundled in the repository.
- [ ] No scraped cache is bundled in releases.
- [ ] User-visible wording says the app does not provide game content.
- [ ] Community scraping sources are optional or conservative.

## GitHub Release

- [ ] Create a version tag, for example `v0.3.0`.
- [ ] Zip `release/win-unpacked` as `Gal-Launcher-win-unpacked.zip`.
- [ ] Attach `Gal-Launcher-win-unpacked.zip` for normal users.
- [ ] Only attach a portable exe/zip when a single-file build is explicitly needed.
- [ ] Include a short changelog.
- [ ] Mention Windows support status.
- [ ] Tell users that Windows may show an "unknown publisher" warning because the app is unsigned.

## Recommended Public Release Text

```text
Gal Launcher v0.3.0

本版本重写了主题系统，新增 Arcade、Atelier、Aurora、Lumen Shelf 等多套独立界面。

下载 Gal-Launcher-win-unpacked.zip 后解压，运行 win-unpacked/Gal Launcher.exe。

这是一个本地 Galgame / 视觉小说启动器，不包含任何游戏本体、破解或下载资源。
如果 Windows 提示未知发布者，是因为当前版本尚未购买代码签名证书。
```
