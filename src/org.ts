/**
 * Org-plane SDK namespace — `client.org.*`.
 *
 * Covers org members, groups, SMTP, audit and gate administration.
 *
 * Distinct from `client.orgs` (collection-style; list/get/restore/current
 * across accessible orgs) — `client.org` is the singular bound-org
 * namespace with member / group / smtp / audit / gate sub-namespaces.
 *
 * Org-plane URL grammar: requests route against the
 * `<orgSlug>.api.k9o.io/` org subdomain WITHOUT the `@<projectSlug>/`
 * prefix used by project-plane requests. The gateway resolves the org
 * context from the subdomain.
 */

import { request, type HttpClientConfig } from "./http.ts";
import { orgPath } from "./url-grammar.ts";
import type { Envelope } from "./envelope.ts";
import type { LLMModelId } from "./compute/llms.ts";

// ----------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------

export type OrgMember = {
  /** `u_<base62>`. */
  userId: string;
  email: string;
  /** Org-level role enum. */
  role: "ORG_OWNER" | "ORG_ADMIN" | "ORG_BILLING_ADMIN" | "ORG_MEMBER";
  joinedAt: string;
  status: "active" | "invited" | "suspended";
};

export type OrgGroup = {
  /** `grp_<base62>`. */
  id: string;
  name: string;
  memberCount: number;
  createdAt: string;
};

export type OrgRoleGrant = {
  /** `grt_<base62>`. */
  id: string;
  userId: string;
  role: "ORG_ADMIN" | "ORG_BILLING_ADMIN";
  grantedBy: string;
  grantedAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  viaDelegationId: string | null;
};

/**
 * Org-level audit event 6-event family.
 *
 * Event types (closed set at v2.1.132):
 *   - `data.write.org.member_invited`
 *   - `data.write.org.member_removed`
 *   - `data.write.org.role_granted`
 *   - `data.write.org.role_revoked`
 *   - `data.write.org.idp_config_changed`
 *   - `data.write.org.settings_updated`
 *
 * `targetKind` is `org` for all; `targetId` is the orgId.
 */
export type OrgAuditEvent = {
  id: string;
  type: string;
  actorId: string | null;
  targetKind: "org";
  targetId: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  requestId: string | null;
  traceId: string | null;
};

/**
 * Org SMTP configuration. Sensitive fields (passwordRef)
 * are sequestered in Kibo enclave; the SDK stores only the reference.
 */
export type SmtpConfig = {
  host: string;
  port: number;
  username: string;
  /** Kibo enclave credential reference; opaque token. */
  passwordRef: string;
  fromEmail: string;
  fromName: string;
  encryption: "none" | "starttls" | "tls";
  replyToEmail?: string | undefined;
};

export type SmtpTestEmailInput = {
  to: string;
  /** Optional override of the from address for the test send (defaults to fromEmail). */
  fromOverride?: string | undefined;
};

export type SmtpTestEmailResult = {
  ok: boolean;
  /** Diagnostic message returned by the SMTP server (success or error detail). */
  diagnostic: string;
  /** ISO 8601 timestamp of the test attempt. */
  attemptedAt: string;
};

export type OrgIdpProvider = {
  /** `idp_<base62>`. */
  id: string;
  name: string;
  /** Protocol/vendor (e.g. "okta-saml", "azure-ad-oidc", "google-workspace"). */
  kind: string;
  enabled: boolean;
  createdAt: string;
};

export type CreateOrgIdpInput = {
  name: string;
  kind: string;
  config: Record<string, unknown>;
};

// ----------------------------------------------------------------------
// Sub-namespace factories
// ----------------------------------------------------------------------

function makeMembersNamespace(config: HttpClientConfig) {
  return {
    /** GET /members (org-plane LIST). */
    async list(opts?: { limit?: number | undefined; cursor?: string | undefined; status?: OrgMember["status"] | undefined }): Promise<Envelope<ReadonlyArray<OrgMember>>> {
      return request(config, { method: "GET", path: orgPath("members"), query: opts });
    },

    /** POST /members — invite a new org member by email. */
    async invite(input: { email: string; role: OrgMember["role"] }): Promise<Envelope<OrgMember>> {
      return request(config, { method: "POST", path: orgPath("members"), body: input });
    },

    /** GET /members/<userId> — single-read (existing endpoint). */
    async get(userId: string): Promise<Envelope<OrgMember>> {
      return request(config, { method: "GET", path: orgPath(`members/${encodeURIComponent(userId)}`) });
    },

    /** DELETE /members/<userId> — remove a member from the org. */
    async remove(userId: string): Promise<Envelope<{ removed: boolean }>> {
      return request(config, { method: "DELETE", path: orgPath(`members/${encodeURIComponent(userId)}`) });
    },
  };
}

