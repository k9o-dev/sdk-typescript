/**
 * Wire-shape verification for `client.metadata.*` against the
 * REST contract. The backing gateway route hasn't landed yet (see `metadata.ts` header) — these
 * tests verify the client builds the request correctly, not that a real gateway accepts it.
 */

import { describe, expect, it } from "bun:test";
import { createClient, KError } from "../src/index.ts";

type CapturedRequest = { url: string; method: string; body?: string };

function captureFetch(captured: CapturedRequest, responseBody: unknown = { data: null, meta: {} }, status = 200): typeof globalThis.fetch {
  return ((async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.url = typeof input === "string" ? input : input.toString();
    captured.method = init?.method as string;
    if (init?.body !== undefined) captured.body = String(init.body);
    return new Response(JSON.stringify(responseBody), { status, headers: { "content-type": "application/json" } });
  }) as unknown) as typeof globalThis.fetch;
}

describe("metadata namespace", () => {
  it("from(...).execute() POSTs /@<slug>/metadata/query with the surfaces array", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: captureFetch(cap, { data: { records: [], nextCursor: null }, meta: {} }),
    });
    await client.metadata.from("collection:posts").execute();
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://acme.api.k9o.io/@member-portal/metadata/query");
    expect(JSON.parse(cap.body!)).toEqual({ surfaces: ["collection:posts"], where: [], cursor: null });
  });

  it("accepts multiple surfaces via an array", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: captureFetch(cap, { data: { records: [], nextCursor: null }, meta: {} }),
    });
    await client.metadata.from(["collection:posts", "storage:images"]).execute();
    expect(JSON.parse(cap.body!).surfaces).toEqual(["collection:posts", "storage:images"]);
  });

  it("where(...) chains into a flat clause array, limit/cursor are included when set", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: captureFetch(cap, { data: { records: [], nextCursor: null }, meta: {} }),
    });
    await client.metadata
      .from("telemetry:auth.session.created")
      .where("context.signinIp", "startsWith", "10.")
      .where("createdAt", "gt", "2026-05-10T00:00:00Z")
      .limit(50)
      .cursor("abc")
      .execute();
    const body = JSON.parse(cap.body!);
    expect(body.where).toEqual([
      { field: "context.signinIp", op: "startsWith", value: "10." },
      { field: "createdAt", op: "gt", value: "2026-05-10T00:00:00Z" },
    ]);
    expect(body.limit).toBe(50);
    expect(body.cursor).toBe("abc");
  });

  it("is immutable — chaining does not mutate the original builder", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({
      baseUrl: "https://acme.api.k9o.io",
      projectSlug: "member-portal",
      fetch: captureFetch(cap, { data: { records: [], nextCursor: null }, meta: {} }),
    });
    const base = client.metadata.from("collection:posts");
    base.where("metadata.tags", "contains", "pinned"); // discarded — not chained
    await base.execute();
    expect(JSON.parse(cap.body!).where).toEqual([]);
  });

  it("throws K9O_MISSING_PROJECT_CONTEXT without a bound projectSlug", () => {
    const client = createClient({ baseUrl: "https://acme.api.k9o.io" });
    expect(() => client.metadata.from("collection:posts").execute()).toThrow(KError);
  });

  it("throws K9O_UNKNOWN_SURFACE on an empty surfaces array", () => {
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", projectSlug: "member-portal" });
    expect(() => client.metadata.from([])).toThrow(KError);
  });
});
