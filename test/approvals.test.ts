import { describe, expect, it } from "bun:test";
import { createClient, KError } from "../src/index.ts";

type Seen = { url: string; method: string; body?: unknown };

function client(data: unknown = {}, meta: Record<string, unknown> = {}, projectSlug: string | null = "portal") {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "HEAD") return new Response(null, { status: 200 });
    seen.push({
      url: String(input),
      method: String(init?.method),
      ...(init?.body !== undefined ? { body: JSON.parse(String(init.body)) } : {}),
    });
    return new Response(JSON.stringify({ data, meta }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  const c = createClient({ baseUrl: "https://acme.api.k9o.io", ...(projectSlug !== null ? { projectSlug } : {}), apiKey: "k", fetch: fetchImpl });
  return { c, seen };
}

const BASE = "https://acme.api.k9o.io/@portal";

const pending = {
  id: "apr_1", status: "pending_approval", collection: "orders", operation: "update", makerId: "usr_1",
  proposedPayload: { amount: 5 }, targetRecordId: "rec_1", approverId: null, decidedAt: null, decisionReason: null,
  createdAt: "2026-10-26T10:00:00.000Z", expiresAt: null,
};

async function rejects(p: Promise<unknown>): Promise<KError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(KError);
    return e as KError;
  }
  throw new Error("expected a rejection");
}

describe("client.approvals", () => {
  it("list sends status and limit as query and returns the rows", async () => {
    const { c, seen } = client([pending]);
    const r = await c.approvals.list({ status: "pending_approval", limit: 20 });
    expect(r.data[0]!.id).toBe("apr_1");
    expect(seen).toEqual([{ method: "GET", url: `${BASE}/pending-approvals?status=pending_approval&limit=20` }]);
  });

  it("list without options sends no query", async () => {
    const { c, seen } = client([]);
    await c.approvals.list();
    expect(seen[0]!.url).toBe(`${BASE}/pending-approvals`);
  });

  it("list validates limit 1..200 before any request", async () => {
    const { c, seen } = client([]);
    for (const limit of [0, 201, 1.5, Number.NaN]) {
      expect((await rejects(c.approvals.list({ limit }))).code).toBe("K9O_INVALID_FIELD_VALUE");
    }
    await c.approvals.list({ limit: 200 });
    await c.approvals.list({ limit: 1 });
    expect(seen).toHaveLength(2);
  });

  it("get reads one change", async () => {
    const { c, seen } = client(pending);
    await c.approvals.get("apr_1");
    expect(seen).toEqual([{ method: "GET", url: `${BASE}/pending-approvals/apr_1` }]);
  });

  it("approve posts the optional reason and exposes a still-pending result", async () => {
    const { c, seen } = client(pending);
    const r = await c.approvals.approve("apr_1", { reason: "looks fine" });
    expect(r.data.status).toBe("pending_approval");
    await c.approvals.approve("apr_1");
    expect(seen).toEqual([
      { method: "POST", url: `${BASE}/pending-approvals/apr_1/approve`, body: { reason: "looks fine" } },
      { method: "POST", url: `${BASE}/pending-approvals/apr_1/approve`, body: {} },
    ]);
  });

  it("reject requires a non-empty reason client-side", async () => {
    const { c, seen } = client({ ...pending, status: "rejected" });
    for (const input of [{ reason: "" }, { reason: "   " }, {} as { reason: string }, undefined as unknown as { reason: string }]) {
      expect((await rejects(c.approvals.reject("apr_1", input))).code).toBe("K9O_INVALID_FIELD_VALUE");
    }
    expect(seen).toHaveLength(0);
    await c.approvals.reject("apr_1", { reason: "duplicate" });
    expect(seen).toEqual([{ method: "POST", url: `${BASE}/pending-approvals/apr_1/reject`, body: { reason: "duplicate" } }]);
  });

  it("id arguments are validated and encoded", async () => {
    const { c, seen } = client(pending);
    expect((await rejects(c.approvals.get(""))).code).toBe("K9O_INVALID_FIELD_VALUE");
    await c.approvals.get("a/b");
    expect(seen[0]!.url).toBe(`${BASE}/pending-approvals/a%2Fb`);
  });

  it("bulk sends action, criteria and reason", async () => {
    const result = { attestationId: "apr_x", action: "reject", affectedCount: 1, affectedIds: ["apr_1"], reason: "stale" };
    const { c, seen } = client(result);
    const criteria = { eq: ["change.table", "orders"] };
    const r = await c.approvals.bulk({ action: "reject", criteria, reason: "stale" });
    expect(r.data.affectedIds).toEqual(["apr_1"]);
    await c.approvals.bulk({ action: "approve", criteria });
    expect(seen).toEqual([
      { method: "POST", url: `${BASE}/pending-approvals/bulk`, body: { action: "reject", criteria, reason: "stale" } },
      { method: "POST", url: `${BASE}/pending-approvals/bulk`, body: { action: "approve", criteria } },
    ]);
  });

  it("bulk validates action, criteria and the reject reason", async () => {
    const { c, seen } = client({});
    const criteria = { eq: ["change.table", "orders"] };
    const bad: unknown[] = [
      { action: "delete", criteria },
      { action: "approve", criteria: null },
      { action: "approve", criteria: [criteria] },
      { action: "approve", criteria: "x" },
      { action: "approve" },
      { action: "reject", criteria },
      { action: "reject", criteria, reason: " " },
    ];
    for (const input of bad) {
      expect((await rejects(c.approvals.bulk(input as never))).code).toBe("K9O_INVALID_FIELD_VALUE");
    }
    expect(seen).toHaveLength(0);
  });

  it("needs a bound project", async () => {
    const { c } = client({}, {}, null);
    await expect(c.approvals.list()).rejects.toThrow(/projectSlug/);
  });
});

