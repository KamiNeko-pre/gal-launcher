import React from "react";
import { CollectionScopeSelect } from "../components/CollectionScopeSelect";
import {
  Clock3,
  Download,
  Gamepad2,
  Home,
  Library,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Upload,
  ArrowDownUp
} from "lucide-react";
import { formatPlayTime, statuses } from "../utils";
import type { LibraryController } from "../useLibrary";
import { titleInitial } from "../useLibrary";
import {
  horizontalScrollbarMetrics,
  horizontalScrollAmount,
  scrollLeftFromThumbPosition
} from "../scroll/horizontalScroll";

function CinemaShelfScrollbar({
  scrollRef,
  itemCount
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  itemCount: number;
}) {
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<{ pointerX: number; thumbLeft: number } | null>(null);
  const [metrics, setMetrics] = React.useState(() => horizontalScrollbarMetrics(0, 0, 0));

  const sync = React.useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    setMetrics(horizontalScrollbarMetrics(element.scrollWidth, element.clientWidth, element.scrollLeft));
  }, [scrollRef]);

  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const frame = window.requestAnimationFrame(sync);
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    element.addEventListener("scroll", sync, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("scroll", sync);
    };
  }, [itemCount, scrollRef, sync]);

  const thumbStyle = {
    width: `max(48px, ${metrics.viewportRatio * 100}%)`,
    left: `${metrics.scrollRatio * 100}%`,
    transform: `translateX(-${metrics.scrollRatio * 100}%)`
  };

  const moveToThumbPosition = (thumbLeft: number) => {
    const element = scrollRef.current;
    const track = trackRef.current;
    const thumb = track?.querySelector<HTMLElement>(".cinema-scrollbar-thumb");
    if (!element || !track || !thumb) return;
    element.scrollLeft = scrollLeftFromThumbPosition(
      thumbLeft,
      metrics.maxScroll,
      track.clientWidth,
      thumb.offsetWidth
    );
  };

  return (
    <div
      ref={trackRef}
      className={`cinema-scrollbar ${metrics.hasOverflow ? "active" : "disabled"}`}
      role="scrollbar"
      aria-label="拖动浏览游戏列表"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.round(metrics.maxScroll)}
      aria-valuenow={Math.round(metrics.scrollRatio * metrics.maxScroll)}
      tabIndex={metrics.hasOverflow ? 0 : -1}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget || !metrics.hasOverflow) return;
        const track = trackRef.current;
        const thumb = track?.querySelector<HTMLElement>(".cinema-scrollbar-thumb");
        if (!track || !thumb) return;
        moveToThumbPosition(event.clientX - track.getBoundingClientRect().left - thumb.offsetWidth / 2);
      }}
      onKeyDown={(event) => {
        const element = scrollRef.current;
        if (!element || !metrics.hasOverflow) return;
        const step = Math.max(80, element.clientWidth * 0.2);
        if (event.key === "ArrowLeft") element.scrollLeft -= step;
        else if (event.key === "ArrowRight") element.scrollLeft += step;
        else if (event.key === "PageUp") element.scrollLeft -= element.clientWidth * 0.9;
        else if (event.key === "PageDown") element.scrollLeft += element.clientWidth * 0.9;
        else if (event.key === "Home") element.scrollLeft = 0;
        else if (event.key === "End") element.scrollLeft = metrics.maxScroll;
        else return;
        event.preventDefault();
      }}
    >
      <div
        className="cinema-scrollbar-thumb"
        style={thumbStyle}
        onPointerDown={(event) => {
          if (!metrics.hasOverflow) return;
          const track = trackRef.current;
          if (!track) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerX: event.clientX,
            thumbLeft: event.currentTarget.getBoundingClientRect().left - track.getBoundingClientRect().left
          };
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) return;
          moveToThumbPosition(dragRef.current.thumbLeft + event.clientX - dragRef.current.pointerX);
        }}
        onPointerUp={(event) => {
          dragRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => { dragRef.current = null; }}
      />
    </div>
  );
}

