const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeLibraryDocument,
  createBookshelf,
  setGameBookshelves,
  deleteBookshelf,
  queryBookshelfGames
} = require("./bookshelves.cjs");

test("migrates an old array library into a versioned document without losing games", () => {
  const document = normalizeLibraryDocument([{ id: "a", title: "旧游戏" }]);
  assert.equal(document.version, 2);
  assert.deepEqual(document.games.map(game => game.id), ["a"]);
  assert.deepEqual(document.bookshelves, []);
  assert.deepEqual(document.games[0].bookshelfIds, []);
});

test("one game can belong to two shelves and deleting a shelf keeps the game", () => {
  let document = normalizeLibraryDocument({ version: 2, games: [{ id: "a", title: "游戏" }], bookshelves: [] });
  const first = createBookshelf(document, "雨天");
  document = first.document;
  const second = createBookshelf(document, "轻松");
  document = setGameBookshelves(second.document, "a", second.document.bookshelves.map(shelf => shelf.id));
  document = deleteBookshelf(document, first.bookshelf.id).document;
  assert.equal(document.games.length, 1);
  assert.deepEqual(document.games[0].bookshelfIds, [second.bookshelf.id]);
});

test("queries only the active shelf while global scope includes all games", () => {
  const document = normalizeLibraryDocument({
    version: 2,
    bookshelves: [{ id: "rain", name: "雨天", createdAt: "2026-01-01T00:00:00.000Z" }],
    games: [
      { id: "a", title: "雨之歌", bookshelfIds: ["rain"] },
      { id: "b", title: "晴天", bookshelfIds: [] }
    ]
  });
  assert.deepEqual(queryBookshelfGames(document, { bookshelfId: "rain", scope: "shelf", sort: "title" }).map(game => game.id), ["a"]);
  assert.equal(queryBookshelfGames(document, { scope: "all", sort: "title" }).length, 2);
});

test("sorts equal play time by title without mutating original games", () => {
  const document = normalizeLibraryDocument({
    version: 2,
    games: [
      { id: "b", title: "白色", totalPlaySeconds: 60 },
      { id: "a", title: "暗色", totalPlaySeconds: 60 }
    ],
    bookshelves: []
  });
  const before = document.games.map(game => game.id);
  const result = queryBookshelfGames(document, { scope: "all", sort: "playTime" });
  assert.deepEqual(document.games.map(game => game.id), before);
  assert.deepEqual(result.map(game => game.id), ["a", "b"]);
});
