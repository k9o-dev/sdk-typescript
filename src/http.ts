/**
 * HTTP client abstraction for `@k9o/core`.
 *
 * Lifted + generalised from `@k9o/gate/client.ts` (the auth-pillar SDK's
 * proven pattern). This client is per-instance — `createClient` constructs
 * one bound to its config; per-call options merge into the bound defaults.
 *
 * Responsibilities:
 *   - URL construction against bound `baseUrl` + per-call `path` + query
 *   - Envelope unwrap on 2xx (rejects malformed envelopes as INTERNAL_ERROR)
 *   - KError rehydration on non-2xx
 *   - Bearer token injection (from per-call override OR bound default)
 *   - Project context header (`x-k9o-project-slug`) injection when bound
 *   - Retry with exponential backoff per RetryConfig (see retry.ts) — not available
 *     yet; requests are currently a single attempt
 *
 * The client is intentionally minimal — per-resource SDK methods compose
 * the path + body + bearer themselves and hand to `request()`. This keeps
 * the HTTP layer dumb and the per-resource logic auditable.
 */

import { KError, kerrorFromWire, type KErrorWire } from "./kerror.ts";
import type { Envelope } from "./envelope.ts";
import { withRetry } from "./retry.ts";
import type { RetryConfig } from "./types.ts";
import { resolveRegionalOrigin } from "./region.ts";

/**
 * Per-instance HTTP client config. Constructed by `createClient`; passed
 * to `request()` per call.
 */
export type HttpClientConfig = {
  /** Normalised baseUrl (scheme + host); set via createClient. */
  baseUrl: string;
  /** Default bearer token (per-call override wins). */
  apiKey?: string | undefined;
  /** Active project slug — injected as `x-k9o-project-slug` header on every request. */
  projectSlug?: string | undefined;
  /** Active org slug — injected as `x-k9o-org-slug` header on every request. */
  orgSlug?: string | undefined;
  /** Custom fetch impl (defaults to globalThis.fetch); use for tests + non-standard runtimes. */
  fetch?: typeof globalThis.fetch | undefined;
  /** Default headers merged into every request. */
  defaultHeaders?: Record<string, string> | undefined;
  /** Retry config; idempotent methods only (GET/HEAD/OPTIONS/DELETE) — applied when transport fails or upstream returns 502/503/504/429. */
  retryConfig?: RetryConfig | undefined;
};

/**
 * Per-call request options.
 */
export type RequestInit = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  /** Send these bytes as the body, unchanged, with the `content-type` given in `headers` (for binary routes). Wins over `body`. */
  rawBody?: Uint8Array | ArrayBuffer | Blob | undefined;
  /** Per-call bearer override (wins over config.apiKey). */
  bearerToken?: string | undefined;
  /** Per-call additional headers (merged with config.defaultHeaders + auth). */
  headers?: Record<string, string> | undefined;
  /** Per-call query params. */
  query?: Record<string, string | number | boolean | undefined> | undefined;
  /** Abort the request (streaming calls only). */
  signal?: AbortSignal | undefined;
};

/**
 * Issue a request against the gateway. Returns the unwrapped Envelope
 * on 2xx; throws KError on non-2xx, transport failures, or malformed
 * responses.
 */
export async function request<T>(
  config: HttpClientConfig,
  init: RequestInit,
): Promise<Envelope<T>> {
  return withRetry(() => requestOnce<T>(config, init), init.method, config.retryConfig);
}

/**
 * Single-attempt request implementation. `request` wraps this in
 * retry-with-backoff per `config.retryConfig`. Exported for tests that
 * want to bypass retry semantics.
 */
export async function requestOnce<T>(
  config: HttpClientConfig,
  init: RequestInit,
): Promise<Envelope<T>> {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new KError({
      code: "K9O_INTERNAL_ERROR",
      message:
        "No fetch implementation available — pass {fetch} in createClient options for runtimes without a global fetch",
      context: {},
      recommendation: "Use Node 18+, Bun 1.1+, or a modern browser; otherwise supply a fetch polyfill via the fetch option.",
    });
  }

  const url = buildUrl(await resolveRegionalOrigin(config), init.path, init.query);
  const headers: Record<string, string> = {
    accept: "application/json",
    ...(config.defaultHeaders ?? {}),
    ...(config.projectSlug ? { "x-k9o-project-slug": config.projectSlug } : {}),
    ...(config.orgSlug ? { "x-k9o-org-slug": config.orgSlug } : {}),
    ...(init.headers ?? {}),
  };
  const bearer = init.bearerToken ?? config.apiKey;
  if (typeof bearer === "string" && bearer.length > 0) {
    headers["authorization"] = `Bearer ${bearer}`;
  }
  const requestInit: Record<string, unknown> = {
    method: init.method,
    headers,
  };
  if (init.rawBody !== undefined) {
    requestInit["body"] = init.rawBody;
  } else if (init.body !== undefined) {
    if (typeof FormData !== "undefined" && init.body instanceof FormData) {
      // Multipart: the runtime sets the content type (with its boundary); never JSON-encode it.
      requestInit["body"] = init.body;
    } else {
      headers["content-type"] = "application/json";
      requestInit["body"] = JSON.stringify(init.body);
    }
  }

  let response: Response;
  try {
    response = await fetchImpl(url, requestInit as Parameters<typeof fetchImpl>[1]);
  } catch (e) {
    throw new KError({
      code: "K9O_UPSTREAM_UNAVAILABLE",
      message: `Network error reaching ${url}: ${e instanceof Error ? e.message : String(e)}`,
      context: { url },
      recommendation: "Check connectivity to the gateway; retry with backoff if transient.",
    });
  }

  // 204 No Content — synthesize an empty envelope (some DELETE / PUT endpoints).
  if (response.status === 204) {
    return { data: undefined as unknown as T, meta: {} };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (e) {
    throw new KError({
      code: "K9O_INTERNAL_ERROR",
      message: `Failed to parse JSON response from ${url}: ${e instanceof Error ? e.message : String(e)}`,
      context: { url, status: response.status },
      status: response.status,
    });
  }

  if (response.status >= 200 && response.status < 300) {
    if (!isEnvelope<T>(parsed)) {
      throw new KError({
        code: "K9O_INTERNAL_ERROR",
        message: `Malformed envelope from ${url}: expected {data, meta}`,
        context: { url, status: response.status },
        status: response.status,
      });
    }
    return parsed;
  }

  if (isKErrorWire(parsed)) {
    throw kerrorFromWire(parsed, response.status);
  }
  throw new KError({
    code: "K9O_INTERNAL_ERROR",
    message: `Upstream returned ${response.status} with non-KError body`,
    context: { url, status: response.status, body: parsed },
    status: response.status,
  });
}