export function CinemaLayout({ lib }: { lib: LibraryController }) {
  const {
    query, setQuery,
    statusFilter, setStatusFilter,
    viewMode, setViewMode,
    bookshelves,
    collectionScope, setCollectionScope,
    collectionBookshelfId, setCollectionBookshelfId,
    collectionSort, setCollectionSort, collectionSortDirection, toggleCollectionSortDirection,
    collectionBaseCount, openCollectionGame, clearCollectionFilters,
    setNotice,
    createBookshelf, renameBookshelf, moveBookshelf, addGamesToBookshelves, removeGamesFromBookshelf, deleteBookshelf,
    scanBulkImport, isScanningBulk, bulkScanProgress, cancelBulkScan,
    setIsInfoOpen,
    setIsThemeOpen,
    imageCache,
    tagFilter, setTagFilter, tagFilters, setTagFilters,
    shelfRef,
    selected,
    selectedImage,
    fadingImage,
    games,
    filteredGames,
    collectionGames,
    counts,
    totalSeconds,
    recentGames,
    popularTags,
    setSelectedId,
    addGame,
    launch,
    exportBackup,
    importBackup,
    openContextMenu
  } = lib;

  return (
    <>
      <div className="backdrop" style={{ backgroundImage: selectedImage ? `url("${selectedImage}")` : undefined }} />
      {fadingImage && <div className="backdrop fading" style={{ backgroundImage: `url("${fadingImage}")` }} />}
      <div className="backdrop-mask" />

      <aside className="rail">
        <div className="rail-logo">
          <Gamepad2 size={24} />
        </div>
        <button className={viewMode === "library" && statusFilter === "全部" ? "rail-button active" : "rail-button"} aria-label="主页" onClick={() => { setViewMode("library"); setStatusFilter("全部"); }}>
          <Home size={20} />
        </button>
        <button className={viewMode === "collection" ? "rail-button active" : "rail-button"} aria-label="书架" onClick={() => { setViewMode("collection"); setStatusFilter("全部"); }}>
          <Library size={20} />
        </button>
        <button className={lib.isCategoriesOpen ? "rail-button active" : "rail-button"} aria-label="分类" onClick={() => lib.setIsCategoriesOpen(true)}>
          <Clock3 size={20} />
        </button>
        <button className="rail-button" aria-label="导出备份" onClick={exportBackup}>
          <Download size={19} />
        </button>
        <button className="rail-button" aria-label="恢复备份" onClick={importBackup}>
          <Upload size={19} />
        </button>
        <button className="rail-button" aria-label="主题设置" onClick={() => setIsThemeOpen(true)}>
          <SlidersHorizontal size={19} />
        </button>
        <button className="rail-button add" aria-label="添加游戏" onClick={addGame}>
          <Plus size={20} />
        </button>
      </aside>

      <main className="stage" style={viewMode !== "library" ? { gridTemplateRows: "60px minmax(0, 1fr)" } as React.CSSProperties : undefined}>
        <header className="stage-top">
          <div className="search-pill">
            <CollectionScopeSelect lib={lib} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、会社、标签" />
          </div>
          <div className="stage-stats">
            <span>{formatPlayTime(totalSeconds)}</span>
            <span>{counts.total} 部作品</span>
            <span>进行中 {counts.active}</span>
            <span>已通关 {counts.done}</span>
          </div>
          {viewMode === "library" && recentGames.length > 0 && (
            <div className="recent-row">
              <span className="recent-label">继续游戏</span>
              {recentGames.map((g) => (
                <button key={g.id} className="recent-chip" onClick={() => { setSelectedId(g.id); setStatusFilter("全部"); setTagFilter(null); }}>
                  {g.title}
                </button>
              ))}
            </div>
          )}
          {viewMode === "library" && popularTags.length > 0 && (
            <div className="tag-row">
              {popularTags.map((tag) => (
                <button key={tag} className={`tag-chip ${tagFilter === tag ? "active" : ""}`} onClick={() => setTagFilter(tagFilter === tag ? null : tag)}>
                  {tag}
                </button>
              ))}
            </div>
          )}
        </header>

        {viewMode === "collection" ? (
          <section className="collection-view" data-game-grid>
            <div className="collection-toolbar">
              <strong>书架 · {collectionGames.length} 部作品</strong>
              <select className="collection-sort" aria-label="书架排序" value={collectionSort} onChange={event => setCollectionSort(event.target.value as typeof collectionSort)}><option value="lastPlayed">最近游玩</option><option value="title">标题 A–Z</option><option value="added">最近添加</option><option value="playTime">游玩时长</option><option value="releaseDate">发售日期</option><option value="rating">我的评分</option></select>
              <button className="collection-sort-direction" onClick={toggleCollectionSortDirection}>{collectionSortDirection === "asc" ? "升序" : "降序"}</button>
            </div>
            <div className="collection-wall">
              {collectionGames.map((game) => {
                const posterImage = imageCache[game.coverPath] || imageCache[game.backgroundPath];
                return (
                  <button
                    key={game.id}
                    className="collection-poster-card"
                    data-game-id={game.id}
                    data-title-initial={titleInitial(game.title)}
                    aria-label={game.title}
                    onContextMenu={(e) => openContextMenu(e, game)}
                    onClick={() => {
                      openCollectionGame(game.id);
                      setIsInfoOpen(false);
                    }}
                  >
                    <div className="collection-poster-art">
                      {posterImage ? <img src={posterImage} alt="" decoding="async" /> : <Gamepad2 size={24} />}
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
                  <strong>{collectionBaseCount === 0 ? "这层书架还没有游戏" : "没有符合筛选的作品"}</strong>
                  <span>{collectionBaseCount === 0 ? "回到书架总览添加已有游戏。" : "换个关键词或清除筛选后再试。"}</span>
                  {collectionBaseCount > 0 && <button className="collection-clear-filter" onClick={clearCollectionFilters}>清除筛选</button>}
                </div>
              )}
            </div>
          </section>
        ) : selected ? (
          <section className="feature">
            <div className="showcase-art">
              {!selectedImage && <Gamepad2 size={72} />}
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

          <div className="cover-row-shell">
            <div
              className="cover-row"
              ref={shelfRef}
              onWheel={(event) => {
                const element = shelfRef.current;
                if (!element) return;
                const amount = horizontalScrollAmount(event, element.clientWidth);
                if (!amount) return;
                event.preventDefault();
                element.scrollBy({ left: amount, behavior: "auto" });
              }}
            >
              {filteredGames.map((game, index) => (
                <button key={game.id} className={`shelf-card ${game.id === selected?.id ? "active" : ""}`} data-game-id={game.id} style={{ '--i': index } as React.CSSProperties} onClick={() => setSelectedId(game.id)} onContextMenu={(e) => openContextMenu(e, game)} aria-label={game.title}>
                  <div className="shelf-cover">
                    {imageCache[game.coverPath] ? <img src={imageCache[game.coverPath]} alt="" decoding="async" /> : <Gamepad2 size={30} />}
                    <span>{game.title}</span>
                  </div>
                </button>
              ))}
            </div>
            <CinemaShelfScrollbar scrollRef={shelfRef} itemCount={filteredGames.length} />
          </div>
        </section>}
      </main>
    </>
  );
}
