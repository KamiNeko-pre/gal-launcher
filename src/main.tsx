import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  Clock3,
  Download,
  Edit3,
  FolderOpen,
  Gamepad2,
  Home,
  ImagePlus,
  Library,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  Trash2,
  Upload,
  X
} from "lucide-react";
import type { CoverCandidate, Game, GameStatus, MetadataCandidate, PickedLaunchFile, PlaySessionEndedEvent } from "./types";
import "./styles.css";

const statuses: GameStatus[] = ["想玩", "未开始", "进行中", "已通关", "搁置"];

const statusMeta: Record<GameStatus, { tone: string }> = {
  想玩: { tone: "wish" },
  未开始: { tone: "idle" },
  进行中: { tone: "active" },
  已通关: { tone: "done" },
  搁置: { tone: "paused" }
};

function nowIso() {
  return new Date().toISOString();
}

function makeGame(picked: PickedLaunchFile): Game {
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

function formatDate(value: string | null) {
  if (!value) return "尚未启动";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function normalizeTags(raw: string) {
  return raw
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatBgmRating(game: Game) {
  if (!game.bgmRatingCheckedAt) return "查询中";
  if (!game.bgmScore) return "暂无";
  const count = game.bgmScoreCount ? ` / ${game.bgmScoreCount}人` : "";
  return `${game.bgmScore.toFixed(1)}${count}`;
}

function formatPlayTime(seconds = 0) {
  if (seconds < 60) return seconds > 0 ? "不到 1 小时" : "0 小时";
  const hours = seconds / 3600;
  if (hours < 10) return `${hours.toFixed(1)} 小时`;
  return `${Math.round(hours)} 小时`;
}

function getTotalPlaySeconds(game: Game, nowMs = Date.now()) {
  const stored = game.totalPlaySeconds ?? 0;
  if (!game.currentSessionStartedAt) return stored;
  const startedMs = new Date(game.currentSessionStartedAt).getTime();
  if (!Number.isFinite(startedMs)) return stored;
  return stored + Math.max(0, Math.round((nowMs - startedMs) / 1000));
}

function metadataChecks(game: Game) {
  return [
    { label: "标题", ok: Boolean(game.title) },
    { label: "竖版封面", ok: Boolean(game.coverPath) },
    { label: "横版图", ok: Boolean(game.backgroundPath && game.backgroundPath !== game.coverPath) },
    { label: "简介", ok: Boolean(game.description && game.description.length > 24) },
    { label: "评分", ok: Boolean(game.bgmScore) },
    { label: "启动文件", ok: Boolean(game.executablePath) }
  ];
}

function completeness(game: Game) {
  const checks = metadataChecks(game);
  return Math.round((checks.filter((item) => item.ok).length / checks.length) * 100);
}

type ThemeSettings = {
  id: string;
  name: string;
  description: string;
  glassAlpha: number;
  blur: number;
  cardScale: number;
  accent: string;
  overlayLeft: number;
  overlayRight: number;
  overlayBottom: number;
  glowA: string;
  glowB: string;
};

const themePresets: ThemeSettings[] = [
  {
    id: "mist",
    name: "静雾灰蓝",
    description: "低饱和灰蓝，克制耐看，适合长期使用。",
    glassAlpha: 0.54,
    blur: 18,
    cardScale: 1,
    accent: "#9fb7ca",
    overlayLeft: 0.62,
    overlayRight: 0.48,
    overlayBottom: 0.78,
    glowA: "rgba(148, 163, 184, 0.12)",
    glowB: "rgba(203, 213, 225, 0.1)"
  },
  {
    id: "night",
    name: "墨蓝夜色",
    description: "更沉稳的暗色基底，强调文字可读性。",
    glassAlpha: 0.64,
    blur: 20,
    cardScale: 1,
    accent: "#8aa6bd",
    overlayLeft: 0.72,
    overlayRight: 0.6,
    overlayBottom: 0.86,
    glowA: "rgba(96, 125, 139, 0.14)",
    glowB: "rgba(148, 163, 184, 0.1)"
  },
  {
    id: "sakura",
    name: "月白藤灰",
    description: "保留一点淡紫气质，但整体更素净。",
    glassAlpha: 0.56,
    blur: 18,
    cardScale: 1,
    accent: "#b8aac7",
    overlayLeft: 0.64,
    overlayRight: 0.5,
    overlayBottom: 0.8,
    glowA: "rgba(180, 167, 196, 0.12)",
    glowB: "rgba(226, 232, 240, 0.1)"
  },
  {
    id: "clear",
    name: "清透纸感",
    description: "遮挡更少，像一层安静的半透明宣纸。",
    glassAlpha: 0.46,
    blur: 14,
    cardScale: 0.98,
    accent: "#a8b8c8",
    overlayLeft: 0.54,
    overlayRight: 0.38,
    overlayBottom: 0.7,
    glowA: "rgba(203, 213, 225, 0.1)",
    glowB: "rgba(241, 245, 249, 0.08)"
  }
];

const defaultTheme = themePresets[0];

function loadThemeSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("gal-launcher-theme") || "{}");
    const preset = themePresets.find((item) => item.id === saved.id) || defaultTheme;
    return preset;
  } catch {
    return defaultTheme;
  }
}

