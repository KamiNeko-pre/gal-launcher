import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Edit3,
  FolderTree,
  Gamepad2,
  ImagePlus,
  Library,
  Maximize2,
  Menu,
  Minimize2,
  Palette,
  Play,
  Search,
  Trash2,
  X
} from "lucide-react";
import type { CoverCandidate, Game, GameStatus, MetadataCandidate, EnhancementToolId, LaunchCandidate, MagpiePresetId, MagpiePresetOption } from "./types";
import { themePresets, defaultTheme } from "./theme";
import { metadataSourceLabel, statuses } from "./utils";
import { bindEnhancementPath, useLibrary } from "./useLibrary";
import { SideSheet } from "./components/SideSheet";
import { BookshelfCollectionOverlay } from "./components/BookshelfCollectionOverlay";
import { layouts, loadThemeAssets } from "./layouts/layoutRegistry";
import { LayoutFallback } from "./components/LayoutFallback";
import { useGamepadNavigation } from "./hooks/useGamepadNavigation";
import "./styles.css";

const sourceColors: Record<string, string> = {
  "Steam": "#1a9fff",
  "官网": "#4caf50",
  "DLsite": "#00bcd4",
  "VNDB截图": "#5c9ce0",
  "VNDB封面": "#5c9ce0",
  "2DFan": "#3f51b5",
  "量子ACG": "#e91e63",
  "本地文件夹": "#ff9800",
  "当前横版图": "#9c27b0",
  "Bangumi": "#f44336"
};

function enhancementPhaseLabel(phase: string) {
  return ({
    checking: "检查已有安装",
    downloading: "正在下载",
    "using-local-archive": "正在读取本地官方包",
    verifying: "正在校验",
    deploying: "正在部署",
    cancelled: "已取消",
    failed: "失败",
    available: "已就绪"
  } as Record<string, string>)[phase] || "正在处理";
}

function bulkCandidateFolderKey(installPath: string) {
  return installPath.replaceAll("/", "\\").replace(/[\\]+$/, "").toLocaleLowerCase();
}

function groupBulkCandidates(candidates: LaunchCandidate[]) {
  const groups = new Map<string, LaunchCandidate[]>();
  for (const candidate of candidates) {
    const key = bulkCandidateFolderKey(candidate.installPath);
    groups.set(key, [...(groups.get(key) || []), candidate]);
  }
  return [...groups.values()];
}

function defaultBulkSelection(candidates: LaunchCandidate[]) {
  return groupBulkCandidates(candidates).flatMap(group => [group.find(candidate => candidate.recommended && !candidate.needsReview)])
    .filter((candidate): candidate is LaunchCandidate => Boolean(candidate))
    .map(candidate => candidate.executablePath);
}

