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
    await client.org.members.list({ status: "invited", limit: 20 });
    expect(cap.url).toBe("https://acme.api.k9o.io/members?status=invited&limit=20");
  });

  it("invite POSTs /members with body", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.org.members.invite({ email: "new@acme.com", role: "ORG_MEMBER" });
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://acme.api.k9o.io/members");
    expect(cap.body).toContain("ORG_MEMBER");
  });

  it("get GETs /members/<userId>", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.org.members.get("u_abc123");
    expect(cap.url).toBe("https://acme.api.k9o.io/members/u_abc123");
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

  it("create POSTs /groups", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.org.groups.create({ name: "engineering" });
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://acme.api.k9o.io/groups");
  });

  it("delete DELETEs /groups/<id>", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.org.groups.delete("grp_x");
    expect(cap.method).toBe("DELETE");
    expect(cap.url).toBe("https://acme.api.k9o.io/groups/grp_x");
  });
});

describe("client.org.auditLog (distinct from project-plane client.audit)", () => {
  it("query GETs org-plane /audit-log (no @projectSlug prefix)", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: [], meta: {} }) });
    await client.org.auditLog.query({ type: "data.write.org.role_granted", limit: 50 });
    expect(cap.url).toBe("https://acme.api.k9o.io/audit-log?type=data.write.org.role_granted&limit=50");
  });

  it("tail composes since-window", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: [], meta: {} }) });
    await client.org.auditLog.tail({ sinceMinutes: 10 });
    expect(cap.url).toContain("https://acme.api.k9o.io/audit-log?since=");
  });
});

describe("client.org.gate.roles", () => {
  it("grant POSTs /org-role-grants", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.org.gate.roles.grant({ userId: "u_abc", role: "ORG_ADMIN" });
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://acme.api.k9o.io/org-role-grants");
    expect(cap.body).toContain("ORG_ADMIN");
  });

  it("list with filters composes query", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: [], meta: {} }) });
    await client.org.gate.roles.list({ userId: "u_abc", includeRevoked: false });
    expect(cap.url).toBe("https://acme.api.k9o.io/org-role-grants?userId=u_abc&includeRevoked=false");
  });

  it("revoke DELETEs /org-role-grants/<id>", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.org.gate.roles.revoke("grt_xyz");
    expect(cap.method).toBe("DELETE");
    expect(cap.url).toBe("https://acme.api.k9o.io/org-role-grants/grt_xyz");
  });
});

describe("client.org.gate.idpProviders", () => {
  it("list GETs /idp-providers", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: [], meta: {} }) });
    await client.org.gate.idpProviders.list();
    expect(cap.url).toBe("https://acme.api.k9o.io/idp-providers");
  });

  it("configure PATCHes /idp-providers/<id>", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.org.gate.idpProviders.configure("idp_x", { enabled: true });
    expect(cap.method).toBe("PATCH");
    expect(cap.url).toBe("https://acme.api.k9o.io/idp-providers/idp_x");
  });
});

describe("client.org.smtp", () => {
  it("get GETs /org/smtp", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: null, meta: {} }) });
    await client.org.smtp.get();
    expect(cap.url).toBe("https://acme.api.k9o.io/org/smtp");
  });

  it("set PATCHes /org with smtpConfig body (password at SDK boundary)", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.org.smtp.set({
      host: "smtp.example.com", port: 587, username: "alice",
      password: "secret-plaintext-routed-to-kibo",
      fromEmail: "noreply@acme.com", fromName: "Acme", encryption: "starttls",
    });
    expect(cap.method).toBe("PATCH");
    expect(cap.url).toBe("https://acme.api.k9o.io/org");
    expect(cap.body).toContain("smtpConfig");
    expect(cap.body).toContain("smtp.example.com");
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

  it("sessions.revoke DELETEs /me/sessions/<id>", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.me.sessions.revoke("sess_x");
    expect(cap.method).toBe("DELETE");
    expect(cap.url).toBe("https://api.k9o.io/me/sessions/sess_x");
  });

  it("sessions.revokeAll DELETEs /me/sessions (no id)", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.me.sessions.revokeAll();
    expect(cap.method).toBe("DELETE");
    expect(cap.url).toBe("https://api.k9o.io/me/sessions");
  });

  it("apiTokens.create POSTs /me/api-tokens", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.me.apiTokens.create({ name: "ci-deploy" });
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://api.k9o.io/me/api-tokens");
  });

  it("dataExport.request POSTs /me/data-export", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://api.k9o.io", fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await client.me.dataExport.request({ format: "json" });
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://api.k9o.io/me/data-export");
  });

  it("auditLog.query GETs /me/audit-log with filters", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const client = createClient({ baseUrl: "https://api.k9o.io", fetch: captureFetch(cap, { data: [], meta: {} }) });
    await client.me.auditLog.query({ type: "gate.signin.success", limit: 25 });
    expect(cap.url).toBe("https://api.k9o.io/me/audit-log?type=gate.signin.success&limit=25");
  });
});
