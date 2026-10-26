import type { CallEntry } from "./calls.ts";

export const CALLS_COMPUTE_STUDIO_KIBO_MIGRATIONS_STORAGE: CallEntry[] = [

  // migrations
  { id: "migrations.list", call: (c) => c.migrations.list() },
  { id: "migrations.get", call: (c) => c.migrations.get(1) },
  // apply and queue: services/gateway/src/routes/migrations.ts parseApplyBody reads `{ migrations: [...] }` and nothing else.
  {
    id: "migrations.apply",
    call: (c) => c.migrations.apply({ migrations: [{ version: 1, slug: "init", up: [], down: [] }] }),
    contract: { required: ["migrations"], properties: ["migrations"] },
  },
  {
    id: "migrations.queue",
    call: (c) => c.migrations.queue({ migrations: [{ version: 1, slug: "init", up: [], down: [] }] }),
    contract: { required: ["migrations"], properties: ["migrations"] },
  },
  { id: "migrations.listPending", call: (c) => c.migrations.listPending() },
  { id: "migrations.applyPending", call: (c) => c.migrations.applyPending("pm_1") },
  // reject: the handler reads an optional `reason` string (routes/migrations.ts).
  {
    id: "migrations.rejectPending",
    call: (c) => c.migrations.rejectPending("pm_1", { reason: "no" }),
    contract: { required: [], properties: ["reason"] },
  },
  { id: "migrations.deletePending", call: (c) => c.migrations.deletePending("pm_1") },

  // storage
  { id: "storage.listBuckets", call: (c) => c.storage.listBuckets() },
  { id: "storage.getBucket", call: (c) => c.storage.getBucket("docs") },
  { id: "storage.createBucket", call: (c) => c.storage.createBucket("docs", { public: false }) },
  { id: "storage.updateBucket", call: (c) => c.storage.updateBucket("docs", { public: true }) },
  { id: "storage.deleteBucket", call: (c) => c.storage.deleteBucket("docs") },
  { id: "storage.object.upload", call: (c) => c.storage.from("docs").upload("a.txt", "hello"), raw: true },
  { id: "storage.object.createSignedUrl", call: (c) => c.storage.from("docs").createSignedUrl("a.txt", { expiresIn: 600 }) },
  { id: "storage.object.list", call: (c) => c.storage.from("docs").list({ prefix: "a" }) },
  { id: "storage.object.remove", call: (c) => c.storage.from("docs").remove("a.txt") },
  { id: "storage.locations.list", call: (c) => c.storage.locations.list() },
  {
    id: "storage.locations.create",
    call: (c) => c.storage.locations.create({ provider: "s3", bucketName: "b", region: "de01", providerRegion: "eu-central-1", credentialRef: "cred_1" }),
  },
  { id: "storage.locations.get", call: (c) => c.storage.locations.get("loc_1") },
  { id: "storage.locations.update", call: (c) => c.storage.locations.update("loc_1", { credentialRef: "cred_2" }) },
  { id: "storage.locations.retire", call: (c) => c.storage.locations.retire("loc_1") },
  { id: "storage.locations.test", call: (c) => c.storage.locations.test("loc_1") },

  // ai and compute
  { id: "ai.embed", call: (c) => c.ai.embed({ input: ["a", "b"] }) },
  { id: "compute.llms.list", call: (c) => c.compute.llms.list() },
  { id: "compute.llms.read", call: (c) => c.compute.llms.read("llama-3.1-8b") },
  { id: "compute.llms.invoke", call: (c) => c.compute.llms.invoke("llama-3.1-8b", { prompt: "hi", params: { maxTokens: 10, temperature: 0.2 } }) },

  // studio
  { id: "studio.workflows.list", call: (c) => c.studio.workflows.list() },
  {
    id: "studio.workflows.create",
    call: (c) => c.studio.workflows.create({ name: "w", triggerType: "manual", triggerConfig: {}, actions: [{ index: 0, action_type: "branch", config: {} }] }),
  },
  { id: "studio.workflows.read", call: (c) => c.studio.workflows.read("wf_1") },
  { id: "studio.workflows.update", call: (c) => c.studio.workflows.update("wf_1", { name: "w2" }) },
  { id: "studio.workflows.delete", call: (c) => c.studio.workflows.delete("wf_1") },
  { id: "studio.workflows.trigger", call: (c) => c.studio.workflows.trigger("wf_1", { k: "v" }) },
  { id: "studio.workflows.runs.list", call: (c) => c.studio.workflows.runs.list("wf_1") },
  { id: "studio.workflows.runs.read", call: (c) => c.studio.workflows.runs.read("wf_1", "run_1") },
  { id: "studio.workflows.runs.cancel", call: (c) => c.studio.workflows.runs.cancel("wf_1", "run_1") },
  { id: "studio.dashboards.list", call: (c) => c.studio.dashboards.list() },
  { id: "studio.dashboards.create", call: (c) => c.studio.dashboards.create({ name: "d" }) },
  { id: "studio.dashboards.read", call: (c) => c.studio.dashboards.read("d_1") },
  { id: "studio.dashboards.update", call: (c) => c.studio.dashboards.update("d_1", { name: "d2" }) },
  { id: "studio.dashboards.delete", call: (c) => c.studio.dashboards.delete("d_1") },
  { id: "studio.dashboards.pin", call: (c) => c.studio.dashboards.pin("d_1") },
  { id: "studio.dashboards.unpin", call: (c) => c.studio.dashboards.unpin("d_1") },

  // kibo vault
  { id: "kibo.vault.secrets.list", call: (c) => c.kibo.vault.secrets.list({ prefix: "db/" }) },
  { id: "kibo.vault.secrets.create", extraQuery: ["region"], call: (c) => c.kibo.vault.secrets.create({ name: "db/pw", region: "de01", value: "x" }) },
  { id: "kibo.vault.secrets.update", extraQuery: ["region"], call: (c) => c.kibo.vault.secrets.update("db/pw", { region: "de01", value: "y" }) },
];
