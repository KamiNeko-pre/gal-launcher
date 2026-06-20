import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CoverCandidate,
  Game,
  GameStatus,
  MetadataCandidate,
  PickedLaunchFile,
  PlaySessionEndedEvent
} from "./types";
import type { ThemeDefinition } from "./theme";
import { loadThemeSettings } from "./theme";
import { statuses, nowIso, makeGame, formatPlayTime, getTotalPlaySeconds } from "./utils";

export function useLibrary() {
  const [games, setGames] = useState<Game[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<GameStatus | "全部">("全部");
  const [viewMode, setViewMode] = useState<"library" | "collection">("library");
  const [isEditing, setIsEditing] = useState(false);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeDefinition>(() => loadThemeSettings());
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
  const [prevImage, setPrevImage] = useState<string | null>(null);
  const [fadingImage, setFadingImage] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ game: Game; x: number; y: number } | null>(null);
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
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (isThemeOpen) { setIsThemeOpen(false); return; }
      if (isCoverPickerOpen) { setIsCoverPickerOpen(false); return; }
      if (isCandidatePickerOpen) { setIsCandidatePickerOpen(false); return; }
      if (isEditing) { closeEdit(); return; }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isThemeOpen, isCoverPickerOpen, isCandidatePickerOpen, isEditing]);

  useEffect(() => {
    localStorage.setItem("gal-launcher-theme", JSON.stringify({ id: theme.id }));
  }, [theme]);

  useEffect(() => {
    return window.galLauncher.onPlaySessionEnded((event: PlaySessionEndedEvent) => {
      setGames((current) =>
        current.map((game) => {
          if (game.id !== event.gameId) return game;
          if (game.currentSessionId && game.currentSessionId !== event.sessionId) return game;
          return {
            ...game,
            totalPlaySeconds: event.totalPlaySeconds ?? game.totalPlaySeconds ?? 0,
            sessions: event.sessions ?? game.sessions,
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

  useEffect(() => {
    if (selectedImage && selectedImage !== prevImage && prevImage !== null) {
      setFadingImage(prevImage);
      const timer = setTimeout(() => setFadingImage(null), 500);
      return () => clearTimeout(timer);
    }
    setPrevImage(selectedImage);
  }, [selectedImage]);
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
      .filter((game) => !tagFilter || game.tags.includes(tagFilter))
      .filter((game) => {
        if (!needle) return true;
        return [game.title, game.originalTitle, game.developer, ...game.tags].some((value) => value.toLowerCase().includes(needle));
      });
  }, [games, query, statusFilter, tagFilter]);

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
    const newDescription = metadata.description || "";
    const cjk = /[\u3400-\u9fff]/;
    const oldHasCjk = cjk.test(game.description || "");
    const newHasCjk = cjk.test(newDescription);
    const description = newHasCjk || !newDescription ? newDescription || game.description : (oldHasCjk ? game.description : newDescription);
    return {
      ...game,
      title: metadata.title || game.title,
      originalTitle: metadata.originalTitle || game.originalTitle,
      description,
      developer: metadata.developer || game.developer,
      releaseDate: metadata.releaseDate || game.releaseDate,
      coverPath: game.coverPath || metadata.coverPath || "",
      backgroundPath: game.backgroundPath || metadata.backgroundPath || metadata.coverPath || game.coverPath,
      tags: metadata.tags?.length ? metadata.tags : game.tags,
      bgmRatingCheckedAt: undefined,
      bgmScore: 0,
      bgmScoreCount: 0,
      bgmRank: 0,
      bgmId: 0
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

  function openContextMenu(e: React.MouseEvent, game: Game) {
    e.preventDefault();
    setCtxMenu({ game, x: e.clientX, y: e.clientY });
  }

  function closeContextMenu() {
    setCtxMenu(null);
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
  const totalSeconds = useMemo(() => {
    return games.reduce((sum, game) => sum + getTotalPlaySeconds(game, clockTick), 0);
  }, [games, clockTick]);
  const recentGames = useMemo(() => {
    return games
      .filter((g) => g.lastPlayedAt)
      .sort((a, b) => new Date(b.lastPlayedAt!).getTime() - new Date(a.lastPlayedAt!).getTime())
      .slice(0, 3);
  }, [games]);
  const popularTags = useMemo(() => {
    const freq: Record<string, number> = {};
    for (const g of games) {
      for (const t of g.tags) {
        if (t) freq[t] = (freq[t] || 0) + 1;
      }
    }
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag]) => tag);
  }, [games]);

  return {
    games,
    selectedId, setSelectedId,
    query, setQuery,
    statusFilter, setStatusFilter,
    viewMode, setViewMode,
    isEditing,
    isInfoOpen, setIsInfoOpen,
    isThemeOpen, setIsThemeOpen,
    theme, setTheme,
    draft, setDraft,
    notice, setNotice,
    imageCache,
    coverCandidates,
    isCoverPickerOpen, setIsCoverPickerOpen,
    isFindingCovers,
    metadataCandidates,
    candidateGameId,
    isCandidatePickerOpen, setIsCandidatePickerOpen,
    isSearchingMetadata,
    metadataKeyword, setMetadataKeyword,
    clockTick,
    fadingImage,
    tagFilter, setTagFilter,
    ctxMenu,
    shelfRef,
    selected,
    selectedImage,
    usesCoverFallback,
    filteredGames,
    collectionGames,
    remoteImagePaths,
    counts,
    totalSeconds,
    recentGames,
    popularTags,
    persistGame,
    openMetadataCandidates,
    applyMetadataCandidate,
    addGame,
    launch,
    rescanMetadata,
    exportBackup,
    importBackup,
    findCovers,
    chooseCover,
    deleteGame,
    startEdit,
    closeEdit,
    openContextMenu,
    closeContextMenu,
    saveDraft,
    chooseImage
  };
}

export type LibraryController = ReturnType<typeof useLibrary>;
