const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../main.cjs"), "utf8");
const ast = ts.createSourceFile("main.cjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = ["cleanText", "normalizeSearchText", "similarity", "stripMarkup", "search2DFanSubjectsFromHtml", "search2DFanSubjectsFromJson"];
const code = ast.statements
  .filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
  .map((node) => node.getText(ast))
  .join("\n");
const context = { URL };
vm.runInNewContext(code, context);

const resultHtml = `
  <li class="media"><a class="pull-left" href="/subjects/91"><img src="/cover.jpg"></a>
  <h4 class="media-heading"><a href="/subjects/91">顔のない月</a></h4></li>`;

test("2DFan parses its current JSON HTML fragment with an exact title", () => {
  const result = context.search2DFanSubjectsFromJson({ subjects: resultHtml }, "顔のない月");
  assert.deepEqual(JSON.parse(JSON.stringify(result.map((item) => ({ title: item.title, url: item.url })))), [{
    title: "顔のない月",
    url: "https://2dfan.com/subjects/91"
  }]);
});

test("2DFan does not accept an unrelated default suggestion", () => {
  const result = context.search2DFanSubjectsFromHtml(
    `<a href="/subjects/25251">おばさんじゃない、女だった。</a>`,
    "顔のない月"
  );
  assert.equal(result.length, 0);
});
