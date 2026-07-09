import type { CSSProperties } from "react";
import { formatPlayTime } from "../utils";
import type { LibraryController } from "../useLibrary";

export function ArcadeLayout({ lib }: { lib: LibraryController }) {
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
  const stageNo = selected ? Math.max(1, list.findIndex((g) => g.id === selected.id) + 1) : 0;
  const clock = new Date().toLocaleTimeString("en-GB", { hour12: false });

  const allOn = viewMode === "library" && statusFilter === "全部";
  const favOn = viewMode === "collection";
  const nowOn = viewMode === "library" && statusFilter === "进行中";

  return (
    <div className="ac-root">
      <div className="room" />

      <div className="console">
        <div className="deck-top">
          <div className="badge"><span className="hex">[//]</span> GAL<b>ARCADE</b> <span className="model">mk-VII</span></div>
          <div className="power">
            <span className="led grn" />POWER
            <span className="led amb" />DISK
            <span className="clock">{clock}</span>
          </div>
        </div>

        <div className="deck-body">
          <aside className="pad-left">
            <div className="pad-label">SELECT MODE</div>
            <div className="dpad">
              <button className={`dbtn up ${allOn ? "on" : ""}`} title="全部" onClick={() => { setViewMode("library"); setStatusFilter("全部"); }}><b>全</b><span>ALL</span></button>
              <button className={`dbtn left ${favOn ? "on" : ""}`} title="收藏柜" onClick={() => { setViewMode("collection"); setStatusFilter("全部"); }}><b>柜</b><span>FAV</span></button>
              <button className={`dbtn right ${nowOn ? "on" : ""}`} title="进行中" onClick={() => { setViewMode("library"); setStatusFilter("进行中"); }}><b>读</b><span>NOW</span></button>
              <div className="dhub" />
            </div>
            <div className="pad-label sys">SYSTEM</div>
            <div className="sysrow">
              <button className="sbtn" title="导出备份" onClick={exportBackup}><b>&darr;</b><span>SAVE</span></button>
              <button className="sbtn" title="恢复备份" onClick={importBackup}><b>&uarr;</b><span>LOAD</span></button>
              <button className="sbtn" title="主题设置" onClick={() => setIsThemeOpen(true)}><b>&#9728;</b><span>SKIN</span></button>
            </div>
          </aside>

          <section className="crt-screen">
            <div className="scan" />
            <div className="screen-glow" />

            <div className="hud">
              <div className="hud-search">
                <i>SRCH&gt;</i>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="title / studio / tag" />
                <span className="cur">_</span>
              </div>
              <div className="hud-stat">
                <span><i>TIME</i>{formatPlayTime(totalSeconds)}</span>
                <span><i>ENT</i>{counts.total}</span>
                <span><i>RUN</i>{String(counts.active).padStart(2, "0")}</span>
                <span><i>END</i>{String(counts.done).padStart(2, "0")}</span>
              </div>
            </div>

            {viewMode === "collection" ? (
              <div className="ac-catalog">
                <div className="cat-head"><h2>FAVORITES</h2><span>{collectionGames.length}</span></div>
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
                            {!poster && <div className="cat-empty">NO DATA</div>}
                          </div>
                          <strong>{game.title}</strong>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="cat-empty-state">NO ENTRIES</div>
                )}
              </div>
            ) : selected ? (
              <div className="game-view">
                <div className="poster" style={selectedImage ? { "--poster-img": `url("${selectedImage}")` } as CSSProperties & Record<"--poster-img", string> : undefined}>
                  {selectedImage
                    ? <img src={selectedImage} alt="" />
                    : <div className="poster-empty">NO SIGNAL</div>}
                  <div className="corner tl" /><div className="corner tr" />
                  <div className="corner bl" /><div className="corner br" />
                  <div className="loaded">NOW LOADED</div>
                </div>
                <div className="game-info">
                  <div className="g-id">STAGE {String(stageNo).padStart(3, "0")} . {selected.developer || "UNKNOWN"} . {selected.releaseDate || "----"}</div>
                  <h1>{selected.title}<span className="blink">_</span></h1>
                  <div className="rpg">
                    <div><span>TIME</span><b style={{ "--p": "88%" } as CSSProperties & Record<"--p", string>} /><i>{formatPlayTime(selected.totalPlaySeconds || 0)}</i></div>
                    <div><span>RUNS</span><b style={{ "--p": "62%" } as CSSProperties & Record<"--p", string>} /><i>{selected.playCount}</i></div>
                    <div><span>STATE</span><b style={{ "--p": "41%" } as CSSProperties & Record<"--p", string>} /><i>{selected.status}</i></div>
                  </div>
                  <p className="blurb">&gt; {selected.description || "NO DESCRIPTION DATA. PRESS A TO EDIT ENTRY."}</p>

                  <div className="action-row">
                    <button className="coin" title="添加游戏" onClick={addGame}><b>+</b><span>INSERT<br />COIN</span></button>
                    <button className="ab info" title="资料" onClick={() => setIsInfoOpen(true)}><b>A</b><span>INFO</span></button>
                    <div className="start-wrap">
                      <button className="start" title="启动游戏" onClick={() => launch(selected)}>
                        <span className="ring" />
                        <span className="tri">&#9654;</span>
                        <span className="st">START</span>
                        <span className="ss">PRESS TO PLAY</span>
                      </button>
                      <div className="start-cap">&#9650; 启 动 游 戏 &#9650;</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="game-view empty">
                <div className="game-info">
                  <h1>INSERT GAME<span className="blink">_</span></h1>
                  <p className="blurb">&gt; 卡带槽是空的，投币收录第一部作品。</p>
                  <div className="action-row">
                    <button className="coin" title="添加游戏" onClick={addGame}><b>+</b><span>INSERT<br />COIN</span></button>
                  </div>
                </div>
              </div>
            )}

            {(recentGames.length > 0 || popularTags.length > 0) && (
              <div className="channels">
                {recentGames.length > 0 && <span className="ch-l">RESUME</span>}
                {recentGames.map((g) => (
                  <button key={g.id} className={`ch ${g.id === selected?.id ? "on" : ""}`} onClick={() => { setSelectedId(g.id); setViewMode("library"); setStatusFilter("全部"); setTagFilter(null); }}>
                    {g.title}
                  </button>
                ))}
                {popularTags.length > 0 && <span className="ch-l tag">TAGS</span>}
                {popularTags.map((tag) => (
                  <button key={tag} className={`ch tg ${tagFilter === tag ? "on" : ""}`} onClick={() => setTagFilter(tagFilter === tag ? null : tag)}>
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="cartridge-bay">
          <div className="bay-label">&#9642; SELECT CARTRIDGE</div>
          <div
            className="cart-rail"
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
                  className={`cart ${game.id === selected?.id ? "on" : ""}`}
                  onClick={() => { setSelectedId(game.id); if (viewMode === "collection") setViewMode("library"); }}
                  onContextMenu={(e) => openContextMenu(e, game)}
                >
                  <div className="cart-cv" style={poster ? { backgroundImage: `url("${poster}")` } : undefined} />
                  <span>{String(i + 1).padStart(3, "0")}</span>
                </button>
              );
            })}
            {list.length === 0 && <span className="cart-empty">NO CARTRIDGE</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
