/**
 * Operator-self SDK namespace — `client.me.*`.
 *
 * Distinct from tenant-
 * scoped surfaces: `/me/*` is the operator-self lane that does NOT
 * require org or project context.
 *
 * Wire mapping (gateway uses platform-plane / cross-org `/me/...` routes):
 *   - `client.me.profile.get/update` → GET/PATCH /me
 *   - `client.me.sessions.list` → GET /me/sessions
 *   - `client.me.sessions.revoke` → POST /auth/sessions/<sessionId>/revoke
 *   - `client.me.sessions.revokeAll` → POST /me/sessions/revoke-all
 *   - `client.me.apiTokens.list/create/delete` → GET/POST/DELETE /me/api-tokens
 */

import { request, type HttpClientConfig } from "./http.ts";
import { orgPath } from "./url-grammar.ts";
import type { Envelope } from "./envelope.ts";

export type MyProfile = {
  /** `usr_<base62>`. */
  id: string;
  email: string;
  displayName: string;
  mfaEnabled: boolean;
  verifiedAt: string | null;
  /** Set while the account is in its deletion grace period. */
  deletedAt: string | null;
  deletionRequestedAt: string | null;
  deletionScheduledFor: string | null;
  avatarUrl: string | null;
  /** BCP 47 language tag, or `null` when unset. */
  locale: string | null;
  /** IANA time zone name, or `null` when unset. */
  timezone: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
};

export type MySession = {
  /** `sess_<base62>`. */
  id: string;
  userId: string;
  /** Sign-in time. */
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  mfaVerifiedAt: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  /** Always `null` for now. */
  geoCountry: string | null;
  /** Whether this session is the one issuing the current request. */
  isCurrentSession: boolean;
};

/** Fields `profile.update` may change; `null` clears `locale` and `timezone`. */
export type UpdateMyProfileInput = {
  displayName?: string | undefined;
  /** BCP 47 language tag, for example `de-DE`. */
  locale?: string | null | undefined;
  /** IANA time zone name, for example `Europe/Berlin`. */
  timezone?: string | null | undefined;
};

export type MyApiToken = {
  /** `pat_<base62>`. */
  id: string;
  userId: string;
  orgId: string;
  label: string;
  scopeManifest: CreateMyApiTokenInput["scopeManifest"];
  ttlSeconds: number;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  expiresAt: string;
  lastUsedAt: string | null;
  revokedReason: string | null;
  status: "active" | "revoked" | "expired";
};

/** Body of POST /me/api-tokens. Each `scopeManifest` field narrows the token; `null` or absent leaves it unrestricted. */
export type CreateMyApiTokenInput = {
  label: string;
  scopeManifest: {
    operations?: ReadonlyArray<"read" | "write" | "admin"> | null | undefined;
    projects?: ReadonlyArray<string> | null | undefined;
    resourceClasses?: ReadonlyArray<string> | null | undefined;
    collections?: Record<string, unknown> | null | undefined;
    cidrs?: ReadonlyArray<string> | null | undefined;
  };
  /** Token lifetime in seconds (60 to 31536000). */
  ttlSeconds?: number | undefined;
};

export function makeMeNamespace(config: HttpClientConfig) {
  return {
    profile: {
      /** GET /me — operator profile (cross-org). */
      async get(): Promise<Envelope<MyProfile>> {
        return request(config, { method: "GET", path: orgPath("me") });
      },

      /** PATCH /me — update mutable profile fields (displayName, locale, timezone). */
      async update(patch: UpdateMyProfileInput): Promise<Envelope<MyProfile>> {
        return request(config, { method: "PATCH", path: orgPath("me"), body: patch });
      },
    },

    sessions: {
      /** GET /me/sessions — list active sessions for the operator. */
      async list(): Promise<Envelope<ReadonlyArray<MySession>>> {
        return request(config, { method: "GET", path: orgPath("me/sessions") });
      },

      /** POST /auth/sessions/<sessionId>/revoke — revoke a specific session. */
      async revoke(sessionId: string): Promise<Envelope<{ revoked: boolean }>> {
        return request(config, { method: "POST", path: orgPath(`auth/sessions/${encodeURIComponent(sessionId)}/revoke`) });
      },

      /** POST /me/sessions/revoke-all — revoke all of the operator's sessions except the current one. */
      async revokeAll(): Promise<Envelope<{ revoked: number }>> {
        return request(config, { method: "POST", path: orgPath("me/sessions/revoke-all") });
      },
    },

    /** Personal access tokens for scripting. */
    apiTokens: {
      async list(): Promise<Envelope<ReadonlyArray<MyApiToken>>> {
        return request(config, { method: "GET", path: orgPath("me/api-tokens") });
      },

      async create(input: CreateMyApiTokenInput): Promise<Envelope<MyApiToken & { plaintext: string }>> {
        return request(config, { method: "POST", path: orgPath("me/api-tokens"), body: input });
      },

      async delete(tokenId: string): Promise<Envelope<MyApiToken>> {
        return request(config, { method: "DELETE", path: orgPath(`me/api-tokens/${encodeURIComponent(tokenId)}`) });
      },
    },
  };
}
