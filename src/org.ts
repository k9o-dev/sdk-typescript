/**
 * Org-plane SDK namespace — `client.org.*`.
 *
 * Covers org members, groups, SMTP, audit and gate administration.
 *
 * Distinct from `client.orgs` (collection-style; list/get/restore/current
 * across accessible orgs) — `client.org` is the singular bound-org
 * namespace with member / group / smtp / audit / gate sub-namespaces.
 *
 * Org-plane URL grammar: requests go to the org's API host (`<orgSlug>.api.<apex>`) WITHOUT the
 * `@<projectSlug>/` prefix used by project-plane requests. The gateway resolves the org context from the host.
 */

import { request, type HttpClientConfig } from "./http.ts";
import { orgPath } from "./url-grammar.ts";
import type { Envelope } from "./envelope.ts";
import type { LLMModelId } from "./compute/llms.ts";
import type { Org } from "./orgs.ts";

// ----------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------

export type OrgMember = {
  /** `usr_<base62>`. */
  userId: string;
  orgId: string;
  email: string;
  displayName: string;
  /** Org-level role. */
  role: "ORG_OWNER" | "ORG_ADMIN" | "ORG_BILLING_ADMIN" | "ORG_MEMBER";
  invitedAt: string;
  /** `null` until the invitation is accepted. */
  acceptedAt: string | null;
  status: "active" | "suspended";
  /** `invited` until accepted, then the same as `status`. */
  state: "invited" | "active" | "suspended";
  suspendedAt: string | null;
};

/**
 * Answer of `members.invite` when the email has no account yet (HTTP 202): an invitation was created
 * instead of a member. `delivery` says whether the invitation email went out.
 */
export type OrgInviteResult = {
  invitation: { id: string; orgId: string; email: string; role: OrgMember["role"]; expiresAt: string };
  delivery: "sent" | "not_configured" | "failed";
};

export type OrgGroup = {
  /** `grp_<base62>`. */
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  /** Groups come from an identity provider. */
  source: "idp";
  sourceGroupId: string;
  createdAt: string;
};

export type OrgRoleGrant = {
  /** `grt_<base62>`. */
  id: string;
  userId: string;
  role: "ORG_OWNER" | "ORG_ADMIN" | "ORG_BILLING_ADMIN" | "ORG_AUDITOR" | "ORG_MEMBER";
  grantedBy: string;
  grantedAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  viaDelegationId: string | null;
};

/**
 * Org-level audit event: member invited or removed, role granted or revoked, identity provider
 * or settings changed.
 */
export type OrgAuditEvent = {
  id: string;
  type: string;
  actorId: string | null;
  targetKind: string | null;
  targetId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  requestId: string | null;
  traceId: string | null;
};

/**
 * Org SMTP configuration, as the gateway takes it in the `smtpConfig` field of PATCH /org.
 * The password is never sent: `passwordRef` is a reference to a stored secret.
 */
export type SmtpConfig = {
  host: string;
  port: number;
  username: string;
  /** Reference to the stored SMTP password; opaque token. */
  passwordRef: string;
  fromAddress: string;
  fromName?: string | undefined;
};

export type SmtpTestEmailInput = {
  to: string;
  subject?: string | undefined;
};

export type SmtpTestEmailResult = {
  accepted: boolean;
  /** Which SMTP configuration serves the org: `org` when it has its own, else `platform`. */
  resolvedTier: "org" | "platform";
  to: string;
  /** `true` while the gateway does not send the message itself. */
  dryRun: boolean;
};

