const { randomUUID } = require("node:crypto");

function text(value) { return String(value || "").trim(); }
function stableTitleCompare(left, right) {
  return text(left.title).localeCompare(text(right.title), "zh-Hans-CN", { numeric: true, sensitivity: "base" }) || String(left.id).localeCompare(String(right.id));
}
function validShelfIds(ids, shelves) {
  const known = new Set(shelves.map(shelf => shelf.id));
  return Array.from(new Set(Array.isArray(ids) ? ids.map(String).filter(known.has.bind(known)) : []));
}
function normalizeShelf(shelf, index) {
  const name = text(shelf?.name);
  if (!name) return null;
  return { id: text(shelf.id) || `shelf-${index}`, name, createdAt: text(shelf.createdAt) || new Date(0).toISOString() };
}
function normalizeLibraryDocument(value) {
  const source = Array.isArray(value) ? { games: value } : value && typeof value === "object" ? value : {};
  const usedNames = new Set();
  const bookshelves = (Array.isArray(source.bookshelves) ? source.bookshelves : [])
    .map(normalizeShelf).filter(Boolean).filter(shelf => {
      const key = shelf.name.toLocaleLowerCase();
      if (usedNames.has(key)) return false;
      usedNames.add(key); return true;
    });
  const games = (Array.isArray(source.games) ? source.games : []).map(game => ({ ...game, bookshelfIds: validShelfIds(game?.bookshelfIds, bookshelves) }));
  return { version: 2, games, bookshelves };
}
function shelfNameConflict(document, name, exceptId = "") {
  return document.bookshelves.some(shelf => shelf.id !== exceptId && shelf.name.toLocaleLowerCase() === name.toLocaleLowerCase());
}
function createBookshelf(value, inputName, now = new Date().toISOString()) {
  const document = normalizeLibraryDocument(value);
  const name = text(inputName);
  if (!name) throw new Error("书架名称不能为空");
  if (shelfNameConflict(document, name)) throw new Error("已有同名书架");
  const bookshelf = { id: randomUUID(), name, createdAt: now };
  return { document: { ...document, bookshelves: [...document.bookshelves, bookshelf] }, bookshelf };
}
function renameBookshelf(value, bookshelfId, inputName) {
  const document = normalizeLibraryDocument(value);
  const name = text(inputName);
  if (!name) throw new Error("书架名称不能为空");
  if (!document.bookshelves.some(shelf => shelf.id === bookshelfId)) throw new Error("找不到书架");
  if (shelfNameConflict(document, name, bookshelfId)) throw new Error("已有同名书架");
  return { ...document, bookshelves: document.bookshelves.map(shelf => shelf.id === bookshelfId ? { ...shelf, name } : shelf) };
}
function setGameBookshelves(value, gameId, ids) {
  const document = normalizeLibraryDocument(value);
  if (!document.games.some(game => game.id === gameId)) throw new Error("找不到游戏");
  const bookshelfIds = validShelfIds(ids, document.bookshelves);
  return { ...document, games: document.games.map(game => game.id === gameId ? { ...game, bookshelfIds } : game) };
}
function deleteBookshelf(value, bookshelfId) {
  const document = normalizeLibraryDocument(value);
  const bookshelf = document.bookshelves.find(shelf => shelf.id === bookshelfId);
  if (!bookshelf) throw new Error("找不到书架");
  return {
    document: {
      ...document,
      bookshelves: document.bookshelves.filter(shelf => shelf.id !== bookshelfId),
      games: document.games.map(game => ({ ...game, bookshelfIds: game.bookshelfIds.filter(id => id !== bookshelfId) }))
    },
    bookshelf
  };
}
function gameMatches(game, options) {
  const needle = text(options.query).toLocaleLowerCase();
  if (options.status && options.status !== "全部" && game.status !== options.status) return false;
  if (options.tag && !(game.tags || []).includes(options.tag)) return false;
  if (!needle) return true;
  return [game.title, game.originalTitle, game.developer, ...(game.tags || [])].some(value => text(value).toLocaleLowerCase().includes(needle));
}
function dateValue(value) { const numeric = Date.parse(value || ""); return Number.isFinite(numeric) ? numeric : null; }
function compareGames(sort) {
  return (left, right) => {
    const leftMissing = value => value === null || value === undefined || value === 0;
    let result = 0;
    if (sort === "lastPlayed") result = (dateValue(right.lastPlayedAt) || -Infinity) - (dateValue(left.lastPlayedAt) || -Infinity);
    else if (sort === "added") result = (dateValue(right.createdAt) || -Infinity) - (dateValue(left.createdAt) || -Infinity);
    else if (sort === "playTime") result = Number(right.totalPlaySeconds || 0) - Number(left.totalPlaySeconds || 0);
    else if (sort === "releaseDate") result = (dateValue(right.releaseDate) || -Infinity) - (dateValue(left.releaseDate) || -Infinity);
    else if (sort === "rating") result = Number(right.rating || 0) - Number(left.rating || 0);
    if (sort !== "title" && leftMissing(sort === "lastPlayed" ? dateValue(left.lastPlayedAt) : sort === "added" ? dateValue(left.createdAt) : sort === "releaseDate" ? dateValue(left.releaseDate) : sort === "playTime" ? left.totalPlaySeconds : left.rating) !== leftMissing(sort === "lastPlayed" ? dateValue(right.lastPlayedAt) : sort === "added" ? dateValue(right.createdAt) : sort === "releaseDate" ? dateValue(right.releaseDate) : sort === "playTime" ? right.totalPlaySeconds : right.rating)) return leftMissing(sort === "lastPlayed" ? dateValue(left.lastPlayedAt) : sort === "added" ? dateValue(left.createdAt) : sort === "releaseDate" ? dateValue(left.releaseDate) : sort === "playTime" ? left.totalPlaySeconds : left.rating) ? 1 : -1;
    return result || stableTitleCompare(left, right);
  };
}
function queryBookshelfGames(value, options = {}) {
  const document = normalizeLibraryDocument(value);
  const scope = options.scope || "all";
  return document.games.filter(game => {
    if (scope === "shelf" && !game.bookshelfIds.includes(options.bookshelfId)) return false;
    if (scope === "unfiled" && game.bookshelfIds.length) return false;
    return gameMatches(game, options);
  }).slice().sort(compareGames(options.sort || "lastPlayed"));
}

module.exports = { normalizeLibraryDocument, createBookshelf, renameBookshelf, setGameBookshelves, deleteBookshelf, queryBookshelfGames };
