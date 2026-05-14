# Release Checklist

Use this checklist before publishing the project or a new release.

## Repository

- [ ] No game files are committed.
- [ ] No downloaded covers/backgrounds are committed.
- [ ] No `%APPDATA%\gal-launcher` user data is committed.
- [ ] No personal one-off maintenance scripts are committed.
- [ ] `README.md` is up to date.
- [ ] `LICENSE` is present.
- [ ] `docs/DATA_SOURCES.md` is up to date.
- [ ] `docs/PRIVACY.md` is up to date.

## Build

```bash
npm install
npm run build
npm run dist
```

To produce a single downloadable portable exe:

```bash
npm run dist:portable
```

- [ ] App opens from `release/win-unpacked/Gal Launcher.exe`.
- [ ] Portable build creates `release/Gal Launcher.exe`.
- [ ] Add game dialog works.
- [ ] Launching a game increments play count.
- [ ] Play time is recorded after the game exits.
- [ ] Metadata search works or fails gracefully.
- [ ] Cover picker works or fails gracefully.
- [ ] Backup export/import works.

## Legal / Source Hygiene

- [ ] Third-party source integrations are documented.
- [ ] No third-party artwork is bundled in the repository.
- [ ] No scraped cache is bundled in releases.
- [ ] User-visible wording says the app does not provide game content.
- [ ] Community scraping sources are optional or conservative.

## GitHub Release

- [ ] Create a version tag, for example `v0.1.0`.
- [ ] Attach `release/Gal Launcher.exe` for normal users.
- [ ] Optionally attach a zip of `release/win-unpacked`.
- [ ] Include a short changelog.
- [ ] Mention Windows support status.
- [ ] Tell users that Windows may show an "unknown publisher" warning because the app is unsigned.

## Recommended Public Release Text

```text
Gal Launcher v0.1.0

下载 Gal Launcher.exe 后双击运行即可。

这是一个本地 Galgame / 视觉小说启动器，不包含任何游戏本体。
如果 Windows 提示未知发布者，是因为当前版本尚未购买代码签名证书。
```
