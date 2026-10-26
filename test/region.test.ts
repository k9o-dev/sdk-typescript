/**
 * Regional host resolution: the one unauthenticated HEAD to the region-free org host, the 308 `Location`
 * validation, the caching, and that a credential can only ever reach a validated regional host.
 */

import { describe, expect, it } from "bun:test";
import { createClient } from "../src/index.ts";
import { regionalOriginFromLocation } from "../src/region.ts";

type Call = { url: string; method: string; headers: Record<string, string> };

function recorder(headLocation: string | null, headStatus = 308) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string> });
    if (init?.method === "HEAD") {
      return new Response(null, { status: headStatus, headers: headLocation === null ? {} : { location: headLocation } });
    }
    return new Response(JSON.stringify({ data: [], meta: {} }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  return { calls, f };
}

const mk = (f: typeof globalThis.fetch, baseUrl = "https://acme.api.k9o.io") =>
  createClient({ baseUrl, projectSlug: "portal", apiKey: "secret-key", defaultHeaders: { "x-extra": "1" }, fetch: f });

describe("regional host resolution", () => {
  it("probes the region-free host unauthenticated, then sends the credentialed call to the regional host", async () => {
    const { calls, f } = recorder("https://acme.api-de01.k9o.io/");
    await mk(f).storage.locations.list();
    expect(calls[0]!.method).toBe("HEAD");
    expect(calls[0]!.url).toBe("https://acme.api.k9o.io/");
    expect(Object.keys(calls[0]!.headers).map((h) => h.toLowerCase())).not.toContain("authorization");
    expect(Object.keys(calls[0]!.headers)).not.toContain("x-extra");
    expect(calls[1]!.url).toBe("https://acme.api-de01.k9o.io/@portal/storage/locations");
    expect(JSON.stringify(calls[1]!.headers)).toContain("secret-key");
  });

  it("caches the regional origin: one probe for many calls", async () => {
    const { calls, f } = recorder("https://acme.api-staging-de01.k9o.io/");
    const c = mk(f, "https://acme.api-staging.k9o.io");
    await c.storage.locations.list();
    await c.storage.locations.list();
    expect(calls.filter((x) => x.method === "HEAD").length).toBe(1);
    expect(calls[2]!.url).toBe("https://acme.api-staging-de01.k9o.io/@portal/storage/locations");
  });

  it("keeps the configured host when the platform answers without a redirect (not cut over)", async () => {
    const { calls, f } = recorder(null, 200);
    await mk(f).storage.locations.list();
    expect(calls[1]!.url).toBe("https://acme.api.k9o.io/@portal/storage/locations");
  });

  it("works on an unrelated apex and on localhost: no hardcoded host", async () => {
    const internal = recorder("https://acme.api-de01.corp.internal/");
    await mk(internal.f, "https://acme.api.corp.internal").storage.locations.list();
    expect(internal.calls[0]!.url).toBe("https://acme.api.corp.internal/");
    expect(internal.calls[1]!.url).toBe("https://acme.api-de01.corp.internal/@portal/storage/locations");
    // Same org, different apex: refused, the credential stays on the configured host.
    const wrong = recorder("https://acme.api-de01.k9o.io/");
    await mk(wrong.f, "https://acme.api.corp.internal").storage.locations.list();
    expect(wrong.calls[1]!.url).toBe("https://acme.api.corp.internal/@portal/storage/locations");
    const local = recorder(null, 200);
    await mk(local.f, "http://localhost:6000").storage.locations.list();
    expect(local.calls.some((x) => x.method === "HEAD")).toBe(false);
    expect(local.calls[0]!.url).toBe("http://localhost:6000/@portal/storage/locations");
  });

  it("never probes a regional, custom or self-hosted baseUrl", async () => {
    for (const base of ["https://acme.api-de01.k9o.io", "https://api.example.com", "https://k9o.internal.corp"]) {
      const { calls, f } = recorder("https://evil.example/");
      await mk(f, base).storage.locations.list();
      expect(calls.some((x) => x.method === "HEAD"), base).toBe(false);
      expect(calls[0]!.url.startsWith(base)).toBe(true);
    }
  });

  it("refuses a hostile Location: the credential stays on the configured host", async () => {
    const hostile = [
      "https://evil.example/",
      "https://acme.api-de01.evil.example/",
      "https://other.api-de01.k9o.io/",
      "https://acme.api-staging-de01.k9o.io/", // wrong apex family for a prod host
      "http://acme.api-de01.k9o.io/",
      "https://user:pw@acme.api-de01.k9o.io/",
      "https://acme.api-de01.k9o.io:8443/",
      "https://acme.api-germany.k9o.io/", // not a 4-character region code
    ];
    for (const loc of hostile) {
      const { calls, f } = recorder(loc);
      await mk(f).storage.locations.list();
      expect(calls[1]!.url, loc).toBe("https://acme.api.k9o.io/@portal/storage/locations");
    }
  });

  it("does not cache a network failure of the probe", async () => {
    let head = 0;
    const f = (async (_u: unknown, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        head++;
        if (head === 1) throw new Error("offline");
        return new Response(null, { status: 308, headers: { location: "https://acme.api-de01.k9o.io/" } });
      }
      return new Response(JSON.stringify({ data: [], meta: {} }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const c = mk(f);
    await c.storage.locations.list();
    await c.storage.locations.list();
    expect(head).toBe(2);
  });

  it("regionalOriginFromLocation accepts only the same org on the same apex family", () => {
    const base = "https://acme.api.k9o.io";
    expect(regionalOriginFromLocation("acme.api.k9o.io", "https://acme.api-de01.k9o.io/x", base)).toBe("https://acme.api-de01.k9o.io");
    expect(regionalOriginFromLocation("acme.api.k9o.io", "/relative", base)).toBeNull();
    expect(regionalOriginFromLocation("acme.api-staging.k9o.io", "https://acme.api-staging-de01.k9o.io/", base)).toBe("https://acme.api-staging-de01.k9o.io");
    expect(regionalOriginFromLocation("api.example.com", "https://acme.api-de01.k9o.io/", base)).toBeNull();
  });
});
