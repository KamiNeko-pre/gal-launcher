function normalizeProxyPort(value, name = "PROXY_PORT") {
  if (value === undefined || value === null || value === "") return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError(`${name} must be a TCP port between 1 and 65535`);
  }
  return port;
}

function normalizeEnvironmentProxy(value, name) {
  if (!value) return undefined;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${name} must be an absolute proxy URL`);
  }
  if (!new Set(["http:", "https:", "socks4:", "socks5:"]).has(parsed.protocol) || !parsed.hostname) {
    throw new TypeError(`${name} must use http, https, socks4, or socks5`);
  }
  if (parsed.username || parsed.password || (parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new TypeError(`${name} must not contain credentials or a path`);
  }
  return `${parsed.protocol}//${parsed.host}`;
}

function environmentProxyConfiguration(env = process.env) {
  const all = normalizeEnvironmentProxy(env.ALL_PROXY ?? env.all_proxy, "ALL_PROXY");
  const http = normalizeEnvironmentProxy(env.HTTP_PROXY ?? env.http_proxy, "HTTP_PROXY") ?? all;
  const https = normalizeEnvironmentProxy(env.HTTPS_PROXY ?? env.https_proxy, "HTTPS_PROXY") ?? all;
  if (!http && !https) return undefined;
  return {
    mode: "fixed_servers",
    proxyRules: http === https ? http : [http && `http=${http}`, https && `https=${https}`].filter(Boolean).join(";"),
    ...(env.NO_PROXY || env.no_proxy ? { proxyBypassRules: String(env.NO_PROXY || env.no_proxy).split(",").map(value => value.trim()).filter(Boolean).join(";") } : {})
  };
}

function isDirectProxy(route) {
  return /^DIRECT(?:\s|$)/i.test(String(route || "").trim());
}

function resolveProxyConfiguration(options = {}) {
  const { env = process.env, proxyBypassRules } = options;
  const requestedPort = Object.hasOwn(options, "proxyPort") ? options.proxyPort : env.PROXY_PORT;
  const port = normalizeProxyPort(requestedPort);
  if (!port) return { mode: "system" };

  return {
    mode: "fixed_servers",
    proxyRules: `http://127.0.0.1:${port}`,
    ...(proxyBypassRules ? { proxyBypassRules } : {})
  };
}

async function applyProxyConfiguration(targetSession, options) {
  if (typeof targetSession?.setProxy !== "function") {
    throw new TypeError("applyProxyConfiguration requires an Electron Session");
  }
  const configuration = resolveProxyConfiguration(options);
  await targetSession.setProxy(configuration);

  const env = options?.env || process.env;
  const hasExplicitPort = Object.hasOwn(options || {}, "proxyPort");
  const canUseEnvironmentFallback = options?.environmentProxyPolicy === "fallback"
    && configuration.mode === "system"
    && options?.systemProxyConfigured === false
    && !hasExplicitPort
    && !env.PROXY_PORT
    && typeof targetSession.resolveProxy === "function";
  if (canUseEnvironmentFallback) {
    const environmentConfiguration = environmentProxyConfiguration(env);
    if (environmentConfiguration) {
      await targetSession.setProxy(environmentConfiguration);
      return environmentConfiguration;
    }
  }
  return configuration;
}

module.exports = {
  applyProxyConfiguration,
  environmentProxyConfiguration,
  isDirectProxy,
  normalizeProxyPort,
  resolveProxyConfiguration
};
