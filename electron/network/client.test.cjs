const test = require("node:test");
const assert = require("node:assert/strict");

const { createNetworkClient } = require("./client.cjs");

test("network client forwards request options and returns the response", async () => {
  const calls = [];
  const response = { ok: true, status: 200, json: async () => ({ ok: true }) };
  const client = createNetworkClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response;
    },
    defaultTimeoutMs: 100
  });

  const result = await client.fetch("https://example.test/data", {
    method: "POST",
    headers: { "X-Test": "yes" },
    body: "{}"
  });

  assert.equal(result, response);
  assert.equal(calls[0].url, "https://example.test/data");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["X-Test"], "yes");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test("network client aborts a request that exceeds its timeout", async () => {
  const client = createNetworkClient({
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
    defaultTimeoutMs: 10
  });

  await assert.rejects(
    client.fetch("https://example.test/slow"),
    (error) => error?.name === "TimeoutError"
  );
});

test("network client preserves an explicit caller timeout", async () => {
  const client = createNetworkClient({
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
    defaultTimeoutMs: 1000
  });

  await assert.rejects(
    client.fetch("https://example.test/slow", { timeoutMs: 10 }),
    (error) => error?.name === "TimeoutError"
  );
});

test("requestJson distinguishes rate limits and malformed JSON", async () => {
  const responses = [
    { ok: false, status: 429, headers: new Headers({ "retry-after": "7" }) },
    { ok: true, status: 200, json: async () => { throw new Error("bad json"); } }
  ];
  const client = createNetworkClient({
    fetchImpl: async () => responses.shift(),
    defaultTimeoutMs: 100
  });

  assert.deepEqual(
    await client.requestJson("https://example.test/rate"),
    { status: "rate_limited", retryAfterSeconds: 7, httpStatus: 429 }
  );
  assert.deepEqual(
    await client.requestJson("https://example.test/bad-json"),
    { status: "parse_error", httpStatus: 200 }
  );
});