export type OrgDefaultLlm = {
  orgId: string;
  defaultModelId: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type OrgIdpProviderKind =
  | "google" | "github" | "microsoft" | "oidc" | "saml" | "scim" | "ldap" | "active_directory" | "apple" | "facebook" | "twitter";

export type OrgIdpProvider = {
  id: string;
  idpProvider: OrgIdpProviderKind;
  displayName: string;
  clientId: string;
  enabled: boolean;
  createdAt: string;
};

/** Body of POST /identity-providers. `clientSecretRef` is a reference to a stored secret, never the secret itself. */
export type CreateOrgIdpInput = {
  idpProvider: OrgIdpProviderKind;
  displayName: string;
  clientId: string;
  clientSecretRef: string;
  tierGating: "free_tier_ok" | "ridge_plus";
  redirectUri?: string | undefined;
  metadataUrl?: string | null | undefined;
  attributeMap?: Record<string, unknown> | undefined;
  enabled?: boolean | undefined;
};

/** Body of PATCH /identity-providers/<id>. */
export type UpdateOrgIdpInput = {
  displayName?: string | undefined;
  clientId?: string | undefined;
  clientSecretRef?: string | undefined;
  redirectUri?: string | undefined;
  metadataUrl?: string | null | undefined;
  attributeMap?: Record<string, unknown> | undefined;
  enabled?: boolean | undefined;
};

// ----------------------------------------------------------------------
// Sub-namespace factories
// ----------------------------------------------------------------------

function makeMembersNamespace(config: HttpClientConfig) {
  return {
    /** GET /members (org-plane LIST). The route is not paged; it filters by userId, role, acceptanceStatus, status and state. */
    async list(opts?: {
      userId?: string | undefined; role?: OrgMember["role"] | undefined;
      acceptanceStatus?: "accepted" | "pending" | undefined; status?: "active" | "suspended" | undefined; state?: string | undefined;
    }): Promise<Envelope<ReadonlyArray<OrgMember>>> {
      return request(config, { method: "GET", path: orgPath("members"), query: opts });
    },

    /**
     * POST /members — add a member by email. An existing user becomes a member at once (201, the member row);
     * an unknown email gets an invitation (202, `{ invitation, delivery }`).
     */
    async invite(input: { email: string; role: OrgMember["role"] }): Promise<Envelope<OrgMember | OrgInviteResult>> {
      return request(config, { method: "POST", path: orgPath("members"), body: input });
    },

    /** DELETE /members/<userId> — remove a member from the org. The gateway answers 204 with no body. */
    async remove(userId: string): Promise<Envelope<undefined>> {
      return request(config, { method: "DELETE", path: orgPath(`members/${encodeURIComponent(userId)}`) });
    },
  };
}

function makeGroupsNamespace(config: HttpClientConfig) {
  return {
    /** GET /groups (org-plane LIST). */
    async list(opts?: { userId?: string | undefined }): Promise<Envelope<ReadonlyArray<OrgGroup>>> {
      return request(config, { method: "GET", path: orgPath("groups"), query: opts });
    },

    /** GET /groups/<groupId> — single-read. */
    async get(groupId: string): Promise<Envelope<OrgGroup>> {
      return request(config, { method: "GET", path: orgPath(`groups/${encodeURIComponent(groupId)}`) });
    },

  };
}

function makeOrgAuditLogNamespace(config: HttpClientConfig) {
  return {
    /**
     * GET /audit-log (org-plane), newest first. The route reads `type` and `limit` (1 to 500, default 100) only.
     * Distinct from project-plane `client.audit.query()` which routes to `@<projectSlug>/audit-log`.
     */
    async query(opts?: { type?: string | undefined; limit?: number | undefined }): Promise<Envelope<ReadonlyArray<OrgAuditEvent>>> {
      return request(config, { method: "GET", path: orgPath("audit-log"), query: opts });
    },
  };
}

function makeOrgGateNamespace(config: HttpClientConfig) {
  return {
    roles: {
      /** GET /role-grants — list role grants. */
      async list(): Promise<Envelope<ReadonlyArray<OrgRoleGrant>>> {
        return request(config, { method: "GET", path: orgPath("role-grants") });
      },

      /** POST /role-grants — grant an org role. */
      async grant(input: { userId: string; role: OrgRoleGrant["role"]; decisionReason?: string | undefined }): Promise<Envelope<OrgRoleGrant>> {
        return request(config, { method: "POST", path: orgPath("role-grants"), body: input });
      },

      /** GET /role-grants/<grantId> — single-read. */
      async get(grantId: string): Promise<Envelope<OrgRoleGrant>> {
        return request(config, { method: "GET", path: orgPath(`role-grants/${encodeURIComponent(grantId)}`) });
      },

      /** DELETE /role-grants/<grantId> — revoke a grant (soft delete; sets revokedAt). */
      async revoke(grantId: string, opts?: { decisionReason?: string | undefined }): Promise<Envelope<OrgRoleGrant>> {
        return request(config, { method: "DELETE", path: orgPath(`role-grants/${encodeURIComponent(grantId)}`), ...(opts ? { body: opts } : {}) });
      },
    },

    idpProviders: {
      /** GET /identity-providers — list configured identity providers. */
      async list(): Promise<Envelope<ReadonlyArray<OrgIdpProvider>>> {
        return request(config, { method: "GET", path: orgPath("identity-providers") });
      },

      /** POST /identity-providers — create a new IdP integration. */
      async create(input: CreateOrgIdpInput): Promise<Envelope<OrgIdpProvider>> {
        return request(config, { method: "POST", path: orgPath("identity-providers"), body: input });
      },

      /** GET /identity-providers/<idpId>. */
      async get(idpId: string): Promise<Envelope<OrgIdpProvider>> {
        return request(config, { method: "GET", path: orgPath(`identity-providers/${encodeURIComponent(idpId)}`) });
      },

      /** PATCH /identity-providers/<idpId> — update settings or enable/disable. */
      async configure(idpId: string, patch: UpdateOrgIdpInput): Promise<Envelope<OrgIdpProvider>> {
        return request(config, { method: "PATCH", path: orgPath(`identity-providers/${encodeURIComponent(idpId)}`), body: patch });
      },

      /** DELETE /identity-providers/<idpId>. */
      async delete(idpId: string): Promise<Envelope<{ deleted: boolean }>> {
        return request(config, { method: "DELETE", path: orgPath(`identity-providers/${encodeURIComponent(idpId)}`) });
      },
    },
  };
}

function makeSmtpNamespace(config: HttpClientConfig) {
  return {
    /**
     * PATCH /org with `smtpConfig` body — set or update SMTP. Answers the org record.
     * The body carries `passwordRef` (a reference to the stored password), not the password.
     */
    async set(config_: SmtpConfig): Promise<Envelope<Org>> {
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

    /** PATCH /org with `smtpConfig: null` — clear org-level SMTP. Answers the org record. */
    async unset(): Promise<Envelope<Org>> {
      return request(config, { method: "PATCH", path: orgPath("org"), body: { smtpConfig: null } });
    },
  };
}

function makeDefaultLlmNamespace(config: HttpClientConfig) {
  return {
    /**
     * GET /default-llm — read the org-default LLM model id.
     * Any accepted member of the org may read it.
     */
    async get(): Promise<Envelope<OrgDefaultLlm>> {
      return request(config, { method: "GET", path: orgPath("default-llm") });
    },

    /**
     * PATCH /default-llm — set the org-default LLM.
     * ORG_ADMIN or ORG_OWNER only. The model must be available to the org's tier
     * or the gateway returns K9O_TIER_FEATURE_GATED.
     */
    async set(input: { modelId: LLMModelId }): Promise<Envelope<{ orgId: string; defaultModelId: string }>> {
      return request(config, { method: "PATCH", path: orgPath("default-llm"), body: input });
    },
  };
}

// ----------------------------------------------------------------------
// Top-level namespace
// ----------------------------------------------------------------------

export function makeOrgNamespace(config: HttpClientConfig) {
  return {
    /** Member lifecycle — list / invite / remove. */
    members: makeMembersNamespace(config),
    /** Groups — list / get (read-only). */
    groups: makeGroupsNamespace(config),
    /** Org-plane audit log — query. Distinct from project-plane `client.audit`. */
    auditLog: makeOrgAuditLogNamespace(config),
    /** Gate (IAK) org-level surfaces — role-grants + IdP-providers. */
    gate: makeOrgGateNamespace(config),
    /** Org-level SMTP config — set / test / unset. */
    smtp: makeSmtpNamespace(config),
    /** Org-default LLM — get / set (ORG_ADMIN). */
    defaultLLM: makeDefaultLlmNamespace(config),

    /**
     * GET /org — read the current org (slug, displayName, products, billing tier, your role).
     * Mirrors `client.orgs.current()` for symmetry; `client.org.get()` is
     * the singular-namespace convention for use within an org-bound client.
     */
    async get(): Promise<Envelope<Org>> {
      return request(config, { method: "GET", path: orgPath("org") });
    },
  };
}
