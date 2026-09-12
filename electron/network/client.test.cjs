const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { createNetworkClient } = require("./client.cjs");

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

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

test("requestJson bounds the complete response, not only time to headers", { timeout: 250 }, async () => {
  await withServer((request, response) => {
    if (request.url === "/hanging-body") {
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"partial":');
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"complete":true}');
  }, async (baseUrl) => {
    const client = createNetworkClient({ fetchImpl: globalThis.fetch, defaultTimeoutMs: 40 });

    await assert.doesNotReject(async () => {
      assert.deepEqual(await client.requestJson(`${baseUrl}/hanging-body`), {
        status: "network_error",
        errorName: "TimeoutError",
        errorMessage: "Request timed out after 40ms"
      });
    });
    assert.deepEqual(await client.requestJson(`${baseUrl}/complete-body`), {
      status: "success",
      httpStatus: 200,
      data: { complete: true }
    });
  });
});
