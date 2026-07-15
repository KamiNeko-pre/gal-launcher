# 启动性能基线

先执行 `npm run build`，再运行 `npm run perf:startup -- --profile empty`。脚本会为每次采样创建临时 userData，复制指定 fixture，记录 `app-ready`、`dom-ready`、`did-finish-load`、`first-paint-ack` 和进程树工作集峰值，结束后删除临时目录。

真实库模式只应在本机手动执行，避免把私人游戏路径或图片复制进仓库；可通过 `GAL_LAUNCHER_PERF_USER_DATA` 指向已准备好的隔离 userData，并使用 `--profile current`。
