import React, { useEffect, useState } from "react";
import { ArrowDownUp, BookOpen, Check, Gamepad2, Library, Pencil, Plus, Search, Tags, Trash2, X } from "lucide-react";
import type { LibraryController } from "../useLibrary";
import "./BookshelfCollectionOverlay.css";

export function BookshelfCollectionOverlay({ lib }: { lib: LibraryController }) {
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [organizing, setOrganizing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [destination, setDestination] = useState("");
  const [addingTo, setAddingTo] = useState("");
  const [topicInput, setTopicInput] = useState("");
  const shelf = lib.bookshelves.find(item => item.id === lib.collectionBookshelfId);
  const targetShelf = lib.bookshelves.find(item => item.id === addingTo);
  const displayed = lib.collectionGames.filter(game => !addingTo || !game.bookshelfIds?.includes(addingTo));
  const topics = Array.from(lib.games.reduce((counts, game) => {
    for (const tag of game.tags) if (tag.trim()) counts.set(tag, (counts.get(tag) || 0) + 1);
    return counts;
  }, new Map<string, number>()).entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"));
  const activeTopic = lib.tagFilters[0] || "";

  useEffect(() => {
    setSelectedIds(current => current.filter(id => lib.collectionGames.some(game => game.id === id)));
  }, [lib.collectionGames]);

  const enter = (scope: "all" | "unfiled" | "shelf", id = "") => {
    lib.selectCollectionScope(scope, id);
    setOrganizing(false);
    setSelectedIds([]);
    setAddingTo("");
    setTopicInput("");
  };

  const enterTopic = (topic: string) => {
    lib.clearCollectionFilters();
    lib.selectCollectionScope("all");
    lib.setTagFilter(topic || null);
    setOrganizing(false);
    setSelectedIds([]);
    setAddingTo("");
  };

  const startAdding = (id: string) => {
    lib.clearCollectionFilters();
    lib.selectCollectionScope("all");
    setAddingTo(id);
    setDestination(id);
    setOrganizing(true);
    setSelectedIds([]);
  };

  const submitCreate = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const created = lib.createBookshelf(newName);
      setNewName("");
      setCreating(false);
      setError("");
      startAdding(created.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建分类失败");
    }
  };

  const assign = () => {
    const target = addingTo || destination;
    if (!target || !selectedIds.length) return;
    lib.addGamesToBookshelves(selectedIds, [target]);
    lib.setNotice(`已将 ${selectedIds.length} 部游戏加入分类`);
    enter("shelf", target);
  };

  const assignTopic = () => {
    const topic = topicInput.trim();
    if (!topic || !selectedIds.length) return;
    lib.addTagsToGames(selectedIds, [topic]);
    lib.setNotice(`已为 ${selectedIds.length} 部游戏添加题材「${topic}」`);
    setTopicInput("");
    setSelectedIds([]);
  };

  const currentName = addingTo
    ? `为「${targetShelf?.name || "分类"}」添加游戏`
    : activeTopic ? `题材 · ${activeTopic}` : lib.collectionScope === "unfiled" ? "未分类" : shelf?.name || "全部游戏";

  return (
    <div className="bookshelf-collection-overlay category-workspace" role="dialog" aria-modal="true" aria-label="分类">
      <header className="category-header">
        <div><Library size={22} /><strong>我的分类</strong><span>给收藏的故事分个位置</span></div>
        <button onClick={() => lib.setIsCategoriesOpen(false)}><X size={17} /> 返回书架</button>
      </header>

      <div className="category-body">
        <aside className="category-directory">
          <button className={lib.collectionScope === "all" && !addingTo ? "active" : ""} onClick={() => enter("all")}>
            <Library size={18} /><span>全部游戏</span><small>{lib.games.length}</small>
          </button>
          {lib.games.some(game => !game.bookshelfIds?.length) && <button className={lib.collectionScope === "unfiled" ? "active" : ""} onClick={() => enter("unfiled")}>
            <BookOpen size={18} /><span>未分类</span><small>{lib.games.filter(game => !game.bookshelfIds?.length).length}</small>
          </button>}

          <div className="category-directory-label"><span>自定义分类</span><button aria-label="新建分类" onClick={() => setCreating(true)}><Plus size={17} /></button></div>
          <nav className="category-folders">
            {lib.bookshelves.map(item => (
              <button key={item.id} className={shelf?.id === item.id || addingTo === item.id ? "active" : ""} onClick={() => enter("shelf", item.id)}>
                <i /><span>{item.name}</span><small>{lib.games.filter(game => game.bookshelfIds?.includes(item.id)).length}</small>
              </button>
            ))}
            {!lib.bookshelves.length && <p>可以按题材、系列或心情分类。新建一个，再挑选要放入的游戏。</p>}
          </nav>

          <div className="category-directory-label category-topic-label"><span>按游戏题材</span><Tags size={15} /></div>
          {topics.length > 0
            ? <nav className="category-topics" aria-label="常用游戏题材">{topics.slice(0, 8).map(([topic, count]) => <button key={topic} className={activeTopic === topic ? "active" : ""} onClick={() => enterTopic(topic)}><span>{topic}</span><small>{count}</small></button>)}</nav>
            : <div className="category-topic-empty"><p>暂无题材标签，可以一次选择多部游戏后设置。</p><button onClick={() => { enter("all"); setOrganizing(true); }}>设置游戏题材</button></div>}

          {creating ? (
            <form className="category-create-form" onSubmit={submitCreate}>
              <label htmlFor="category-name">分类名称</label>
              <input id="category-name" autoFocus value={newName} onChange={event => setNewName(event.target.value)} placeholder="例如：悬疑推理" maxLength={36} />
              <div><button type="submit" disabled={!newName.trim()}>创建并选游戏</button><button type="button" onClick={() => setCreating(false)}>取消</button></div>
            </form>
          ) : <button className="category-new" onClick={() => setCreating(true)}><Plus size={17} /> 新建分类</button>}
          {error && <p className="bookshelf-error" role="alert">{error}</p>}
          <p className="category-note">一部游戏可以放进多个分类。删除分类会保留游戏和游玩记录。</p>
        </aside>

        <section className="category-content">
          <div className="category-content-heading">
            <div><h1>{currentName}<small>{displayed.length} 部</small></h1><p>{addingTo ? "勾选作品，然后点击加入分类。" : "点击封面浏览；需要整理时使用批量归类。"}</p></div>
            <div className="category-heading-actions">
              {shelf && !addingTo && <>
                <button onClick={() => startAdding(shelf.id)}><Plus size={16} /> 添加游戏</button>
                <button aria-label="重命名分类" onClick={() => { const name = window.prompt("重命名分类", shelf.name); if (name !== null) { try { lib.renameBookshelf(shelf.id, name); } catch (reason) { setError(String(reason)); } } }}><Pencil size={16} /></button>
                <button aria-label="删除分类" onClick={() => { if (window.confirm(`删除分类“${shelf.name}”？游戏和记录会保留。`)) { lib.deleteBookshelf(shelf.id); enter("all"); } }}><Trash2 size={16} /></button>
              </>}
              {!addingTo && <button className={organizing ? "active" : ""} onClick={() => { setOrganizing(value => !value); setSelectedIds([]); setTopicInput(""); }}>{organizing ? "完成整理" : "批量归类"}</button>}
            </div>
          </div>

          <div className="category-controls">
            <label><Search size={17} /><input aria-label="搜索游戏" placeholder="搜索游戏名称、制作组…" value={lib.query} onChange={event => lib.setQuery(event.target.value)} /></label>
            <select aria-label="排序方式" value={lib.collectionSort} onChange={event => lib.setCollectionSort(event.target.value as typeof lib.collectionSort)}>
              <option value="lastPlayed">最近游玩</option><option value="title">标题 A–Z</option><option value="added">最近添加</option><option value="playTime">游玩时长</option><option value="releaseDate">发售日期</option><option value="rating">我的评分</option>
            </select>
            {topics.length > 0 && <select aria-label="游戏题材" value={activeTopic} onChange={event => enterTopic(event.target.value)}><option value="">全部题材</option>{topics.map(([topic, count]) => <option key={topic} value={topic}>{topic}（{count}）</option>)}</select>}
            <button onClick={lib.toggleCollectionSortDirection}><ArrowDownUp size={16} />{lib.collectionSortDirection === "asc" ? "升序" : "降序"}</button>
            {lib.query && <button onClick={lib.clearCollectionFilters}>清除搜索</button>}
          </div>

          <div className="collection-wall category-book-wall" data-game-grid>
            {displayed.map(game => {
              const image = lib.imageCache[game.coverPath] || lib.imageCache[game.backgroundPath];
              const selected = selectedIds.includes(game.id);
              return (
                <button key={game.id} className={`collection-poster-card ${selected ? "selected" : ""}`} data-game-id={game.id} aria-label={game.title} aria-pressed={organizing ? selected : undefined} onContextMenu={event => lib.openContextMenu(event, game)} onClick={() => organizing ? setSelectedIds(current => current.includes(game.id) ? current.filter(id => id !== game.id) : [...current, game.id]) : lib.openCollectionGame(game.id)}>
                  <div className="collection-poster-art">{image ? <img src={image} alt="" /> : <Gamepad2 size={28} />}{organizing && <span className="collection-select-mark">{selected ? <Check size={16} /> : ""}</span>}</div>
                  <div className="collection-poster-title"><strong>{game.title}</strong><span>{game.developer || game.status}</span></div>
                </button>
              );
            })}
            {!displayed.length && <div className="category-empty"><BookOpen size={36} /><h2>{addingTo ? "没有可添加的游戏" : shelf ? "这个分类还没有作品" : "没有找到游戏"}</h2><p>{shelf ? "从现有游戏中挑几部放进来。" : "清除搜索条件后再试。"}</p>{shelf && !addingTo && <button onClick={() => startAdding(shelf.id)}><Plus size={16} /> 从游戏库添加</button>}</div>}
          </div>

          {organizing && <div className="category-selection-bar">
            <strong>已选 {selectedIds.length} 部</strong>
            <button onClick={() => setSelectedIds(displayed.map(game => game.id))}>全选当前结果</button>
            {!addingTo && <select aria-label="目标分类" value={destination} onChange={event => setDestination(event.target.value)}><option value="">选择目标分类</option>{lib.bookshelves.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
            <button className="primary" disabled={!selectedIds.length || !(addingTo || destination)} onClick={assign}>加入分类</button>
            {!addingTo && <button onClick={() => setCreating(true)}>新建分类</button>}
            {!addingTo && <div className="category-topic-assignment"><input aria-label="新题材" value={topicInput} onChange={event => setTopicInput(event.target.value)} placeholder="题材名，如：悬疑" maxLength={24} /><button disabled={!selectedIds.length || !topicInput.trim()} onClick={assignTopic}>添加题材</button></div>}
            {shelf && !addingTo && <button disabled={!selectedIds.length} onClick={() => { lib.removeGamesFromBookshelf(selectedIds, shelf.id); setSelectedIds([]); }}>移出当前分类</button>}
            <button onClick={() => addingTo ? enter("shelf", addingTo) : (setOrganizing(false), setSelectedIds([]), setTopicInput(""))}>取消</button>
          </div>}
        </section>
      </div>
    </div>
  );
}