describe("client.approvalPolicies", () => {
  const policy = { id: "apo_1", collection: "orders", operation: "update", predicate: { gt: ["change.row.amount", 1000] }, action: "queue", authoredBy: "usr_1", createdAt: "2026-10-26T10:00:00.000Z" };

  it("list, create and delete use the policy routes", async () => {
    const { c, seen } = client(policy);
    await c.approvalPolicies.list();
    await c.approvalPolicies.create({ collection: "orders", operation: "update", action: "queue", predicate: policy.predicate });
    const d = await c.approvalPolicies.delete("apo_1");
    expect(d.data).toBeDefined();
    expect(seen).toEqual([
      { method: "GET", url: `${BASE}/approval-policies` },
      { method: "POST", url: `${BASE}/approval-policies`, body: { collection: "orders", operation: "update", action: "queue", predicate: policy.predicate } },
      { method: "DELETE", url: `${BASE}/approval-policies/apo_1` },
    ]);
  });

  it("create validates every field client-side", async () => {
    const { c, seen } = client({});
    const ok = { collection: "orders", operation: "insert", action: "auto_approve", predicate: { eq: ["maker.id", "u"] } } as const;
    const bad: unknown[] = [
      { ...ok, collection: "1orders" },
      { ...ok, collection: "a-b" },
      { ...ok, collection: "" },
      { ...ok, collection: "a".repeat(64) },
      { ...ok, operation: "upsert" },
      { ...ok, action: "block" },
      { ...ok, predicate: null },
      { ...ok, predicate: [] },
      { ...ok, predicate: "x" },
    ];
    for (const input of bad) {
      expect((await rejects(c.approvalPolicies.create(input as never))).code).toBe("K9O_INVALID_FIELD_VALUE");
    }
    expect(seen).toHaveLength(0);
    await c.approvalPolicies.create({ ...ok, collection: "a".repeat(63) });
    await c.approvalPolicies.create({ ...ok, collection: "_x1" });
    expect(seen).toHaveLength(2);
  });

  it("delete validates the id", async () => {
    const { c } = client({});
    expect((await rejects(c.approvalPolicies.delete(""))).code).toBe("K9O_INVALID_FIELD_VALUE");
  });
});

describe("client.schema.collections", () => {
  const row = { name: "orders", rowCount: 120, rowCountIsExact: true, columnCount: 8, indexCount: 3, lastMigrationSlug: "add_orders", lastMigrationAppliedAt: "2026-10-01T09:00:00.000Z" };

  it("list sends limit and cursor and returns meta.cursor", async () => {
    const { c, seen } = client([row], { cursor: { next: "b3JkZXJz", totalCount: null, countMethod: "none" } });
    const r = await c.schema.collections.list({ limit: 10, cursor: "abc" });
    expect(r.data[0]!.name).toBe("orders");
    expect((r.meta["cursor"] as { next: string }).next).toBe("b3JkZXJz");
    expect(seen).toEqual([{ method: "GET", url: `${BASE}/schema/collections?limit=10&cursor=abc` }]);
  });

  it("list with no options sends no query; limit is validated", async () => {
    const { c, seen } = client([]);
    await c.schema.collections.list();
    expect(seen[0]!.url).toBe(`${BASE}/schema/collections`);
    expect((await rejects(c.schema.collections.list({ limit: 201 }))).code).toBe("K9O_INVALID_FIELD_VALUE");
    expect(seen).toHaveLength(1);
  });
});
