# Changelog

## 0.3.0

主题系统大更新。这个版本把 Gal Launcher 从单一沉浸式启动页扩展为多套独立前端主题。

### Added

- 新增 Arcade 主题：CRT 游戏机、卡带槽、像素 HUD 和街机式启动按钮。
- 新增 Atelier 主题：视觉小说手账桌面、相册、便签和纸张拼贴风格。
- 新增 Aurora 主题：柔光宽幅剧照舞台、统计卡和续读列表。
- 新增 Lumen Shelf 主题：明亮书架目录、多列作品墙和索引式信息区。
- 新增多主题布局注册能力，每套主题可以拥有独立的首页、收藏页和底部作品导航。

### Changed

- 重写主题预设说明，主题不再只是颜色方案，而是完整界面风格。
- 优化 Editorial 杂志主题的横版主视觉兼容性、跨页展示和收藏页。
- 保留 Cinema 主题的沉浸式设计语言，作为默认电影感启动体验。
- 更新 README，使项目介绍、下载方式、主题说明和发布流程适配 0.3.0。

### Notes

- 推荐发布附件为 `Gal-Launcher-win-unpacked.zip`。
- 审核和快速验证时使用 `npm run dist`，不要默认构建 portable 单文件。

## 0.2.3

侧栏视觉优化、主题重构、时长统计重写。

### Changed

- 优化侧栏按钮可视度与交互动效。
- 重构主题预设系统。
- 重写游玩时长统计，加入进程树追踪、崩溃恢复和看门狗保活。
- 修复 release workflow 手动触发时无法正确关联 tag 的问题。

## 0.2.2

封面搜索全面重构。

### Changed

- 增加代理可选、动态查询、竖版备选、降噪、重试和缓存感知。
- 优化多来源封面搜索的稳定性。

## 0.2.1

### Fixed

- VNDB 截图搜索改为仅下载全尺寸图片，跳过缩略图。
- 下载超时时间从 8 秒增加到 20 秒。
- 降低 VNDB 封面搜索相似度阈值，改善日文名命中但分数过低的问题。
- 扩充作品别名库，提高部分作品的封面搜索命中率。

## 0.2.0

### Added

- 重写 README，加入截图、功能表格、主题说明和社区文件。
- 添加 GitHub Issue / PR 模板和 Funding 配置。

## 0.1.0

Initial public release preparation.

### Added

- Local visual novel / galgame library.
- Steam-like cover wall.
- Immersive key visual launch page.
- Game launch support for `.exe`, `.bat`, `.cmd`, and `.lnk`.
- Play count and play time tracking.
- Metadata search and candidate picker.
- Cover/background candidate search.
- Bangumi rating lookup.
- Backup export/import.
- Windows build and portable release workflows.
- Public README, user guide, privacy notes, and data source notes.