function makeGroupsNamespace(config: HttpClientConfig) {
  return {
    /** GET /groups (org-plane LIST). */
    async list(opts?: { limit?: number; cursor?: string }): Promise<Envelope<ReadonlyArray<OrgGroup>>> {
      return request(config, { method: "GET", path: orgPath("groups"), query: opts });
    },

    /** POST /groups — create a new group. */
    async create(input: { name: string }): Promise<Envelope<OrgGroup>> {
      return request(config, { method: "POST", path: orgPath("groups"), body: input });
    },

    /** GET /groups/<groupId> — single-read (pre-cement existing endpoint). */
    async get(groupId: string): Promise<Envelope<OrgGroup>> {
      return request(config, { method: "GET", path: orgPath(`groups/${encodeURIComponent(groupId)}`) });
    },

    /** DELETE /groups/<groupId> — remove a group. */
    async delete(groupId: string): Promise<Envelope<{ deleted: boolean }>> {
      return request(config, { method: "DELETE", path: orgPath(`groups/${encodeURIComponent(groupId)}`) });
    },
  };
}

function makeOrgAuditLogNamespace(config: HttpClientConfig) {
  return {
    /**
     * GET /audit-log (org-plane).
     * Distinct from project-plane `client.audit.query()` which routes to
     * `@<projectSlug>/audit-log`. Org-plane events cover the 6-event family
     * (member_invited/removed/role_granted/revoked/
     * idp_config_changed/settings_updated).
     */
    async query(opts?: {
      since?: string | undefined; until?: string | undefined; type?: string | undefined; actorId?: string | undefined;
      targetKind?: string | undefined; targetId?: string | undefined; limit?: number | undefined; cursor?: string | undefined;
    }): Promise<Envelope<ReadonlyArray<OrgAuditEvent>>> {
      return request(config, { method: "GET", path: orgPath("audit-log"), query: opts });
    },

    /** Convenience: recent events (defaults to 5 minute window). */
    async tail(opts?: { sinceMinutes?: number; limit?: number }): Promise<Envelope<ReadonlyArray<OrgAuditEvent>>> {
      const minutes = opts?.sinceMinutes ?? 5;
      const since = new Date(Date.now() - minutes * 60_000).toISOString();
      return request(config, {
        method: "GET",
        path: orgPath("audit-log"),
        query: { since, limit: opts?.limit ?? 100 },
      });
    },
  };
}

function makeOrgGateNamespace(config: HttpClientConfig) {
  return {
    roles: {
      /** GET /org-role-grants — list active grants ask 4. */
      async list(opts?: { userId?: string | undefined; role?: OrgRoleGrant["role"] | undefined; includeRevoked?: boolean | undefined }): Promise<Envelope<ReadonlyArray<OrgRoleGrant>>> {
        return request(config, { method: "GET", path: orgPath("org-role-grants"), query: opts });
      },

      /** POST /org-role-grants — grant an ORG_ADMIN or ORG_BILLING_ADMIN role. */
      async grant(input: { userId: string; role: OrgRoleGrant["role"] }): Promise<Envelope<OrgRoleGrant>> {
        return request(config, { method: "POST", path: orgPath("org-role-grants"), body: input });
      },

      /** GET /org-role-grants/<grantId> — single-read. */
      async get(grantId: string): Promise<Envelope<OrgRoleGrant>> {
        return request(config, { method: "GET", path: orgPath(`org-role-grants/${encodeURIComponent(grantId)}`) });
      },

      /** DELETE /org-role-grants/<grantId> — revoke a grant (soft delete; sets revokedAt). */
      async revoke(grantId: string): Promise<Envelope<OrgRoleGrant>> {
        return request(config, { method: "DELETE", path: orgPath(`org-role-grants/${encodeURIComponent(grantId)}`) });
      },
    },

    idpProviders: {
      /** GET /idp-providers — list configured org operator IdP providers ask 7. */
      async list(): Promise<Envelope<ReadonlyArray<OrgIdpProvider>>> {
        return request(config, { method: "GET", path: orgPath("idp-providers") });
      },

      /** POST /idp-providers — create a new IdP integration. */
      async create(input: CreateOrgIdpInput): Promise<Envelope<OrgIdpProvider>> {
        return request(config, { method: "POST", path: orgPath("idp-providers"), body: input });
      },

      /** GET /idp-providers/<idpId>. */
      async get(idpId: string): Promise<Envelope<OrgIdpProvider>> {
        return request(config, { method: "GET", path: orgPath(`idp-providers/${encodeURIComponent(idpId)}`) });
      },

      /** PATCH /idp-providers/<idpId> — update config or enable/disable. */
      async configure(idpId: string, patch: { name?: string; enabled?: boolean; config?: Record<string, unknown> }): Promise<Envelope<OrgIdpProvider>> {
        return request(config, { method: "PATCH", path: orgPath(`idp-providers/${encodeURIComponent(idpId)}`), body: patch });
      },

      /** DELETE /idp-providers/<idpId>. */
      async delete(idpId: string): Promise<Envelope<{ deleted: boolean }>> {
        return request(config, { method: "DELETE", path: orgPath(`idp-providers/${encodeURIComponent(idpId)}`) });
      },
    },
  };
}

