const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../main.cjs"), "utf8");
const ast = ts.createSourceFile("main.cjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const code = ast.statements
  .filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === "isTransportFailure")
  .map((node) => node.getText(ast))
  .join("\n");
const context = {};
vm.runInNewContext(code, context);

test("proxy timeout is eligible for a direct fallback", () => {
  assert.equal(context.isTransportFailure(new Error("The operation was aborted due to timeout")), true);
  assert.equal(context.isTransportFailure(new Error("net::ERR_PROXY_CONNECTION_FAILED")), true);
});

test("ordinary HTTP and validation failures do not bypass the configured route", () => {
  assert.equal(context.isTransportFailure(new Error("HTTP 404")), false);
  assert.equal(context.isTransportFailure(new Error("invalid JSON payload")), false);
});