function App() {
  const lib = useLibrary();
  const [isImportMenuOpen, setIsImportMenuOpen] = useState(false);
  const layoutLibrary = { ...lib, addGame: async () => { setIsImportMenuOpen(true); } };
  const {
    statusFilter,
    viewMode,
    setViewMode,
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
    coverSearchElapsedSeconds,
    coverSearchError,
    metadataCandidates,
    candidateGameId,
    isCandidatePickerOpen, setIsCandidatePickerOpen,
    isSearchingMetadata,
    metadataSearchElapsedSeconds,
    metadataSearchError,
    isApplyingMetadata,
    metadataKeyword, setMetadataKeyword,
    clockTick,
    ctxMenu,
    selected,
    selectedId, setSelectedId,
    filteredGames,
    usesCoverFallback,
    games,
    openMetadataCandidates,
    applyMetadataCandidate,
    closeMetadataCandidates,
    launch,
    retryBangumiRating,
    openBangumi,
    retryTranslation,
    integrationSettings, setIntegrationSettings,
    enhancementTools, enhancementToolProgress, isInstallingEnhancementTool,
    installEnhancementTool, installEnhancementToolFromArchive, selectExistingEnhancementTool,
    toggleGameEnhancement,
    bulkEnrichment, cancelBulkEnrichment, metadataReviewCount, isBulkMetadataReviewOpen, openBulkMetadataReview, skipBulkMetadataReview,
    bookshelves,
    createBookshelf,
    bulkCandidates, setBulkCandidates, importBulkCandidates,
    rescanMetadata,
    findCovers,
    chooseCover,
    deleteGame,
    startEdit,
    closeEdit,
    closeContextMenu,
    saveDraft,
    chooseImage,
    chooseLocaleEmulatorPath,
    relinkMissingGame,
    dismissMissingLaunch,
    persistGame,
    collectionScope,
    collectionBookshelfId
  } = lib;
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [magpiePresets, setMagpiePresets] = useState<MagpiePresetOption[]>([]);
  const [enhancementSetup, setEnhancementSetup] = useState<{
    game: Game;
    toolId: EnhancementToolId;
    executablePath?: string;
    magpiePresetId: MagpiePresetId;
  } | null>(null);
  const [enhancementBusy, setEnhancementBusy] = useState(false);
  const [enhancementError, setEnhancementError] = useState("");
  useEffect(() => {
    void window.galLauncher.getMagpiePresets().then(setMagpiePresets).catch(() => setMagpiePresets([]));
  }, []);
  const requestEnhancement = async (game: Game, toolId: EnhancementToolId) => {
    const enabled = toolId === "magpie" ? game.magpieEnabled === true : game.localeEmulator?.enabled === true;
    if (enabled && toolId !== "magpie") return toggleGameEnhancement(game, toolId);
    const path = enhancementTools.find(tool => tool.id === toolId && tool.status === "available")?.executablePath
      || (toolId === "magpie" ? integrationSettings.magpiePath : game.localeEmulator?.executablePath || integrationSettings.localeEmulatorPath);
    let executablePath = "";
    if (path) {
      const validated = await window.galLauncher.validateEnhancementTool(toolId, path).catch(() => null);
      executablePath = validated?.executablePath || "";
      if (executablePath) {
        setIntegrationSettings(current => bindEnhancementPath(current, toolId, executablePath));
        if (toolId !== "magpie") return toggleGameEnhancement(game, toolId, executablePath);
      }
    }
    setEnhancementError("");
    setEnhancementSetup({
      game,
      toolId,
      executablePath: executablePath || undefined,
      magpiePresetId: game.magpiePresetId || "balanced",
    });
  };
  const completeEnhancementSetup = async (source: "configured" | "existing" | "install") => {
    if (!enhancementSetup || enhancementBusy) return;
    setEnhancementBusy(true);
    setEnhancementError("");
    try {
      const result = source === "configured"
        ? { executablePath: enhancementSetup.executablePath }
        : source === "existing"
          ? await selectExistingEnhancementTool(enhancementSetup.toolId)
          : await installEnhancementTool(enhancementSetup.toolId);
      if (result?.executablePath) {
        await toggleGameEnhancement(
          enhancementSetup.game,
          enhancementSetup.toolId,
          result.executablePath,
          enhancementSetup.toolId === "magpie" ? enhancementSetup.magpiePresetId : undefined,
        );
        setEnhancementSetup(null);
      } else if (source === "existing") {
        setEnhancementError(`未完成绑定，请选择正确的 ${enhancementSetup.toolId === "magpie" ? "Magpie.exe" : "LEProc.exe"} 后重试。`);
      } else {
        setEnhancementError("安装未完成，请检查网络后重试，或选择已有程序。");
      }
    } finally { setEnhancementBusy(false); }
  };
  const [isImmersiveMenuOpen, setIsImmersiveMenuOpen] = useState(false);
  const [showFullscreenControls, setShowFullscreenControls] = useState(false);
  const fullscreenHideTimer = useRef<number | null>(null);
  const fullscreenRevealTimer = useRef<number | null>(null);
  const [bulkSelectedPaths, setBulkSelectedPaths] = useState<string[]>([]);
  const [bulkBookshelfIds, setBulkBookshelfIds] = useState<string[]>([]);
  const previousBulkCandidateCount = useRef(0);

  useEffect(() => {
    setBulkSelectedPaths(defaultBulkSelection(bulkCandidates));
    if (bulkCandidates.length && previousBulkCandidateCount.current === 0) {
      const currentShelfIsValid = collectionScope === "shelf" && bookshelves.some(shelf => shelf.id === collectionBookshelfId);
      setBulkBookshelfIds(currentShelfIsValid ? [collectionBookshelfId] : []);
    }
    if (!bulkCandidates.length) setBulkBookshelfIds([]);
    previousBulkCandidateCount.current = bulkCandidates.length;
  }, [bulkCandidates, bookshelves, collectionBookshelfId, collectionScope]);

  const bulkGroups = groupBulkCandidates(bulkCandidates);
  const selectBulkCandidate = (candidate: (typeof bulkCandidates)[number], checked: boolean) => {
    const folderKey = bulkCandidateFolderKey(candidate.installPath);
    setBulkSelectedPaths(current => {
      const withoutSameFolder = current.filter(selectedPath => {
        const selectedCandidate = bulkCandidates.find(item => item.executablePath === selectedPath);
        return !selectedCandidate || bulkCandidateFolderKey(selectedCandidate.installPath) !== folderKey;
      });
      return checked ? [...withoutSameFolder, candidate.executablePath] : withoutSameFolder;
    });
  };

  const revealFullscreenControls = useCallback(() => {
    if (fullscreenRevealTimer.current !== null) window.clearTimeout(fullscreenRevealTimer.current);
    setShowFullscreenControls(true);
    if (fullscreenHideTimer.current !== null) window.clearTimeout(fullscreenHideTimer.current);
    const hideWhenIdle = () => {
      const bar = document.querySelector(".immersive-topbar");
      if (bar?.matches(":hover, :focus-within")) {
        fullscreenHideTimer.current = window.setTimeout(hideWhenIdle, 1800);
      } else setShowFullscreenControls(false);
    };
    fullscreenHideTimer.current = window.setTimeout(hideWhenIdle, 1800);
  }, []);

  const scheduleFullscreenControls = useCallback(() => {
    if (fullscreenRevealTimer.current !== null) return;
    fullscreenRevealTimer.current = window.setTimeout(() => {
      fullscreenRevealTimer.current = null;
      revealFullscreenControls();
    }, 350);
  }, [revealFullscreenControls]);

  const toggleFullscreen = useCallback(async () => {
    try {
      const next = await window.galLauncher.toggleFullscreen();
      setIsFullscreen(next);
      setIsImmersiveMenuOpen(false);
      if (next) {
        revealFullscreenControls();
        setNotice("F11 退出沉浸式全屏 · Esc 打开菜单");
      }
    } catch {
      setNotice("无法切换全屏模式");
    }
  }, [revealFullscreenControls, setNotice]);

  const closeOverlay = useCallback(() => {
    if (enhancementSetup) { if (!enhancementBusy) setEnhancementSetup(null); return; }
    if (lib.isCategoriesOpen && !isInfoOpen && !ctxMenu) { lib.setIsCategoriesOpen(false); return; }
    if (missingLaunchGame) { dismissMissingLaunch(); return; }
    if (isImportMenuOpen) { setIsImportMenuOpen(false); return; }
    if (isImmersiveMenuOpen) { setIsImmersiveMenuOpen(false); return; }
    if (ctxMenu) { closeContextMenu(); return; }
    if (isThemeOpen) { setIsThemeOpen(false); return; }
    if (isCoverPickerOpen) { setIsCoverPickerOpen(false); return; }
    if (isCandidatePickerOpen) { setIsCandidatePickerOpen(false); return; }
    if (isInfoOpen) { setIsInfoOpen(false); return; }
    if (isEditing) { closeEdit(); return; }
    if (viewMode === "collection") { setViewMode("library"); return; }
    if (isFullscreen) setIsImmersiveMenuOpen(true);
  }, [isImportMenuOpen, enhancementSetup, enhancementBusy, lib.isCategoriesOpen, missingLaunchGame, dismissMissingLaunch, isImmersiveMenuOpen, ctxMenu, closeContextMenu, isThemeOpen, isCoverPickerOpen, isCandidatePickerOpen, isInfoOpen, isEditing, viewMode, isFullscreen, setViewMode, setIsThemeOpen, setIsCoverPickerOpen, setIsCandidatePickerOpen, setIsInfoOpen, closeEdit]);

  const { isGamepadActive } = useGamepadNavigation({
    selectedId,
    selectGame: setSelectedId,
    launchSelected: () => { if (selected) void launch(selected); },
    openInfo: () => { if (selected) setIsInfoOpen(true); },
    closeOverlay,
    openMenu: () => setIsImmersiveMenuOpen(true)
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme.id);
    const linkId = "theme-font";
    let link = document.getElementById(linkId) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = theme.fontHref;
    void loadThemeAssets(theme.id);
  }, [theme]);

  const Layout = layouts[theme.id] ?? layouts.cinema;

  useEffect(() => {
    window.galLauncher.reportFirstPaint?.();
  }, []);

  useEffect(() => {
    void window.galLauncher.isFullscreen().then(setIsFullscreen);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F11") { event.preventDefault(); void toggleFullscreen(); }
      else if (event.key === "Escape") { event.preventDefault(); closeOverlay(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleFullscreen, closeOverlay]);

  useEffect(() => {
    const removeListener = window.galLauncher.onFullscreenChanged?.((next) => {
      setIsFullscreen(next);
      if (!next) {
        setIsImmersiveMenuOpen(false);
        setShowFullscreenControls(false);
        if (fullscreenRevealTimer.current !== null) window.clearTimeout(fullscreenRevealTimer.current);
      }
    });
    return () => removeListener?.();
  }, []);

  useEffect(() => {
    if (!isFullscreen) {
      setShowFullscreenControls(false);
      if (fullscreenHideTimer.current !== null) window.clearTimeout(fullscreenHideTimer.current);
      if (fullscreenRevealTimer.current !== null) window.clearTimeout(fullscreenRevealTimer.current);
      return;
    }
    const onMouseMove = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".immersive-topbar")) revealFullscreenControls();
      else if (event.clientY <= 64) scheduleFullscreenControls();
      else if (fullscreenRevealTimer.current !== null) { window.clearTimeout(fullscreenRevealTimer.current); fullscreenRevealTimer.current = null; }
    };
    window.addEventListener("mousemove", onMouseMove);
    return () => window.removeEventListener("mousemove", onMouseMove);
  }, [isFullscreen, revealFullscreenControls, scheduleFullscreenControls]);

  return (
    <div className={`app-shell ${usesCoverFallback ? "cover-fallback-mode" : "keyvisual-mode"} ${isInfoOpen ? "info-open" : ""} ${isFullscreen ? "immersive-fullscreen" : ""}`}>
      <Suspense fallback={<LayoutFallback />}>
        <Layout lib={layoutLibrary} />
      </Suspense>
      {lib.isCategoriesOpen && <BookshelfCollectionOverlay lib={lib} />}
      {isImportMenuOpen && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setIsImportMenuOpen(false); }}>
        <section className="modal import-method-modal" role="dialog" aria-modal="true" aria-labelledby="import-method-title">
          <div className="modal-header"><h2 id="import-method-title">添加游戏</h2><button className="icon-button" aria-label="关闭添加游戏" onClick={() => setIsImportMenuOpen(false)}><X size={20} /></button></div>
          <div className="import-method-options">
            <button className="soft-button import-method-option" autoFocus onClick={() => { setIsImportMenuOpen(false); void lib.addGame(); }}><Play size={22} /><span><strong>导入单个 EXE</strong><small>选择一部游戏的启动程序</small></span></button>
            <button className="soft-button import-method-option" disabled={lib.isScanningBulk} onClick={() => { setIsImportMenuOpen(false); void lib.scanBulkImport(); }}><FolderTree size={22} /><span><strong>{lib.isScanningBulk ? "正在扫描文件夹…" : "批量导入文件夹"}</strong><small>选择总目录，自动识别其下的游戏文件夹</small></span></button>
          </div>
        </section>
      </div>}

      {isFullscreen && <div className={`immersive-topbar ${showFullscreenControls ? "visible" : ""}`} inert={!showFullscreenControls} aria-hidden={!showFullscreenControls} onMouseEnter={revealFullscreenControls}>
        <button onClick={() => void toggleFullscreen()} aria-label="退出沉浸式全屏"><Minimize2 size={16} /> 返回窗口</button>
        <button onClick={() => setIsImmersiveMenuOpen(true)} aria-label="打开沉浸式菜单"><Menu size={16} /> 菜单</button>
      </div>}
      {isGamepadActive && (
        <div className="gamepad-hints" aria-live="polite">
          <span><b>A</b> 启动/确认</span><span><b>B</b> 返回</span><span><b>X</b> 资料</span><span><b>☰</b> 菜单</span>
        </div>
      )}
      {isImmersiveMenuOpen && (
        <div className="immersive-menu-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setIsImmersiveMenuOpen(false); }}>
          <section className="immersive-menu" role="dialog" aria-modal="true" aria-labelledby="immersive-menu-title">
            <span className="immersive-menu-kicker">沉浸模式</span>
             <h2 id="immersive-menu-title">{isFullscreen ? "继续浏览你的书架" : "准备进入沉浸式全屏"}</h2>
             <button onClick={() => setIsImmersiveMenuOpen(false)}>继续浏览</button>
             <button onClick={() => { setIsImmersiveMenuOpen(false); lib.setIsCategoriesOpen(false); lib.clearCollectionFilters(); setViewMode("collection"); }}><Library size={17} /> 打开书架</button>
             <button onClick={() => { setIsImmersiveMenuOpen(false); lib.setIsCategoriesOpen(true); }}><FolderTree size={17} /> 管理分类</button>
             <button onClick={() => { setIsImmersiveMenuOpen(false); setIsThemeOpen(true); }}><Palette size={17} /> 切换主题</button>
             <button onClick={() => void toggleFullscreen()}>{isFullscreen ? <><Minimize2 size={17} /> 返回窗口模式</> : <><Maximize2 size={17} /> 进入沉浸式全屏</>}</button>
            <p>F11 切换全屏 · Esc 打开此菜单</p>
          </section>
        </div>
      )}
      {(bulkEnrichment?.active || metadataReviewCount > 0) && (
        <div className="bulk-enrichment-toast" role="status" aria-live="polite">
          <span>{bulkEnrichment?.active
            ? `正在补全资料：已处理 ${bulkEnrichment.completed} / ${bulkEnrichment.total}，待确认 ${bulkEnrichment.review}，未命中 ${bulkEnrichment.unmatched}，失败 ${bulkEnrichment.failed}`
            : `有 ${metadataReviewCount} 部游戏的资料候选待确认`}</span>
          {metadataReviewCount > 0 && <button type="button" onClick={openBulkMetadataReview}>确认资料</button>}
          {bulkEnrichment?.active && <button type="button" onClick={cancelBulkEnrichment}>{bulkEnrichment.cancelled ? "正在停止…" : "取消剩余"}</button>}
        </div>
      )}
      <SideSheet
        game={selected}
        isOpen={isInfoOpen}
        onClose={() => setIsInfoOpen(false)}
        clockTick={clockTick}
        onRescanMetadata={openMetadataCandidates}
        onFindCovers={findCovers}
        onEdit={startEdit}
        onDelete={deleteGame}
        onRetryBangumiRating={retryBangumiRating}
        onOpenBangumi={openBangumi}
        onRetryTranslation={retryTranslation}
        isSearchingMetadata={isSearchingMetadata}
        isFindingCovers={isFindingCovers}
        metadataKeyword={metadataKeyword}
        onToggleEnhancement={requestEnhancement}
        isEnhancementBusy={isInstallingEnhancementTool}
      />

      {bulkCandidates.length > 0 && (
        <div className="modal-backdrop">
          <section className="modal bulk-import-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-import-title">
            <div className="modal-header"><div><h2 id="bulk-import-title">选择无法自动确定的启动文件</h2><p>{bulkGroups.length} 个游戏文件夹需要确认；同一文件夹只会导入一个 EXE。</p></div><button className="icon-button" onClick={() => setBulkCandidates([])}><X size={18} /></button></div>
            <div className="bulk-import-list">
              {bulkGroups.map((group) => {
                const folderKey = bulkCandidateFolderKey(group[0].installPath);
                return <div key={folderKey} className="bulk-import-group">
                  <div className="bulk-import-group-title"><strong>{group[0].title}</strong><small>{group.length > 1 ? `发现 ${group.length} 个可启动 EXE，请选择一个` : "无法确认是否为游戏启动文件，请确认"}</small></div>
                  {group.map(candidate => <label key={candidate.executablePath} className={`bulk-import-item ${candidate.needsReview ? "review" : ""}`}><input type={group.length > 1 ? "radio" : "checkbox"} name={group.length > 1 ? `bulk-launch-${folderKey}` : undefined} checked={bulkSelectedPaths.includes(candidate.executablePath)} onChange={event => selectBulkCandidate(candidate, event.target.checked)} /><span><strong>{candidate.executablePath.split(/[\\/]/).pop()}</strong><small>{candidate.relativePath} · 待确认</small></span></label>)}
                </div>;
              })}
            </div>
            <div className="bulk-import-shelf-row">
              <label className="bulk-import-shelves">同时放入书架（可多选）<select multiple value={bulkBookshelfIds} onChange={event => setBulkBookshelfIds(Array.from(event.target.selectedOptions, option => option.value))}>{bookshelves.map(shelf => <option key={shelf.id} value={shelf.id}>{shelf.name}</option>)}</select></label>
              <button type="button" className="soft-button" onClick={() => {
                const name = window.prompt("新建书架名称");
                if (name === null) return;
                try {
                  const shelf = createBookshelf(name);
                  setBulkBookshelfIds(current => [...current, shelf.id]);
                } catch (error) {
                  setNotice(error instanceof Error ? error.message : "创建书架失败");
                }
              }}>新建书架</button>
            </div>
            {collectionScope === "shelf" && bulkBookshelfIds.includes(collectionBookshelfId) && <small className="bulk-import-shelf-hint">当前书架已默认选中；同一目录下的多个启动程序默认只选择推荐项，其他候选请手动确认。</small>}
            <div className="modal-actions"><button className="soft-button" onClick={() => setBulkCandidates([])}>取消</button><button className="play-button" disabled={!bulkSelectedPaths.length} onClick={() => importBulkCandidates(bulkCandidates.filter(candidate => bulkSelectedPaths.includes(candidate.executablePath)), bulkBookshelfIds)}>导入已选择的 {bulkSelectedPaths.length} 部游戏</button></div>
          </section>
        </div>
      )}

      {missingLaunchGame && (
        <div className="modal-backdrop missing-launch-backdrop">
          <section className="modal missing-launch-modal" role="dialog" aria-modal="true" aria-labelledby="missing-launch-title">
            <div className="missing-launch-copy">
              <Gamepad2 size={28} />
              <div>
                <h2 id="missing-launch-title">找不到启动文件</h2>
                <p>“{missingLaunchGame.title}”的资料、封面和游玩记录都会继续保留。你可以重新选择游戏的启动文件，也可以只把它留在收藏中。</p>
              </div>
            </div>
            <div className="modal-actions missing-launch-actions">
              <button className="soft-button" onClick={dismissMissingLaunch}>暂不关联，仅保留收藏</button>
              <button className="play-button" onClick={() => void relinkMissingGame(missingLaunchGame)}>重新关联启动文件</button>
            </div>
          </section>
        </div>
      )}

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
                <input value={draft.tags.join(", ")} onChange={(event) => setDraft({ ...draft, tags: event.target.value.split(/[，,]/).map((item) => item.trim()).filter(Boolean) })} placeholder="纯爱, 悬疑, 汉化" />
              </label>
              {bookshelves.length > 0 && (
                <fieldset className="full bookshelf-assignment">
                  <legend>收纳到书架</legend>
                  <div className="bookshelf-assignment-list">
                    {bookshelves.map((shelf) => {
                      const checked = (draft.bookshelfIds || []).includes(shelf.id);
                      return (
                        <label key={shelf.id}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              const current = new Set(draft.bookshelfIds || []);
                              if (event.target.checked) current.add(shelf.id);
                              else current.delete(shelf.id);
                              setDraft({ ...draft, bookshelfIds: [...current] });
                            }}
                          />
                          {shelf.name}
                        </label>
                      );
                    })}
                  </div>
                  <small>同一部游戏可以同时放入多个书架；这里只改变书架归属，不会复制游戏或记录。</small>
                </fieldset>
              )}
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
              <label className="full">
                <input
                  type="checkbox"
                  checked={draft.localeEmulator?.enabled ?? false}
                  onChange={(event) => setDraft({
                    ...draft,
                    localeEmulator: {
                      enabled: event.target.checked,
                      executablePath: draft.localeEmulator?.executablePath || integrationSettings.localeEmulatorPath || ""
                    }
                  })}
                />
                使用 Locale Emulator 转区启动
              </label>
              {draft.localeEmulator?.enabled && (
                <label className="full">
                  LEProc 路径
                  <input value={draft.localeEmulator.executablePath} readOnly placeholder="请在资料页首次点击“一键转区”安装或绑定 LEProc.exe" />
                  <button type="button" className="soft-button" onClick={chooseLocaleEmulatorPath}>选择 LEProc</button>
                </label>
              )}
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
              {isFindingCovers
                ? Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="candidate-card skeleton">
                      <div className="candidate-image skeleton-pulse" />
                      <div className="skeleton-line" style={{ width: "60%" }} />
                      <div className="skeleton-line" style={{ width: "40%" }} />
                    </div>
                  ))
                : coverCandidates.map((candidate: CoverCandidate) => (
                    <button key={candidate.id} className="candidate-card" onClick={() => chooseCover(candidate)}>
                      <div className="candidate-image">
                        {imageCache[candidate.path] ? <img src={imageCache[candidate.path]} alt="" decoding="async" /> : <Gamepad2 size={30} />}
                      </div>
                      <span
                        className="source-badge"
                        style={{ "--badge-color": sourceColors[candidate.source] || "#888" } as React.CSSProperties}
                      >
                        {candidate.source}
                      </span>
                      <span>{candidate.width} x {candidate.height}</span>
                      <small>{candidate.reason}</small>
                    </button>
                  ))}
              {isFindingCovers && <p className="candidate-empty">正在查找横版封面候选，已等待 {coverSearchElapsedSeconds} 秒… 你可以关闭此窗口继续浏览；搜索会在后台继续，完成后自动展示候选。</p>}
              {!isFindingCovers && coverSearchError && <p className="candidate-empty">查找失败：{coverSearchError}</p>}
              {!isFindingCovers && !coverSearchError && coverCandidates.length === 0 && <p className="candidate-empty">没有找到符合横版比例的候选图。</p>}
            </div>
          </section>
        </div>
      )}

      {isCandidatePickerOpen && (
        <div className="modal-backdrop">
          <section className="modal metadata-picker">
            <div className="modal-header">
              <h2>{isBulkMetadataReviewOpen ? `批量导入待确认（剩余 ${metadataReviewCount} 部）` : "确认作品资料"}</h2>
              <button className="icon-button" onClick={closeMetadataCandidates}>
                <X size={18} />
              </button>
            </div>
            {!isBulkMetadataReviewOpen && <div className="metadata-search-row">
              <input value={metadataKeyword} onChange={(event) => setMetadataKeyword(event.target.value)} placeholder="输入标题重新搜索，例如 サクラノ刻 / WHITE ALBUM2" />
              <button className="soft-button" disabled={isSearchingMetadata} onClick={() => {
                const game = games.find((item) => item.id === candidateGameId);
                if (game) openMetadataCandidates(game, metadataKeyword);
              }}>
                <Search size={18} />
                搜索
              </button>
            </div>}
            {isBulkMetadataReviewOpen && <p className="metadata-review-explanation">候选分数接近，系统没有自动覆盖《{games.find(item => item.id === candidateGameId)?.title || "当前游戏"}》的本地资料。请选择正确作品，或保留本地资料。</p>}
            <div className="metadata-candidate-list">
              {metadataCandidates.map((candidate: MetadataCandidate) => (
                <button key={`${candidate.source}-${candidate.sourceId}`} className="metadata-candidate" disabled={isApplyingMetadata} onClick={() => applyMetadataCandidate(candidate)}>
                  <div className="metadata-cover">
                    {candidate.coverUrl ? <img src={candidate.coverUrl} alt="" decoding="async" /> : <Gamepad2 size={30} />}
                  </div>
                  <div>
                    <strong>{candidate.title}</strong>
                    <span>{candidate.originalTitle || candidate.releaseDate || candidate.sourceId}</span>
                    <small>来源：{metadataSourceLabel(candidate.source)} · {candidate.developer || "未知会社"} · 匹配度 {Math.round(candidate.confidence * 100)}%</small>
                    <p>{candidate.descriptionPreview || "暂无简介预览"}</p>
                  </div>
                </button>
              ))}
              {isSearchingMetadata && <p className="candidate-empty">正在搜索资料候选，已等待 {metadataSearchElapsedSeconds} 秒…</p>}
              {!isSearchingMetadata && metadataSearchError && <p className="candidate-empty">搜索失败：{metadataSearchError}</p>}
              {!isSearchingMetadata && !metadataSearchError && metadataCandidates.length === 0 && <p className="candidate-empty">没有找到候选。可以换日文原名、英文名或会社名再搜。</p>}
            </div>
            {isBulkMetadataReviewOpen && <div className="metadata-review-actions"><button className="soft-button" type="button" onClick={skipBulkMetadataReview}>保留本地资料</button></div>}
          </section>
        </div>
      )}

      {ctxMenu && (
        <>
          <div className="ctx-backdrop" onClick={closeContextMenu} onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }} />
          <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <button onClick={() => { launch(ctxMenu.game); closeContextMenu(); }}><Play size={16} /> 启动</button>
            <div className="ctx-divider" />
            <div className="ctx-subheader">修改状态</div>
            {statuses.map((s) => (
              <button key={s} className={ctxMenu.game.status === s ? "ctx-active" : ""} onClick={() => { persistGame({ ...ctxMenu.game, status: s }); closeContextMenu(); }}>
                {ctxMenu.game.status === s ? "✓ " : ""}{s}
              </button>
            ))}
            <div className="ctx-divider" />
            <button onClick={() => { startEdit(ctxMenu.game); closeContextMenu(); }}><Edit3 size={16} /> 编辑</button>
            <button className="ctx-danger" onClick={() => { deleteGame(ctxMenu.game); closeContextMenu(); }}><Trash2 size={16} /> 删除</button>
          </div>
        </>
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
                  className={`theme-card ${theme.id === preset.id ? "active" : ""}`}
                  onClick={() => setTheme(preset)}
                >
                  <span className={`theme-preview theme-preview-${preset.id}`} />
                  <strong>{preset.name}</strong>
                  <small>{preset.description}</small>
                </button>
              ))}
            </div>
            <button className="soft-button" onClick={() => void toggleFullscreen()}><Maximize2 size={16} /> {isFullscreen ? "退出沉浸式全屏" : "进入沉浸式全屏"} · F11</button>
            <div className="modal-actions">
              <button className="soft-button" onClick={() => setTheme(defaultTheme)}>恢复默认</button>
              <button className="play-button" onClick={() => setIsThemeOpen(false)}>完成</button>
            </div>
          </section>
        </div>
      )}

      {enhancementSetup && <div className="modal-backdrop enhancement-setup-backdrop">
        <section className="modal enhancement-setup" role="dialog" aria-modal="true" aria-labelledby="enhancement-heading">
          <div className="modal-header"><h2 id="enhancement-heading">{enhancementSetup.toolId === "magpie" ? "启用游戏超分" : "启用转区启动"}</h2><button className="icon-button" disabled={enhancementBusy} onClick={() => setEnhancementSetup(null)} aria-label="关闭"><X size={18} /></button></div>
          <p>《{enhancementSetup.game.title}》 · {enhancementSetup.toolId === "magpie" ? "选择画质方案，下次启动自动应用。" : "配置 Locale Emulator，已有安装可直接选择，否则自动下载部署。"}</p>
          {enhancementSetup.toolId === "magpie" && <div className="magpie-preset-grid" role="radiogroup" aria-label="超分方案">
            {magpiePresets.map(preset => <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={enhancementSetup.magpiePresetId === preset.id}
              aria-describedby="magpie-selected-details"
              disabled={enhancementBusy}
              className={`magpie-preset-card ${enhancementSetup.magpiePresetId === preset.id ? "selected" : ""}`}
              onClick={() => setEnhancementSetup(current => current ? { ...current, magpiePresetId: preset.id } : current)}
            >
              <span className="magpie-preset-name">{{ light: "轻量", balanced: "均衡", quality: "精细", fourK: "极致" }[preset.id]}</span>
              <strong>{{ light: "低负载", balanced: "日常推荐", quality: "细节优先", fourK: "高负载" }[preset.id]}</strong>
            </button>)}
          </div>}
          {enhancementSetup.toolId === "magpie" && <>
            <div className="magpie-selected-details" id="magpie-selected-details" aria-live="polite">
              {magpiePresets.filter(preset => preset.id === enhancementSetup.magpiePresetId).map(preset => <div key={preset.id}>
                <p>{preset.description}</p>
                <small>{preset.recommendation}。仅供选档参考，流畅度以实际游戏为准。</small>
              </div>)}
            </div>
            <div className="magpie-output-info">
              <strong>输出分辨率 · 自动适配游戏所在显示器</strong>
              <p>1080p 屏 → 1920 × 1080<br />1440p 屏 → 2560 × 1440<br />4K 屏 → 3840 × 2160</p>
              <small>四档都适用以上分辨率，只改变处理算法和显卡负载。保持原画比例，比例不同时会留黑边。</small>
            </div>
          </>}
          {enhancementBusy ? <div className="enhancement-install-status" role="status" aria-live="polite"><strong>{enhancementToolProgress ? enhancementPhaseLabel(enhancementToolProgress.phase) : "正在应用方案"}</strong><progress max="100" value={enhancementToolProgress?.percent ?? undefined} /><span>{enhancementToolProgress?.percent != null ? `${enhancementToolProgress.percent}%` : "请稍候…"}</span></div> : <div className="enhancement-setup-options">
            {enhancementSetup.executablePath && <button className="play-button" onClick={() => void completeEnhancementSetup("configured")}>{enhancementSetup.toolId === "magpie" ? "应用所选方案" : "启用"}</button>}
            <button className="soft-button" onClick={() => void completeEnhancementSetup("existing")}>{enhancementSetup.executablePath ? "更换" : "选择已有"} {enhancementSetup.toolId === "magpie" ? "Magpie.exe" : "LEProc.exe"}</button>
            {!enhancementSetup.executablePath && <button className="play-button" onClick={() => void completeEnhancementSetup("install")}>一键安装并启用</button>}
            {enhancementSetup.toolId === "magpie" && enhancementSetup.game.magpieEnabled && <button className="soft-button danger" onClick={() => { void toggleGameEnhancement(enhancementSetup.game, "magpie"); setEnhancementSetup(null); }}>关闭当前游戏超分</button>}
          </div>}
          {enhancementError && <p role="alert">{enhancementError}</p>}
          <small>{enhancementSetup.toolId === "magpie" ? "方案仅对当前游戏生效，可随时更换。" : "配置完成后仅为当前游戏启用；其他作品可以复用已安装的工具。"}</small>
        </section>
      </div>}
      {notice && (
        <button className="toast" onClick={() => setNotice("")} role="status" aria-live="polite">
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
