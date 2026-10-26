/**
 * Approvals SDK: `client.approvals.*` (the pending-change queue) and `client.approvalPolicies.*` (the rules that decide
 * which writes are queued).
 *
 * Wire mapping (project plane):
 *   - `approvals.list({ status?, limit? })`          -> GET    /@<slug>/pending-approvals
 *   - `approvals.get(id)`                            -> GET    /@<slug>/pending-approvals/<id>
 *   - `approvals.approve(id, { reason? })`           -> POST   /@<slug>/pending-approvals/<id>/approve
 *   - `approvals.reject(id, { reason })`             -> POST   /@<slug>/pending-approvals/<id>/reject
 *   - `approvals.bulk({ action, criteria, reason? })`-> POST   /@<slug>/pending-approvals/bulk
 *   - `approvalPolicies.list()`                      -> GET    /@<slug>/approval-policies
 *   - `approvalPolicies.create({...})`               -> POST   /@<slug>/approval-policies
 *   - `approvalPolicies.delete(id)`                  -> DELETE /@<slug>/approval-policies/<id>
 *
 * `approvals.list` is not paginated: it returns the newest `limit` changes (1 to 200, default 50). Project admins and
 * auditors see the whole queue; other members see only the changes they proposed.
 */

import { request, type HttpClientConfig } from "./http.ts";
import { KError } from "./kerror.ts";
import { projectPath } from "./url-grammar.ts";
import type { Envelope } from "./envelope.ts";

export type PendingChangeStatus = "pending_approval" | "approved" | "rejected" | "expired" | "redeemed";
export type ApprovalOperation = "insert" | "update" | "delete";

/** A change waiting for (or past) a decision. */
export type PendingChange = {
  /** `apr_<base62>`. */
  id: string;
  status: PendingChangeStatus;
  collection: string;
  operation: ApprovalOperation;
  makerId: string;
  /** The proposed record for a data write; for other kinds of change, a description of the action. */
  proposedPayload: Record<string, unknown>;
  targetRecordId: string | null;
  approverId: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  createdAt: string;
  expiresAt: string | null;
};

export type ListApprovalsOptions = {
  /** Only changes in this status. Omit for all. */
  status?: PendingChangeStatus | undefined;
  /** 1 to 200; the gateway defaults to 50. */
  limit?: number | undefined;
};

export type ApproveInput = {
  /** Optional note stored with the decision. */
  reason?: string | null | undefined;
};

export type RejectInput = {
  /** Required, non-empty. */
  reason: string;
};

/**
 * Answer of `approve`. When the change needs several approvers, a 200 whose `status` is still `pending_approval`
 * means your approval was recorded and more approvers are needed; the change has not been applied yet. A change
 * that applies inline ends `redeemed`; some kinds of change end `approved` and are applied by a later step.
 */
export type ApproveResult = PendingChange;

/** A predicate tree in the policy grammar, for example `{ gt: ["change.row.amount", 1000] }`. */
export type ApprovalPredicate = Record<string, unknown>;

export type BulkApprovalsInput = {
  action: "approve" | "reject";
  /**
   * Selects the pending changes to decide. Operands are `change.table`, `change.operation`, `change.row.<field>`,
   * `change.fields_modified`, `change.magnitude`, `change.created_at`, `maker.id` and `maker.account_type`.
   */
  criteria: ApprovalPredicate;
  /** Required when `action` is `reject`. */
  reason?: string | null | undefined;
};

/**
 * Answer of `bulk`. Rows that fail (conflict, apply error) are skipped silently and left out of `affectedIds`:
 * compare `affectedIds` with the set you meant to decide. It considers the newest 10000 pending changes.
 */
export type BulkApprovalsResult = {
  attestationId: string;
  action: "approve" | "reject";
  affectedCount: number;
  affectedIds: ReadonlyArray<string>;
  reason: string | null;
};

export type ApprovalAction = "auto_approve" | "queue";

/** A rule: writes to `collection` with `operation` that match `predicate` get `action`. */
export type ApprovalPolicy = {
  /** `apo_<base62>`. */
  id: string;
  collection: string;
  operation: ApprovalOperation;
  predicate: ApprovalPredicate;
  action: ApprovalAction;
  authoredBy: string;
  createdAt: string;
};

export type CreateApprovalPolicyInput = {
  /** `^[a-zA-Z_][a-zA-Z0-9_]{0,62}$`. */
  collection: string;
  operation: ApprovalOperation;
  action: ApprovalAction;
  /** A non-null predicate object. */
  predicate: ApprovalPredicate;
};

const COLLECTION_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

function invalid(message: string, context: Record<string, unknown> = {}): KError {
  return new KError({ code: "K9O_INVALID_FIELD_VALUE", message, context, recommendation: null });
}

