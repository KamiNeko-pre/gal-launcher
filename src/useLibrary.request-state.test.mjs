import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadRequestHelpers() {
  const source = readFileSync(new URL("./useLibrary.ts", import.meta.url), "utf8");
  const start = source.indexOf("export function isCurrentSearchRequest");
  const end = source.indexOf("export function useLibrary()");
  assert.ok(start >= 0 && end > start, "request-state helpers should be exported from useLibrary.ts");
  const js = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "module", js)(module.exports, module);
  return module.exports;
}

test("ignores a late A response after B becomes current", () => {
  const { isCurrentSearchRequest } = loadRequestHelpers();
  assert.equal(isCurrentSearchRequest(1, 2, "game-a", "game-b"), false);
  assert.equal(isCurrentSearchRequest(2, 2, "game-b", "game-b"), true);
});

test("accepts only the newest request for the same game", () => {
  const { isCurrentSearchRequest } = loadRequestHelpers();
  assert.equal(isCurrentSearchRequest(4, 5, "game-a", "game-a"), false);
  assert.equal(isCurrentSearchRequest(5, 5, "game-a", "game-a"), true);
});

test("keeps a normal successful response eligible", () => {
  const { isCurrentSearchRequest } = loadRequestHelpers();
  assert.equal(isCurrentSearchRequest(3, 3, "game-a", "game-a"), true);
});

test("keeps the newest cover search eligible after browsing another game", () => {
  const { isCurrentCoverSearchRequest } = loadRequestHelpers();
  assert.equal(isCurrentCoverSearchRequest(7, 7), true);
  assert.equal(isCurrentCoverSearchRequest(7, 8), false);
});

test("formats IPC errors without exposing URL credentials or tokens", () => {
  const { formatIpcError } = loadRequestHelpers();
  const message = formatIpcError(
    new Error("Error invoking remote method 'find-cover-candidates': Error: source failed 401 https://alice:secret@example.test/api?token=abc Bearer xyz"),
    "查找横版封面失败"
  );
  assert.equal(message, "source failed 401 https://example.test/api Bearer [已隐藏]");
});

test("derives the bookshelf index without romanizing Japanese titles", () => {
  const { titleInitial } = loadRequestHelpers();
  assert.equal(titleInitial("阿卡迪亚"), "A");
  assert.equal(titleInitial("Aokana"), "A");
  assert.equal(titleInitial("9-nine-"), "0-9");
  assert.equal(titleInitial("さくら"), "#");
});

test("sorts Chinese titles by pinyin and keeps missing values at the end", () => {
  const { compareCollectionGames } = loadRequestHelpers();
  const game = (id, title, releaseDate) => ({ id, title, releaseDate });
  const pinyinOrder = [
    game("a", "阿卡迪亚", "2020-01-01"),
    game("b", "白色相簿", "2021-01-01"),
    game("m", "明日方舟", ""),
    game("z", "樱花", "2019-01-01")
  ];
  assert.deepEqual(pinyinOrder.sort(compareCollectionGames("title", "asc")).map(item => item.id), ["a", "b", "m", "z"]);
  assert.deepEqual([
    game("missing", "A", ""),
    game("valid", "B", "2024-01-01")
  ].sort(compareCollectionGames("releaseDate", "asc")).map(item => item.id), ["valid", "missing"]);
});

test("propagates a managed enhancement path into the launch settings", () => {
  const { bindEnhancementPath } = loadRequestHelpers();
  const settings = { localeEmulatorPath: "E:\\locale\\LEProc.exe" };

  assert.deepEqual(
    bindEnhancementPath(settings, "magpie", "E:\\magpie\\Magpie.exe"),
    { ...settings, magpiePath: "E:\\magpie\\Magpie.exe" }
  );
  assert.deepEqual(settings, { localeEmulatorPath: "E:\\locale\\LEProc.exe" });
});

test("enabling Magpie stores the selected preset on only that game", () => {
  const { enableMagpieForGame } = loadRequestHelpers();
  const game = { id: "game-a", title: "A", magpieEnabled: false, updatedAt: "old" };
  const next = enableMagpieForGame(game, "quality", "new");
  assert.deepEqual(next, { ...game, magpieEnabled: true, magpiePresetId: "quality", updatedAt: "new" });
  assert.equal(game.magpieEnabled, false);
  assert.equal(game.magpiePresetId, undefined);
});
