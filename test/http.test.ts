/**
 * Unit tests for the HTTP client — envelope unwrap + KError rehydration
 * + bearer + project context header + transport error mapping.
 * Uses a stub fetch implementation for deterministic verification.
 */

import { describe, expect, it } from "bun:test";
import { request, type HttpClientConfig } from "../src/http.ts";
import { KError } from "../src/kerror.ts";

function makeStubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    return await handler(url, init ?? {});
  }) as unknown as typeof globalThis.fetch;
}

const baseConfig: Omit<HttpClientConfig, "fetch"> = {
  baseUrl: "https://acme.api.k9o.io",
};

describe("HTTP — success path", () => {
  it("unwraps 2xx envelope + composes URL with query", async () => {
    let capturedUrl = "";
    const config: HttpClientConfig = {
      ...baseConfig,
      fetch: makeStubFetch((url) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ data: { ok: true }, meta: { x: 1 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    };
    const env = await request<{ ok: boolean }>(config, {
      method: "GET",
      path: "/projects",
      query: { limit: 10, count: "exact" },
    });
    expect(env.data).toEqual({ ok: true });
    expect(env.meta).toEqual({ x: 1 });
    expect(capturedUrl).toBe("https://acme.api.k9o.io/projects?limit=10&count=exact");
  });

  it("injects bearer + project + org headers", async () => {
    let capturedHeaders: Record<string, string> = {};
    const config: HttpClientConfig = {
      ...baseConfig,
      apiKey: "k9o_test_key",
      projectSlug: "member-portal",
      orgSlug: "acme",
      fetch: makeStubFetch((_, init) => {
        capturedHeaders = init.headers as Record<string, string>;
        return new Response(JSON.stringify({ data: null, meta: {} }), { status: 200 });
      }),
    };
    await request(config, { method: "GET", path: "/x" });
    expect(capturedHeaders["authorization"]).toBe("Bearer k9o_test_key");
    expect(capturedHeaders["x-k9o-project-slug"]).toBe("member-portal");
    expect(capturedHeaders["x-k9o-org-slug"]).toBe("acme");
  });

  it("per-call bearerToken overrides config.apiKey", async () => {
    let captured = "";
    const config: HttpClientConfig = {
      ...baseConfig,
      apiKey: "default",
      fetch: makeStubFetch((_, init) => {
        captured = (init.headers as Record<string, string>)["authorization"]!;
        return new Response(JSON.stringify({ data: null, meta: {} }), { status: 200 });
      }),
    };
    await request(config, { method: "GET", path: "/x", bearerToken: "override" });
    expect(captured).toBe("Bearer override");
  });

  it("serialises JSON body + sets content-type", async () => {
    let capturedBody = "";
    let capturedContentType = "";
    const config: HttpClientConfig = {
      ...baseConfig,
      fetch: makeStubFetch((_, init) => {
        capturedBody = String(init.body);
        capturedContentType = (init.headers as Record<string, string>)["content-type"] ?? "";
        return new Response(JSON.stringify({ data: null, meta: {} }), { status: 200 });
      }),
    };
    await request(config, { method: "POST", path: "/x", body: { hello: "world" } });
    expect(capturedBody).toBe(`{"hello":"world"}`);
    expect(capturedContentType).toBe("application/json");
  });

  it("handles 204 No Content as empty envelope", async () => {
    const config: HttpClientConfig = {
      ...baseConfig,
      fetch: makeStubFetch(() => new Response(null, { status: 204 })),
    };
    const env = await request(config, { method: "DELETE", path: "/x" });
    expect(env.data).toBeUndefined();
    expect(env.meta).toEqual({});
  });
});

describe("HTTP — error path", () => {
  it("rehydrates non-2xx KError wire payload", async () => {
    const config: HttpClientConfig = {
      ...baseConfig,
      fetch: makeStubFetch(() =>
        new Response(
          JSON.stringify({
            code: "K9O_TIER_CAP_HIT",
            message: "MAU cap exceeded",
            context: { dimension: "mau", limit: 1000 },
            recommendation: "upgrade to Ascent",
          }),
          { status: 429 },
        ),
      ),
    };
    let caught: unknown;
    try {
      await request(config, { method: "GET", path: "/x" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(KError);
    expect((caught as KError).code).toBe("K9O_TIER_CAP_HIT");
    expect((caught as KError).status).toBe(429);
    expect((caught as KError).context).toEqual({ dimension: "mau", limit: 1000 });
    expect((caught as KError).recommendation).toBe("upgrade to Ascent");
  });

  it("wraps transport failure as K9O_UPSTREAM_UNAVAILABLE", async () => {
    const config: HttpClientConfig = {
      ...baseConfig,
      fetch: makeStubFetch(() => {
        throw new TypeError("network down");
      }),
    };
    let caught: unknown;
    try {
      await request(config, { method: "GET", path: "/x" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(KError);
    expect((caught as KError).code).toBe("K9O_UPSTREAM_UNAVAILABLE");
  });

  it("rejects malformed 2xx envelope as INTERNAL_ERROR", async () => {
    const config: HttpClientConfig = {
      ...baseConfig,
      fetch: makeStubFetch(() =>
        new Response(JSON.stringify({ wrong: "shape" }), { status: 200 }),
      ),
    };
    let caught: unknown;
    try {
      await request(config, { method: "GET", path: "/x" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(KError);
    expect((caught as KError).code).toBe("K9O_INTERNAL_ERROR");
  });

  it("wraps non-KError non-2xx body as INTERNAL_ERROR", async () => {
    const config: HttpClientConfig = {
      ...baseConfig,
      fetch: makeStubFetch(() =>
        new Response(JSON.stringify({ random: "garbage" }), { status: 500 }),
      ),
    };
    let caught: unknown;
    try {
      await request(config, { method: "GET", path: "/x" });
    } catch (e) {
      caught = e;
    }
    expect((caught as KError).code).toBe("K9O_INTERNAL_ERROR");
    expect((caught as KError).status).toBe(500);
  });
});
