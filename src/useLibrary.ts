import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CoverCandidate,
  Game,
  GameStatus,
  MetadataCandidate,
  PickedLaunchFile,
  PlaySessionEndedEvent,
  Bookshelf,
  LaunchCandidate,
  IntegrationSettings,
  EnhancementToolId,
  EnhancementToolProgress,
  EnhancementToolStatus,
  LaunchScanProgress,
  BulkMetadataEnrichmentResult,
  MagpiePresetId
} from "./types";
import type { ThemeDefinition } from "./theme";
import { loadThemeSettings } from "./theme";
import { statuses, nowIso, makeGame, formatPlayTime, getTotalPlaySeconds } from "./utils";
import { selectDisplayImage } from "./images/imageSelection";
import { resolveImageSource } from "./images/imageSource";

export type CollectionSort = "lastPlayed" | "title" | "added" | "playTime" | "releaseDate" | "rating";
export type CollectionSortDirection = "asc" | "desc";
export type BulkEnrichmentStatus = {
  active: boolean;
  total: number;
  completed: number;
  failed: number;
  review: number;
  unmatched: number;
  pending: number;
  cancelled: boolean;
};

function shouldLookupBangumiRating(game: Game, now = Date.now()) {
  const nextRetryAt = Date.parse(game.bgmRatingNextRetryAt || "");
  if (Number.isFinite(nextRetryAt) && nextRetryAt > now) return false;
  if (game.bgmRatingStatus === "success") return false;
  if (game.bgmRatingStatus === "no_match" && game.bgmRatingCheckedAt && (!Number.isFinite(nextRetryAt) || nextRetryAt > now)) return false;
  // Keep successful records created before the status field was introduced.
  if (!game.bgmRatingStatus && (game.bgmId ?? 0) > 0 && (game.bgmScoreCount ?? 0) > 0 && game.bgmRatingCheckedAt) return false;
  return true;
}

export function isCurrentSearchRequest(
  requestId: number,
  latestRequestId: number,
  requestGameId: string,
  selectedGameId: string
) {
  return requestId === latestRequestId && requestGameId === selectedGameId;
}

export function isCurrentCoverSearchRequest(requestId: number, latestRequestId: number) {
  return requestId === latestRequestId;
}

