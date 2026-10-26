/**
 * Tests for retry + backoff logic.
 *
 * Covers: isRetryable predicate (method gating + KError code/status
 * inspection); computeDelay (exponential / linear / none + cap + jitter);
 * withRetry orchestration (transient failures → retry; semantic failures
 * → throw immediately; max-attempts exhaust → throw last error).
 */

import { describe, expect, it } from "bun:test";
import { isRetryable, computeDelay, withRetry, DEFAULT_RETRY_CONFIG } from "../src/retry.ts";
import { KError } from "../src/kerror.ts";
import { createClient } from "../src/index.ts";

describe("isRetryable", () => {
  it("retries transport failures on GET", () => {
    expect(isRetryable(new KError({ code: "K9O_UPSTREAM_UNAVAILABLE", message: "x" }), "GET")).toBe(true);
  });

  it("retries 502/503/504 on GET", () => {
    for (const status of [502, 503, 504]) {
      expect(isRetryable(new KError({ code: "X", message: "x", status }), "GET")).toBe(true);
    }
  });

  it("retries 429 on GET", () => {
    expect(isRetryable(new KError({ code: "X", message: "x", status: 429 }), "GET")).toBe(true);
  });

  it("does not retry 500", () => {
    expect(isRetryable(new KError({ code: "X", message: "x", status: 500 }), "GET")).toBe(false);
  });

  it("does not retry 4xx other than 429", () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(isRetryable(new KError({ code: "X", message: "x", status }), "GET")).toBe(false);
    }
  });

  it("does not retry non-idempotent methods even if status retryable", () => {
    for (const method of ["POST", "PATCH", "PUT"]) {
      expect(isRetryable(new KError({ code: "K9O_UPSTREAM_UNAVAILABLE", message: "x" }), method)).toBe(false);
    }
  });

  it("retries DELETE (idempotent)", () => {
    expect(isRetryable(new KError({ code: "K9O_UPSTREAM_UNAVAILABLE", message: "x" }), "DELETE")).toBe(true);
  });

  it("does not retry non-KError thrown values", () => {
    expect(isRetryable(new Error("plain"), "GET")).toBe(false);
    expect(isRetryable("string thrown", "GET")).toBe(false);
  });
});

describe("computeDelay", () => {
  it("returns 0 for backoff: none", () => {
    expect(computeDelay({ ...DEFAULT_RETRY_CONFIG, backoff: "none" }, 0)).toBe(0);
    expect(computeDelay({ ...DEFAULT_RETRY_CONFIG, backoff: "none" }, 3)).toBe(0);
  });

  it("exponential backoff doubles per attempt", () => {
    const config = { ...DEFAULT_RETRY_CONFIG, backoff: "exponential" as const, initialDelayMs: 100, maxDelayMs: 100000 };
    // attempt 0: ~100ms; attempt 1: ~200ms; attempt 2: ~400ms; etc.
    // Jitter is ±25% so use ranges
    for (const attempt of [0, 1, 2, 3]) {
      const base = 100 * Math.pow(2, attempt);
      const delay = computeDelay(config, attempt);
      expect(delay).toBeGreaterThanOrEqual(base * 0.75 - 1);
      expect(delay).toBeLessThanOrEqual(base * 1.25 + 1);
    }
  });

  it("linear backoff scales linearly", () => {
    const config = { ...DEFAULT_RETRY_CONFIG, backoff: "linear" as const, initialDelayMs: 100, maxDelayMs: 100000 };
    for (const attempt of [0, 1, 2, 3]) {
      const base = 100 * (attempt + 1);
      const delay = computeDelay(config, attempt);
      expect(delay).toBeGreaterThanOrEqual(base * 0.75 - 1);
      expect(delay).toBeLessThanOrEqual(base * 1.25 + 1);
    }
  });

  it("caps at maxDelayMs", () => {
    const config = { ...DEFAULT_RETRY_CONFIG, backoff: "exponential" as const, initialDelayMs: 100, maxDelayMs: 500 };
    // attempt 5: base = 3200ms; capped to 500ms; ±25% jitter
    const delay = computeDelay(config, 5);
    expect(delay).toBeLessThanOrEqual(500 * 1.25 + 1);
  });
});

describe("withRetry orchestration", () => {
  it("returns value on first success (no retry)", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        return "ok";
      },
      "GET",
      { maxRetries: 3, backoff: "none" },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries transient failures + eventually succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new KError({ code: "K9O_UPSTREAM_UNAVAILABLE", message: "x" });
        return "ok";
      },
      "GET",
      { maxRetries: 3, backoff: "none" },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("throws after maxRetries+1 attempts on persistent transient failure", async () => {
    let calls = 0;
    let caught: unknown;
    try {
      await withRetry(
        async () => {
          calls++;
          throw new KError({ code: "K9O_UPSTREAM_UNAVAILABLE", message: "x" });
        },
        "GET",
        { maxRetries: 2, backoff: "none" },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(KError);
    expect(calls).toBe(3); // 1 initial + 2 retries
  });

  it("throws immediately on non-retryable failure (no retries)", async () => {
    let calls = 0;
    let caught: unknown;
    try {
      await withRetry(
        async () => {
          calls++;
          throw new KError({ code: "K9O_PROJECT_NOT_FOUND", message: "x", status: 404 });
        },
        "GET",
        { maxRetries: 3, backoff: "none" },
      );
    } catch (e) {
      caught = e;
    }
    expect(calls).toBe(1); // no retries
    expect((caught as KError).code).toBe("K9O_PROJECT_NOT_FOUND");
  });

  it("does not retry POST even on transient failure", async () => {
    let calls = 0;
    let caught: unknown;
    try {
      await withRetry(
        async () => {
          calls++;
          throw new KError({ code: "K9O_UPSTREAM_UNAVAILABLE", message: "x" });
        },
        "POST",
        { maxRetries: 3, backoff: "none" },
      );
    } catch (e) {
      caught = e;
    }
    expect(calls).toBe(1);
    expect((caught as KError).code).toBe("K9O_UPSTREAM_UNAVAILABLE");
  });
});

describe("HTTP client retry integration", () => {
  it("retries 503 on GET and succeeds on second attempt", async () => {
    let calls = 0;
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      orgSlug: "acme",
      retryConfig: { maxRetries: 3, backoff: "none" },
      fetch: ((async () => {
        calls++;
        if (calls < 2) {
          return new Response(JSON.stringify({ code: "K9O_UPSTREAM_BUSY", message: "busy" }), { status: 503 });
        }
        return new Response(JSON.stringify({ data: [], meta: {} }), { status: 200 });
      }) as unknown) as typeof globalThis.fetch,
    });
    const res = await client.projects.list();
    expect(calls).toBe(2);
    expect(res.data).toEqual([]);
  });

  it("does not retry 404 (semantic failure)", async () => {
    let calls = 0;
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      orgSlug: "acme",
      retryConfig: { maxRetries: 5, backoff: "none" },
      fetch: ((async (_u: unknown, init?: RequestInit) => {
        // The region probe (an unauthenticated HEAD to the region-free host) is not an API attempt.
        if (init?.method === "HEAD") return new Response(null, { status: 200 });
        calls++;
        return new Response(JSON.stringify({ code: "K9O_PROJECT_NOT_FOUND", message: "x" }), { status: 404 });
      }) as unknown) as typeof globalThis.fetch,
    });
    let caught: unknown;
    try {
      await client.projects.get("ghost");
    } catch (e) {
      caught = e;
    }
    expect(calls).toBe(1);
    expect((caught as KError).code).toBe("K9O_PROJECT_NOT_FOUND");
  });
});
