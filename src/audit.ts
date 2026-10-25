/**
 * Audit log query SDK — `client.audit.*`.
 *
 * Backed by the gateway audit-log routes.
 *
 * Wire mapping:
 *   - `query({ since, until, type, actorId, targetKind, targetId, limit, cursor })`
 *     → GET /@<slug>/audit-log?...
 *
 * The endpoint accepts cursor-paginated reverse-chronological queries.
 * `type` is the audit-event namespace (e.g. `data.write.access.insert`,
 * `gate.signin.success`) per the event-name taxonomy +
 * `feedback_error_code_namespace_boundary_and_prefix.md` cement.
 *
 * Returns audit events with full context payload — actorId / targetKind /
 * targetId / payload / occurredAt / requestId / traceId.
 */

import { request, type HttpClientConfig } from "./http.ts";
import { projectPath } from "./url-grammar.ts";
import type { Envelope } from "./envelope.ts";

/**
 * Audit event record `_sys.audit_log` shape.
 */
export type AuditEvent = {
  id: string;
  /** Dotted namespace (e.g. `data.write.access.insert`). */
  type: string;
  actorId: string | null;
  targetKind: string | null;
  targetId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  requestId: string | null;
  traceId: string | null;
};

export type AuditQueryOpts = {
  /** ISO 8601 lower bound (inclusive). */
  since?: string | undefined;
  /** ISO 8601 upper bound (exclusive). */
  until?: string | undefined;
  /** Filter by event type (exact match; future cycles may add prefix-match). */
  type?: string | undefined;
  /** Filter by actor. */
  actorId?: string | undefined;
  /** Filter by target resource kind. */
  targetKind?: string | undefined;
  /** Filter by target resource id. */
  targetId?: string | undefined;
  /** Page size (per-tier max bounded server-side). */
  limit?: number | undefined;
  /** Cursor from prior response. */
  cursor?: string | undefined;
};

function requireProjectSlug(config: HttpClientConfig): string {
  if (typeof config.projectSlug !== "string" || config.projectSlug.length === 0) {
    throw new Error("audit operations require projectSlug bound on the client");
  }
  return config.projectSlug;
}

export function makeAuditNamespace(config: HttpClientConfig) {
  return {
    /**
     * Query the audit log. Returns reverse-chronological events matching
     * all supplied filters (AND composition).
     *
     * Per RBAC: requires `AUDIT_READER` role minimum; Custodian-
     * class roles inherit. Project-level audit is project-scoped (this
     * endpoint); platform-level audit is admin-only (separate surface).
     */
    async query(opts?: AuditQueryOpts): Promise<Envelope<ReadonlyArray<AuditEvent>>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "GET",
        path: projectPath(slug, "audit-log"),
        query: opts,
      });
    },

    /**
     * Convenience: live-tail recent events. Currently single-shot read
     * with `since` defaulted to "1 minute ago"; subscription-mode tail
     * (SSE) lands when the streaming layer ships pattern.
     */
    async tail(opts?: { sinceMinutes?: number; limit?: number }): Promise<Envelope<ReadonlyArray<AuditEvent>>> {
      const slug = requireProjectSlug(config);
      const minutes = opts?.sinceMinutes ?? 1;
      const since = new Date(Date.now() - minutes * 60_000).toISOString();
      return request(config, {
        method: "GET",
        path: projectPath(slug, "audit-log"),
        query: { since, limit: opts?.limit ?? 100 },
      });
    },
  };
}
