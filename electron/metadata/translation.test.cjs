const test = require("node:test");
const assert = require("node:assert/strict");

const { successfulTranslation, translateLongText } = require("./translation.cjs");

test("long descriptions translate every chunk in order", async () => {
  const source = "a".repeat(901);
  const chunks = [];
  const result = await translateLongText(source, {
    chunkSize: 450,
    translateChunk: async (chunk) => {
      chunks.push(chunk.length);
      return `中${chunk}`;
    }
  });

  assert.deepEqual(chunks, [450, 450, 1]);
  assert.equal(result.status, "success");
  assert.equal(result.text, `中${"a".repeat(450)}\n中${"a".repeat(450)}\n中a`);
});

test("a failed primary provider falls back for the same chunk", async () => {
  const result = await translateLongText("hello world", {
    chunkSize: 450,
    translateChunk: async () => { throw new Error("primary down"); },
    fallbackChunk: async () => "你好世界"
  });

  assert.equal(result.status, "success");
  assert.equal(result.text, "你好世界");
  assert.equal(result.usedFallback, true);
});

test("mixed Chinese and English descriptions are still translated", async () => {
  const source = "中文标题\nThe rest of this visual novel description is in English.";
  const result = await translateLongText(source, {
    translateChunk: async () => "这是完整的中文简介。"
  });

  assert.equal(result.status, "success");
  assert.equal(result.text, "这是完整的中文简介。");
});

test("when all providers fail, the original complete text is preserved", async () => {
  const source = "English paragraph ".repeat(60);
  const result = await translateLongText(source, {
    chunkSize: 450,
    translateChunk: async () => { throw new Error("primary down"); },
    fallbackChunk: async () => { throw new Error("fallback down"); }
  });

  assert.equal(result.status, "failed");
  assert.equal(result.text, source);
});

test("strict providers do not promote an unverified proxy error to a translation", async () => {
  const source = "A description that must not be cached as Chinese.";
  const result = await translateLongText(source, {
    requireStructuredResults: true,
    translateChunk: async () => "代理服务器错误",
    fallbackChunk: async () => ({ status: "error", message: "upstream unavailable" })
  });

  assert.deepEqual(result, { text: source, status: "failed", usedFallback: false });
});

test("strict providers accept explicitly validated translations for every chunk", async () => {
  const source = "a".repeat(5);
  const result = await translateLongText(source, {
    chunkSize: 2,
    requireStructuredResults: true,
    translateChunk: async (chunk) => successfulTranslation(`中${chunk}`)
  });

  assert.deepEqual(result, { text: "中aa\n中aa\n中a", status: "success", usedFallback: false });
});

test("legacy raw-string providers remain compatible until the main-process wiring migrates", async () => {
  const result = await translateLongText("hello", {
    translateChunk: async () => "你好"
  });

  assert.equal(result.status, "success");
  assert.equal(result.text, "你好");
});
