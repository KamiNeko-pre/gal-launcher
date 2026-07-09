# Gal Launcher

Gal Launcher 是一个面向本地 Galgame / 视觉小说收藏的 Windows 启动器。

它不提供游戏下载、破解、补丁或 DRM 绕过能力，只负责整理你已经安装在本地的作品：封面、横版主视觉、资料、启动入口、游玩时长和备份数据。

## 这次版本有什么不同

0.3.0 是一次主题系统大更新。它不再只是换颜色，而是把前端界面拆成多套完全不同的体验：

| 主题 | 设计方向 |
| --- | --- |
| Cinema | 沉浸式横版大图，保留最初的全屏启动语言 |
| Editorial | 杂志跨页、刊头目录和阅读感启动页 |
| Arcade | CRT 游戏机、卡带槽、像素 HUD 和街机式 START |
| Atelier | 手账桌面、相册、便签和纸张拼贴 |
| Lumen Shelf | 明亮书架、目录索引和多列作品墙 |
| Aurora | 柔光剧照舞台、续读列表和玻璃质感信息卡 |

这次重写的目标是让每套主题都有自己的布局、节奏和交互方式，而不是共享一张换皮模板。

## 核心功能

- 本地游戏库管理：添加 `.exe`、`.bat`、`.cmd`、`.lnk` 启动文件。
- 一键启动：自动记录启动次数、总时长、最近游玩时间和当前进行状态。
- 多源资料检索：从 VNDB、Bangumi、Steam、DLsite、2DFan 等来源辅助匹配作品资料和封面候选。
- 横版主视觉和竖版封面：支持自动候选，也支持手动选择本地图片。
- 主题切换：六套主题拥有各自的首页、收藏页、底部作品条和资料入口。
- 本地优先：数据保存在本机，支持导出和恢复备份。

## 下载与运行

前往 GitHub Releases 下载最新版本。

当前推荐交付物：

```text
Gal-Launcher-win-unpacked.zip
```

解压后运行：

```text
release/win-unpacked/Gal Launcher.exe
```

如果 Windows 提示“未知发布者”，这是因为当前项目没有代码签名证书。确认文件来自本仓库 Release 后继续运行即可。

## 快速开始

1. 打开 Gal Launcher。
2. 点击添加按钮，选择游戏目录里的启动文件。
3. 等待自动资料搜索，也可以手动选择候选。
4. 在主题按钮中切换 Cinema、Arcade、Atelier、Lumen Shelf 等主题。
5. 点击启动按钮运行游戏，应用会自动追踪游玩时间。

支持的启动文件：

```text
.exe
.bat
.cmd
.lnk
```

## 数据与隐私

Gal Launcher 不上传你的游戏库。默认数据位于本机用户目录下，备份文件也只由你手动导出。

请不要把以下内容提交到仓库或发布包中：

- 游戏本体
- 下载到本地的封面、截图、背景图
- `%APPDATA%` 下的个人游戏库数据
- 本地缓存或一次性维护脚本

更多说明见：

- [数据来源说明](docs/DATA_SOURCES.md)
- [隐私说明](docs/PRIVACY.md)
- [使用教程](docs/USER_GUIDE.md)

## 开发

环境要求：

- Windows
- Node.js 22 或兼容版本
- npm

常用命令：

```powershell
npm install
npm run dev
npm run build
```

快速打包审核版本：

```powershell
Stop-Process -Name "Gal Launcher" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
npm run dist
```

产物路径：

```text
release/win-unpacked/Gal Launcher.exe
```

不要在常规审核流程里跑 `npm run dist:portable`。portable 单文件会压缩较大的 Electron 运行时，在 WSL 或低速环境下会明显更慢。

## 发布口径

本项目的发布优先级：

1. 源码提交到 GitHub。
2. 打 tag，例如 `v0.3.0`。
3. GitHub Actions 或本地 `npm run dist` 生成 `release/win-unpacked`。
4. 将 `release/win-unpacked` 压缩为 `Gal-Launcher-win-unpacked.zip` 作为推荐下载附件。
5. portable exe 只在需要单文件分发时单独构建。

## 技术栈

- Electron 38
- React 19
- TypeScript 5.9
- Vite 7
- CSS Modules 风格的主题分层，但不依赖外部 UI 框架

## 免责声明

Gal Launcher 只管理本地已有游戏，不提供游戏资源、破解、补丁、激活工具或 DRM 绕过方式。第三方资料和图片候选只用于用户本地整理收藏，请遵守对应站点规则和作品版权。

## License

MIT
