/**
 * Wire-shape verification for the namespaces shipped at checkpoint B:
 * migrations / functions / policies / audit / orgs.
 *
 * Tests verify URL construction + HTTP method + body shape against the
 * gateway route definitions in `services/gateway/src/routes/`.
 */

import { describe, expect, it } from "bun:test";
import { createClient } from "../src/index.ts";

type CapturedRequest = { url: string; method: string; body?: string };

function captureFetch(captured: CapturedRequest, responseBody: unknown = { data: null, meta: {} }, status = 200): typeof globalThis.fetch {
  return ((async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.url = typeof input === "string" ? input : input.toString();
    captured.method = init?.method as string;
    if (init?.body !== undefined) captured.body = String(init.body);
    return new Response(JSON.stringify(responseBody), { status, headers: { "content-type": "application/json" } });
  }) as unknown) as typeof globalThis.fetch;
}

describe("migrations namespace", () => {
  it("apply POSTs /@<slug>/migrations/apply with body", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: captureFetch(cap, { data: { applied: [] }, meta: {} }),
    });
    await client.migrations.apply({
      migrations: [
        {
          version: 1,
          slug: "init",
          up: [{ create_table: { name: "x", columns: [{ name: "id", type: "text", primary_key: true }] } }],
          down: [{ drop_table: "x" }],
        },
      ],
    });
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://acme.api.k9o.io/@member-portal/migrations/apply");
    expect(cap.body).toContain("create_table");
  });

  it("list GETs /@<slug>/migrations", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: captureFetch(cap, { data: [], meta: {} }),
    });
    await client.migrations.list();
    expect(cap.method).toBe("GET");
    expect(cap.url).toBe("https://acme.api.k9o.io/@member-portal/migrations");
  });

  it("get GETs /@<slug>/migrations/<version>", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: captureFetch(cap, { data: {}, meta: {} }),
    });
    await client.migrations.get(5);
    expect(cap.url).toBe("https://acme.api.k9o.io/@member-portal/migrations/5");
  });

  it("applyPending POSTs the apply endpoint", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: captureFetch(cap, { data: {}, meta: {} }),
    });
    await client.migrations.applyPending("pend_abc");
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://acme.api.k9o.io/@member-portal/migrations/pending/pend_abc/apply");
  });

  it("deletePending DELETEs", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: captureFetch(cap, { data: {}, meta: {} }),
    });
    await client.migrations.deletePending("pend_xyz");
    expect(cap.method).toBe("DELETE");
    expect(cap.url).toBe("https://acme.api.k9o.io/@member-portal/migrations/pending/pend_xyz");
  });
});

describe("functions namespace", () => {
  it("deploy POSTs /@<slug>/functions with input body", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: captureFetch(cap, { data: { id: "fn_1", name: "hello", runtime: "wasm", status: "deploying", tier: "low", createdAt: "x", updatedAt: null }, meta: {} }),
    });
    const res = await client.functions.deploy({ name: "hello", runtime: "wasm", code: "base64bundle" });
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://acme.api.k9o.io/@member-portal/functions");
    expect(res.data.name).toBe("hello");
  });

  it("list with filter composes query string", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: captureFetch(cap, { data: [], meta: {} }),
    });
    await client.functions.list({ status: "active", limit: 50 });
    expect(cap.url).toBe("https://acme.api.k9o.io/@member-portal/functions?status=active&limit=50");
  });

  it("invoke POSTs /@<slug>/functions/<name>/invoke with payload", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: captureFetch(cap, { data: { result: 42 }, meta: {} }),
    });
    const res = await client.functions.invoke<{ result: number }>("compute", { a: 1, b: 2 });
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://acme.api.k9o.io/@member-portal/functions/compute/invoke");
    expect(cap.body).toBe(`{"a":1,"b":2}`);
    expect(res.data.result).toBe(42);
  });

  it("delete DELETEs /@<slug>/functions/<name>", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: captureFetch(cap, { data: { retired: true, cooldownUntil: "x" }, meta: {} }),
    });
    await client.functions.delete("old-fn");
    expect(cap.method).toBe("DELETE");
    expect(cap.url).toBe("https://acme.api.k9o.io/@member-portal/functions/old-fn");
  });
});

