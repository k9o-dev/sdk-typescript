/**
 * `client.storage.locations.*` — URL composition, verb and body for the six gateway operations
 * (`/@<projectSlug>/storage/locations`), the bound-project guard, and the hard cutover (no `client.byos`).
 */

import { describe, expect, it } from "bun:test";
import { createClient } from "../src/index.ts";
import { KError } from "../src/kerror.ts";

type Captured = { url: string; method: string; body?: string };

function captureFetch(cap: Captured, response: unknown = { data: null, meta: {} }, status = 200): typeof globalThis.fetch {
  return ((async (input: RequestInfo | URL, init?: RequestInit) => {
    cap.url = typeof input === "string" ? input : input.toString();
    cap.method = init?.method as string;
    if (init?.body !== undefined) cap.body = String(init.body);
    return new Response(JSON.stringify(response), { status, headers: { "content-type": "application/json" } });
  }) as unknown) as typeof globalThis.fetch;
}

const BASE = "https://acme.api.k9o.io/@member-portal/storage/locations";
const mk = (cap: Captured, response?: unknown, status?: number) =>
  createClient({ baseUrl: "https://acme.api.k9o.io", projectSlug: "member-portal", fetch: captureFetch(cap, response, status) });

describe("client.storage.locations", () => {
  it("list GETs /storage/locations", async () => {
    const cap: Captured = { url: "", method: "" };
    await mk(cap, { data: [], meta: {} }).storage.locations.list();
    expect(cap.method).toBe("GET");
    expect(cap.url).toBe(BASE);
  });

  it("create POSTs the body as given: providerParams, no purpose", async () => {
    const cap: Captured = { url: "", method: "" };
    await mk(cap, { data: {}, meta: {} }).storage.locations.create({
      provider: "r2",
      bucketName: "acme-docs",
      region: "de01",
      providerRegion: "auto",
      credentialRef: "kibo://byos-creds/sec_abc123",
      providerParams: { accountId: "a".repeat(32), parentAccessKeyId: "b".repeat(32) },
    });
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe(BASE);
    const body = JSON.parse(cap.body!) as Record<string, unknown>;
    expect(body["provider"]).toBe("r2");
    // Both namespaces ride the wire, camelCase, as two separate fields.
    expect(body["region"]).toBe("de01");
    expect(body["providerRegion"]).toBe("auto");
    expect("provider_region" in body).toBe(false);
    expect(body["providerParams"]).toEqual({ accountId: "a".repeat(32), parentAccessKeyId: "b".repeat(32) });
    expect("purpose" in body).toBe(false);
  });

  it("get GETs /storage/locations/<id> and url-encodes the id", async () => {
    const cap: Captured = { url: "", method: "" };
    await mk(cap, { data: {}, meta: {} }).storage.locations.get("byos_abc123");
    expect(cap.method).toBe("GET");
    expect(cap.url).toBe(`${BASE}/byos_abc123`);
    await mk(cap, { data: {}, meta: {} }).storage.locations.get("a/b c");
    expect(cap.url).toBe(`${BASE}/a%2Fb%20c`);
  });

  it("update carries region and providerRegion as separate patch fields", async () => {
    const cap: Captured = { url: "", method: "" };
    await mk(cap, { data: {}, meta: {} }).storage.locations.update("byos_abc123", { providerRegion: "eu-west-1" });
    expect(JSON.parse(cap.body!)).toEqual({ providerRegion: "eu-west-1" });
    await mk(cap, { data: {}, meta: {} }).storage.locations.update("byos_abc123", { region: "uk01" });
    expect(JSON.parse(cap.body!)).toEqual({ region: "uk01" });
  });

  it("update PATCHes only the fields given, and null clears the endpoint override", async () => {
    const cap: Captured = { url: "", method: "" };
    await mk(cap, { data: {}, meta: {} }).storage.locations.update("byos_abc123", { endpointOverride: null, credentialRef: "kibo://byos-creds/sec_new" });
    expect(cap.method).toBe("PATCH");
    expect(cap.url).toBe(`${BASE}/byos_abc123`);
    expect(JSON.parse(cap.body!)).toEqual({ endpointOverride: null, credentialRef: "kibo://byos-creds/sec_new" });
  });

  it("retire DELETEs /storage/locations/<id> and returns the retired status", async () => {
    const cap: Captured = { url: "", method: "" };
    const env = await mk(cap, { data: { id: "byos_abc123", status: "retired" }, meta: {} }).storage.locations.retire("byos_abc123");
    expect(cap.method).toBe("DELETE");
    expect(cap.url).toBe(`${BASE}/byos_abc123`);
    expect(env.data).toEqual({ id: "byos_abc123", status: "retired" });
  });

  it("test POSTs /storage/locations/<id>/test", async () => {
    const cap: Captured = { url: "", method: "" };
    await mk(cap, { data: { dryRun: true }, meta: {} }).storage.locations.test("byos_abc123");
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe(`${BASE}/byos_abc123/test`);
  });

  it("surfaces the 409 location_in_use conflict as a KError", async () => {
    const cap: Captured = { url: "", method: "" };
    // The gateway answers with the bare KError shape (not wrapped in an envelope).
    const err = {
      code: "K9O_STATE_CONFLICT",
      message: "This storage location is still used by a bucket or a Dataset",
      context: { reason: "location_in_use", locationId: "byos_abc123", buckets: ["b1"], datasets: 0 },
      recommendation: null,
    };
    let caught: unknown;
    try { await mk(cap, err, 409).storage.locations.retire("byos_abc123"); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(KError);
    expect((caught as KError).code).toBe("K9O_STATE_CONFLICT");
    expect((caught as KError).context["reason"]).toBe("location_in_use");
  });

  it("requires a bound project (per-project resource)", async () => {
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch({ url: "", method: "" }) });
    await expect(client.storage.locations.list()).rejects.toMatchObject({ code: "K9O_MISSING_PROJECT_CONTEXT" });
  });

  it("hard cutover: the purpose-model client.byos namespace is gone", () => {
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", projectSlug: "member-portal", fetch: captureFetch({ url: "", method: "" }) });
    expect((client as unknown as Record<string, unknown>)["byos"]).toBeUndefined();
  });
});