export function formatIpcError(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : String(error || fallback);
  const withoutIpcPrefix = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "");
  return withoutIpcPrefix
    .replace(/([a-z][\w+.-]*:\/\/)(?:[^/\s@]+@)?([^/\s?#]+)([^\s?#]*)(?:\?[^\s#]*)?(?:#[^\s]*)?/gi, "$1$2$3")
    .replace(/\b((?:api[_-]?key|token|password|passwd|authorization|cookie)=)[^&\s,;]+/gi, "$1[已隐藏]")
    .replace(/\b(Bearer\s+)[^\s,;]+/gi, "$1[已隐藏]")
    || fallback;
}

function dateValue(value: string | null | undefined) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

const bookshelfTitleCollator = new Intl.Collator("zh-Hans-CN-u-co-pinyin", { numeric: true, sensitivity: "base" });
const pinyinInitialAnchors = [
  ["A", "阿"], ["B", "八"], ["C", "擦"], ["D", "大"], ["E", "额"], ["F", "发"],
  ["G", "嘎"], ["H", "哈"], ["J", "家"], ["K", "卡"], ["L", "拉"], ["M", "妈"],
  ["N", "那"], ["O", "欧"], ["P", "怕"], ["Q", "七"], ["R", "然"], ["S", "撒"],
  ["T", "他"], ["W", "哇"], ["X", "西"], ["Y", "亚"], ["Z", "杂"]
] as const;

function firstTitleCharacter(value: string) {
  return [...String(value || "").trim()].find((character) => /[\p{L}\p{N}]/u.test(character)) || "";
}

function launchPathKey(value: string) {
  return String(value || "")
    .replaceAll("/", "\\")
    .replace(/[\\]+$/, "")
    .toLocaleLowerCase();
}

export function titleInitial(value: string) {
  const first = firstTitleCharacter(value);
  if (!first) return "#";
  if (/\d/u.test(first)) return "0-9";
  if (/^[A-Za-z]$/u.test(first)) return first.toUpperCase();
  if (/^[\u3400-\u9fff]$/u.test(first)) {
    let current = "#";
    for (const [initial, anchor] of pinyinInitialAnchors) {
      if (bookshelfTitleCollator.compare(first, anchor) >= 0) current = initial;
      else break;
    }
    return current;
  }
  // Do not turn Japanese kana or other scripts into invented Latin initials.
  return "#";
}

function compareTitles(left: Game, right: Game) {
  return bookshelfTitleCollator.compare(left.title || "", right.title || "") || left.id.localeCompare(right.id);
}

export function compareCollectionGames(sort: CollectionSort, direction: CollectionSortDirection = sort === "title" ? "asc" : "desc") {
  return (left: Game, right: Game) => {
    if (sort === "title") return (direction === "asc" ? 1 : -1) * compareTitles(left, right);
    const leftValue = sort === "lastPlayed" ? dateValue(left.lastPlayedAt)
      : sort === "added" ? dateValue(left.createdAt)
        : sort === "releaseDate" ? dateValue(left.releaseDate)
          : sort === "playTime" ? Number(left.totalPlaySeconds || 0)
            : Number(left.rating || 0);
    const rightValue = sort === "lastPlayed" ? dateValue(right.lastPlayedAt)
      : sort === "added" ? dateValue(right.createdAt)
        : sort === "releaseDate" ? dateValue(right.releaseDate)
          : sort === "playTime" ? Number(right.totalPlaySeconds || 0)
            : Number(right.rating || 0);
    const leftMissing = leftValue === null || !Number.isFinite(leftValue);
    const rightMissing = rightValue === null || !Number.isFinite(rightValue);
    if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
    if (!leftMissing && !rightMissing && leftValue !== rightValue) {
      return (direction === "asc" ? 1 : -1) * (leftValue - rightValue);
    }
    return compareTitles(left, right);
  };
}

export function bindEnhancementPath(settings: IntegrationSettings, toolId: EnhancementToolId, executablePath: string): IntegrationSettings {
  return toolId === "magpie"
    ? { ...settings, magpiePath: executablePath }
    : { ...settings, localeEmulatorPath: executablePath };
}

export function enableMagpieForGame(game: Game, presetId: MagpiePresetId, updatedAt = nowIso()): Game {
  return { ...game, magpieEnabled: true, magpiePresetId: presetId, updatedAt };
}

export function useLibrary() {
  const [games, setGames] = useState<Game[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<GameStatus | "全部">("全部");
  const [viewMode, setViewModeState] = useState<"library" | "collection">("library");
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false);
  const [collectionBrowseIds, setCollectionBrowseIds] = useState<string[] | null>(null);
  const [bookshelves, setBookshelves] = useState<Bookshelf[]>([]);
  const [collectionScope, setCollectionScope] = useState<"all" | "unfiled" | "shelf">("all");
  const [collectionBookshelfId, setCollectionBookshelfId] = useState("");
  const [collectionSorts, setCollectionSorts] = useState<Record<string, CollectionSort>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("gal-launcher-collection-sorts") || "{}");
      return saved && typeof saved === "object" ? saved : {};
    } catch { return {}; }
  });
  const [collectionSortDirections, setCollectionSortDirections] = useState<Record<string, CollectionSortDirection>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("gal-launcher-collection-sort-directions") || "{}");
      return saved && typeof saved === "object" ? saved : {};
    } catch { return {}; }
  });
  const [bulkCandidates, setBulkCandidates] = useState<LaunchCandidate[]>([]);
  const [isScanningBulk, setIsScanningBulk] = useState(false);
  const [bulkScanProgress, setBulkScanProgress] = useState<LaunchScanProgress | null>(null);
  const [bulkEnrichment, setBulkEnrichment] = useState<BulkEnrichmentStatus | null>(null);
  const bulkEnrichmentRef = useRef<{ cancelled: boolean } | null>(null);
  const [isBulkMetadataReviewOpen, setIsBulkMetadataReviewOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeDefinition>(() => loadThemeSettings());
  const [draft, setDraft] = useState<Game | null>(null);
  const [notice, setNotice] = useState("");
  const [missingLaunchGame, setMissingLaunchGame] = useState<Game | null>(null);
  const [coverCandidates, setCoverCandidates] = useState<CoverCandidate[]>([]);
  const [isCoverPickerOpen, setIsCoverPickerOpen] = useState(false);
  const [coverPickerGameId, setCoverPickerGameId] = useState("");
  const [isFindingCovers, setIsFindingCovers] = useState(false);
  const [coverSearchStartedAt, setCoverSearchStartedAt] = useState<number | null>(null);
  const [coverSearchError, setCoverSearchError] = useState("");
  const [metadataCandidates, setMetadataCandidates] = useState<MetadataCandidate[]>([]);
  const [candidateGameId, setCandidateGameId] = useState("");
  const [isCandidatePickerOpen, setIsCandidatePickerOpen] = useState(false);
  const [isSearchingMetadata, setIsSearchingMetadata] = useState(false);
  const [metadataSearchStartedAt, setMetadataSearchStartedAt] = useState<number | null>(null);
  const [metadataSearchError, setMetadataSearchError] = useState("");
  const [isApplyingMetadata, setIsApplyingMetadata] = useState(false);
  const [metadataKeyword, setMetadataKeyword] = useState("");
  const [clockTick, setClockTick] = useState(Date.now());
  const [searchTick, setSearchTick] = useState(Date.now());
  const [prevImage, setPrevImage] = useState<string | null>(null);
  const [fadingImage, setFadingImage] = useState<string | null>(null);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [ctxMenu, setCtxMenu] = useState<{ game: Game; x: number; y: number } | null>(null);
  const hydratedRef = useRef(false);
  const selectedIdRef = useRef(selectedId);
  const metadataRequestRef = useRef(0);
  const coverRequestRef = useRef(0);
  selectedIdRef.current = selectedId;
  const [integrationSettings, setIntegrationSettings] = useState<IntegrationSettings>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("gal-launcher-integrations") || "{}");
      return saved;
    } catch { return {}; }
  });
  const [enhancementTools, setEnhancementTools] = useState<EnhancementToolStatus[]>([]);
  const [enhancementToolProgress, setEnhancementToolProgress] = useState<EnhancementToolProgress | null>(null);
  const [isInstallingEnhancementTool, setIsInstallingEnhancementTool] = useState(false);
  const shelfRef = useRef<HTMLDivElement | null>(null);
  const collectionSortKey = collectionScope === "shelf" ? collectionBookshelfId : collectionScope;
  const collectionSort: CollectionSort = collectionSorts[collectionSortKey] || "lastPlayed";
  const collectionSortDirection: CollectionSortDirection = collectionSortDirections[collectionSortKey] || (collectionSort === "title" ? "asc" : "desc");
  const setCollectionSort = (value: CollectionSort) => setCollectionSorts(current => ({ ...current, [collectionSortKey]: value }));
  const toggleCollectionSortDirection = () => setCollectionSortDirections(current => ({
    ...current,
    [collectionSortKey]: collectionSortDirection === "asc" ? "desc" : "asc"
  }));
  const tagFilter = tagFilters[0] || null;
  const setTagFilter = (value: string | null) => setTagFilters(value ? [value] : []);
  const toggleTagFilter = (value: string) => setTagFilters(current => current.includes(value)
    ? current.filter(tag => tag !== value)
    : [...current, value]);
  const setViewMode = (next: "library" | "collection") => {
    setIsCategoriesOpen(false);
    setCollectionBrowseIds(null);
    setViewModeState(next);
  };

  function selectCollectionScope(scope: "all" | "unfiled" | "shelf", bookshelfId = "") {
    setCollectionScope(scope);
    setCollectionBookshelfId(scope === "shelf" ? bookshelfId : "");
    setCollectionBrowseIds(null);
    setStatusFilter("全部");
    setTagFilters([]);
  }

  useEffect(() => {
    window.galLauncher.loadLibraryDocument().then((loaded) => {
      setGames(loaded.games);
      setBookshelves(loaded.bookshelves);
      try {
        const savedScope = JSON.parse(localStorage.getItem("gal-launcher-collection-scope") || "null");
        if (savedScope?.scope === "unfiled" && loaded.games.some(game => !game.bookshelfIds?.length)) setCollectionScope("unfiled");
        else if (savedScope?.scope === "shelf" && loaded.bookshelves.some(shelf => shelf.id === savedScope.bookshelfId)) {
          setCollectionScope("shelf");
          setCollectionBookshelfId(savedScope.bookshelfId);
        }
      } catch { /* invalid browsing state falls back to all games */ }
      setSelectedId(loaded.games[0]?.id ?? "");
      hydratedRef.current = true;
    });
  }, []);

  useEffect(() => {
    if (hydratedRef.current && collectionScope === "unfiled" && !games.some(game => !game.bookshelfIds?.length)) {
      setCollectionScope("all");
    }
  }, [games, collectionScope]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try { localStorage.setItem("gal-launcher-collection-scope", JSON.stringify({ scope: collectionScope, bookshelfId: collectionBookshelfId })); } catch { /* storage may be unavailable */ }
  }, [collectionScope, collectionBookshelfId]);

  useEffect(() => {
    if (candidateGameId && candidateGameId !== selectedId) {
      metadataRequestRef.current += 1;
      setIsSearchingMetadata(false);
      setMetadataSearchStartedAt(null);
      setIsCandidatePickerOpen(false);
    }
  }, [selectedId, candidateGameId, coverPickerGameId]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const timer = window.setTimeout(() => { void window.galLauncher.saveLibraryDocument({ version: 2, games, bookshelves }); }, 300);
    return () => window.clearTimeout(timer);
  }, [games, bookshelves]);

  useEffect(() => {
    try { localStorage.setItem("gal-launcher-collection-sorts", JSON.stringify(collectionSorts)); } catch { /* storage may be unavailable in a locked profile */ }
  }, [collectionSorts]);

  useEffect(() => {
    try { localStorage.setItem("gal-launcher-collection-sort-directions", JSON.stringify(collectionSortDirections)); } catch { /* storage may be unavailable in a locked profile */ }
  }, [collectionSortDirections]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isSearchingMetadata && !isFindingCovers) return;
    setSearchTick(Date.now());
    const timer = window.setInterval(() => setSearchTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isSearchingMetadata, isFindingCovers]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);


  useEffect(() => {
    localStorage.setItem("gal-launcher-theme", JSON.stringify({ id: theme.id }));
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("gal-launcher-integrations", JSON.stringify(integrationSettings));
  }, [integrationSettings]);

  useEffect(() => {
    void window.galLauncher.getEnhancementTools().then(setEnhancementTools).catch(() => setEnhancementTools([]));
    const removeListener = window.galLauncher.onEnhancementToolProgress?.((progress) => {
      setEnhancementToolProgress(progress);
    });
    return () => removeListener?.();
  }, []);

  useEffect(() => {
    const removeListener = window.galLauncher.onLaunchScanProgress?.((progress) => setBulkScanProgress(progress));
    return () => removeListener?.();
  }, []);

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

  const imageCache = useMemo<Record<string, string>>(() => {
    const paths = Array.from(
      new Set([...games.flatMap((game) => [game.coverPath, game.backgroundPath]), ...coverCandidates.map((candidate) => candidate.path)].filter(Boolean))
    );
    // Chromium streams and caches local files without a whole-library base64 IPC barrier.
    return Object.fromEntries(paths.map(imagePath => [imagePath, resolveImageSource(imagePath)]));
  }, [games, coverCandidates]);

  const selected = selectedId ? games.find((game) => game.id === selectedId) ?? null : null;
  const selectedImage = selected
    ? selectDisplayImage(imageCache, selected.backgroundPath, selected.coverPath)
    : "";

  function retryBangumiRating(game: Game) {
    const attemptedAt = nowIso();
    setGames((current) => current.map((item) => item.id === game.id
      ? { ...item, bgmRatingStatus: "stale", bgmRatingNextRetryAt: undefined, bgmRatingLastAttemptAt: attemptedAt, updatedAt: attemptedAt }
      : item));
  }

  async function openBangumi(game: Game) {
    try {
      await window.galLauncher.openBangumi(game);
    } catch {
      setNotice("无法打开 Bangumi，请检查网络后重试");
    }
  }

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
    const activeCard = document.querySelector<HTMLElement>(".shelf-card.active");
    activeCard?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [selectedId]);

  useEffect(() => {
    if (!selected || !shouldLookupBangumiRating(selected)) return;
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
      const attemptedAt = nowIso();
      const retryAt = new Date(Date.now() + 30_000).toISOString();
      setGames((current) =>
        current.map((game) =>
          game.id === selected.id
            ? {
                ...game,
                bgmRatingStatus: "network_error",
                bgmRatingLastAttemptAt: attemptedAt,
                bgmRatingNextRetryAt: retryAt,
                updatedAt: attemptedAt
              }
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
      .filter((game) => !collectionBrowseIds || collectionBrowseIds.includes(game.id))
      .filter((game) => collectionScope !== "shelf" || game.bookshelfIds?.includes(collectionBookshelfId))
      .filter((game) => collectionScope !== "unfiled" || !(game.bookshelfIds || []).length)
      .filter((game) => statusFilter === "全部" || game.status === statusFilter)
      .filter((game) => !tagFilters.length || tagFilters.some(tag => game.tags.includes(tag)))
      .filter((game) => {
        if (!needle) return true;
        return [game.title, game.originalTitle, game.developer, ...game.tags].some((value) => value.toLowerCase().includes(needle));
      });
  }, [games, query, statusFilter, tagFilters, collectionBrowseIds, collectionScope, collectionBookshelfId]);

  const collectionBaseGames = useMemo(() => games
    .filter((game) => collectionScope !== "shelf" || game.bookshelfIds?.includes(collectionBookshelfId))
    .filter((game) => collectionScope !== "unfiled" || !(game.bookshelfIds || []).length),
  [games, collectionScope, collectionBookshelfId]);

  const collectionGames = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const scoped = collectionBaseGames
      .filter((game) => statusFilter === "全部" || game.status === statusFilter)
      .filter((game) => !tagFilters.length || tagFilters.some(tag => game.tags.includes(tag)))
      .filter((game) => {
        if (!needle) return true;
        return [game.title, game.originalTitle, game.developer, ...game.tags].some((value) => value.toLowerCase().includes(needle));
      });
    return scoped.slice().sort(compareCollectionGames(collectionSort, collectionSortDirection));
  }, [collectionBaseGames, query, statusFilter, tagFilters, collectionSort, collectionSortDirection]);

  useEffect(() => {
    const visible = viewMode === "collection" ? collectionGames : filteredGames;
    if (!visible.length) {
      if (selectedId) setSelectedId("");
      return;
    }
    if (!visible.some((game) => game.id === selectedId)) setSelectedId(visible[0].id);
  }, [viewMode, collectionGames, filteredGames, selectedId]);

  function openCollectionGame(gameId: string) {
    if (!collectionGames.some((game) => game.id === gameId)) return;
    setCollectionBrowseIds(collectionGames.map((game) => game.id));
    setSelectedId(gameId);
    setIsCategoriesOpen(false);
    setViewModeState("library");
  }

  function clearCollectionFilters() {
    setQuery("");
    setStatusFilter("全部");
    setTagFilters([]);
  }

  function createBookshelf(name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("书架名称不能为空");
    if (bookshelves.some(shelf => shelf.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) throw new Error("已有同名书架");
    const shelf = { id: crypto.randomUUID(), name: trimmed, createdAt: nowIso() };
    setBookshelves(current => [...current, shelf]);
    return shelf;
  }

  function renameBookshelf(bookshelfId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("书架名称不能为空");
    if (bookshelves.some(shelf => shelf.id !== bookshelfId && shelf.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) {
      throw new Error("已有同名书架");
    }
    if (!bookshelves.some(shelf => shelf.id === bookshelfId)) throw new Error("找不到书架");
    setBookshelves(current => current.map(shelf => shelf.id === bookshelfId ? { ...shelf, name: trimmed } : shelf));
  }

  function moveBookshelf(bookshelfId: string, direction: -1 | 1) {
    setBookshelves(current => {
      const index = current.findIndex(shelf => shelf.id === bookshelfId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  function setGameBookshelves(gameIds: string[], bookshelfIds: string[]) {
    const allowed = new Set(bookshelves.map(shelf => shelf.id));
    const uniqueIds = Array.from(new Set(bookshelfIds.filter(id => allowed.has(id))));
    const targets = new Set(gameIds);
    setGames(current => current.map(game => targets.has(game.id) ? { ...game, bookshelfIds: uniqueIds, updatedAt: nowIso() } : game));
  }

  function addGamesToBookshelves(gameIds: string[], bookshelfIds: string[]) {
    const allowed = new Set(bookshelves.map(shelf => shelf.id));
    const additions = Array.from(new Set(bookshelfIds.filter(id => allowed.has(id))));
    if (!additions.length) return;
    const targets = new Set(gameIds);
    setGames(current => current.map(game => targets.has(game.id)
      ? { ...game, bookshelfIds: Array.from(new Set([...(game.bookshelfIds || []), ...additions])), updatedAt: nowIso() }
      : game));
  }

  function removeGamesFromBookshelf(gameIds: string[], bookshelfId: string) {
    if (!bookshelves.some(shelf => shelf.id === bookshelfId)) return;
    const targets = new Set(gameIds);
    setGames(current => current.map(game => targets.has(game.id)
      ? { ...game, bookshelfIds: (game.bookshelfIds || []).filter(id => id !== bookshelfId), updatedAt: nowIso() }
      : game));
  }

  function addTagsToGames(gameIds: string[], tags: string[]) {
    const additions = Array.from(new Set(tags.map(tag => tag.trim()).filter(Boolean)));
    if (!additions.length) return;
    const targets = new Set(gameIds);
    const updatedAt = nowIso();
    setGames(current => current.map(game => targets.has(game.id)
      ? { ...game, tags: Array.from(new Set([...(game.tags || []), ...additions])), updatedAt }
      : game));
  }

  function deleteBookshelf(bookshelfId: string) {
    setBookshelves(current => current.filter(shelf => shelf.id !== bookshelfId));
    setGames(current => current.map(game => ({ ...game, bookshelfIds: (game.bookshelfIds || []).filter(id => id !== bookshelfId) })));
    if (collectionBookshelfId === bookshelfId) { setCollectionBookshelfId(""); setCollectionScope("all"); }
  }

  async function scanBulkImport() {
    const root = await window.galLauncher.pickFolder();
    if (!root) return;
    setIsScanningBulk(true);
    setBulkScanProgress({ gameFolderCount: 0, scannedFiles: 0, candidateCount: 0, needsReviewCount: 0, skippedDirectories: 0, skippedLinks: 0, limitReached: false });
    setNotice("正在扫描所选根目录的第一层游戏文件夹，请稍候…");
    try {
      const result = await window.galLauncher.scanLaunchCandidates(root);
      const groups = new Map<string, LaunchCandidate[]>();
      for (const candidate of result.candidates) {
        const key = launchPathKey(candidate.installPath);
        groups.set(key, [...(groups.get(key) || []), candidate]);
      }
      const autoCandidates = [...groups.values()]
        .filter(group => group.length === 1 && !group[0].needsReview)
        .map(group => group[0]);
      const reviewCandidates = [...groups.values()]
        .filter(group => !(group.length === 1 && !group[0].needsReview))
        .flat();
      const targetBookshelves = collectionScope === "shelf" && bookshelves.some(shelf => shelf.id === collectionBookshelfId)
        ? [collectionBookshelfId]
        : [];
      if (autoCandidates.length) await importBulkCandidates(autoCandidates, targetBookshelves);
      setBulkCandidates(reviewCandidates);
      const suffix = result.limitReached ? "（已达到扫描上限，结果可能不完整）" : "";
      const skipped = result.skippedDirectories ? `，跳过 ${result.skippedDirectories} 个不可读目录` : "";
      const reviewCount = new Set(reviewCandidates.map(candidate => launchPathKey(candidate.installPath))).size;
      const autoMessage = autoCandidates.length ? `，已自动加入 ${autoCandidates.length} 部` : "";
      const reviewMessage = reviewCount ? `，${reviewCount} 部需选择启动文件` : "";
      setNotice(result.candidates.length
        ? `扫描完成：检查 ${result.gameFolderCount ?? 0} 个第一层文件夹（${result.scannedFiles} 个 EXE），找到 ${new Set(result.candidates.map(candidate => launchPathKey(candidate.installPath))).size} 个候选目录${autoMessage}${reviewMessage}${skipped}${suffix}`
        : `扫描完成：检查 ${result.gameFolderCount ?? 0} 个第一层游戏文件夹，未找到启动 EXE${skipped}${suffix}`);
    } catch (error) {
      setNotice(error instanceof Error && (error as Error & { code?: string }).code === "cancelled" ? "已取消目录扫描" : error instanceof Error ? error.message : "扫描游戏目录失败");
    } finally {
      setIsScanningBulk(false);
    }
  }

  function cancelBulkScan() {
    if (isScanningBulk) void window.galLauncher.cancelLaunchScan();
  }

  async function importBulkCandidates(candidates: LaunchCandidate[], bookshelfIds: string[] = []) {
    const uniquePaths = Array.from(new Map(candidates.map(candidate => [launchPathKey(candidate.executablePath), candidate])).values());
    const uniqueCandidates = Array.from(new Map(uniquePaths.map(candidate => [launchPathKey(candidate.installPath), candidate])).values());
    const existingByPath = new Map(games.map(game => [launchPathKey(game.executablePath), game]));
    const existingCandidates = uniqueCandidates
      .map(candidate => existingByPath.get(launchPathKey(candidate.executablePath)))
      .filter((game): game is Game => Boolean(game));
    const existingCount = existingCandidates.length;
    const allowedShelves = new Set(bookshelves.map(shelf => shelf.id));
    const targetShelves = Array.from(new Set(bookshelfIds.filter(id => allowedShelves.has(id))));
    const additions = uniqueCandidates
      .filter(candidate => !existingByPath.has(launchPathKey(candidate.executablePath)))
      .map(candidate => ({ ...makeGame(candidate), bookshelfIds: targetShelves }));
    const updatedExisting = targetShelves.length
      ? existingCandidates.map(game => ({
          ...game,
          bookshelfIds: Array.from(new Set([...(game.bookshelfIds || []), ...targetShelves])),
          updatedAt: nowIso()
        }))
      : existingCandidates;
    const updatedById = new Map(updatedExisting.map(game => [game.id, game]));
    const nextGames = [
      ...additions,
      ...games.map(game => updatedById.get(game.id) || game)
    ];
    if (!additions.length && !targetShelves.length) {
      setBulkCandidates([]);
      setNotice(`导入完成：新增 0 部，已存在 ${existingCount} 部`);
      return;
    }
    setGames(nextGames);
    setBulkCandidates([]);
    setNotice(`导入完成：新增 ${additions.length} 部，已存在 ${existingCount} 部${additions.length ? "；正在补全资料" : "，已加入所选书架"}`);
    try {
      // Commit the local library before starting any network work. A metadata
      // failure must never roll back a successfully imported local entry.
      await window.galLauncher.saveLibraryDocument({ version: 2, games: nextGames, bookshelves });
    } catch (error) {
      setNotice(`本地条目已加入当前界面，但写盘失败：${error instanceof Error ? error.message : "请稍后重试"}`);
      return;
    }
    if (additions.length) void enrichImportedGames(additions);
  }

  async function enrichImportedGames(importedGames: Game[]) {
    const total = importedGames.length;
    const control = { cancelled: false };
    bulkEnrichmentRef.current = control;
    setBulkEnrichment({ active: true, total, completed: 0, failed: 0, review: 0, unmatched: 0, pending: total, cancelled: false });
    let nextIndex = 0;
    let completed = 0;
    let failed = 0;
    let review = 0;
    let unmatched = 0;
    const worker = async () => {
      while (!control.cancelled) {
        const index = nextIndex++;
        if (index >= importedGames.length) return;
        const game = importedGames[index];
        try {
          const result: BulkMetadataEnrichmentResult = await window.galLauncher.enrichBulkMetadata(game);
          if (result.kind === "apply") {
            setGames(current => current.map(item => item.id === game.id ? mergeMetadata(item, result.metadata) : item));
          } else if (result.kind === "review") {
            review++;
            setGames(current => current.map(item => item.id === game.id ? {
              ...item,
              metadataReviewCandidates: result.candidates,
              metadataReviewQueuedAt: nowIso()
            } : item));
          } else {
            unmatched++;
          }
          completed++;
        } catch {
          failed++;
        }
        setBulkEnrichment({ active: true, total, completed, failed, review, unmatched, pending: Math.max(0, total - completed - failed), cancelled: control.cancelled });
      }
    };
    await Promise.all([worker(), worker()]);
    const pending = Math.max(0, total - completed - failed);
    const wasCancelled = control.cancelled;
    setBulkEnrichment({ active: false, total, completed, failed, review, unmatched, pending, cancelled: wasCancelled });
    if (bulkEnrichmentRef.current === control) bulkEnrichmentRef.current = null;
    setNotice(wasCancelled
      ? `资料补全已取消：已处理 ${completed} 部，待确认 ${review} 部，失败 ${failed} 部，剩余 ${pending} 部保留待补全`
      : `资料补全完成：已自动补全 ${completed - review - unmatched} 部，待确认 ${review} 部，未命中 ${unmatched} 部，失败 ${failed} 部`);
  }

  function cancelBulkEnrichment() {
    if (!bulkEnrichmentRef.current) return;
    bulkEnrichmentRef.current.cancelled = true;
    setBulkEnrichment(current => current ? { ...current, cancelled: true } : current);
  }

  function persistGame(next: Game) {
    setGames((current) => current.map((game) => (game.id === next.id ? { ...next, updatedAt: nowIso() } : game)));
  }

  function mergeMetadata(game: Game, metadata: Partial<PickedLaunchFile>) {
    const newDescription = metadata.description || "";
    const cjk = /[\u3400-\u9fff]/;
    const oldChineseDescription = game.descriptionZh || (cjk.test(game.description || "") ? game.description : "");
    const translatedDescription = metadata.descriptionZh || (metadata.translationStatus === "success" || metadata.translationStatus === "already_zh" ? newDescription : "");
    const description = translatedDescription || oldChineseDescription || newDescription || game.description;
    return {
      ...game,
      title: metadata.title || game.title,
      originalTitle: metadata.originalTitle || game.originalTitle,
      description,
      descriptionOriginal: metadata.descriptionOriginal || game.descriptionOriginal || (!cjk.test(description) ? description : ""),
      descriptionZh: translatedDescription || oldChineseDescription || undefined,
      translationStatus: metadata.translationStatus || game.translationStatus,
      translationUpdatedAt: metadata.translationUpdatedAt || game.translationUpdatedAt,
      descriptionSourceHash: (metadata as Partial<PickedLaunchFile>).descriptionSourceHash || game.descriptionSourceHash,
      metadataSource: (metadata as Partial<PickedLaunchFile>).metadataSource || game.metadataSource,
      metadataSourceId: (metadata as Partial<PickedLaunchFile>).metadataSourceId || game.metadataSourceId,
      metadataConfidence: (metadata as Partial<PickedLaunchFile>).metadataConfidence ?? game.metadataConfidence,
      metadataReviewCandidates: undefined,
      metadataReviewQueuedAt: undefined,
      developer: metadata.developer || game.developer,
      releaseDate: metadata.releaseDate || game.releaseDate,
      coverPath: game.coverPath || metadata.coverPath || "",
      backgroundPath: game.backgroundPath || metadata.backgroundPath || metadata.coverPath || game.coverPath,
      tags: metadata.tags?.length ? metadata.tags : game.tags,
      bgmScore: 0,
      bgmScoreCount: 0,
      bgmRank: 0,
      bgmId: 0,
      bgmRatingStatus: undefined,
      bgmRatingCheckedAt: undefined,
      bgmRatingLastAttemptAt: undefined,
      bgmRatingNextRetryAt: undefined
    };
  }

  async function openMetadataCandidates(game: Game, keyword = "") {
    const requestId = ++metadataRequestRef.current;
    setIsSearchingMetadata(true);
    setMetadataSearchStartedAt(Date.now());
    setMetadataCandidates([]);
    setCandidateGameId(game.id);
    setMetadataKeyword(keyword);
    setMetadataSearchError("");
    setIsBulkMetadataReviewOpen(false);
    setIsCandidatePickerOpen(true);
    setNotice("正在搜索资料候选");
    try {
      const candidates = await window.galLauncher.searchMetadataCandidates(game, keyword);
      if (!isCurrentSearchRequest(requestId, metadataRequestRef.current, game.id, selectedIdRef.current)) return;
      setMetadataCandidates(candidates);
      setNotice(candidates.length ? "" : "没有找到可靠的资料候选");
    } catch (error) {
      if (!isCurrentSearchRequest(requestId, metadataRequestRef.current, game.id, selectedIdRef.current)) return;
      const message = formatIpcError(error, "搜索资料失败");
      setMetadataSearchError(message);
      setNotice(message);
    } finally {
      if (requestId === metadataRequestRef.current) {
        setIsSearchingMetadata(false);
        setMetadataSearchStartedAt(null);
      }
    }
  }

  async function applyMetadataCandidate(candidate: MetadataCandidate) {
    const game = games.find((item) => item.id === candidateGameId);
    if (!game || selectedIdRef.current !== candidateGameId || isApplyingMetadata) return;
    setIsApplyingMetadata(true);
    setNotice("正在应用资料");
    try {
      const metadata = await window.galLauncher.applyMetadataCandidate(game, candidate);
      persistGame(mergeMetadata(game, metadata));
      const nextReview = games.find(item => item.id !== game.id && item.metadataReviewCandidates?.length);
      if (isBulkMetadataReviewOpen && nextReview) {
        setSelectedId(nextReview.id);
        setCandidateGameId(nextReview.id);
        setMetadataCandidates(nextReview.metadataReviewCandidates || []);
        setMetadataKeyword("");
        setNotice(`已应用资料：${candidate.title}；继续确认《${nextReview.title}》`);
      } else {
        setIsCandidatePickerOpen(false);
        setIsBulkMetadataReviewOpen(false);
        setNotice(`已应用资料：${candidate.title}`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "应用资料失败");
    } finally {
      setIsApplyingMetadata(false);
    }
  }

  function openBulkMetadataReview() {
    const nextReview = games.find(game => game.metadataReviewCandidates?.length);
    if (!nextReview) {
      setNotice("没有待确认的资料候选");
      return;
    }
    setSelectedId(nextReview.id);
    setCandidateGameId(nextReview.id);
    setMetadataCandidates(nextReview.metadataReviewCandidates || []);
    setMetadataKeyword("");
    setMetadataSearchError("");
    metadataRequestRef.current += 1;
    setIsSearchingMetadata(false);
    setMetadataSearchStartedAt(null);
    setIsBulkMetadataReviewOpen(true);
    setIsCandidatePickerOpen(true);
  }

  function skipBulkMetadataReview() {
    const game = games.find(item => item.id === candidateGameId);
    if (!game || !isBulkMetadataReviewOpen) return;
    const nextReview = games.find(item => item.id !== game.id && item.metadataReviewCandidates?.length);
    persistGame({ ...game, metadataReviewCandidates: undefined, metadataReviewQueuedAt: undefined });
    if (nextReview) {
      setSelectedId(nextReview.id);
      setCandidateGameId(nextReview.id);
      setMetadataCandidates(nextReview.metadataReviewCandidates || []);
      setNotice(`已保留《${game.title}》的本地资料；继续确认《${nextReview.title}》`);
      return;
    }
    setIsCandidatePickerOpen(false);
    setIsBulkMetadataReviewOpen(false);
    setNotice(`已保留《${game.title}》的本地资料`);
  }

  function closeMetadataCandidates() {
    setIsCandidatePickerOpen(false);
    setIsBulkMetadataReviewOpen(false);
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
      const result = await window.galLauncher.launchGame(game, integrationSettings);
      if (!result.launched && result.reason === "missing-executable") {
        setMissingLaunchGame(game);
        return;
      }
      if (!result.launched) {
        setNotice("游戏未能启动");
        return;
      }
      const startedAt = result.startedAt ?? nowIso();
      setGames((current) =>
        current.map((item) =>
          item.id === game.id
            ? {
                ...item,
                executablePath: game.executablePath,
                installPath: game.installPath,
                workingDirectory: game.workingDirectory,
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
      setNotice(result.integrationWarning || (result.sessionId ? "游戏已启动，正在记录游玩时长" : "游戏已启动"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "启动失败");
    }
  }

  async function retryTranslation(game: Game) {
    setNotice("正在重新翻译简介");
    try {
      const metadata = await window.galLauncher.enrichOnlineMetadata(game, { forceTranslation: true });
      persistGame(mergeMetadata(game, metadata));
      setNotice("简介翻译已更新");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "翻译失败，已保留原文");
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
      const filePath = await window.galLauncher.exportLibrary({ version: 2, games, bookshelves });
      if (filePath) setNotice("备份已导出");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "导出失败");
    }
  }

  async function importBackup() {
    try {
      const imported = await window.galLauncher.importLibrary();
      if (!imported) return;
      setGames(imported.games);
      setBookshelves(imported.bookshelves);
      setSelectedId(imported.games[0]?.id ?? "");
      setCollectionScope("all");
      setCollectionBookshelfId("");
      setNotice("备份已恢复");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "恢复失败");
    }
  }

  async function findCovers(game: Game) {
    const requestId = ++coverRequestRef.current;
    setIsFindingCovers(true);
    setCoverSearchStartedAt(Date.now());
    setCoverCandidates([]);
    setCoverPickerGameId(game.id);
    setCoverSearchError("");
    setIsCoverPickerOpen(true);
    setNotice("正在查找横版封面候选");
    try {
      const candidates = await window.galLauncher.findCoverCandidates(game);
      if (!isCurrentCoverSearchRequest(requestId, coverRequestRef.current)) return;
      setCoverCandidates(candidates);
      setIsCoverPickerOpen(true);
      setNotice(candidates.length ? "" : "没有找到可信横版候选图");
    } catch (error) {
      if (!isCurrentCoverSearchRequest(requestId, coverRequestRef.current)) return;
      const message = formatIpcError(error, "查找横版封面失败");
      setCoverSearchError(message);
      setNotice(message);
    } finally {
      if (requestId === coverRequestRef.current) {
        setIsFindingCovers(false);
        setCoverSearchStartedAt(null);
      }
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

  async function relinkMissingGame(game: Game) {
    try {
      const picked = await window.galLauncher.pickLaunchFile();
      if (!picked) return;
      const relinked = {
        ...game,
        executablePath: picked.executablePath,
        installPath: picked.installPath,
        workingDirectory: picked.workingDirectory
      };
      persistGame(relinked);
      setMissingLaunchGame(null);
      await launch(relinked);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "重新关联失败");
    }
  }

  function startEdit(game: Game) {
    setDraft({ ...game, tags: [...game.tags], bookshelfIds: [...(game.bookshelfIds || [])] });
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

  async function chooseLocaleEmulatorPath() {
    try {
      const picked = await window.galLauncher.pickLaunchFile();
      if (!picked) return;
      setDraft((current) => current
        ? { ...current, localeEmulator: { enabled: true, executablePath: picked.executablePath } }
        : current);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "选择 Locale Emulator 失败");
    }
  }

  function applyEnhancementPath(toolId: EnhancementToolId, executablePath: string) {
    setIntegrationSettings((current) => bindEnhancementPath(current, toolId, executablePath));
  }

  async function installEnhancementTool(toolId: EnhancementToolId, localArchivePath?: string): Promise<EnhancementToolStatus | null> {
    if (isInstallingEnhancementTool) return null;
    setIsInstallingEnhancementTool(true);
    setEnhancementToolProgress({ phase: "checking", toolId, version: "", percent: 0 });
    setNotice(`${toolId === "magpie" ? "Magpie" : "Locale Emulator"} 正在准备安装…`);
    try {
      const result = await window.galLauncher.installEnhancementTool(toolId, localArchivePath ? { localArchivePath } : undefined);
      setEnhancementTools((current) => current.some((item) => item.id === toolId)
        ? current.map((item) => item.id === toolId ? { ...item, ...result } : item)
        : [...current, result]);
      applyEnhancementPath(toolId, result.executablePath || "");
      setNotice(`${toolId === "magpie" ? "Magpie" : "Locale Emulator"} 已就绪`);
      return result;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "增强工具安装失败，可重试");
      return null;
    } finally {
      setIsInstallingEnhancementTool(false);
    }
  }

  async function selectExistingEnhancementTool(toolId: EnhancementToolId) {
    try {
      const picked = await window.galLauncher.pickLaunchFile();
      if (!picked) return;
      const result = await window.galLauncher.selectExistingEnhancementTool(toolId, picked.executablePath);
      setEnhancementTools((current) => current.some((item) => item.id === toolId)
        ? current.map((item) => item.id === toolId ? { ...item, ...result } : item)
        : [...current, result]);
      applyEnhancementPath(toolId, result.executablePath || "");
      setNotice(`${toolId === "magpie" ? "Magpie" : "Locale Emulator"} 已绑定`);
      return result;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "绑定增强工具失败");
    }
  }

  async function installEnhancementToolFromArchive(toolId: EnhancementToolId) {
    const archivePath = await window.galLauncher.pickEnhancementToolArchive(toolId);
    if (archivePath) await installEnhancementTool(toolId, archivePath);
  }

  async function toggleGameEnhancement(game: Game, toolId: EnhancementToolId, resolvedPath?: string, magpiePresetId?: MagpiePresetId) {
    const enabled = toolId === "magpie"
      ? game.magpieEnabled === true
      : game.localeEmulator?.enabled === true;
    if (enabled && !(toolId === "magpie" && magpiePresetId)) {
      const next = toolId === "magpie"
        ? { ...game, magpieEnabled: false, updatedAt: nowIso() }
        : { ...game, localeEmulator: { enabled: false, executablePath: game.localeEmulator?.executablePath || "" }, updatedAt: nowIso() };
      persistGame(next);
      setNotice(`${toolId === "magpie" ? "超分" : "转区"}已关闭`);
      return;
    }

    const available = enhancementTools.find(item => item.id === toolId && item.status === "available" && item.executablePath);
    let executablePath = resolvedPath || available?.executablePath || (toolId === "magpie"
      ? integrationSettings.magpiePath
      : game.localeEmulator?.executablePath || integrationSettings.localeEmulatorPath);
    if (!executablePath) {
      const installed = await installEnhancementTool(toolId);
      executablePath = installed?.executablePath || "";
    }
    if (toolId === "localeEmulator" && !executablePath) {
      setNotice("转区工具尚未就绪，未启用当前游戏");
      return;
    }
    if (toolId === "magpie" && !executablePath) {
      setNotice("超分工具尚未就绪，未启用当前游戏");
      return;
    }

    applyEnhancementPath(toolId, executablePath);
    const next = toolId === "magpie"
      ? enableMagpieForGame(game, magpiePresetId || game.magpiePresetId || "balanced")
      : { ...game, localeEmulator: { enabled: true, executablePath }, updatedAt: nowIso() };
    persistGame(next);
    setNotice(`${toolId === "magpie" ? "超分" : "转区"}已为《${game.title}》启用`);
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
    isCategoriesOpen, setIsCategoriesOpen,
    bookshelves, collectionScope, setCollectionScope, collectionBookshelfId, setCollectionBookshelfId, selectCollectionScope, collectionSort, setCollectionSort, collectionSortDirection, toggleCollectionSortDirection,
    collectionBaseCount: collectionBaseGames.length, openCollectionGame, clearCollectionFilters,
    createBookshelf, renameBookshelf, moveBookshelf, setGameBookshelves, addGamesToBookshelves, removeGamesFromBookshelf, addTagsToGames, deleteBookshelf, bulkCandidates, setBulkCandidates, isScanningBulk, bulkScanProgress, scanBulkImport, cancelBulkScan, importBulkCandidates,
    isEditing,
    isInfoOpen, setIsInfoOpen,
    isThemeOpen, setIsThemeOpen,
    theme, setTheme,
    draft, setDraft,
    notice, setNotice,
    missingLaunchGame,
    imageCache,
    coverCandidates,
    isCoverPickerOpen, setIsCoverPickerOpen,
    isFindingCovers,
    coverSearchElapsedSeconds: coverSearchStartedAt ? Math.max(0, Math.floor((searchTick - coverSearchStartedAt) / 1000)) : 0,
    coverSearchError,
    metadataCandidates,
    candidateGameId,
    isCandidatePickerOpen, setIsCandidatePickerOpen,
    isSearchingMetadata,
    metadataSearchElapsedSeconds: metadataSearchStartedAt ? Math.max(0, Math.floor((searchTick - metadataSearchStartedAt) / 1000)) : 0,
    metadataSearchError,
    isApplyingMetadata,
    metadataKeyword, setMetadataKeyword,
    clockTick,
    fadingImage,
    tagFilter, setTagFilter, tagFilters, setTagFilters, toggleTagFilter,
    ctxMenu,
    shelfRef,
    selected,
    selectedImage,
    usesCoverFallback,
    filteredGames,
    collectionGames,
    bulkEnrichment,
    cancelBulkEnrichment,
    metadataReviewCount: games.filter(game => game.metadataReviewCandidates?.length).length,
    isBulkMetadataReviewOpen,
    openBulkMetadataReview,
    skipBulkMetadataReview,
    counts,
    totalSeconds,
    recentGames,
    popularTags,
    persistGame,
    openMetadataCandidates,
    applyMetadataCandidate,
    closeMetadataCandidates,
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
    ,chooseLocaleEmulatorPath
    ,relinkMissingGame
    ,dismissMissingLaunch: () => setMissingLaunchGame(null)
    ,retryBangumiRating
    ,openBangumi
    ,retryTranslation
    ,integrationSettings, setIntegrationSettings
    ,enhancementTools, enhancementToolProgress, isInstallingEnhancementTool
    ,installEnhancementTool, installEnhancementToolFromArchive, selectExistingEnhancementTool, toggleGameEnhancement
  };
}

export type LibraryController = ReturnType<typeof useLibrary>;
