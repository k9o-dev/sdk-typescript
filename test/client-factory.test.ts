/**
 * Unit tests for `createClient` — the public factory that callers
 * invoke to construct a `K9oClient` instance.
 */

import { describe, expect, it } from "bun:test";
import { createClient, KError } from "../src/index.ts";

describe("createClient", () => {
  it("constructs with minimal options", () => {
    const client = createClient({ baseUrl: "https://api.k9o.io" });
    expect(client.config.baseUrl).toBe("https://api.k9o.io");
    expect(typeof client.from).toBe("function");
    expect(typeof client.projects.list).toBe("function");
  });

  it("normalises trailing slash on baseUrl", () => {
    const client = createClient({ baseUrl: "https://api.k9o.io/" });
    expect(client.config.baseUrl).toBe("https://api.k9o.io");
  });

  it("propagates apiKey + projectSlug + orgSlug to config", () => {
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      apiKey: "k9o_test",
      orgSlug: "acme",
      projectSlug: "member-portal",
    });
    expect(client.config.apiKey).toBe("k9o_test");
    expect(client.config.orgSlug).toBe("acme");
    expect(client.config.projectSlug).toBe("member-portal");
  });

  it("freezes config to prevent caller mutation", () => {
    const client = createClient({ baseUrl: "https://api.k9o.io" });
    expect(Object.isFrozen(client.config)).toBe(true);
  });

  it("throws K9O_INVALID_BASE_URL at construct time for path-bearing baseUrl", () => {
    let caught: unknown;
    try {
      createClient({ baseUrl: "https://api.k9o.io/v2" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(KError);
    expect((caught as KError).code).toBe("K9O_INVALID_BASE_URL");
  });

  it("throws K9O_INVALID_BASE_URL for ws scheme", () => {
    let caught: unknown;
    try {
      createClient({ baseUrl: "wss://api.k9o.io" });
    } catch (e) {
      caught = e;
    }
    expect((caught as KError).code).toBe("K9O_INVALID_BASE_URL");
  });
});

describe("data-plane DSL — `from(collection)`", () => {
  it("requires projectSlug bound on client", async () => {
    const client = createClient({ baseUrl: "https://api.k9o.io" });
    let caught: unknown;
    try {
      await client.from("posts").select();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(KError);
    expect((caught as KError).code).toBe("K9O_MISSING_PROJECT_CONTEXT");
  });

  it("validates collection name", async () => {
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
    });
    let caught: unknown;
    try {
      await client.from("Bad-Name").select();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(KError);
    expect((caught as KError).code).toBe("K9O_INVALID_FIELD_VALUE");
  });

  it("composes filters + limit + count into query string", async () => {
    let capturedUrl = "";
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: ((async (input: RequestInfo | URL) => {
        capturedUrl = typeof input === "string" ? input : input.toString();
        return new Response(JSON.stringify({ data: [], meta: { cursor: { next: null } } }), { status: 200 });
      }) as unknown) as typeof globalThis.fetch,
    });
    await client.from("posts").select().eq("status", "published").gt("views", 100).limit(20).count("exact");
    expect(capturedUrl).toBe(
      "https://acme.api.k9o.io/@member-portal/data/posts?status=eq.published&views=gt.100&limit=20&count=exact",
    );
  });

  it("insert POSTs to collection documents path with body", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    let capturedMethod = "";
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: ((async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = typeof input === "string" ? input : input.toString();
        capturedBody = String(init?.body);
        capturedMethod = init?.method as string;
        return new Response(JSON.stringify({ data: { id: "rec_x", title: "hi" }, meta: {} }), { status: 200 });
      }) as unknown) as typeof globalThis.fetch,
    });
    const res = await client.from("posts").insert({ title: "hi" });
    expect(capturedMethod).toBe("POST");
    expect(capturedUrl).toBe("https://acme.api.k9o.io/@member-portal/data/posts");
    expect(capturedBody).toBe(`{"title":"hi"}`);
    expect(res.data).toEqual({ id: "rec_x", title: "hi" } as unknown);
  });

  it("update requires .eq('id',...) clause", async () => {
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
    });
    let caught: unknown;
    try {
      await client.from("posts").update({ title: "x" });
    } catch (e) {
      caught = e;
    }
    expect((caught as KError).code).toBe("K9O_INVALID_FIELD_VALUE");
  });

  it("update with .eq('id',...) PATCHes the document path", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: ((async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = typeof input === "string" ? input : input.toString();
        capturedMethod = init?.method as string;
        return new Response(JSON.stringify({ data: { id: "rec_y" }, meta: {} }), { status: 200 });
      }) as unknown) as typeof globalThis.fetch,
    });
    await client.from("posts").update({ title: "x" }).eq("id", "rec_y");
    expect(capturedMethod).toBe("PATCH");
    expect(capturedUrl).toBe("https://acme.api.k9o.io/@member-portal/data/posts/rec_y");
  });

  it("delete with .eq('id',...) DELETEs the document path", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: ((async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = typeof input === "string" ? input : input.toString();
        capturedMethod = init?.method as string;
        return new Response(null, { status: 204 });
      }) as unknown) as typeof globalThis.fetch,
    });
    await client.from("posts").delete().eq("id", "rec_z");
    expect(capturedMethod).toBe("DELETE");
    expect(capturedUrl).toBe("https://acme.api.k9o.io/@member-portal/data/posts/rec_z");
  });

  it("serialises in() filter as parenthesised comma list", async () => {
    let capturedUrl = "";
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: ((async (input: RequestInfo | URL) => {
        capturedUrl = typeof input === "string" ? input : input.toString();
        return new Response(JSON.stringify({ data: [], meta: {} }), { status: 200 });
      }) as unknown) as typeof globalThis.fetch,
    });
    await client.from("posts").select().in("status", ["published", "draft"]);
    expect(capturedUrl).toBe(
      "https://acme.api.k9o.io/@member-portal/data/posts?status=in.%28published%2Cdraft%29",
    );
  });
});

describe("projects namespace", () => {
  it("list GETs /projects", async () => {
    let captured = "";
    let method = "";
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      orgSlug: "acme",
      fetch: ((async (input: RequestInfo | URL, init?: RequestInit) => {
        captured = typeof input === "string" ? input : input.toString();
        method = init?.method as string;
        return new Response(JSON.stringify({ data: [], meta: {} }), { status: 200 });
      }) as unknown) as typeof globalThis.fetch,
    });
    await client.projects.list();
    expect(method).toBe("GET");
    expect(captured).toBe("https://acme.api.k9o.io/projects");
  });

  it("create POSTs /projects with input body + validates slug", async () => {
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      orgSlug: "acme",
    });
    let caught: unknown;
    try {
      await client.projects.create({ slug: "Bad-Slug", displayName: "x" });
    } catch (e) {
      caught = e;
    }
    expect((caught as KError).code).toBe("K9O_INVALID_FIELD_VALUE");
  });

  it("get GETs /projects/<slug>", async () => {
    let captured = "";
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      fetch: ((async (input: RequestInfo | URL) => {
        captured = typeof input === "string" ? input : input.toString();
        return new Response(JSON.stringify({ data: { id: "proj_x", slug: "p", name: "P" }, meta: {} }), { status: 200 });
      }) as unknown) as typeof globalThis.fetch,
    });
    await client.projects.get("member-portal");
    expect(captured).toBe("https://acme.api.k9o.io/projects/member-portal");
  });
});