/**
 * Open a streaming request against the gateway. Returns the raw
 * `Response` on 2xx (caller consumes `response.body` as an SSE / chunked
 * stream); throws `KError` on non-2xx, transport failures, or a missing
 * body. Used by streaming surfaces — `client.compute.llms.invokeStream`
 * + `client.realtime.subscribe` SSE transport.
 *
 * Unlike `request()`, this does NOT unwrap the JSON envelope or apply
 * retry — streaming responses are consumed incrementally and retry on a
 * half-consumed stream is unsafe.
 */
export async function requestStream(
  config: HttpClientConfig,
  init: RequestInit & { accept?: string },
): Promise<Response> {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new KError({
      code: "K9O_INTERNAL_ERROR",
      message: "No fetch implementation available — pass {fetch} in createClient options",
      context: {},
      recommendation: "Use Node 18+, Bun 1.1+, or a modern browser; otherwise supply a fetch polyfill via the fetch option.",
    });
  }

  const url = buildUrl(await resolveRegionalOrigin(config), init.path, init.query);
  const headers: Record<string, string> = {
    accept: init.accept ?? "text/event-stream",
    ...(config.defaultHeaders ?? {}),
    ...(config.projectSlug ? { "x-k9o-project-slug": config.projectSlug } : {}),
    ...(config.orgSlug ? { "x-k9o-org-slug": config.orgSlug } : {}),
    ...(init.headers ?? {}),
  };
  const bearer = init.bearerToken ?? config.apiKey;
  if (typeof bearer === "string" && bearer.length > 0) {
    headers["authorization"] = `Bearer ${bearer}`;
  }
  const requestInit: Record<string, unknown> = { method: init.method, headers };
  if (init.signal !== undefined) requestInit["signal"] = init.signal;
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    requestInit["body"] = JSON.stringify(init.body);
  }

  let response: Response;
  try {
    response = await fetchImpl(url, requestInit as Parameters<typeof fetchImpl>[1]);
  } catch (e) {
    if (init.signal?.aborted) throw e;
    throw new KError({
      code: "K9O_UPSTREAM_UNAVAILABLE",
      message: `Network error reaching ${url}: ${e instanceof Error ? e.message : String(e)}`,
      context: { url },
      recommendation: "Check connectivity to the gateway; retry with backoff if transient.",
    });
  }

  if (response.status < 200 || response.status >= 300) {
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      /* non-JSON error body */
    }
    if (isKErrorWire(parsed)) throw kerrorFromWire(parsed, response.status);
    throw new KError({
      code: "K9O_INTERNAL_ERROR",
      message: `Upstream returned ${response.status} opening stream`,
      context: { url, status: response.status, body: parsed },
      status: response.status,
    });
  }

  if (response.body === null) {
    throw new KError({
      code: "K9O_INTERNAL_ERROR",
      message: `Stream response from ${url} has no body`,
      context: { url, status: response.status },
      status: response.status,
    });
  }

  return response;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query: RequestInit["query"],
): string {
  const trimmedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const trimmedPath = path.startsWith("/") ? path : `/${path}`;
  let url = `${trimmedBase}${trimmedPath}`;
  if (query !== undefined) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs.length > 0) url += `?${qs}`;
  }
  return url;
}

function isEnvelope<T>(value: unknown): value is Envelope<T> {
  if (value === null || typeof value !== "object") return false;
  const v = value as { data?: unknown; meta?: unknown };
  return "data" in v && "meta" in v && typeof v.meta === "object" && v.meta !== null;
}

function isKErrorWire(value: unknown): value is KErrorWire {
  if (value === null || typeof value !== "object") return false;
  const v = value as { code?: unknown; message?: unknown };
  return typeof v.code === "string" && typeof v.message === "string";
}
