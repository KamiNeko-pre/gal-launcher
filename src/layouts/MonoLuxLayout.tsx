import { formatPlayTime } from "../utils";
import type { LibraryController } from "../useLibrary";

export function MonoLuxLayout({ lib }: { lib: LibraryController }) {
  const {
    query, setQuery,
    statusFilter, setStatusFilter,
    viewMode, setViewMode,
    setIsInfoOpen,
    setIsThemeOpen,
    imageCache,
    selected,
    selectedImage,
    filteredGames,
    collectionGames,
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
  const no = idx >= 0 ? idx + 1 : 0;

  const allOn = viewMode === "library" && statusFilter === "全部";
  const favOn = viewMode === "collection";
  const nowOn = viewMode === "library" && statusFilter === "进行中";

  function walk(dir: -1 | 1) {
    if (!list.length) return;
    const base = idx < 0 ? 0 : idx;
    const target = list[(base + dir + list.length) % list.length];
    if (target) {
      setSelectedId(target.id);
      if (viewMode === "collection") setViewMode("library");
    }
  }

  const nearLeft = list[(idx - 1 + list.length) % list.length];
  const nearRight = list[(idx + 1) % list.length];
  const img = (g?: typeof selected) => (g ? imageCache[g.coverPath] || imageCache[g.backgroundPath] : "");

  return (
    <div className="ml-root">
      <div className="grain" />

      <header className="lintel">
        <div className="house">
          <span className="g">L</span><span className="l">S</span>
          <em>LUMEN SHELF</em>
        </div>
        <nav className="guide">
          <button className={`gtab ${allOn ? "on" : ""}`} title="全部作品" onClick={() => { setViewMode("library"); setStatusFilter("全部"); }}>全库</button>
          <button className={`gtab ${favOn ? "on" : ""}`} title="收藏书架" onClick={() => { setViewMode("collection"); setStatusFilter("全部"); }}>书架</button>
          <button className={`gtab ${nowOn ? "on" : ""}`} title="进行中" onClick={() => { setViewMode("library"); setStatusFilter("进行中"); }}>续读</button>
        </nav>
        <label className="seek"><i>SEARCH</i><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="title / studio / tag" /><span className="kbd">/</span></label>
        <div className="curator">
          <button className="cbtn" title="导出备份" onClick={exportBackup}><i>↓</i><em>导出</em></button>
          <button className="cbtn" title="恢复备份" onClick={importBackup}><i>↑</i><em>恢复</em></button>
          <button className="cbtn" title="主题设置" onClick={() => setIsThemeOpen(true)}><i>☼</i><em>主题</em></button>
          <button className="cbtn add" title="添加游戏" onClick={addGame}><i>+</i><em>添加</em></button>
        </div>
      </header>

      {viewMode === "collection" ? (
        <main className="gallery catalog-gallery">
          <div className="cat-head"><h2>书架目录</h2><span>{collectionGames.length} titles</span></div>
          {collectionGames.length > 0 ? (
            <div className="cat-grid">
              {collectionGames.map((game, i) => {
                const cv = img(game);
                return (
                  <button
                    key={game.id}
                    className={`cat-card ${game.id === selected?.id ? "on" : ""}`}
                    onClick={() => { setSelectedId(game.id); setViewMode("library"); }}
                    onContextMenu={(e) => openContextMenu(e, game)}
                  >
                    <div className="cat-art" style={cv ? { backgroundImage: `url("${cv}")` } : undefined}>
                      {!cv && <span className="cat-empty">N&deg;</span>}
                    </div>
                    <span className="pn">{String(i + 1).padStart(3, "0")}</span>
                    <b>{game.title}</b>
                    <em>{game.developer || "Unknown studio"}</em>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="cat-empty-state">书架暂空</div>
          )}
        </main>
      ) : selected ? (
        <main className="gallery">
          <button className="walk left" title="上一部" onClick={() => walk(-1)}>‹</button>

          <div className="wall">
            {img(nearLeft) && nearLeft !== selected && <figure className="frame near ll" style={{ "--img": `url("${img(nearLeft)}")` } as React.CSSProperties} />}

            <figure className="frame focus">
              <div className="art" style={selectedImage ? { backgroundImage: `url("${selectedImage}")` } : undefined}>
                {!selectedImage && <div className="art-empty">N&deg; {String(no).padStart(3, "0")}</div>}
              </div>
              <figcaption className="plaque">
                <span className="no">N&deg; {String(no).padStart(3, "0")}</span>
                <strong>{selected.title}</strong>
                <em>{selected.developer || "Unknown"} · {selected.releaseDate || "No date"}</em>
              </figcaption>
            </figure>

            {img(nearRight) && nearRight !== selected && <figure className="frame near rr" style={{ "--img": `url("${img(nearRight)}")` } as React.CSSProperties} />}
          </div>

          <button className="walk right" title="下一部" onClick={() => walk(1)}>›</button>

          <aside className="placard">
            <div className="kicker">CURRENT TITLE · {String(no).padStart(3, "0")}</div>
            <h1><span className="serif">{selected.title}</span>{selected.originalTitle && <span className="thin">{selected.originalTitle}</span>}</h1>
            {selected.description && <p className="lede">{selected.description}</p>}
            <dl className="spec">
              <dt>Studio</dt><dd>{selected.developer || "Unknown"}</dd>
              <dt>Date</dt><dd>{selected.releaseDate || "No date"}</dd>
              <dt>Time</dt><dd>{formatPlayTime(selected.totalPlaySeconds || 0)} · {selected.playCount} 次</dd>
              <dt>Status</dt><dd>{selected.status}</dd>
            </dl>

            <button className="enter" title="启动游戏" onClick={() => launch(selected)}>
              <span className="tri">&#9654;</span>
              <span className="et">启动游戏</span>
              <span className="es">LAUNCH</span>
            </button>
            <button className="catalogue" title="资料" onClick={() => setIsInfoOpen(true)}>资料卡 · INFO</button>
          </aside>
        </main>
      ) : (
        <main className="gallery">
          <aside className="placard placard-empty">
            <div className="kicker">EMPTY SHELF</div>
            <h1><span className="serif">书架待点亮</span></h1>
            <p className="lede">添加第一部作品后，这里会生成明亮的索引桌面。</p>
            <button className="enter" title="添加游戏" onClick={addGame}>
              <span className="tri">+</span>
              <span className="et">添加作品</span>
              <span className="es">ADD NEW</span>
            </button>
          </aside>
        </main>
      )}

      <footer className="index-bar">
        <div className="ib-head">
          <span className="ibl">{viewMode === "collection" ? "书架目录 · SHELF" : "作品索引 · LIBRARY"}</span>
          <span className="ibc">{list.length > 0 ? `001 - ${String(list.length).padStart(3, "0")}` : "000"}</span>
        </div>
        <div
          className="plates"
          ref={shelfRef}
          onWheel={(event) => {
            const element = shelfRef.current;
            if (!element) return;
            element.scrollLeft += event.deltaY || event.deltaX;
          }}
        >
          {list.map((game, i) => {
            const cv = img(game);
            return (
              <button
                key={game.id}
                className={`plate ${game.id === selected?.id ? "on" : ""}`}
                onClick={() => { setSelectedId(game.id); if (viewMode === "collection") setViewMode("library"); }}
                onContextMenu={(e) => openContextMenu(e, game)}
              >
                <div className="pcv" style={cv ? { backgroundImage: `url("${cv}")` } : undefined} />
                <span className="pn">{String(i + 1).padStart(3, "0")}</span>
                <b>{game.title}</b>
              </button>
            );
          })}
          {list.length === 0 && <span className="plates-empty">没有匹配作品</span>}
        </div>
      </footer>
    </div>
  );
}
