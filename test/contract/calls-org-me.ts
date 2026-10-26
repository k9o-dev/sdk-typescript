import type { CallEntry } from "./calls.ts";

export const CALLS_ORG_ME: CallEntry[] = [

  // orgs and the org plane
  { id: "orgs.list", call: (c) => c.orgs.list() },
  { id: "orgs.get", call: (c) => c.orgs.get("acme") },
  { id: "orgs.current", call: (c) => c.orgs.current() },
  { id: "org.get", call: (c) => c.org.get() },
  { id: "org.members.list", call: (c) => c.org.members.list({ status: "active" }) },
  { id: "org.members.invite", call: (c) => c.org.members.invite({ email: "a@b.co", role: "ORG_MEMBER" }) },
  { id: "org.members.remove", call: (c) => c.org.members.remove("u_1") },
  { id: "org.groups.list", call: (c) => c.org.groups.list() },
  { id: "org.auditLog.query", call: (c) => c.org.auditLog.query({ limit: 10 }) },
  { id: "org.gate.roles.list", call: (c) => c.org.gate.roles.list() },
  { id: "org.gate.roles.grant", call: (c) => c.org.gate.roles.grant({ userId: "u_1", role: "ORG_ADMIN" }) },
  { id: "org.gate.roles.get", call: (c) => c.org.gate.roles.get("g_1") },
  { id: "org.gate.roles.revoke", call: (c) => c.org.gate.roles.revoke("g_1") },
  { id: "org.gate.idpProviders.list", call: (c) => c.org.gate.idpProviders.list() },
  { id: "org.gate.idpProviders.create", call: (c) => c.org.gate.idpProviders.create({ idpProvider: "saml", displayName: "Okta", clientId: "cid", clientSecretRef: "ref_1", tierGating: "free_tier_ok" }) },
  { id: "org.gate.idpProviders.get", call: (c) => c.org.gate.idpProviders.get("idp_1") },
  { id: "org.gate.idpProviders.configure", call: (c) => c.org.gate.idpProviders.configure("idp_1", { enabled: true }) },
  { id: "org.gate.idpProviders.delete", call: (c) => c.org.gate.idpProviders.delete("idp_1") },
  {
    id: "org.smtp.set",
    call: (c) => c.org.smtp.set({ host: "smtp.x.io", port: 587, username: "u", passwordRef: "ref_1", fromAddress: "a@b.co", fromName: "A" }),
  },
  { id: "org.smtp.test", call: (c) => c.org.smtp.test({ to: "a@b.co" }) },
  { id: "org.smtp.unset", call: (c) => c.org.smtp.unset() },
  { id: "org.defaultLLM.get", call: (c) => c.org.defaultLLM.get() },
  { id: "org.defaultLLM.set", call: (c) => c.org.defaultLLM.set({ modelId: "llama-3.1-8b" }) },

  // me
  { id: "me.profile.get", call: (c) => c.me.profile.get() },
  { id: "me.profile.update", call: (c) => c.me.profile.update({ displayName: "A" }) },
  { id: "me.sessions.list", call: (c) => c.me.sessions.list() },
  { id: "me.sessions.revoke", call: (c) => c.me.sessions.revoke("s_1") },
  { id: "me.sessions.revokeAll", call: (c) => c.me.sessions.revokeAll() },
  { id: "me.apiTokens.list", call: (c) => c.me.apiTokens.list() },
  { id: "me.apiTokens.create", call: (c) => c.me.apiTokens.create({ label: "ci", scopeManifest: { operations: ["read"], projects: ["portal"], resourceClasses: null, collections: null, cidrs: null }, ttlSeconds: 3600 }) },
  { id: "me.apiTokens.delete", call: (c) => c.me.apiTokens.delete("pat_1") },
];
