import type { Game, GameStatus } from "./types";

export const statuses: GameStatus[] = ["想玩", "未开始", "进行中", "已通关", "搁置"];

export const statusMeta: Record<GameStatus, { tone: string }> = {
  想玩: { tone: "wish" },
  未开始: { tone: "idle" },
  进行中: { tone: "active" },
  已通关: { tone: "done" },
  搁置: { tone: "paused" }
};

export function nowIso() {
  return new Date().toISOString();
}

export function formatDate(value: string | null) {
  if (!value) return "尚未启动";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function normalizeTags(raw: string) {
  return raw
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatBgmRating(game: Game) {
  if (!game.bgmRatingCheckedAt) return "查询中";
  if (!game.bgmScore) return "暂无";
  const count = game.bgmScoreCount ? ` / ${game.bgmScoreCount}人` : "";
  return `${game.bgmScore.toFixed(1)}${count}`;
}

export function formatPlayTime(seconds = 0) {
  if (seconds < 60) return seconds > 0 ? "不到 1 小时" : "0 小时";
  const hours = seconds / 3600;
  if (hours < 10) return `${hours.toFixed(1)} 小时`;
  return `${Math.round(hours)} 小时`;
}

export function getTotalPlaySeconds(game: Game, nowMs = Date.now()) {
  const stored = game.totalPlaySeconds ?? 0;
  if (!game.currentSessionStartedAt) return stored;
  const startedMs = new Date(game.currentSessionStartedAt).getTime();
  if (!Number.isFinite(startedMs)) return stored;
  return stored + Math.max(0, Math.round((nowMs - startedMs) / 1000));
}

export function metadataChecks(game: Game) {
  return [
    { label: "标题", ok: Boolean(game.title) },
    { label: "竖版封面", ok: Boolean(game.coverPath) },
    { label: "横版图", ok: Boolean(game.backgroundPath && game.backgroundPath !== game.coverPath) },
    { label: "简介", ok: Boolean(game.description && game.description.length > 24) },
    { label: "评分", ok: Boolean(game.bgmScore) },
    { label: "启动文件", ok: Boolean(game.executablePath) }
  ];
}

export function completeness(game: Game) {
  const checks = metadataChecks(game);
  return Math.round((checks.filter((item) => item.ok).length / checks.length) * 100);
}

export function getRecentTwoWeeksSeconds(game: Game, nowMs = Date.now()) {
  const sessions = game.sessions ?? [];
  if (sessions.length === 0) return 0;
  const cutoff = nowMs - 14 * 24 * 60 * 60 * 1000;
  let total = 0;
  for (const session of sessions) {
    if (new Date(session.startedAt).getTime() >= cutoff) {
      total += session.durationSeconds;
    }
  }
  // Also count current session if within 2 weeks
  if (game.currentSessionStartedAt) {
    const startedMs = new Date(game.currentSessionStartedAt).getTime();
    if (Number.isFinite(startedMs) && startedMs >= cutoff) {
      total += Math.max(0, Math.round((nowMs - startedMs) / 1000));
    }
  }
  return total;
}

import type { PickedLaunchFile } from "./types";

export function makeGame(picked: PickedLaunchFile): Game {
  const now = nowIso();
  return {
    id: crypto.randomUUID(),
    title: picked.title,
    originalTitle: picked.originalTitle ?? "",
    description: picked.description ?? "",
    developer: picked.developer ?? "",
    releaseDate: picked.releaseDate ?? "",
    installPath: picked.installPath,
    executablePath: picked.executablePath,
    workingDirectory: picked.workingDirectory,
    coverPath: picked.coverPath ?? "",
    backgroundPath: picked.backgroundPath || picked.coverPath || "",
    status: "未开始",
    tags: picked.tags ?? [],
    rating: 0,
    playCount: 0,
    totalPlaySeconds: 0,
    currentSessionId: null,
    currentSessionStartedAt: null,
    lastPlayedAt: null,
    createdAt: now,
    updatedAt: now
  };
}
