/**
 * Tests for org-plane (client.org.*) + operator-self (client.me.*)
 * namespaces.
 *
 * Verifies URL composition + HTTP method against the gateway routes.
 */

import { describe, expect, it } from "bun:test";
import { createClient } from "../src/index.ts";

type CapturedRequest = { url: string; method: string; body?: string };

function captureFetch(captured: CapturedRequest, response: unknown = { data: null, meta: {} }, status = 200): typeof globalThis.fetch {
  return ((async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.url = typeof input === "string" ? input : input.toString();
    captured.method = init?.method as string;
    if (init?.body !== undefined) captured.body = String(init.body);
    return new Response(JSON.stringify(response), { status, headers: { "content-type": "application/json" } });
  }) as unknown) as typeof globalThis.fetch;
}

describe("client.org.members", () => {
  it("list GETs /members", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: [], meta: {} }) });
    await client.org.members.list();
    expect(cap.method).toBe("GET");
    expect(cap.url).toBe("https://acme.api.k9o.io/members");
  });

  it("list composes query string", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: [], meta: {} }) });
    await client.org.members.list({ status: "suspended", role: "ORG_ADMIN" });
    expect(cap.url).toBe("https://acme.api.k9o.io/members?status=suspended&role=ORG_ADMIN");
  });

  it("invite POSTs /members with body", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.org.members.invite({ email: "new@acme.com", role: "ORG_MEMBER" });
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://acme.api.k9o.io/members");
    expect(cap.body).toContain("ORG_MEMBER");
  });

  it("remove DELETEs /members/<userId>", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.org.members.remove("u_xyz");
    expect(cap.method).toBe("DELETE");
    expect(cap.url).toBe("https://acme.api.k9o.io/members/u_xyz");
  });
});

describe("client.org.groups", () => {
  it("list GETs /groups", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: [], meta: {} }) });
    await client.org.groups.list();
    expect(cap.url).toBe("https://acme.api.k9o.io/groups");
  });

  it("create and delete are not on the namespace", () => {
    const client = createClient({ baseUrl: "https://acme.api.k9o.io" });
    expect((client.org.groups as Record<string, unknown>)["create"]).toBeUndefined();
    expect((client.org.groups as Record<string, unknown>)["delete"]).toBeUndefined();
  });
});

describe("client.org.auditLog (distinct from project-plane client.audit)", () => {
  it("query GETs org-plane /audit-log (no @projectSlug prefix)", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: [], meta: {} }) });
    await client.org.auditLog.query({ type: "data.write.org.role_granted", limit: 50 });
    expect(cap.url).toBe("https://acme.api.k9o.io/audit-log?type=data.write.org.role_granted&limit=50");
  });
});

describe("client.org.gate.roles", () => {
  it("grant POSTs /role-grants", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.org.gate.roles.grant({ userId: "u_abc", role: "ORG_ADMIN" });
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://acme.api.k9o.io/role-grants");
    expect(cap.body).toContain("ORG_ADMIN");
  });

  it("list GETs /role-grants", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: [], meta: {} }) });
    await client.org.gate.roles.list();
    expect(cap.url).toBe("https://acme.api.k9o.io/role-grants");
  });

  it("revoke DELETEs /role-grants/<id>", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.org.gate.roles.revoke("grt_xyz");
    expect(cap.method).toBe("DELETE");
    expect(cap.url).toBe("https://acme.api.k9o.io/role-grants/grt_xyz");
  });
});

describe("client.org.gate.idpProviders", () => {
  it("list GETs /identity-providers", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: [], meta: {} }) });
    await client.org.gate.idpProviders.list();
    expect(cap.url).toBe("https://acme.api.k9o.io/identity-providers");
  });

  it("configure PATCHes /identity-providers/<id>", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.org.gate.idpProviders.configure("idp_x", { enabled: true });
    expect(cap.method).toBe("PATCH");
    expect(cap.url).toBe("https://acme.api.k9o.io/identity-providers/idp_x");
  });
});

describe("client.org.smtp", () => {
  it("set PATCHes /org with smtpConfig body (passwordRef, fromAddress)", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.org.smtp.set({
      host: "smtp.example.com", port: 587, username: "alice",
      passwordRef: "ref_smtp_1",
      fromAddress: "noreply@acme.com", fromName: "Acme",
    });
    expect(cap.method).toBe("PATCH");
    expect(cap.url).toBe("https://acme.api.k9o.io/org");
    expect(cap.body).toContain("smtpConfig");
    expect(cap.body).toContain("smtp.example.com");
    expect(cap.body).toContain("passwordRef");
    expect(cap.body).toContain("fromAddress");
  });

  it("test POSTs /org/smtp/test-email", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: { ok: true, diagnostic: "sent", attemptedAt: "x" }, meta: {} }) });
    await client.org.smtp.test({ to: "verify@acme.com" });
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://acme.api.k9o.io/org/smtp/test-email");
  });

  it("unset PATCHes /org with smtpConfig:null", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: { cleared: true }, meta: {} }) });
    await client.org.smtp.unset();
    expect(cap.method).toBe("PATCH");
    expect(cap.url).toBe("https://acme.api.k9o.io/org");
    expect(cap.body).toContain("null");
  });
});

describe("client.me (operator-self; cross-org)", () => {
  it("profile.get GETs /me", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.me.profile.get();
    expect(cap.url).toBe("https://api.k9o.io/me");
  });

  it("profile.update PATCHes /me", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.me.profile.update({ displayName: "Test User" });
    expect(cap.method).toBe("PATCH");
    expect(cap.url).toBe("https://api.k9o.io/me");
  });

  it("sessions.list GETs /me/sessions", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://api.k9o.io", fetch: captureFetch(cap, { data: [], meta: {} }) });
    await client.me.sessions.list();
    expect(cap.url).toBe("https://api.k9o.io/me/sessions");
  });

  it("sessions.revoke POSTs /auth/sessions/<id>/revoke", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.me.sessions.revoke("sess_x");
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://api.k9o.io/auth/sessions/sess_x/revoke");
  });

  it("sessions.revokeAll POSTs /me/sessions/revoke-all", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.me.sessions.revokeAll();
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://api.k9o.io/me/sessions/revoke-all");
  });

  it("apiTokens.create POSTs /me/api-tokens", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.me.apiTokens.create({ label: "ci-deploy", scopeManifest: { operations: ["read"] }, ttlSeconds: 3600 });
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://api.k9o.io/me/api-tokens");
    expect(JSON.parse(cap.body ?? "{}")).toEqual({ label: "ci-deploy", scopeManifest: { operations: ["read"] }, ttlSeconds: 3600 });
  });

  it("notifications, auditLog and dataExport are not on the namespace", () => {
    const me = createClient({ baseUrl: "https://api.k9o.io" }).me as Record<string, unknown>;
    expect(me["notifications"]).toBeUndefined();
    expect(me["auditLog"]).toBeUndefined();
    expect(me["dataExport"]).toBeUndefined();
  });
});