function requireProjectSlug(config: HttpClientConfig, what: string): string {
  if (typeof config.projectSlug !== "string" || config.projectSlug.length === 0) {
    throw new Error(`${what} operations require projectSlug bound on the client`);
  }
  return config.projectSlug;
}

function requireId(id: unknown, what: string): string {
  if (typeof id !== "string" || id.length === 0) throw invalid(`${what} id must be a non-empty string`);
  return id;
}

function requireReason(reason: unknown): string {
  if (typeof reason !== "string" || reason.trim().length === 0) throw invalid("reason is required and must be a non-empty string");
  return reason;
}

function requirePredicate(value: unknown, field: string): ApprovalPredicate {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalid(`${field} must be a predicate object`);
  return value as ApprovalPredicate;
}

export function makeApprovalsNamespace(config: HttpClientConfig) {
  const path = (tail: string): string => projectPath(requireProjectSlug(config, "approvals"), `pending-approvals${tail}`);
  return {
    /** List pending changes, newest first. Not paginated: only `limit` caps the result. */
    async list(opts: ListApprovalsOptions = {}): Promise<Envelope<ReadonlyArray<PendingChange>>> {
      if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > 200)) {
        throw invalid("limit must be a whole number from 1 to 200", { limit: opts.limit });
      }
      return request(config, { method: "GET", path: path(""), query: opts });
    },

    /** One pending change. Members who are not queue admins can read only their own. */
    async get(id: string): Promise<Envelope<PendingChange>> {
      return request(config, { method: "GET", path: path(`/${encodeURIComponent(requireId(id, "approval"))}`) });
    },

    /**
     * Approve a pending change. Read `status` on the answer: `pending_approval` means the approval was recorded but
     * more approvers are needed.
     */
    async approve(id: string, input: ApproveInput = {}): Promise<Envelope<ApproveResult>> {
      return request(config, {
        method: "POST",
        path: path(`/${encodeURIComponent(requireId(id, "approval"))}/approve`),
        body: input.reason === undefined ? {} : { reason: input.reason },
      });
    },

    /** Reject a pending change. `reason` is required. */
    async reject(id: string, input: RejectInput): Promise<Envelope<PendingChange>> {
      const reason = requireReason(input?.reason);
      return request(config, {
        method: "POST",
        path: path(`/${encodeURIComponent(requireId(id, "approval"))}/reject`),
        body: { reason },
      });
    },

    /**
     * Approve or reject every pending change matching `criteria`. Rows that fail are skipped without a report, so
     * compare `affectedIds` with what you intended.
     */
    async bulk(input: BulkApprovalsInput): Promise<Envelope<BulkApprovalsResult>> {
      if (input === null || typeof input !== "object") throw invalid("bulk input must be an object");
      if (input.action !== "approve" && input.action !== "reject") throw invalid('action must be "approve" or "reject"');
      const criteria = requirePredicate(input.criteria, "criteria");
      const body: Record<string, unknown> = { action: input.action, criteria };
      if (input.action === "reject") body["reason"] = requireReason(input.reason);
      else if (input.reason !== undefined) body["reason"] = input.reason;
      return request(config, { method: "POST", path: path("/bulk"), body });
    },
  };
}

export function makeApprovalPoliciesNamespace(config: HttpClientConfig) {
  const path = (tail: string): string => projectPath(requireProjectSlug(config, "approvalPolicies"), `approval-policies${tail}`);
  return {
    /** All policies, oldest first. The first matching policy for a write decides. */
    async list(): Promise<Envelope<ReadonlyArray<ApprovalPolicy>>> {
      return request(config, { method: "GET", path: path("") });
    },

    /** Create a policy. Identical policies are not de-duplicated. */
    async create(input: CreateApprovalPolicyInput): Promise<Envelope<ApprovalPolicy>> {
      if (input === null || typeof input !== "object") throw invalid("input must be an object");
      if (typeof input.collection !== "string" || !COLLECTION_RE.test(input.collection)) {
        throw invalid("collection must match ^[a-zA-Z_][a-zA-Z0-9_]{0,62}$", { collection: input.collection });
      }
      if (input.operation !== "insert" && input.operation !== "update" && input.operation !== "delete") {
        throw invalid('operation must be "insert", "update" or "delete"');
      }
      if (input.action !== "auto_approve" && input.action !== "queue") throw invalid('action must be "auto_approve" or "queue"');
      const predicate = requirePredicate(input.predicate, "predicate");
      return request(config, {
        method: "POST",
        path: path(""),
        body: { collection: input.collection, operation: input.operation, action: input.action, predicate },
      });
    },

    /** Delete a policy; answers `{ id }`. */
    async delete(id: string): Promise<Envelope<{ id: string }>> {
      return request(config, { method: "DELETE", path: path(`/${encodeURIComponent(requireId(id, "policy"))}`) });
    },
  };
}
