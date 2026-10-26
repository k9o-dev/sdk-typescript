import type { CallEntry } from "./calls.ts";

export const CALLS_PROJECTS_FUNCTIONS_POLICIES_AUDIT: CallEntry[] = [

  // projects
  { id: "projects.list", call: (c) => c.projects.list() },
  { id: "projects.create", call: (c) => c.projects.create({ slug: "demo", displayName: "Demo", custodyMode: "PLATFORM_MANAGED" }) },
  { id: "projects.get", call: (c) => c.projects.get("demo") },
  { id: "projects.update", call: (c) => c.projects.update("demo", { displayName: "Renamed" }) },

  // functions
  { id: "functions.uploadArtifact", call: (c) => c.functions.uploadArtifact(new Uint8Array([0, 97, 115, 109]), "wasm"), raw: true },
  { id: "functions.deploy", call: (c) => c.functions.deploy({ name: "hello", runtime: "bun", tier: "sandbox", artifactKey: "functions/p/abc.tar", version: "1" }) },
  { id: "functions.list", call: (c) => c.functions.list({ limit: 10 }) },
  { id: "functions.get", call: (c) => c.functions.get("hello") },
  { id: "functions.delete", call: (c) => c.functions.delete("hello") },
  { id: "functions.invoke", call: (c) => c.functions.invoke("hello", { a: 1 }) },

  // policies
  { id: "policies.current", call: (c) => c.policies.current() },
  { id: "policies.list", call: (c) => c.policies.list({ status: "published" }) },
  { id: "policies.create", call: (c) => c.policies.create({ policy: { collections: {} }, editorMode: "json" }) },
  { id: "policies.validate", call: (c) => c.policies.validate({ policy: { collections: {} } }) },
  { id: "policies.get", call: (c) => c.policies.get("pol_1") },
  { id: "policies.update", call: (c) => c.policies.update("pol_1", { policy: { collections: {} } }) },
  { id: "policies.delete", call: (c) => c.policies.delete("pol_1") },
  { id: "policies.publish", call: (c) => c.policies.publish("pol_1") },

  // audit
  { id: "audit.query", call: (c) => c.audit.query({ limit: 10 }) },
  { id: "audit.query.filters", call: (c) => c.audit.query({ eventType: "auth.sign_in", after: "2026-01-01", before: "2026-02-01" }) },
  { id: "audit.tail", call: (c) => c.audit.tail({ sinceMinutes: 5 }) },
];
