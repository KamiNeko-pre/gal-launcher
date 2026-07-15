function createTimeoutError(timeoutMs) {
  const error = new Error(`Request timed out after ${timeoutMs}ms`);
  error.name = "TimeoutError";
  return error;
}

function retryAfterSeconds(response) {
  const value = response?.headers?.get?.("retry-after");
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function createNetworkClient({ fetchImpl, defaultTimeoutMs = 12000 } = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("createNetworkClient requires a fetch implementation");
  }

  async function fetchWithTimeout(url, options = {}) {
    const { timeoutMs = defaultTimeoutMs, signal: callerSignal, ...requestOptions } = options;
    const controller = new AbortController();
    const onCallerAbort = () => controller.abort(callerSignal.reason);
    if (callerSignal) {
      if (callerSignal.aborted) onCallerAbort();
      else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    }

    const timer = setTimeout(() => controller.abort(createTimeoutError(timeoutMs)), timeoutMs);
    try {
      return await fetchImpl(url, { ...requestOptions, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  }

  async function requestJson(url, options = {}) {
    let response;
    try {
      response = await fetchWithTimeout(url, options);
    } catch (error) {
      return {
        status: "network_error",
        errorName: error?.name || "Error",
        errorMessage: error?.message || String(error)
      };
    }

    if (response.status === 429) {
      return {
        status: "rate_limited",
        retryAfterSeconds: retryAfterSeconds(response),
        httpStatus: response.status
      };
    }
    if (!response.ok) {
      return { status: "network_error", httpStatus: response.status };
    }

    try {
      return { status: "success", httpStatus: response.status, data: await response.json() };
    } catch {
      return { status: "parse_error", httpStatus: response.status };
    }
  }

  return { fetch: fetchWithTimeout, requestJson };
}

module.exports = { createNetworkClient };
