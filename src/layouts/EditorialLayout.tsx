import { useState } from "react";
import { formatPlayTime } from "../utils";
import type { LibraryController } from "../useLibrary";

export function EditorialLayout({ lib }: { lib: LibraryController }) {
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

  const [turning, setTurning] = useState<{ dir: "prev" | "next"; targetId: string } | null>(null);

  const list = viewMode === "collection" ? collectionGames : filteredGames;
  const folio = selected ? Math.max(1, list.findIndex((g) => g.id === selected.id) + 1) : 0;
  const progressTag = selected?.status ?? "";

  function flip(dir: "prev" | "next") {
    if (!list.length || turning) return;
    const idx = selected ? list.findIndex((g) => g.id === selected.id) : 0;
    const target = dir === "prev"
      ? list[(idx - 1 + list.length) % list.length]
      : list[(idx + 1) % list.length];
    if (!target || target.id === selected?.id) return;
    setTurning({ dir, targetId: target.id });
    setTimeout(() => setSelectedId(target.id), 480);
  }

  function finishFlip() {
    setTurning(null);
  }

  return (
    <div className="ed-root">
      <div className="paper" />

      <header className="masthead">
        <div className="brand">
          <div className="mark">G/L</div>
          <div className="info">
            <strong>GAL ATELIER</strong>
            <em>Library . {counts.total} works</em>
          </div>
        </div>

        <div className="search">
          <i>检索</i>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题、会社、标签" />
          <span className="kbd">/</span>
        </div>

        <nav className="toolbar" aria-label="功能">
          <button className={`tool ${viewMode === "library" && statusFilter === "全部" ? "on" : ""}`} title="全部" onClick={() => { setViewMode("library"); setStatusFilter("全部"); }}><b>全</b><span>全部</span></button>
          <button className={`tool ${viewMode === "collection" ? "on" : ""}`} title="收藏柜" onClick={() => { setViewMode("collection"); setStatusFilter("全部"); }}><b>柜</b><span>收藏</span></button>
          <button className={`tool ${viewMode === "library" && statusFilter === "进行中" ? "on" : ""}`} title="进行中" onClick={() => { setViewMode("library"); setStatusFilter("进行中"); }}><b>读</b><span>进行</span></button>
          <span className="tsep" />
          <button className="tool" title="导出备份" onClick={exportBackup}><b>&darr;</b><span>导出</span></button>
          <button className="tool" title="恢复备份" onClick={importBackup}><b>&uarr;</b><span>恢复</span></button>
          <button className="tool" title="主题设置" onClick={() => setIsThemeOpen(true)}><b>&#9728;</b><span>主题</span></button>
          <button className="tool add" title="添加游戏" onClick={addGame}><b>+</b><span>收录</span></button>
        </nav>
      </header>

      <div className="ribbon">
        <div className="circ">
          <span className="ci"><b>{formatPlayTime(totalSeconds)}</b>累计阅读</span>
          <span className="ci"><b>{counts.total}</b>收录</span>
          <span className="ci"><b>{counts.active}</b>连载中</span>
          <span className="ci"><b>{counts.done}</b>已完结</span>
        </div>
        {recentGames.length > 0 && (
          <div className="resume">
            <span className="rl">续读</span>
            {recentGames.map((g) => (
              <button key={g.id} className={`rchip ${g.id === selected?.id ? "on" : ""}`} onClick={() => { setSelectedId(g.id); setViewMode("library"); setStatusFilter("全部"); setTagFilter(null); }}>
                {g.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {popularTags.length > 0 && (
        <div className="topics">
          <span className="topl">专题</span>
          {popularTags.map((tag) => (
            <button key={tag} className={`topic ${tagFilter === tag ? "on" : ""}`} onClick={() => setTagFilter(tagFilter === tag ? null : tag)}>
              {tag}
            </button>
          ))}
        </div>
      )}

      {viewMode === "collection" ? (
        <main className="catalog">
          <div className="cat-head">
            <h2>收藏柜</h2>
            <span>{collectionGames.length} 部</span>
          </div>
          {collectionGames.length > 0 ? (
            <div className="cat-grid">
              {collectionGames.map((game) => {
                const poster = imageCache[game.coverPath] || imageCache[game.backgroundPath];
                return (
                  <button
                    key={game.id}
                    className={`cat-card ${game.id === selected?.id ? "on" : ""}`}
                    onClick={() => { setSelectedId(game.id); setViewMode("library"); }}
                    onContextMenu={(e) => openContextMenu(e, game)}
                  >
                    <div className="cat-art" style={poster ? { backgroundImage: `url("${poster}")` } : undefined}>
                      {!poster && <div className="cat-empty">NO IMAGE</div>}
                    </div>
                    <div className="cat-info">
                      <strong>{game.title}</strong>
                      <em>{game.developer || game.status}</em>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="cat-empty-state">暂无匹配作品</div>
          )}
        </main>
      ) : selected ? (
        <main className={`spread ${turning ? `turn-${turning.dir}` : ""}`}>
          <div className="binding" />
          {turning && <div className="turning-page" onAnimationEnd={finishFlip} />}

          <section className="page left">
            <div className="folio">p. {String(folio).padStart(3, "0")}</div>
            <div className="plate" style={{ backgroundImage: selectedImage ? `url("${selectedImage}")` : undefined }}>
              {selectedImage && <div className="plate-img" style={{ backgroundImage: `url("${selectedImage}")` }} />}
              {!selectedImage && <div className="plate-empty">NO IMAGE</div>}
              <div className="plate-cap">封面故事 . COVER STORY</div>
            </div>
            <div className="caption">
              <span>{selected.title}</span>
              <em>{selected.developer || "Visual Novel"} . {selected.releaseDate || "—"}</em>
            </div>
          </section>

          <section className="page right">
            <div className="folio">p. {String(folio + 1).padStart(3, "0")}</div>
            <div className="kicker">特集 . 第 {String(folio).padStart(3, "0")} 号</div>
            <h1>{selected.title}</h1>
            {selected.originalTitle && <p className="standfirst">{selected.originalTitle}</p>}
            <p className="body-text">
              {selected.description
                ? <><span className="dropcap">{selected.description.slice(0, 1)}</span>{selected.description.slice(1)}</>
                : "暂无简介。点击右侧资料卡补全作品信息，或重新搜索元数据。"}
            </p>
            <dl className="masthead-meta">
              <div><dt>会社</dt><dd>{selected.developer || "—"}</dd></div>
              <div><dt>发售</dt><dd>{selected.releaseDate || "—"}</dd></div>
              <div><dt>时长</dt><dd>{formatPlayTime(totalSeconds && selected.totalPlaySeconds ? selected.totalPlaySeconds : 0)}</dd></div>
              <div><dt>状态</dt><dd>{progressTag}</dd></div>
            </dl>

            <div className="action">
              <button className="launch" onClick={() => launch(selected)}>
                <span className="lg" />
                <span className="tri" />
                <span className="lt">立即阅读</span>
                <span className="ls">LAUNCH . 第 {String(folio).padStart(3, "0")} 号</span>
              </button>
              <button className="dossier" onClick={() => setIsInfoOpen(true)}>资料卡 INFO</button>
            </div>
          </section>
        </main>
      ) : (
        <main className="spread spread-empty">
          <div className="empty-note">
            <h1>书架还是空的</h1>
            <button className="launch" onClick={addGame}>
              <span className="lg" />
              <span className="tri" />
              <span className="lt">收录第一部</span>
              <span className="ls">ADD . NEW</span>
            </button>
          </div>
        </main>
      )}

      <footer className="pager">
        <button className="flip prev" title="上一部" onClick={() => flip("prev")}>&#8249; 前页</button>
        <div
          className="contents"
          role="list"
          ref={shelfRef}
          onWheel={(event) => {
            const element = shelfRef.current;
            if (!element) return;
            element.scrollLeft += event.deltaY || event.deltaX;
          }}
        >
          {list.map((game, i) => (
            <button
              key={game.id}
              className={`toc ${game.id === selected?.id ? "on" : ""}`}
              role="listitem"
              onClick={() => { setSelectedId(game.id); if (viewMode === "collection") setViewMode("library"); }}
              onContextMenu={(e) => openContextMenu(e, game)}
            >
              <span className="tn">{String(i + 1).padStart(3, "0")}</span>
              <span className="tt">{game.title}</span>
            </button>
          ))}
          {list.length === 0 && <span className="toc-empty">没有匹配作品</span>}
        </div>
        <button className="flip next" title="下一部" onClick={() => flip("next")}>后页 &#8250;</button>
      </footer>
    </div>
  );
}
