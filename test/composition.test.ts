/**
 * Tests for pillar composition: client.gate (from `@k9o/gate`) +
 * client.extensions (from `@k9o/extensions`).
 *
 * Verifies the K9oClient exposes composed pillar namespaces and that
 * the gate bridge routes against the same baseUrl + projectSlug as the
 * rest of the client.
 */

import { describe, expect, it } from "bun:test";
import { createClient, KError } from "../src/index.ts";

describe("client.gate composition", () => {
  it("exposes gate namespace when projectSlug is bound", () => {
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      apiKey: "k9o_test",
    });
    expect(typeof client.gate.signUp).toBe("function");
    expect(typeof client.gate.signIn).toBe("function");
    expect(typeof client.gate.signOut).toBe("function");
    expect(typeof client.gate.whoami).toBe("function");
    expect(typeof client.gate.refreshToken).toBe("function");
    expect(typeof client.gate.verifySession).toBe("function");
  });

  it("throws K9O_MISSING_PROJECT_CONTEXT when gate accessed without projectSlug", () => {
    const client = createClient({ baseUrl: "https://api.k9o.io" });
    let caught: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      client.gate;
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(KError);
    expect((caught as KError).code).toBe("K9O_MISSING_PROJECT_CONTEXT");
  });

  it("gate routes against the same baseUrl + projectSlug as the K9oClient", async () => {
    let capturedUrl = "";
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      apiKey: "k9o_test",
      fetch: ((async (input: RequestInfo | URL) => {
        capturedUrl = typeof input === "string" ? input : input.toString();
        return new Response(JSON.stringify({ data: { user: { id: "eu_x" } }, meta: {} }), { status: 200 });
      }) as unknown) as typeof globalThis.fetch,
    });
    await client.gate.whoami();
    expect(capturedUrl).toBe("https://acme.api.k9o.io/@member-portal/gate/whoami");
  });
});

describe("client.extensions composition", () => {
  it("exposes extensions.extension factory", () => {
    const client = createClient({ baseUrl: "https://api.k9o.io" });
    expect(typeof client.extensions.extension).toBe("function");
  });

  it("returns typed extension binding for known slug", () => {
    const client = createClient({ baseUrl: "https://api.k9o.io" });
    const paperless = client.extensions.extension("paperless");
    expect(paperless).toBeDefined();
    expect(typeof paperless.documents.uploadAndOcr).toBe("function");
  });

  it("returns cairn extension binding", () => {
    const client = createClient({ baseUrl: "https://api.k9o.io" });
    const cairn = client.extensions.extension("cairn");
    expect(cairn).toBeDefined();
    expect(typeof cairn.vectors.upsert).toBe("function");
  });
});

describe("client.gate.hosted", () => {
  it("is reachable through the composed gate and goes to the project's hosted route", async () => {
    const urls: string[] = [];
    const client = createClient({
      baseUrl: "https://api.k9o.io",
      projectSlug: "member-portal",
      fetch: (async (input: string | URL) => {
        urls.push(String(input));
        return new Response(JSON.stringify({ data: { signInUrl: "https://k3xy.gate-de01.k9o.io/sign-in", rpId: "k3xy.gate-de01.k9o.io" }, meta: {} }), { status: 200 });
      }) as unknown as typeof globalThis.fetch,
    });
    const r = await client.gate.hosted();
    expect(urls).toEqual(["https://api.k9o.io/@member-portal/gate/hosted"]);
    expect(r.data.rpId).toBe("k3xy.gate-de01.k9o.io");
  });
});
