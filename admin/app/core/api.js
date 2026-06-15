function hasApiClient() {
  return Boolean(window.AdminApiClient && typeof window.AdminApiClient.request === "function");
}

function getToken() {
  try {
    return String(window.localStorage.getItem("adminToken") || "").trim();
  } catch (_error) {
    return "";
  }
}

function getBaseUrl() {
  const base = String(window.AdminConfig?.apiBaseUrl || "").replace(/\/+$/, "");
  return base || "";
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function withTimeout(promise, timeoutMs, onTimeout) {
  const timeout = Math.max(500, Number(timeoutMs || 0));
  if (!timeout) {
    return promise;
  }

  let timeoutId = null;
  const timer = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      if (typeof onTimeout === "function") {
        onTimeout();
      }

      const error = new Error(`Request timed out after ${timeout}ms`);
      error.code = "REQUEST_TIMEOUT";
      error.status = 0;
      reject(error);
    }, timeout);
  });

  return Promise.race([promise, timer]).finally(() => {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  });
}

function normalizeError(error, path) {
  const normalized = new Error(error?.message || "Request failed");
  normalized.status = Number(error?.status || error?.response?.status || 0) || 0;
  normalized.path = path;
  normalized.payload = error?.payload || error?.response?.data || null;
  normalized.code = String(error?.code || "");
  normalized.cause = error;
  return normalized;
}

function shouldRetry(error) {
  if (String(error?.name || "") === "AbortError" || String(error?.code || "") === "REQUEST_TIMEOUT") {
    return false;
  }

  const status = Number(error?.status || 0);
  if (!status) {
    return true;
  }

  return status === 408 || status === 429 || status >= 500;
}

function buildUrl(path) {
  const baseUrl = getBaseUrl();
  const normalizedPath = String(path || "").trim();

  if (/^https?:/i.test(normalizedPath)) {
    return normalizedPath;
  }

  const withoutApiPrefix = normalizedPath.replace(/^\/api\/?/i, "").replace(/^\/+/, "");
  return `${baseUrl}/${withoutApiPrefix}`;
}

async function fallbackRequest(path, options) {
  const url = buildUrl(path);

  const token = getToken();
  const controller = new AbortController();
  const externalSignal = options?.signal;
  const abortForwarder = () => {
    controller.abort();
  };

  if (externalSignal && typeof externalSignal.addEventListener === "function") {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", abortForwarder, { once: true });
    }
  }

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {})
    },
    signal: controller.signal,
    ...options
  }).finally(() => {
    if (externalSignal && typeof externalSignal.removeEventListener === "function") {
      externalSignal.removeEventListener("abort", abortForwarder);
    }
  });

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => "");
  if (!response.ok) {
    const error = new Error(payload?.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export async function request(path, options) {
  const requestOptions = options || {};
  const retryCount = Number.isFinite(Number(requestOptions.retryCount))
    ? Math.max(0, Number(requestOptions.retryCount))
    : 1;
  const retryDelayMs = Number.isFinite(Number(requestOptions.retryDelayMs))
    ? Math.max(0, Number(requestOptions.retryDelayMs))
    : 350;
  const timeoutMs = Number.isFinite(Number(requestOptions.timeoutMs))
    ? Math.max(500, Number(requestOptions.timeoutMs))
    : 12000;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const externalSignal = requestOptions?.signal;
    const abortForwarder = () => controller.abort();
    if (externalSignal && typeof externalSignal.addEventListener === "function") {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener("abort", abortForwarder, { once: true });
      }
    }

    try {
      if (hasApiClient()) {
        const result = await withTimeout(
          window.AdminApiClient.request(path, { ...requestOptions, signal: controller.signal }),
          timeoutMs,
          () => controller.abort()
        );

        return result;
      }

      return await withTimeout(
        fallbackRequest(path, { ...requestOptions, signal: controller.signal }),
        timeoutMs,
        () => controller.abort()
      );
    } catch (error) {
      const normalized = normalizeError(error, path);
      if (attempt >= retryCount || !shouldRetry(normalized)) {
        throw normalized;
      }

      await wait(retryDelayMs * (attempt + 1));
    } finally {
      if (externalSignal && typeof externalSignal.removeEventListener === "function") {
        externalSignal.removeEventListener("abort", abortForwarder);
      }
    }
  }

  throw new Error("Request failed");
}

export function get(path) {
  return request(path, { method: "GET" });
}

export function post(path, body) {
  return request(path, { method: "POST", body: JSON.stringify(body || {}) });
}

export function put(path, body) {
  return request(path, { method: "PUT", body: JSON.stringify(body || {}) });
}

export function remove(path) {
  return request(path, { method: "DELETE" });
}
