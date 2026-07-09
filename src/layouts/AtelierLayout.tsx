import { formatPlayTime } from "../utils";
import type { LibraryController } from "../useLibrary";

export function AtelierLayout({ lib }: { lib: LibraryController }) {
  const {
    query, setQuery,
    statusFilter, setStatusFilter,
    viewMode, setViewMode,
    setIsInfoOpen,
    setIsThemeOpen,
    imageCache,
    tagFilter, setTagFilter,
    selected,
    selectedImage,
    filteredGames,
    collectionGames,
    counts,
    totalSeconds,
    popularTags,
    setSelectedId,
    addGame,
    launch,
    exportBackup,
    importBackup,
    openContextMenu,
    shelfRef
  } = lib;

  const list = viewMode === "collection" ? collectionGames : filteredGames;
  const no = selected ? Math.max(1, list.findIndex((g) => g.id === selected.id) + 1) : 0;
  const lastPlayed = selected?.lastPlayedAt ? new Date(selected.lastPlayedAt) : null;

  const allOn = viewMode === "library" && statusFilter === "全部";
  const favOn = viewMode === "collection";
  const nowOn = viewMode === "library" && statusFilter === "进行中";

  return (
    <div className="at-root">
      <div className="desk" />

      <div className="clipbar">
        <div className="logo"><span className="stamp">GAL</span><strong>atelier</strong><em>～ 我的视觉小说手账</em></div>
        <label className="search"><span>q.</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题、会社、标签" /></label>
        <div className="clips">
          <button className={`clip ${allOn ? "on" : ""}`} title="全部" onClick={() => { setViewMode("library"); setStatusFilter("全部"); }}><span>全部</span></button>
          <button className={`clip ${favOn ? "on" : ""}`} title="收藏柜" onClick={() => { setViewMode("collection"); setStatusFilter("全部"); }}><span>收藏</span></button>
          <button className={`clip ${nowOn ? "on" : ""}`} title="进行中" onClick={() => { setViewMode("library"); setStatusFilter("进行中"); }}><span>进行</span></button>
          <button className="clip" title="主题设置" onClick={() => setIsThemeOpen(true)}><span>主题</span></button>
        </div>
      </div>

      {viewMode === "collection" ? (
        <main className="board catalog-board">
          <div className="cat-head"><h2>我的相册</h2><span>{collectionGames.length} 张</span></div>
          {collectionGames.length > 0 ? (
            <div className="cat-grid">
              {collectionGames.map((game, i) => {
                const poster = imageCache[game.coverPath] || imageCache[game.backgroundPath];
                return (
                  <button
                    key={game.id}
                    className={`cat-card ${game.id === selected?.id ? "on" : ""}`}
                    style={{ "--r": `${((i % 5) - 2) * 1.6}deg` } as React.CSSProperties}
                    onClick={() => { setSelectedId(game.id); setViewMode("library"); }}
                    onContextMenu={(e) => openContextMenu(e, game)}
                  >
                    <div className="cat-ph" style={poster ? { backgroundImage: `url("${poster}")` } : undefined}>
                      {!poster && <div className="cat-empty">no photo</div>}
                    </div>
                    <span>{game.title}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="cat-empty-state">相册里还没有照片</div>
          )}
        </main>
      ) : selected ? (
        <main className="board">
          <article className="hero-polaroid" style={{ "--rot": "-1.5deg" } as React.CSSProperties}>
            <div className="washi top" />
            <div className="ph" style={selectedImage ? { backgroundImage: `url("${selectedImage}")` } : undefined}>
              {!selectedImage && <div className="ph-empty">no photo</div>}
            </div>
            <div className="hand">
              <span className="num">No.{String(no).padStart(3, "0")} ・ {selected.developer || "—"} ・ {selected.releaseDate || "—"}</span>
              <h1>{selected.title}</h1>
              {selected.originalTitle && <p className="kana">{selected.originalTitle}</p>}
              <p className="memo">{selected.description || "还没有写下感想，点开资料卡补全这部作品 ♡"}</p>
              <div className="rate"><em>{selected.status} ・ {formatPlayTime(selected.totalPlaySeconds || 0)}</em></div>
            </div>
            <button className="play-stamp" title="启动游戏" onClick={() => launch(selected)}>
              <span className="ink" />
              <span className="pt">▶ PLAY</span>
              <span className="ps">点 此 开 始</span>
            </button>
          </article>

          <aside className="note ynote" style={{ "--rot": "3deg" } as React.CSSProperties}>
            <strong>上次游玩</strong>
            <p>{lastPlayed ? `${lastPlayed.getFullYear()}.${String(lastPlayed.getMonth() + 1).padStart(2, "0")}.${String(lastPlayed.getDate()).padStart(2, "0")}` : "尚未游玩"}</p>
            <em>启动 {selected.playCount} 次</em>
          </aside>

          <button className="note info-note" style={{ "--rot": "-2.4deg" } as React.CSSProperties} title="资料" onClick={() => setIsInfoOpen(true)}>
            <strong>翻看资料 →</strong>
            <p>会社・发售日<br />标签・简介</p>
            <em>INFO</em>
          </button>

          <aside className="ticket" style={{ "--rot": "1.6deg" } as React.CSSProperties}>
            <span>READING LOG</span>
            <div className="trow"><b>{formatPlayTime(totalSeconds)}</b><i>累计</i></div>
            <div className="trow"><b>{counts.total}</b><i>收录</i></div>
            <div className="trow"><b>{counts.active} / {counts.done}</b><i>进行 / 通关</i></div>
          </aside>

          {popularTags.length > 0 && (
            <div className="tagstrip" style={{ "--rot": "-1deg" } as React.CSSProperties}>
              <span className="tl">tags ♪</span>
              {popularTags.map((tag) => (
                <button key={tag} className={`tg ${tagFilter === tag ? "on" : ""}`} onClick={() => setTagFilter(tagFilter === tag ? null : tag)}>{tag}</button>
              ))}
            </div>
          )}

          <button className="add-pin" title="添加游戏" onClick={addGame}><b>+</b><span>夹一张<br />新照片</span></button>

          <div className="paperclips">
            <button className="pclip" title="导出备份" onClick={exportBackup}><b>↓</b><span>导出</span></button>
            <button className="pclip" title="恢复备份" onClick={importBackup}><b>↑</b><span>恢复</span></button>
          </div>
        </main>
      ) : (
        <main className="board">
          <article className="hero-polaroid empty" style={{ "--rot": "-1.5deg" } as React.CSSProperties}>
            <div className="hand">
              <h1>相册还是空的</h1>
              <p className="memo">夹一张新照片，开始你的视觉小说手账 ♡</p>
            </div>
            <button className="play-stamp" title="添加游戏" onClick={addGame}>
              <span className="ink" />
              <span className="pt">+ ADD</span>
              <span className="ps">收 录 第 一 部</span>
            </button>
          </article>
        </main>
      )}

      <footer className="album">
        <span className="album-l">— 我的相册 ・ {list.length} 张 —</span>
        <div
          className="scatter"
          ref={shelfRef}
          onWheel={(event) => {
            const element = shelfRef.current;
            if (!element) return;
            element.scrollLeft += event.deltaY || event.deltaX;
          }}
        >
          {list.map((game, i) => {
            const poster = imageCache[game.coverPath] || imageCache[game.backgroundPath];
            return (
              <button
                key={game.id}
                className={`snap ${game.id === selected?.id ? "on" : ""}`}
                style={{ "--r": `${((i % 5) - 2) * 2}deg` } as React.CSSProperties}
                onClick={() => { setSelectedId(game.id); if (viewMode === "collection") setViewMode("library"); }}
                onContextMenu={(e) => openContextMenu(e, game)}
              >
                <div className="s-ph" style={poster ? { backgroundImage: `url("${poster}")` } : undefined} />
                <span>{game.title}</span>
              </button>
            );
          })}
          {list.length === 0 && <span className="scatter-empty">还没有照片</span>}
        </div>
      </footer>
    </div>
  );
}
