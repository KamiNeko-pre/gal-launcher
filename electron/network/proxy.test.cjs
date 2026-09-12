const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyProxyConfiguration,
  environmentProxyConfiguration,
  resolveProxyConfiguration
} = require("./proxy.cjs");

test("an absent project proxy explicitly restores Electron system proxy settings", () => {
  assert.deepEqual(resolveProxyConfiguration({ env: {} }), { mode: "system" });
});

test("an explicit empty project proxy resets a legacy environment override to system mode", () => {
  assert.deepEqual(resolveProxyConfiguration({
    proxyPort: null,
    env: { PROXY_PORT: "7897" }
  }), { mode: "system" });
});

test("a valid project proxy port configures only the local fixed proxy", async () => {
  const calls = [];
  const config = await applyProxyConfiguration({
    setProxy: async (value) => calls.push(value)
  }, { env: { PROXY_PORT: "7897" }, proxyBypassRules: "<local>" });

  assert.deepEqual(config, {
    mode: "fixed_servers",
    proxyRules: "http://127.0.0.1:7897",
    proxyBypassRules: "<local>"
  });
  assert.deepEqual(calls, [config]);
});

test("unrelated HTTP proxy environment variables do not override Electron system mode", () => {
  assert.deepEqual(resolveProxyConfiguration({
    env: { HTTPS_PROXY: "http://unexpected.example:8080", HTTP_PROXY: "http://unexpected.example:8080" }
  }), { mode: "system" });
});

test("environment fallback requires confirmed absence of system proxy configuration", async () => {
  const calls = [];
  const session = {
    setProxy: async (value) => calls.push(value),
    resolveProxy: async () => "DIRECT"
  };

  const config = await applyProxyConfiguration(session, {
    env: { ALL_PROXY: "http://127.0.0.1:7897" },
    environmentProxyPolicy: "fallback"
    ,systemProxyConfigured: false
  });

  assert.deepEqual(config, { mode: "fixed_servers", proxyRules: "http://127.0.0.1:7897" });
  assert.deepEqual(calls, [
    { mode: "system" },
    { mode: "fixed_servers", proxyRules: "http://127.0.0.1:7897" }
  ]);
});

test("environment fallback preserves a configured system proxy", async () => {
  const calls = [];
  const config = await applyProxyConfiguration({
    setProxy: async (value) => calls.push(value),
    resolveProxy: async () => "DIRECT"
  }, {
    env: { HTTPS_PROXY: "http://127.0.0.1:7897" },
    environmentProxyPolicy: "fallback"
  });

  assert.deepEqual(config, { mode: "system" });
  assert.deepEqual(calls, [{ mode: "system" }]);
});

test("environment proxy rules distinguish HTTP and HTTPS without accepting credentials", () => {
  assert.deepEqual(environmentProxyConfiguration({
    HTTP_PROXY: "http://127.0.0.1:8080",
    HTTPS_PROXY: "socks5://[::1]:1080"
  }), {
    mode: "fixed_servers",
    proxyRules: "http=http://127.0.0.1:8080;https=socks5://[::1]:1080"
  });
  assert.throws(
    () => environmentProxyConfiguration({ ALL_PROXY: "http://user:password@127.0.0.1:7897" }),
    /must not contain credentials/
  );
});

test("environment proxy preserves NO_PROXY rules for its fallback session", () => {
  assert.deepEqual(environmentProxyConfiguration({
    ALL_PROXY: "http://127.0.0.1:7897",
    NO_PROXY: "localhost, 127.0.0.1, *.local"
  }), {
    mode: "fixed_servers",
    proxyRules: "http://127.0.0.1:7897",
    proxyBypassRules: "localhost;127.0.0.1;*.local"
  });
});

test("invalid project proxy ports fail instead of silently producing a broken proxy rule", () => {
  assert.throws(
    () => resolveProxyConfiguration({ env: { PROXY_PORT: "70000" } }),
    /PROXY_PORT must be a TCP port/
  );
});
