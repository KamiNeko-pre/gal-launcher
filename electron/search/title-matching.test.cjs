const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
const ast = ts.createSourceFile('main.cjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = ['cleanText', 'normalizeSearchText', 'normalizeTags', 'isGenericSearchText', 'collectTitleVariants', 'expandSearchAlias', 'titleQueriesFor', 'rawTitleQueriesFor', 'steamFallbackExecutableQuery', 'isSteamGameDetails', 'similarity'];
const code = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)).map(n => n.getText(ast)).join('\n');
const context = { path };
vm.runInNewContext(code, context);
test('normalization preserves marker substrings inside real titles', () => {
  assert.equal(context.normalizeSearchText('Railway Story'), 'railway story');
  assert.equal(context.normalizeSearchText('Chronicle of Rain'), 'chronicle of rain');
});
test('normalization still removes standalone release markers', () => {
  assert.equal(context.normalizeSearchText('Railway Story [CHS] patch.exe'), 'railway story');
});
test('sequel numbers cannot be treated as a strong title match', () => {
  assert.ok(context.similarity('Story 2', 'Story 3') < 0.58);
  assert.ok(context.similarity('Story 2', 'Story') < 0.58);
  assert.equal(context.similarity('Story 2', 'Story 2'), 1);
});
test('an explicit game title does not turn arbitrary install folders into search queries', () => {
  const queries = context.rawTitleQueriesFor({
    title: '白色相簿2',
    originalTitle: 'WHITE ALBUM2',
    installPath: 'D:\\isolated\\0',
    executablePath: 'D:\\isolated\\0\\game.exe',
    developer: 'Leaf',
    tags: ['恋爱']
  });
  assert.ok(queries.includes('白色相簿2'));
  assert.ok(queries.includes('white album2'));
  assert.ok(!queries.includes('isolated'));
  assert.ok(!queries.includes('leaf'));
});
test('a Chinese metadata title is the first query for Chinese community sources', () => {
  const queries = context.titleQueriesFor({
    title: '大图书馆的牧羊人',
    originalTitle: '大図書館の羊飼い'
  });
  assert.equal(queries[0], '大图书馆的牧羊人');
  assert.ok(queries.includes('大図書館の羊飼い'));
});
test('file names remain a fallback when no title is known yet', () => {
  const queries = context.rawTitleQueriesFor({
    title: '',
    originalTitle: '',
    installPath: 'D:\\games\\White Album2',
    executablePath: 'D:\\games\\White Album2\\start.exe'
  });
  assert.ok(queries.includes('white album2'));
});

test('Steam can use a non-generic selected executable name without treating the install folder as a title', () => {
  const game = {
    title: '中文作品名',
    originalTitle: '日本語タイトル',
    installPath: 'D:\\unrelated\\release-121',
    executablePath: 'D:\\unrelated\\release-121\\English Retail Name.exe'
  };
  assert.equal(context.steamFallbackExecutableQuery(game), 'English Retail Name');
  assert.equal(context.steamFallbackExecutableQuery({ ...game, executablePath: 'D:\\unrelated\\release-121\\start.exe' }), '');
  assert.ok(!context.rawTitleQueriesFor(game).includes('release 121'));
});

test('Steam cover search accepts only game app details', () => {
  assert.equal(context.isSteamGameDetails({ type: 'game' }), true);
  assert.equal(context.isSteamGameDetails({ type: 'demo' }), false);
  assert.equal(context.isSteamGameDetails({ type: 'music' }), false);
  assert.equal(context.isSteamGameDetails(null), false);
});
