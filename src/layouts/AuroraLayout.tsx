import { formatPlayTime } from "../utils";
import type { LibraryController } from "../useLibrary";

export function AuroraLayout({ lib }: { lib: LibraryController }) {
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
    recentGames,
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
  const idx = selected ? list.findIndex((g) => g.id === selected.id) : -1;

  const allOn = viewMode === "library" && statusFilter === "全部";
  const favOn = viewMode === "collection";
  const nowOn = viewMode === "library" && statusFilter === "进行中";

  function step(dir: -1 | 1) {
    if (!list.length) return;
    const base = idx < 0 ? 0 : idx;
    const target = list[(base + dir + list.length) % list.length];
    if (target) { setSelectedId(target.id); if (viewMode === "collection") setViewMode("library"); }
  }

  const ghostLeft = idx > 0 ? list[idx - 1] : list[list.length - 1];
  const ghostRight = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : list[0];
  const ghostLeftImg = ghostLeft ? imageCache[ghostLeft.coverPath] || imageCache[ghostLeft.backgroundPath] : "";
  const ghostRightImg = ghostRight ? imageCache[ghostRight.coverPath] || imageCache[ghostRight.backgroundPath] : "";

  return (
    <div className="au-root">
      <div className="sky" />
      <div className="aurora a1" />
      <div className="aurora a2" />
      <div className="aurora a3" />
      <div className="stars" />

      <header className="float-top">
        <div className="brand"><span className="orb" /><strong>Aurora</strong></div>
        <nav className="orbs">
          <button className={`orbtn ${allOn ? "on" : ""}`} title="全部" onClick={() => { setViewMode("library"); setStatusFilter("全部"); }}><i>◉</i><em>全部</em></button>
          <button className={`orbtn ${favOn ? "on" : ""}`} title="收藏柜" onClick={() => { setViewMode("collection"); setStatusFilter("全部"); }}><i>♡</i><em>收藏</em></button>
          <button className={`orbtn ${nowOn ? "on" : ""}`} title="进行中" onClick={() => { setViewMode("library"); setStatusFilter("进行中"); }}><i>◐</i><em>进行</em></button>
          <span className="osep" />
          <button className="orbtn" title="导出备份" onClick={exportBackup}><i>↓</i><em>导出</em></button>
          <button className="orbtn" title="恢复备份" onClick={importBackup}><i>↑</i><em>恢复</em></button>
          <button className="orbtn" title="主题设置" onClick={() => setIsThemeOpen(true)}><i>☀</i><em>主题</em></button>
          <button className="orbtn add" title="添加游戏" onClick={addGame}><i>+</i><em>添加</em></button>
        </nav>
      </header>

      <label className="float-search"><i>⌕</i><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题、会社、标签" /><span className="kbd">/</span></label>

      <main className="theater">
        <aside className="glass stat-card">
          <h3>今夜</h3>
          <div className="big-time">{formatPlayTime(totalSeconds)}</div>
          <span className="cap">累计阅读</span>
          <div className="mini-stats">
            <div><b>{counts.total}</b><i>收录</i></div>
            <div><b>{counts.active}</b><i>进行</i></div>
            <div><b>{counts.done}</b><i>通关</i></div>
            <div><b>{list.length}</b><i>当前</i></div>
          </div>
          {selected && (
            <div className="prog">
              <div className="pbar"><i style={{ width: "68%" }} /></div>
              <span>{selected.status}</span>
            </div>
          )}
        </aside>

        <section className="stage-center">
          {viewMode === "collection" ? (
            <div className="au-collection">
              <div className="au-collection-head">
                <span>收藏柜</span>
                <strong>{collectionGames.length} 部作品</strong>
              </div>
              {collectionGames.length > 0 ? (
                <div className="au-collection-grid">
                  {collectionGames.map((game) => {
                    const cv = imageCache[game.coverPath] || imageCache[game.backgroundPath];
                    return (
                      <button
                        key={game.id}
                        className={`au-collection-card ${game.id === selected?.id ? "on" : ""}`}
                        onClick={() => { setSelectedId(game.id); setViewMode("library"); }}
                        onContextMenu={(e) => openContextMenu(e, game)}
                      >
                        <span className="au-collection-art" style={cv ? { backgroundImage: `url("${cv}")` } : undefined}>
                          {!cv && <i>{game.title.slice(0, 2)}</i>}
                        </span>
                        <b>{game.title}</b>
                        <em>{game.developer || game.status}</em>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="au-collection-empty">收藏柜还没有作品</div>
              )}
            </div>
          ) : selected ? (
            <>
              <button className="nav prev" title="上一部" onClick={() => step(-1)}>‹</button>

              <div className="cover-stack">
                {ghostLeftImg && <div className="ghost-cover left" style={{ backgroundImage: `url("${ghostLeftImg}")` }} />}
                {ghostRightImg && <div className="ghost-cover right" style={{ backgroundImage: `url("${ghostRightImg}")` }} />}
                <div className="cover-main">
                  <div className="cover-img" style={selectedImage ? { backgroundImage: `url("${selectedImage}")` } : undefined}>
                    {!selectedImage && <div className="cover-empty">无封面</div>}
                  </div>
                  <div className="cover-glow" />
                </div>
              </div>

              <button className="nav next" title="下一部" onClick={() => step(1)}>›</button>

              <div className="title-block">
                <span className="meta">{selected.developer || "—"} ・ {selected.releaseDate || "—"} ・ {selected.tags.slice(0, 2).join(" / ") || "VISUAL NOVEL"}</span>
                <h1>{selected.title}</h1>
                {selected.originalTitle && <p className="sub">{selected.originalTitle}</p>}

                <div className="acts">
                  <button className="play" title="启动游戏" onClick={() => launch(selected)}>
                    <span className="halo" />
                    <span className="tri" />
                    <span className="lbl">启动游戏</span>
                    <span className="sub-lbl">LAUNCH</span>
                  </button>
                  <button className="ghost" title="资料" onClick={() => setIsInfoOpen(true)}>资料</button>
                </div>
              </div>

              {popularTags.length > 0 && (
                <div className="tagline">
                  {popularTags.map((tag) => (
                    <button key={tag} className={`tg ${tagFilter === tag ? "on" : ""}`} onClick={() => setTagFilter(tagFilter === tag ? null : tag)}>{tag}</button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="title-block">
              <h1>夜空还很安静</h1>
              <p className="sub">添加第一部作品，点亮你的极光收藏。</p>
              <div className="acts">
                <button className="play" title="添加游戏" onClick={addGame}>
                  <span className="halo" />
                  <span className="tri" />
                  <span className="lbl">添加游戏</span>
                  <span className="sub-lbl">ADD</span>
                </button>
              </div>
            </div>
          )}
        </section>

        <aside className="glass queue-card">
          <h3>续读</h3>
          <ul className="queue">
            {recentGames.map((g) => {
              const cv = imageCache[g.coverPath] || imageCache[g.backgroundPath];
              return (
                <li
                  key={g.id}
                  className={g.id === selected?.id ? "on" : ""}
                  onClick={() => { setSelectedId(g.id); setViewMode("library"); setStatusFilter("全部"); setTagFilter(null); }}
                  onContextMenu={(e) => openContextMenu(e, g)}
                >
                  <div className="qcv" style={cv ? { backgroundImage: `url("${cv}")` } : undefined} />
                  <div><b>{g.title}</b><span>{g.developer || g.status}</span></div>
                </li>
              );
            })}
            {recentGames.length === 0 && <li className="queue-empty">还没有游玩记录</li>}
          </ul>
        </aside>
      </main>

      <footer className="filmstrip">
        <span className="fl">{viewMode === "collection" ? "收藏柜" : "全部作品"} ・ {list.length}</span>
        <div
          className="strip"
          ref={shelfRef}
          onWheel={(event) => {
            const element = shelfRef.current;
            if (!element) return;
            element.scrollLeft += event.deltaY || event.deltaX;
          }}
        >
          {list.map((game) => {
            const cv = imageCache[game.coverPath] || imageCache[game.backgroundPath];
            return (
              <button
                key={game.id}
                className={`frame ${game.id === selected?.id ? "on" : ""}`}
                style={cv ? { backgroundImage: `url("${cv}")` } : undefined}
                title={game.title}
                onClick={() => { setSelectedId(game.id); if (viewMode === "collection") setViewMode("library"); }}
                onContextMenu={(e) => openContextMenu(e, game)}
              >
                {!cv && <span className="frame-empty">{game.title.slice(0, 2)}</span>}
              </button>
            );
          })}
          {list.length === 0 && <span className="strip-empty">没有匹配作品</span>}
        </div>
      </footer>
    </div>
  );
}
