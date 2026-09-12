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

  async function runWithTimeout(url, options = {}, consumeResponse) {
    const { timeoutMs = defaultTimeoutMs, signal: callerSignal, ...requestOptions } = options;
    const controller = new AbortController();
    const onCallerAbort = () => controller.abort(callerSignal.reason);
    if (callerSignal) {
      if (callerSignal.aborted) onCallerAbort();
      else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    }

    const timer = setTimeout(() => controller.abort(createTimeoutError(timeoutMs)), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...requestOptions, signal: controller.signal });
      return await consumeResponse(response, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  }

  function fetchWithTimeout(url, options = {}) {
    return runWithTimeout(url, options, async (response) => {
      // All callers consume finite metadata/pages/images. Keep the request budget
      // and domain semaphore alive until that payload is fully received.
      if (typeof response.arrayBuffer !== "function") return response;
      const body = await response.arrayBuffer();
      return new Response([204, 205, 304].includes(response.status) ? null : body, {
        status: response.status, statusText: response.statusText, headers: response.headers
      });
    });
  }

  async function requestJson(url, options = {}) {
    try {
      return await runWithTimeout(url, options, async (response, signal) => {
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
        } catch (error) {
          if (signal.aborted) throw signal.reason;
          return { status: "parse_error", httpStatus: response.status };
        }
      });
    } catch (error) {
      return {
        status: "network_error",
        errorName: error?.name || "Error",
        errorMessage: error?.message || String(error)
      };
    }

  }

  return { fetch: fetchWithTimeout, requestJson };
}

module.exports = { createNetworkClient };