function makeSmtpNamespace(config: HttpClientConfig) {
  return {
    /**
     * GET /org/smtp — read current SMTP config.
     * Returns null when no org-level SMTP is configured (falls back to
     * platform SMTP 3-tier cascade).
     */
    async get(): Promise<Envelope<SmtpConfig | null>> {
      return request(config, { method: "GET", path: orgPath("org/smtp") });
    },

    /**
     * PATCH /orgs/<orgSlug> with `smtpConfig` body — set or update SMTP.
     * PATCH on the org resource accepts smtpConfig.
     * Passwords route through Kibo enclave — SDK accepts plaintext at
     * the SDK boundary; gateway stores the reference.
     */
    async set(config_: Omit<SmtpConfig, "passwordRef"> & { password: string }): Promise<Envelope<SmtpConfig>> {
      return request(config, { method: "PATCH", path: orgPath("org"), body: { smtpConfig: config_ } });
    },

    /**
     * POST /org/smtp/test-email — send a diagnostic email to verify config.
     * 5/hour rate limit; RFC 5322 validation;
     * 3-tier resolution (platform→org→project) of effective SMTP.
     */
    async test(input: SmtpTestEmailInput): Promise<Envelope<SmtpTestEmailResult>> {
      return request(config, { method: "POST", path: orgPath("org/smtp/test-email"), body: input });
    },

    /** PATCH /orgs/<orgSlug> with `smtpConfig: null` — clear org-level SMTP. */
    async unset(): Promise<Envelope<{ cleared: boolean }>> {
      return request(config, { method: "PATCH", path: orgPath("org"), body: { smtpConfig: null } });
    },
  };
}

function makeDefaultLlmNamespace(config: HttpClientConfig) {
  return {
    /**
     * GET /org/default-llm — read the org-default LLM model id
     *. Returns `null` when no explicit default is set (gateway
     * falls back to `mistral-7b`). ORG_ADMIN read; tier-gated.
     */
    async get(): Promise<Envelope<LLMModelId | null>> {
      return request(config, { method: "GET", path: orgPath("org/default-llm") });
    },

    /**
     * PATCH /org/default-llm — set the org-default LLM.
     * ORG_ADMIN only. The model must be available to the org's tier per
     * or the gateway returns K9O_TIER_FEATURE_GATED.
     */
    async set(input: { modelId: LLMModelId }): Promise<Envelope<LLMModelId>> {
      return request(config, { method: "PATCH", path: orgPath("org/default-llm"), body: input });
    },
  };
}

// ----------------------------------------------------------------------
// Top-level namespace
// ----------------------------------------------------------------------

export function makeOrgNamespace(config: HttpClientConfig) {
  return {
    /** Member lifecycle — list / invite / get / remove. */
    members: makeMembersNamespace(config),
    /** Group lifecycle — list / create / get / delete. */
    groups: makeGroupsNamespace(config),
    /** Org-plane audit log — query / tail. Distinct from project-plane `client.audit`. */
    auditLog: makeOrgAuditLogNamespace(config),
    /** Gate (IAK) org-level surfaces — role-grants + IdP-providers. */
    gate: makeOrgGateNamespace(config),
    /** Org-level SMTP config — get / set / test / unset. */
    smtp: makeSmtpNamespace(config),
    /** Org-default LLM — get / set (ORG_ADMIN). */
    defaultLLM: makeDefaultLlmNamespace(config),

    /**
     * GET /org — read the current org (slug + name + status + settings).
     * Mirrors `client.orgs.current()` for symmetry; `client.org.get()` is
     * the singular-namespace convention for use within an org-bound client.
     */
    async get(): Promise<Envelope<{ id: string; slug: string; name: string; status: string; createdAt: string }>> {
      return request(config, { method: "GET", path: orgPath("org") });
    },
  };
}
