const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../main.cjs"), "utf8");
const ast = ts.createSourceFile("main.cjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = ["cleanText", "normalizeSearchText", "similarity", "urlHintScore", "dlsiteImageUrlsFromProduct", "searchDlsiteArticlesFromHtml"];
const code = ast.statements
  .filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
  .map((node) => node.getText(ast))
  .join("\n");
const context = { URL };
context.isReliableCommunityTitleMatch = require("./community-title-match.cjs").isReliableCommunityTitleMatch;
vm.runInNewContext(code, context);

test("DLsite parses the current absolute thumbnail-component product link", () => {
  const html = `<thumb-with-ng-filter-block link="https://www.dlsite.com/pro/work/=/product_id/VJ01004381.html" alt="顔のない月 -待宵の双椿- [ROOT]"></thumb-with-ng-filter-block>`;
  const result = context.searchDlsiteArticlesFromHtml(html, "顔のない月");
  assert.equal(result.length, 1);
  assert.equal(result[0].url, "https://www.dlsite.com/pro/work/=/product_id/VJ01004381");
  assert.equal(result[0].title, "顔のない月 -待宵の双椿- [ROOT]");
});

test("DLsite ignores a product card with an unrelated label", () => {
  const html = `<thumb-with-ng-filter-block link="https://www.dlsite.com/pro/work/=/product_id/VJ00000001.html" alt="完全无关的作品"></thumb-with-ng-filter-block>`;
  assert.equal(context.searchDlsiteArticlesFromHtml(html, "顔のない月").length, 0);
});

test("DLsite reads full-resolution sample slides stored in data-src", () => {
  const html = `<div data-src="//img.dlsite.jp/modpub/images2/work/professional/VJ01005000/VJ01004381_img_smpa1.jpg" data-width="1280" data-height="720"></div>`;
  assert.deepEqual(JSON.parse(JSON.stringify(context.dlsiteImageUrlsFromProduct(html, "https://www.dlsite.com/pro/work/=/product_id/VJ01004381.html"))), [
    "https://img.dlsite.jp/modpub/images2/work/professional/VJ01005000/VJ01004381_img_smpa1.jpg"
  ]);
});

test("DLsite restores a resize thumbnail URL to its full-sized asset", () => {
  const html = `<img src="//img.dlsite.jp/resize/images2/work/professional/VJ01005000/VJ01004381_img_smpa1_100x100.jpg">`;
  const result = context.dlsiteImageUrlsFromProduct(html, "https://www.dlsite.com/pro/work/=/product_id/VJ01004381.html");
  assert.equal(result[0], "https://img.dlsite.jp/modpub/images2/work/professional/VJ01005000/VJ01004381_img_smpa1.jpg");
});
