# 性能与发布门槛

## 当前基线

测试环境：Windows 本机，Electron 38，空库 profile，3 次采样。

- 首屏 `first-paint-ack`：约 446–535 ms
- 进程树峰值工作集：约 384–406 MiB
- 采样命令：`npm run perf:startup -- --profile empty`

空库工作集主要是 Electron/Chromium 基线；真实库应在隔离 userData 中单独测量，不能把用户路径或图片提交到仓库。

## 每次提交检查

运行 `npm run check`，必须同时通过 TypeScript/Vite 构建和全部 Node 单元测试。性能改动还应运行空库启动采样，并对比 `artifacts/perf` 中的 JSON 结果。

## 回归门槛

- 不得重新引入全库 Base64 图片驻留或远程图片批量预加载。
- 元数据网络失败必须可重试，不能写成永久的零分或“查无条目”。
- 首屏不得等待 VNDB、Bangumi、翻译、远程字体或非首屏图片。
- 主进程职责拆分必须保持现有 IPC 名称和离线启动行为。
