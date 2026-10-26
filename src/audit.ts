/**
 * Audit log query SDK — `client.audit.*`.
 *
 * Backed by the gateway audit-log routes.
 *
 * Wire mapping:
 *   - `query({ eventType, actorId, after, before, limit, cursor })`
 *     → GET /@<slug>/audit-log?...
 *
 * Option names are the gateway's query parameter names. The endpoint
 * accepts cursor-paginated reverse-chronological queries. `eventType` is
 * the audit-event name (e.g. `data.write.access.insert`).
 *
 * Returns audit events with full context payload.
 */

import { request, type HttpClientConfig } from "./http.ts";
import { projectPath } from "./url-grammar.ts";
import type { Envelope } from "./envelope.ts";

/** Audit event record. */
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
  /** Filter by event type. */
  eventType?: string | undefined;
  /** Filter by actor. */
  actorId?: string | undefined;
  /** ISO 8601 lower bound: only events after this instant. */
  after?: string | undefined;
  /** ISO 8601 upper bound: only events before this instant. */
  before?: string | undefined;
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
     * Requires the `AUDIT_READER` role at minimum. This endpoint is
     * project-scoped.
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
     * with `after` defaulted to "1 minute ago".
     */
    async tail(opts?: { sinceMinutes?: number; limit?: number }): Promise<Envelope<ReadonlyArray<AuditEvent>>> {
      const slug = requireProjectSlug(config);
      const minutes = opts?.sinceMinutes ?? 1;
      const since = new Date(Date.now() - minutes * 60_000).toISOString();
      return request(config, {
        method: "GET",
        path: projectPath(slug, "audit-log"),
        query: { after: since, limit: opts?.limit ?? 100 },
      });
    },
  };
}
