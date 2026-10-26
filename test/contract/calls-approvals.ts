import type { CallEntry } from "./calls.ts";

// Bodies below are the ones the gateway handlers read (the OpenAPI entries declare none).
const criteria = { eq: ["change.table", "orders"] };

export const CALLS_APPROVALS: CallEntry[] = [
  { id: "approvals.list", call: (c) => c.approvals.list({ status: "pending_approval", limit: 20 }) },
  { id: "approvals.get", call: (c) => c.approvals.get("apr_1") },
  { id: "approvals.approve", call: (c) => c.approvals.approve("apr_1", { reason: "ok" }), contract: { required: [], properties: ["reason"] } },
  { id: "approvals.reject", call: (c) => c.approvals.reject("apr_1", { reason: "duplicate" }), contract: { required: ["reason"], properties: ["reason"] } },
  {
    id: "approvals.bulk", call: (c) => c.approvals.bulk({ action: "reject", criteria, reason: "stale" }),
    contract: { required: ["action", "criteria"], properties: ["action", "criteria", "reason"] },
  },
  { id: "approvalPolicies.list", call: (c) => c.approvalPolicies.list() },
  {
    id: "approvalPolicies.create",
    call: (c) => c.approvalPolicies.create({ collection: "orders", operation: "update", action: "queue", predicate: { gt: ["change.row.amount", 1000] } }),
    contract: { required: ["collection", "operation", "action", "predicate"], properties: ["collection", "operation", "action", "predicate"] },
  },
  { id: "approvalPolicies.delete", call: (c) => c.approvalPolicies.delete("apo_1") },
  { id: "schema.collections.list", call: (c) => c.schema.collections.list({ limit: 10, cursor: "abc" }) },
];
