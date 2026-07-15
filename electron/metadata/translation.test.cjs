const test = require("node:test");
const assert = require("node:assert/strict");

const { translateLongText } = require("./translation.cjs");

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
