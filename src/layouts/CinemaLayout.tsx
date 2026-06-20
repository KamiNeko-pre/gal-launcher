import React from "react";
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
  Upload
} from "lucide-react";
import { formatPlayTime } from "../utils";
import type { LibraryController } from "../useLibrary";

export function CinemaLayout({ lib }: { lib: LibraryController }) {
  const {
    query, setQuery,
    statusFilter, setStatusFilter,
    viewMode, setViewMode,
    setIsInfoOpen,
    setIsThemeOpen,
    imageCache,
    tagFilter, setTagFilter,
    shelfRef,
    selected,
    selectedImage,
    fadingImage,
    filteredGames,
    collectionGames,
    remoteImagePaths,
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
      <div className="image-preload" aria-hidden="true">
        {remoteImagePaths.map((imagePath) => (
          <img key={imagePath} src={imagePath} alt="" />
        ))}
      </div>
      <div className="backdrop" style={{ backgroundImage: selectedImage ? `url("${selectedImage}")` : undefined }} />
      {fadingImage && <div className="backdrop fading" style={{ backgroundImage: `url("${fadingImage}")` }} />}
      <div className="backdrop-mask" />

      <aside className="rail">
        <div className="rail-logo">
          <Gamepad2 size={24} />
        </div>
        <button className={viewMode === "library" && statusFilter === "全部" ? "rail-button active" : "rail-button"} aria-label="全部游戏" onClick={() => { setViewMode("library"); setStatusFilter("全部"); }}>
          <Home size={20} />
        </button>
        <button className={viewMode === "collection" ? "rail-button active" : "rail-button"} aria-label="收藏展示柜" onClick={() => { setViewMode("collection"); setStatusFilter("全部"); }}>
          <Library size={20} />
        </button>
        <button className={viewMode === "library" && statusFilter === "进行中" ? "rail-button active" : "rail-button"} aria-label="进行中" onClick={() => { setViewMode("library"); setStatusFilter("进行中"); }}>
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
            <Search size={18} />
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
              {collectionGames.map((game) => {
                const posterImage = imageCache[game.coverPath] || imageCache[game.backgroundPath];
                return (
                  <button
                    key={game.id}
                    className="collection-poster-card"
                    aria-label={game.title}
                    onContextMenu={(e) => openContextMenu(e, game)}
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

          <div
            className="cover-row"
            ref={shelfRef}
            onWheel={(event) => {
              const element = shelfRef.current;
              if (!element) return;
              element.scrollLeft += event.deltaY || event.deltaX;
            }}
          >
            {filteredGames.map((game, index) => (
              <button key={game.id} className={`shelf-card ${game.id === selected?.id ? "active" : ""}`} style={{ '--i': index } as React.CSSProperties} onClick={() => setSelectedId(game.id)} onContextMenu={(e) => openContextMenu(e, game)} aria-label={game.title}>
                <div className="shelf-cover">
                  {imageCache[game.coverPath] ? <img src={imageCache[game.coverPath]} alt="" /> : <Gamepad2 size={30} />}
                  <span>{game.title}</span>
                </div>
              </button>
            ))}
          </div>
        </section>}
      </main>
    </>
  );
}
