import type { LibraryController } from "../useLibrary";

export function CollectionScopeSelect({ lib }: { lib: LibraryController }) {
  const value = lib.collectionScope === "shelf" ? `shelf:${lib.collectionBookshelfId}` : lib.collectionScope;
  return <select className="collection-scope-select" aria-label="当前游戏分类" value={value} onChange={event => {
    const next = event.target.value;
    if (next.startsWith("shelf:")) lib.selectCollectionScope("shelf", next.slice(6));
    else lib.selectCollectionScope(next === "unfiled" ? "unfiled" : "all");
  }}>
    <option value="all">全部游戏 · {lib.games.length}</option>
    {lib.games.some(game => !game.bookshelfIds?.length) && <option value="unfiled">未分类 · {lib.games.filter(game => !game.bookshelfIds?.length).length}</option>}
    {lib.bookshelves.map(shelf => <option key={shelf.id} value={`shelf:${shelf.id}`}>{shelf.name} · {lib.games.filter(game => game.bookshelfIds?.includes(shelf.id)).length}</option>)}
  </select>;
}