function buildLibraryStats(games: Game[], now: number) {
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
  const totalSeconds = games.reduce((sum, game) => sum + getTotalPlaySeconds(game, now), 0);
  const recent7 = games.filter((game) => game.lastPlayedAt && new Date(game.lastPlayedAt).getTime() >= weekAgo).length;
  const recent30 = games.filter((game) => game.lastPlayedAt && new Date(game.lastPlayedAt).getTime() >= monthAgo).length;
  const mostPlayed = [...games].sort((a, b) => getTotalPlaySeconds(b, now) - getTotalPlaySeconds(a, now))[0];
  const incomplete = games.filter((game) => completeness(game) < 100).length;
  const ranking = [...games].sort((a, b) => getTotalPlaySeconds(b, now) - getTotalPlaySeconds(a, now));
  const topSeconds = Math.max(1, getTotalPlaySeconds(ranking[0] || ({} as Game), now));
  return { totalSeconds, recent7, recent30, mostPlayed, incomplete, ranking, topSeconds };
}

function App() {
  const [games, setGames] = useState<Game[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<GameStatus | "全部">("全部");
  const [viewMode, setViewMode] = useState<"library" | "collection" | "stats">("library");
  const [isEditing, setIsEditing] = useState(false);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(() => loadThemeSettings());
  const [draft, setDraft] = useState<Game | null>(null);
  const [notice, setNotice] = useState("");
  const [imageCache, setImageCache] = useState<Record<string, string>>({});
  const [coverCandidates, setCoverCandidates] = useState<CoverCandidate[]>([]);
  const [isCoverPickerOpen, setIsCoverPickerOpen] = useState(false);
  const [coverPickerGameId, setCoverPickerGameId] = useState("");
  const [isFindingCovers, setIsFindingCovers] = useState(false);
  const [metadataCandidates, setMetadataCandidates] = useState<MetadataCandidate[]>([]);
  const [candidateGameId, setCandidateGameId] = useState("");
  const [isCandidatePickerOpen, setIsCandidatePickerOpen] = useState(false);
  const [isSearchingMetadata, setIsSearchingMetadata] = useState(false);
  const [metadataKeyword, setMetadataKeyword] = useState("");
  const [clockTick, setClockTick] = useState(Date.now());
  const shelfRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.galLauncher.loadLibrary().then((loaded) => {
      setGames(loaded);
      setSelectedId(loaded[0]?.id ?? "");
    });
  }, []);

  useEffect(() => {
    if (games.length > 0) window.galLauncher.saveLibrary(games);
  }, [games]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem("gal-launcher-theme", JSON.stringify(themeSettings));
  }, [themeSettings]);

  useEffect(() => {
    return window.galLauncher.onPlaySessionEnded((event: PlaySessionEndedEvent) => {
      setGames((current) =>
        current.map((game) => {
          if (game.id !== event.gameId) return game;
          if (game.currentSessionId && game.currentSessionId !== event.sessionId) return game;
          return {
            ...game,
            totalPlaySeconds: (game.totalPlaySeconds ?? 0) + event.durationSeconds,
            currentSessionId: null,
            currentSessionStartedAt: null,
            lastPlayedAt: event.endedAt,
            updatedAt: nowIso()
          };
        })
      );
      setNotice(`本次游玩 ${formatPlayTime(event.durationSeconds)}，已计入总时长`);
    });
  }, []);

  useEffect(() => {
    const paths = Array.from(
      new Set([...games.flatMap((game) => [game.coverPath, game.backgroundPath]), ...coverCandidates.map((candidate) => candidate.path)].filter(Boolean))
    );
    const remote = paths.filter((imagePath) => /^https?:\/\//i.test(imagePath) && imageCache[imagePath] !== imagePath);
    if (remote.length > 0) {
      setImageCache((current) => {
        const next = { ...current };
        for (const imagePath of remote) next[imagePath] = imagePath;
        return next;
      });
    }

    const missing = paths.filter((imagePath) => !/^https?:\/\//i.test(imagePath) && !imageCache[imagePath]);
    if (missing.length === 0) return;

    let cancelled = false;
    Promise.all(
      missing.map(async (imagePath) => {
        try {
          return [imagePath, await window.galLauncher.readImageDataUrl(imagePath)] as const;
        } catch {
          return [imagePath, ""] as const;
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setImageCache((current) => {
        const next = { ...current };
        for (const [imagePath, dataUrl] of entries) next[imagePath] = dataUrl;
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [games, coverCandidates, imageCache]);

  const selected = games.find((game) => game.id === selectedId) ?? games[0] ?? null;
  const selectedImage = selected ? imageCache[selected.backgroundPath] || imageCache[selected.coverPath] : "";
  const usesCoverFallback = selected ? !selected.backgroundPath || selected.backgroundPath === selected.coverPath : false;

  useEffect(() => {
    if (!selected || selected.bgmRatingCheckedAt) return;
    let cancelled = false;
    window.galLauncher.lookupBangumiRating(selected).then((rating) => {
      if (cancelled) return;
      setGames((current) =>
        current.map((game) =>
          game.id === selected.id
            ? { ...game, ...rating, updatedAt: nowIso() }
            : game
        )
      );
    }).catch(() => {
      if (cancelled) return;
      setGames((current) =>
        current.map((game) =>
          game.id === selected.id
            ? { ...game, bgmScore: 0, bgmScoreCount: 0, bgmRank: 0, bgmId: 0, bgmRatingCheckedAt: nowIso(), updatedAt: nowIso() }
            : game
        )
      );
    });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const filteredGames = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return games
      .filter((game) => statusFilter === "全部" || game.status === statusFilter)
      .filter((game) => {
        if (!needle) return true;
        return [game.title, game.originalTitle, game.developer, ...game.tags].some((value) => value.toLowerCase().includes(needle));
      });
  }, [games, query, statusFilter]);

  const collectionGames = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return games
      .filter((game) => {
        if (!needle) return true;
        return [game.title, game.originalTitle, game.developer, ...game.tags].some((value) => value.toLowerCase().includes(needle));
      })
      .sort((a, b) => {
        const left = a.lastPlayedAt ? new Date(a.lastPlayedAt).getTime() : 0;
        const right = b.lastPlayedAt ? new Date(b.lastPlayedAt).getTime() : 0;
        return right - left || a.title.localeCompare(b.title);
      });
  }, [games, query]);

  const remoteImagePaths = useMemo(
    () =>
      Array.from(new Set(games.flatMap((game) => [game.backgroundPath, game.coverPath]).filter((imagePath) => /^https?:\/\//i.test(imagePath)))),
    [games]
  );

  useEffect(() => {
    const preloaders = remoteImagePaths.map((imagePath) => {
      const image = new Image();
      image.decoding = "async";
      image.src = imagePath;
      return image;
    });

    return () => {
      for (const image of preloaders) {
        image.onload = null;
        image.onerror = null;
      }
    };
  }, [remoteImagePaths]);

  function persistGame(next: Game) {
    setGames((current) => current.map((game) => (game.id === next.id ? { ...next, updatedAt: nowIso() } : game)));
  }

  function mergeMetadata(game: Game, metadata: Partial<PickedLaunchFile>) {
    return {
      ...game,
      title: metadata.title || game.title,
      originalTitle: metadata.originalTitle || game.originalTitle,
      description: metadata.description || game.description,
      developer: metadata.developer || game.developer,
      releaseDate: metadata.releaseDate || game.releaseDate,
      coverPath: game.coverPath || metadata.coverPath || "",
      backgroundPath: game.backgroundPath || metadata.backgroundPath || metadata.coverPath || game.coverPath,
      tags: metadata.tags?.length ? metadata.tags : game.tags
    };
  }

  async function openMetadataCandidates(game: Game, keyword = "") {
    setIsSearchingMetadata(true);
    setMetadataCandidates([]);
    setCandidateGameId(game.id);
    setMetadataKeyword(keyword);
    setNotice("正在搜索资料候选");
    try {
      const candidates = await window.galLauncher.searchMetadataCandidates(game, keyword);
      setMetadataCandidates(candidates);
      setIsCandidatePickerOpen(true);
      setNotice(candidates.length ? "" : "没有找到可靠的资料候选");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "搜索资料失败");
    } finally {
      setIsSearchingMetadata(false);
    }
  }

  async function applyMetadataCandidate(candidate: MetadataCandidate) {
    const game = games.find((item) => item.id === candidateGameId);
    if (!game) return;
    setNotice("正在应用资料");
    try {
      const metadata = await window.galLauncher.applyMetadataCandidate(game, candidate);
      persistGame(mergeMetadata(game, metadata));
      setIsCandidatePickerOpen(false);
      setNotice(`已应用资料：${candidate.title}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "应用资料失败");
    }
  }

  async function addGame() {
    try {
      const picked = await window.galLauncher.pickLaunchFile();
      if (!picked) return;
      const next = makeGame(picked);
      setGames((current) => [next, ...current]);
      setSelectedId(next.id);
      setViewMode("library");
      setNotice("已添加，正在搜索候选资料");
      window.setTimeout(() => {
        openMetadataCandidates(next).catch((error) => {
          setNotice(error instanceof Error ? error.message : "搜索资料失败，游戏已添加");
        });
      }, 0);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "添加游戏失败");
    }
  }

  async function launch(game: Game) {
    try {
      const result = await window.galLauncher.launchGame(game);
      const startedAt = result.startedAt ?? nowIso();
      setGames((current) =>
        current.map((item) =>
          item.id === game.id
            ? {
                ...item,
                playCount: item.playCount + 1,
                currentSessionId: result.sessionId ?? null,
                currentSessionStartedAt: result.sessionId ? startedAt : null,
                lastPlayedAt: startedAt,
                status: item.status === statuses[1] ? statuses[2] : item.status,
                updatedAt: nowIso()
              }
            : item
        )
      );
      setNotice(result.sessionId ? "游戏已启动，正在记录游玩时长" : "游戏已启动");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "启动失败");
    }
  }

  async function rescanMetadata(game: Game) {
    try {
      const metadata = await window.galLauncher.rescanMetadata(game);
      const next = mergeMetadata(game, metadata);
      persistGame(next);
      await openMetadataCandidates(next);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "自动识别失败");
    }
  }

  async function exportBackup() {
    try {
      const filePath = await window.galLauncher.exportLibrary(games);
      if (filePath) setNotice("备份已导出");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "导出失败");
    }
  }

  async function importBackup() {
    try {
      const imported = await window.galLauncher.importLibrary();
      if (!imported) return;
      setGames(imported);
      setSelectedId(imported[0]?.id ?? "");
      setNotice("备份已恢复");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "恢复失败");
    }
  }

  async function findCovers(game: Game) {
    setIsFindingCovers(true);
    setCoverCandidates([]);
    setNotice("正在查找横版封面候选");
    try {
      const candidates = await window.galLauncher.findCoverCandidates(game);
      setCoverCandidates(candidates);
      setCoverPickerGameId(game.id);
      setIsCoverPickerOpen(true);
      setNotice(candidates.length ? "" : "没有找到可信横版候选图");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "查找横版封面失败");
    } finally {
      setIsFindingCovers(false);
    }
  }

  function chooseCover(candidate: CoverCandidate) {
    setGames((current) =>
      current.map((game) =>
        game.id === coverPickerGameId
          ? { ...game, backgroundPath: candidate.path, updatedAt: nowIso() }
          : game
      )
    );
    setIsCoverPickerOpen(false);
    setNotice("");
  }

  function deleteGame(game: Game) {
    if (!confirm(`从启动器中移除「${game.title}」？不会删除硬盘上的游戏文件。`)) return;
    setGames((current) => {
      const next = current.filter((item) => item.id !== game.id);
      if (selectedId === game.id) setSelectedId(next[0]?.id ?? "");
      window.galLauncher.saveLibrary(next);
      return next;
    });
    setNotice("已从游戏库移除");
  }

  function startEdit(game: Game) {
    setDraft({ ...game, tags: [...game.tags] });
    setIsEditing(true);
  }

  function closeEdit() {
    setDraft(null);
    setIsEditing(false);
  }

  function saveDraft() {
    if (!draft) return;
    persistGame(draft);
    closeEdit();
    setNotice("资料已保存");
  }

  async function chooseImage(field: "coverPath" | "backgroundPath") {
    const imagePath = await window.galLauncher.pickImage();
    if (!imagePath || !draft) return;
    setDraft({ ...draft, [field]: imagePath });
  }

  const counts = {
    total: games.length,
    active: games.filter((game) => game.status === "进行中").length,
    done: games.filter((game) => game.status === "已通关").length
  };
  const libraryStats = useMemo(() => {
    return buildLibraryStats(games, clockTick);
  }, [games, clockTick]);
  const themeStyle = {
    "--glass-alpha": themeSettings.glassAlpha,
    "--glass-blur": `${themeSettings.blur}px`,
    "--card-scale": themeSettings.cardScale,
    "--accent-color": themeSettings.accent,
    "--overlay-left": themeSettings.overlayLeft,
    "--overlay-right": themeSettings.overlayRight,
    "--overlay-bottom": themeSettings.overlayBottom,
    "--theme-glow-a": themeSettings.glowA,
    "--theme-glow-b": themeSettings.glowB
  } as React.CSSProperties;

  return (
    <div className={`app-shell ${usesCoverFallback ? "cover-fallback-mode" : "keyvisual-mode"} ${isInfoOpen ? "info-open" : ""}`} style={themeStyle}>
      <div className="image-preload" aria-hidden="true">
        {remoteImagePaths.map((imagePath) => (
          <img key={imagePath} src={imagePath} alt="" />
        ))}
      </div>
      <div className="backdrop" style={{ backgroundImage: selectedImage ? `url("${selectedImage}")` : undefined }} />
      <div className="backdrop-mask" />

      <aside className="rail">
        <div className="rail-logo">
          <Gamepad2 size={24} />
        </div>
        <button className={viewMode === "library" && statusFilter === "全部" ? "rail-button active" : "rail-button"} title="全部游戏" onClick={() => { setViewMode("library"); setStatusFilter("全部"); }}>
          <Home size={20} />
        </button>
        <button className={viewMode === "collection" ? "rail-button active" : "rail-button"} title="收藏展示柜" onClick={() => { setViewMode("collection"); setStatusFilter("全部"); }}>
          <Library size={20} />
        </button>
        <button className={viewMode === "stats" ? "rail-button active" : "rail-button"} title="游玩统计" onClick={() => setViewMode("stats")}>
          <BarChart3 size={20} />
        </button>
        <button className={viewMode === "library" && statusFilter === "进行中" ? "rail-button active" : "rail-button"} title="进行中" onClick={() => { setViewMode("library"); setStatusFilter("进行中"); }}>
          <Clock3 size={20} />
        </button>
        <button className="rail-button" title="导出备份" onClick={exportBackup}>
          <Download size={19} />
        </button>
        <button className="rail-button" title="恢复备份" onClick={importBackup}>
          <Upload size={19} />
        </button>
        <button className="rail-button" title="主题设置" onClick={() => setIsThemeOpen(true)}>
          <SlidersHorizontal size={19} />
        </button>
        <button className="rail-button add" title="添加游戏" onClick={addGame}>
          <Plus size={20} />
        </button>
      </aside>

      <main className={`stage ${viewMode !== "library" ? "stats-stage" : ""}`}>
        <header className="stage-top">
          <div className="search-pill">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、会社、标签" />
          </div>
          <div className="stage-stats">
            <span>{counts.total} 部作品</span>
            <span>进行中 {counts.active}</span>
            <span>已通关 {counts.done}</span>
          </div>
        </header>

        {viewMode === "collection" ? (
          <section className="collection-view">
            <div className="collection-toolbar">
              <div className="collection-toolbar-left">
                <button className="collection-filter">所有游戏 <span>({collectionGames.length})</span></button>
                <span className="collection-chevron">⌄</span>
                <span className="collection-sort-label">排序方式:</span>
                <button className="collection-sort">最近游玩 <span>⌄</span></button>
              </div>
              <button className="collection-top-button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>⌃</button>
            </div>
            <div className="collection-wall">
              {collectionGames.map((game, index) => {
                const posterImage = imageCache[game.coverPath] || imageCache[game.backgroundPath];
                return (
                  <button
                    key={game.id}
                    className="collection-poster-card"
                    onClick={() => {
                      setSelectedId(game.id);
                      setStatusFilter("全部");
                      setViewMode("library");
                      setIsInfoOpen(false);
                    }}
                  >
                    <div className="collection-poster-art">
                      {posterImage ? <img src={posterImage} alt="" /> : <Gamepad2 size={24} />}
                      {game.playCount > 0 && <span className="collection-badge">{Math.min(game.playCount, 99)}</span>}
                    </div>
                    <div className="collection-poster-title">
                      <strong>{game.title}</strong>
                      <span>{game.developer || game.status}</span>
                    </div>
                  </button>
                );
              })}
              {collectionGames.length === 0 && (
                <div className="collection-empty">
                  <Library size={36} />
                  <strong>暂无匹配作品</strong>
                  <span>换个关键词再看看收藏柜。</span>
                </div>
              )}
            </div>
          </section>
        ) : viewMode === "stats" ? (
          <section className="stats-view">
            <div className="stats-summary">
              <div className="stats-hero">
                <p>游玩统计</p>
                <h1>{formatPlayTime(libraryStats.totalSeconds)}</h1>
                <span>{counts.total} 部作品 · {libraryStats.incomplete} 部资料待补全</span>
              </div>
              <div className="stats-grid">
                <div><span>最近 7 天启动</span><strong>{libraryStats.recent7} 部</strong></div>
                <div><span>最近 30 天启动</span><strong>{libraryStats.recent30} 部</strong></div>
                <div><span>进行中</span><strong>{counts.active} 部</strong></div>
                <div><span>已通关</span><strong>{counts.done} 部</strong></div>
              </div>
            </div>
            <div className="top-podium">
              {libraryStats.ranking.slice(0, 3).map((game, index) => (
                <button key={game.id} className={`podium-card rank-${index + 1}`} onClick={() => { setSelectedId(game.id); setViewMode("library"); }}>
                  <span>#{index + 1}</span>
                  <strong>{game.title}</strong>
                  <small>{formatPlayTime(getTotalPlaySeconds(game, clockTick))}</small>
                </button>
              ))}
            </div>
            <div className="stats-list">
              <div className="stats-list-head">
                <span>游玩时长排行</span>
                <strong>{libraryStats.mostPlayed?.title || "暂无记录"}</strong>
              </div>
              {libraryStats.ranking.slice(0, 10).map((game, index) => {
                const seconds = getTotalPlaySeconds(game, clockTick);
                const percent = Math.max(3, Math.round((seconds / libraryStats.topSeconds) * 100));
                return (
                  <button key={game.id} className="rank-row" onClick={() => { setSelectedId(game.id); setViewMode("library"); }}>
                    <span className="rank-number">{String(index + 1).padStart(2, "0")}</span>
                    <span className="rank-title">{game.title}</span>
                    <span className="rank-bar"><i style={{ width: `${percent}%` }} /></span>
                    <strong>{formatPlayTime(seconds)}</strong>
                  </button>
                );
              })}
            </div>
          </section>
        ) : selected ? (
          <section className="feature">
            <div className="showcase-art">
              {selectedImage ? <img className="hero-visual" src={selectedImage} alt="" /> : <Gamepad2 size={72} />}
              <div className="showcase-glow" />
              <div className="showcase-overlay">
                <p>{selected.developer || "Visual Novel"}</p>
                <h1>{selected.title}</h1>
                <span>{selected.originalTitle || selected.releaseDate || "本地游戏"}</span>
              </div>
              <button className="floating-play" onClick={() => launch(selected)}>
                <Play size={22} fill="currentColor" />
                启动
              </button>
              <button className="floating-info" onClick={() => setIsInfoOpen(true)}>
                资料
              </button>
            </div>
          </section>
        ) : (
          <section className="empty-hero">
            <Library size={40} />
            <h1>把第一部作品放进来</h1>
            <button className="play-button" onClick={addGame}>
              <Plus size={20} />
              添加游戏
            </button>
          </section>
        )}

        {viewMode === "library" && <section className="shelf">
          <div className="shelf-title">
            <span className="accent-dot" />
            <h2>{statusFilter === "全部" ? "Galgame" : statusFilter}</h2>
            <span>{filteredGames.length} 部</span>
          </div>

          <div
            className="cover-row"
            ref={shelfRef}
            onWheel={(event) => {
              const element = shelfRef.current;
              if (!element) return;
              element.scrollLeft += event.deltaY || event.deltaX;
            }}
          >
            {filteredGames.map((game) => (
              <button key={game.id} className={`shelf-card ${game.id === selected?.id ? "active" : ""}`} onClick={() => setSelectedId(game.id)}>
                <div className="shelf-cover">
                  {imageCache[game.coverPath] ? <img src={imageCache[game.coverPath]} alt="" /> : <Gamepad2 size={30} />}
                  <span>{game.title}</span>
                </div>
              </button>
            ))}
          </div>
        </section>}
      </main>

      <aside className={`side-sheet ${isInfoOpen ? "open" : ""}`}>
        {selected && (
          <>
            <button className="sheet-close" onClick={() => setIsInfoOpen(false)}>
              <X size={18} />
            </button>
            <p className="sheet-kicker">{selected.developer || "Visual Novel"}</p>
            <h1>{selected.title}</h1>
            <p className="sheet-original">{selected.originalTitle || selected.releaseDate || "本地游戏"}</p>
            <div className="feature-tags">
              <span className={`status-pill ${statusMeta[selected.status].tone}`}>{selected.status}</span>
              {selected.currentSessionStartedAt && <span className="playing-pill">正在游玩</span>}
              {selected.releaseDate && <span>{selected.releaseDate}</span>}
            </div>
            <div className="sheet-actions">
              <button className="soft-button" onClick={() => openMetadataCandidates(selected, metadataKeyword)} disabled={isSearchingMetadata}>
                <RefreshCw size={18} />
                {isSearchingMetadata ? "搜索中" : "重搜资料"}
              </button>
              <button className="soft-button" onClick={() => findCovers(selected)} disabled={isFindingCovers}>
                <ImagePlus size={18} />
                {isFindingCovers ? "查找中" : "找横版图"}
              </button>
              <button className="soft-button" onClick={() => startEdit(selected)}>
                <Edit3 size={18} />
                编辑
              </button>
              <button className="soft-button danger" onClick={() => deleteGame(selected)}>
                <Trash2 size={18} />
                删除
              </button>
            </div>
            <div className="completeness-card">
              <div className="completeness-head">
                <ShieldCheck size={16} />
                <span>资料完整度</span>
                <strong>{completeness(selected)}%</strong>
              </div>
              <div className="completeness-list">
                {metadataChecks(selected).map((item) => (
                  <span key={item.label} className={item.ok ? "ok" : "missing"}>{item.label}</span>
                ))}
              </div>
            </div>
            <div className="sheet-stats">
              <div>
                <span>最近游玩</span>
                <strong>{formatDate(selected.lastPlayedAt)}</strong>
              </div>
              <div>
                <span>启动次数</span>
                <strong>{selected.playCount}</strong>
              </div>
              <div>
                <span>游玩时长</span>
                <strong>{formatPlayTime(getTotalPlaySeconds(selected, clockTick))}</strong>
              </div>
              <div>
                <span>Bangumi评分</span>
                <strong>{formatBgmRating(selected)}</strong>
              </div>
            </div>
            <div className="sheet-heading">
              <Tags size={16} />
              资料
            </div>
            <p className="sheet-description">{selected.description || "暂无简介"}</p>
            <div className="sheet-path">
              <FolderOpen size={15} />
              <span>{selected.executablePath}</span>
            </div>
          </>
        )}
      </aside>

      {isEditing && draft && (
        <div className="modal-backdrop">
          <section className="modal">
            <div className="modal-header">
              <h2>编辑资料</h2>
              <button className="icon-button" onClick={closeEdit}>
                <X size={18} />
              </button>
            </div>

            <div className="form-grid">
              <label>
                标题
                <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
              </label>
              <label>
                原名
                <input value={draft.originalTitle} onChange={(event) => setDraft({ ...draft, originalTitle: event.target.value })} />
              </label>
              <label>
                会社
                <input value={draft.developer} onChange={(event) => setDraft({ ...draft, developer: event.target.value })} />
              </label>
              <label>
                发售日期
                <input value={draft.releaseDate} onChange={(event) => setDraft({ ...draft, releaseDate: event.target.value })} placeholder="YYYY-MM-DD" />
              </label>
              <label>
                状态
                <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as GameStatus })}>
                  {statuses.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </label>
              <label className="full">
                标签
                <input value={draft.tags.join(", ")} onChange={(event) => setDraft({ ...draft, tags: normalizeTags(event.target.value) })} placeholder="纯爱, 悬疑, 汉化" />
              </label>
              <label className="full">
                简介
                <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
              </label>
              <label className="full">
                启动文件
                <input value={draft.executablePath} onChange={(event) => setDraft({ ...draft, executablePath: event.target.value })} />
              </label>
              <label className="full">
                工作目录
                <input value={draft.workingDirectory} onChange={(event) => setDraft({ ...draft, workingDirectory: event.target.value })} />
              </label>
            </div>

            <div className="asset-row">
              <button onClick={() => chooseImage("coverPath")}>
                <ImagePlus size={18} />
                选择封面
              </button>
              <button onClick={() => chooseImage("backgroundPath")}>
                <ImagePlus size={18} />
                选择背景图
              </button>
            </div>

            <div className="modal-actions">
              <button className="soft-button" onClick={closeEdit}>取消</button>
              <button className="play-button" onClick={saveDraft}>保存</button>
            </div>
          </section>
        </div>
      )}

      {isCoverPickerOpen && (
        <div className="modal-backdrop">
          <section className="modal cover-picker">
            <div className="modal-header">
              <h2>选择横版封面</h2>
              <button className="icon-button" onClick={() => setIsCoverPickerOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="candidate-grid">
              {coverCandidates.map((candidate) => (
                <button key={candidate.id} className="candidate-card" onClick={() => chooseCover(candidate)}>
                  <div className="candidate-image">
                    {imageCache[candidate.path] ? <img src={imageCache[candidate.path]} alt="" /> : <Gamepad2 size={30} />}
                  </div>
                  <strong>{candidate.source}</strong>
                  <span>{candidate.width} x {candidate.height}</span>
                  <small>{candidate.reason}</small>
                </button>
              ))}
              {coverCandidates.length === 0 && <p className="candidate-empty">没有找到符合横版比例的候选图。</p>}
            </div>
          </section>
        </div>
      )}

      {isCandidatePickerOpen && (
        <div className="modal-backdrop">
          <section className="modal metadata-picker">
            <div className="modal-header">
              <h2>确认作品资料</h2>
              <button className="icon-button" onClick={() => setIsCandidatePickerOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="metadata-search-row">
              <input value={metadataKeyword} onChange={(event) => setMetadataKeyword(event.target.value)} placeholder="输入标题重新搜索，例如 サクラノ刻 / WHITE ALBUM2" />
              <button className="soft-button" onClick={() => {
                const game = games.find((item) => item.id === candidateGameId);
                if (game) openMetadataCandidates(game, metadataKeyword);
              }}>
                <Search size={18} />
                搜索
              </button>
            </div>
            <div className="metadata-candidate-list">
              {metadataCandidates.map((candidate) => (
                <button key={`${candidate.source}-${candidate.sourceId}`} className="metadata-candidate" onClick={() => applyMetadataCandidate(candidate)}>
                  <div className="metadata-cover">
                    {candidate.coverUrl ? <img src={candidate.coverUrl} alt="" /> : <Gamepad2 size={30} />}
                  </div>
                  <div>
                    <strong>{candidate.title}</strong>
                    <span>{candidate.originalTitle || candidate.releaseDate || candidate.sourceId}</span>
                    <small>{candidate.developer || "未知会社"} · 匹配度 {Math.round(candidate.confidence * 100)}%</small>
                    <p>{candidate.descriptionPreview || "暂无简介预览"}</p>
                  </div>
                </button>
              ))}
              {metadataCandidates.length === 0 && <p className="candidate-empty">没有找到候选。可以换日文原名、英文名或会社名再搜。</p>}
            </div>
          </section>
        </div>
      )}

      {isThemeOpen && (
        <div className="modal-backdrop">
          <section className="modal theme-modal">
            <div className="modal-header">
              <h2>主题设置</h2>
              <button className="icon-button" onClick={() => setIsThemeOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="theme-presets">
              {themePresets.map((preset) => (
                <button
                  key={preset.id}
                  className={`theme-card ${themeSettings.id === preset.id ? "active" : ""}`}
                  onClick={() => setThemeSettings(preset)}
                >
                  <span className="theme-preview" style={{
                    "--preview-accent": preset.accent,
                    "--preview-glow-a": preset.glowA,
                    "--preview-glow-b": preset.glowB
                  } as React.CSSProperties}>
                    <i />
                    <b />
                  </span>
                  <strong>{preset.name}</strong>
                  <small>{preset.description}</small>
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="soft-button" onClick={() => setThemeSettings(defaultTheme)}>恢复默认</button>
              <button className="play-button" onClick={() => setIsThemeOpen(false)}>完成</button>
            </div>
          </section>
        </div>
      )}

      {notice && (
        <button className="toast" onClick={() => setNotice("")}>
          {notice}
        </button>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
