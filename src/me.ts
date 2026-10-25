/**
 * Operator-self SDK namespace — `client.me.*`.
 *
 * Distinct from tenant-
 * scoped surfaces: `/me/*` is the operator-self lane that does NOT
 * require org or project context.
 *
 * Wire mapping (gateway uses platform-plane / cross-org `/me/...` routes):
 *   - `client.me.profile.get/update` → GET/PATCH /me
 *   - `client.me.sessions.list/revoke` → GET/DELETE /me/sessions
 *   - `client.me.apiTokens.list/create/delete` → GET/POST/DELETE /me/api-tokens (not available yet)
 *   - `client.me.notifications.list/markRead` → GET/PATCH /me/notifications (not available yet)
 *   - `client.me.auditLog.query` → GET /me/audit-log (not available yet)
 *   - `client.me.dataExport.request` → POST /me/data-export (not available yet)
 *
 * Profile, sessions and MFA setup are served by the existing gateway routes
 * `me.ts` + `mfa.ts`.
 */

import { request, type HttpClientConfig } from "./http.ts";
import { orgPath } from "./url-grammar.ts";
import type { Envelope } from "./envelope.ts";

export type MyProfile = {
  /** `u_<base62>`. */
  id: string;
  email: string;
  displayName: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** Last activity timestamp. */
  lastActiveAt: string | null;
};

export type MySession = {
  /** `sess_<base62>`. */
  id: string;
  /** Initial sign-in time. */
  createdAt: string;
  /** Most recent activity time. */
  lastSeenAt: string;
  userAgent: string | null;
  ipAddress: string | null;
  /** Whether this session is the one issuing the current request. */
  current: boolean;
};

export type MyApiToken = {
  /** `tok_<base62>`. */
  id: string;
  name: string;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601 or null for non-expiring tokens. */
  expiresAt: string | null;
  /** Last 4 chars for display. */
  suffix: string;
  scope: string;
};

export type MyNotification = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
};

export function makeMeNamespace(config: HttpClientConfig) {
  return {
    profile: {
      /** GET /me — operator profile (cross-org). */
      async get(): Promise<Envelope<MyProfile>> {
        return request(config, { method: "GET", path: orgPath("me") });
      },

      /** PATCH /me — update mutable profile fields (displayName). */
      async update(patch: { displayName?: string | null }): Promise<Envelope<MyProfile>> {
        return request(config, { method: "PATCH", path: orgPath("me"), body: patch });
      },
    },

    sessions: {
      /** GET /me/sessions — list active sessions for the operator. */
      async list(): Promise<Envelope<ReadonlyArray<MySession>>> {
        return request(config, { method: "GET", path: orgPath("me/sessions") });
      },

      /** DELETE /me/sessions/<sessionId> — revoke a specific session. */
      async revoke(sessionId: string): Promise<Envelope<{ revoked: boolean }>> {
        return request(config, { method: "DELETE", path: orgPath(`me/sessions/${encodeURIComponent(sessionId)}`) });
      },

      /** DELETE /me/sessions (no path) — revoke all sessions except the current one. */
      async revokeAll(): Promise<Envelope<{ revoked: number }>> {
        return request(config, { method: "DELETE", path: orgPath("me/sessions") });
      },
    },

    /**
     * API tokens for personal scripting. The gateway endpoints are not available yet,
     * so these methods return K9O_NOT_FOUND until they ship.
     */
    apiTokens: {
      async list(): Promise<Envelope<ReadonlyArray<MyApiToken>>> {
        return request(config, { method: "GET", path: orgPath("me/api-tokens") });
      },

      async create(input: { name: string; expiresInDays?: number | undefined; scope?: string | undefined }): Promise<Envelope<MyApiToken & { token: string }>> {
        return request(config, { method: "POST", path: orgPath("me/api-tokens"), body: input });
      },

      async delete(tokenId: string): Promise<Envelope<{ deleted: boolean }>> {
        return request(config, { method: "DELETE", path: orgPath(`me/api-tokens/${encodeURIComponent(tokenId)}`) });
      },
    },

    /**
     * Notifications — operator-targeted (account-level events). Forward-
     * cycle substrate; methods route correctly when gateway ships.
     */
    notifications: {
      async list(opts?: { unreadOnly?: boolean | undefined; limit?: number | undefined; cursor?: string | undefined }): Promise<Envelope<ReadonlyArray<MyNotification>>> {
        return request(config, { method: "GET", path: orgPath("me/notifications"), query: opts });
      },

      async markRead(notificationId: string): Promise<Envelope<MyNotification>> {
        return request(config, { method: "PATCH", path: orgPath(`me/notifications/${encodeURIComponent(notificationId)}`), body: { read: true } });
      },

      async markAllRead(): Promise<Envelope<{ marked: number }>> {
        return request(config, { method: "PATCH", path: orgPath("me/notifications"), body: { read: true } });
      },
    },

    /**
     * Operator-self audit log — actions performed BY this operator across
     * orgs. Distinct from `client.audit` (project-plane) and
     * `client.org.auditLog` (org-plane).
     */
    auditLog: {
      async query(opts?: { since?: string | undefined; until?: string | undefined; type?: string | undefined; limit?: number | undefined; cursor?: string | undefined }): Promise<Envelope<ReadonlyArray<{ id: string; type: string; occurredAt: string; payload: Record<string, unknown> }>>> {
        return request(config, { method: "GET", path: orgPath("me/audit-log"), query: opts });
      },
    },

    /**
     * Personal data export per GDPR-style requests. Returns a job id
     * the operator polls for completion.
     */
    dataExport: {
      async request(input?: { format?: "json" | "csv" }): Promise<Envelope<{ jobId: string; status: "queued" | "in-progress" | "ready" }>> {
        return request(config, { method: "POST", path: orgPath("me/data-export"), body: input ?? {} });
      },

      async status(jobId: string): Promise<Envelope<{ jobId: string; status: "queued" | "in-progress" | "ready" | "failed"; downloadUrl: string | null }>> {
        return request(config, { method: "GET", path: orgPath(`me/data-export/${encodeURIComponent(jobId)}`) });
      },
    },
  };
}