describe("policies namespace", () => {
  it("current GETs /@<slug>/policy", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: captureFetch(cap, { data: null, meta: {} }),
    });
    await client.policies.current();
    expect(cap.url).toBe("https://acme.api.k9o.io/@member-portal/policy");
  });

  it("create POSTs /@<slug>/policies with body", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: captureFetch(cap, { data: { id: "pol_1", name: "x", version: 1, status: "draft", rules: {}, createdAt: "x", publishedAt: null, createdBy: "u" }, meta: {} }),
    });
    await client.policies.create({ name: "test", rules: { allow: true } });
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://acme.api.k9o.io/@member-portal/policies");
    expect(cap.body).toContain("allow");
  });

  it("validate POSTs /@<slug>/policies/validate", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: captureFetch(cap, { data: { valid: true, errors: [], warnings: [] }, meta: {} }),
    });
    const res = await client.policies.validate({ rules: { x: 1 } });
    expect(cap.url).toBe("https://acme.api.k9o.io/@member-portal/policies/validate");
    expect(res.data.valid).toBe(true);
  });

  it("publish POSTs the publish endpoint", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: captureFetch(cap, { data: {}, meta: {} }),
    });
    await client.policies.publish("pol_abc");
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://acme.api.k9o.io/@member-portal/policies/pol_abc/publish");
  });

  it("update PATCHes /@<slug>/policies/<id>", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: captureFetch(cap, { data: {}, meta: {} }),
    });
    await client.policies.update("pol_x", { name: "renamed" });
    expect(cap.method).toBe("PATCH");
    expect(cap.url).toBe("https://acme.api.k9o.io/@member-portal/policies/pol_x");
  });
});

describe("audit namespace", () => {
  it("query GETs /@<slug>/audit-log with filter query", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: captureFetch(cap, { data: [], meta: {} }),
    });
    await client.audit.query({ type: "data.write.access.insert", actorId: "u_123", limit: 50 });
    expect(cap.method).toBe("GET");
    expect(cap.url).toBe(
      "https://acme.api.k9o.io/@member-portal/audit-log?type=data.write.access.insert&actorId=u_123&limit=50",
    );
  });

  it("tail composes a since-window query", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: captureFetch(cap, { data: [], meta: {} }),
    });
    await client.audit.tail({ sinceMinutes: 5, limit: 20 });
    expect(cap.url).toContain("https://acme.api.k9o.io/@member-portal/audit-log?since=");
    expect(cap.url).toContain("&limit=20");
  });
});

describe("orgs namespace", () => {
  it("list GETs /orgs", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      fetch: captureFetch(cap, { data: [], meta: {} }),
    });
    await client.orgs.list();
    expect(cap.method).toBe("GET");
    expect(cap.url).toBe("https://acme.api.k9o.io/orgs");
  });

  it("get GETs /orgs/<orgSlug>", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      fetch: captureFetch(cap, { data: {}, meta: {} }),
    });
    await client.orgs.get("acme");
    expect(cap.url).toBe("https://acme.api.k9o.io/orgs/acme");
  });

  it("restore POSTs the restore endpoint", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      fetch: captureFetch(cap, { data: {}, meta: {} }),
    });
    await client.orgs.restore("org_xyz");
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://acme.api.k9o.io/orgs/org_xyz/restore");
  });

  it("current GETs /org", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      fetch: captureFetch(cap, { data: {}, meta: {} }),
    });
    await client.orgs.current();
    expect(cap.url).toBe("https://acme.api.k9o.io/org");
  });
});
