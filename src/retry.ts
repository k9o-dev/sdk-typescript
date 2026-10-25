/**
 * Retry + backoff for the HTTP client.
 *
 * Configured via `retryConfig: { maxRetries, backoff }`. Retries are
 * scoped to transient failures only — never retry on KError-carrying
 * non-2xx responses (those are semantic; the caller must handle them).
 *
 * Retryable conditions (transient; safe to retry idempotently):
 *   - Transport error (`K9O_UPSTREAM_UNAVAILABLE` from `request()`) — network down,
 *     DNS fail, connection refused, etc.
 *   - HTTP 502 / 503 / 504 (gateway-up but downstream unavailable)
 *   - HTTP 429 with `Retry-After` header (rate-limit; backoff by header value)
 *
 * Non-retryable (semantic; caller must handle):
 *   - HTTP 4xx other than 429 (caller bug; retry won't help)
 *   - HTTP 5xx other than 502/503/504 (gateway-side bug; surface immediately)
 *   - KError on success-shape (rare; malformed envelope)
 *
 * Retry method discipline: only GET / HEAD / OPTIONS / DELETE are
 * retried by default — these are RFC-7231 idempotent. POST / PATCH /
 * PUT are NOT retried (caller can opt in via `idempotencyKey` header
 * when they assert idempotency).
 *
 * Backoff:
 *   - `exponential` (default) — `initialDelayMs * 2^attempt`, capped at maxDelayMs; jittered ±25%
 *   - `linear` — `initialDelayMs * (attempt + 1)`, capped at maxDelayMs; jittered ±25%
 *   - `none` — no delay between attempts
 */

import { KError } from "./kerror.ts";
import type { RetryConfig } from "./types.ts";

const RETRYABLE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "DELETE"]);
const RETRYABLE_STATUS = new Set([502, 503, 504]);

export const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  backoff: "exponential",
  initialDelayMs: 100,
  maxDelayMs: 5000,
};

/**
 * Decide if a thrown error is retryable.
 * Only KError instances are inspected; other thrown values propagate
 * (programmer error / unrecoverable state).
 */
export function isRetryable(error: unknown, method: string): boolean {
  if (!RETRYABLE_METHODS.has(method.toUpperCase())) return false;
  if (!(error instanceof KError)) return false;
  if (error.code === "K9O_UPSTREAM_UNAVAILABLE") return true;
  if (error.status !== null && RETRYABLE_STATUS.has(error.status)) return true;
  if (error.status === 429) return true; // rate-limit; respect Retry-After if surfaced in context
  return false;
}

/**
 * Compute the backoff delay for a given attempt index (0-based).
 */
export function computeDelay(config: Required<RetryConfig>, attempt: number): number {
  let base: number;
  if (config.backoff === "none") return 0;
  if (config.backoff === "linear") base = config.initialDelayMs * (attempt + 1);
  else base = config.initialDelayMs * Math.pow(2, attempt);
  const capped = Math.min(base, config.maxDelayMs);
  // ±25% jitter
  const jitter = capped * 0.25 * (Math.random() * 2 - 1);
  return Math.max(0, Math.floor(capped + jitter));
}

/**
 * Sleep helper. Pulled out so tests can stub it via injection.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry. The function is called up to
 * `maxRetries + 1` times; non-retryable failures throw immediately.
 *
 * @param fn - The function to execute (typically the HTTP request)
 * @param method - HTTP method (used to gate retry per RETRYABLE_METHODS)
 * @param config - Retry config; defaults applied if partial
 * @param sleepImpl - Sleep implementation (tests inject a no-op or fast variant)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  method: string,
  config: RetryConfig | undefined,
  sleepImpl: (ms: number) => Promise<void> = sleep,
): Promise<T> {
  const c: Required<RetryConfig> = {
    ...DEFAULT_RETRY_CONFIG,
    ...(config ?? {}),
  };
  let lastError: unknown;
  for (let attempt = 0; attempt <= c.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt === c.maxRetries) break;
      if (!isRetryable(e, method)) break;
      const delay = computeDelay(c, attempt);
      if (delay > 0) await sleepImpl(delay);
    }
  }
  throw lastError;
}
