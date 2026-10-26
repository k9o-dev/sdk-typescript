# @k9o/core

Official TypeScript client for [Kilimanjaro](#about-kilimanjaro).
Read and write your data, store files, manage policies and migrations, deploy and invoke agents or functions,
and publish to and subscribe to streams and realtime events.

## Contents

- [Links](#links)
- [Install](#install)
- [Quick start](#quick-start)
- [Authentication and project context](#authentication-and-project-context)
- [Running queries](#running-queries)
- [Query with SQL](#query-with-sql)
- [Search](#search)
- [Projects, functions and policies](#projects-functions-and-policies)
- [Streams](#streams)
- [Approvals](#approvals)
- [Approval policies](#approval-policies)
- [Schema collections](#schema-collections)
- [Handling errors](#handling-errors)
- [Regional hosts](#regional-hosts)
- [Appendix](#appendix)
  - [About Kilimanjaro](#about-kilimanjaro)

## Links

- Website: <https://kilimanjaro.dev>
- Documentation / Developer Hub: <https://docs.kilimanjaro.dev>
- Platform API: <https://api.k9o.io>
- Platform Console: <https://console.k9o.io>

## Install

```bash
npm install @k9o/core
```

```bash
bun add @k9o/core
```

```bash
pnpm add @k9o/core
```

Requires Node.js 18+, Bun 1.1+ or a browser with a global `fetch`. TypeScript 5.6+ is optional. See [Requirements](#requirements).

## Quick start

The examples on this page use a `tasks` collection with a `title` and a `done` field.

```ts
import { createClient } from "@k9o/core";

const client = createClient({
  apiKey: process.env.K9O_API_KEY,
  orgSlug: "acme",
  projectSlug: "member-portal",
});

type Task = { id: string; title: string; done: boolean };

const created = await client.from("tasks").insert<Task>({ title: "Write the README", done: false });
const task = created.data;

console.log(`Output: ${task.title}`);
```

```text
Output: Write the README
```

Every method resolves to `{ data, meta }`. `data` is the typed result and `meta` holds response metadata.

The SDK passes the gateway's field names through unchanged. Inputs and results use the names the gateway uses.
For example, a project has a `displayName`, not a `name`, and its `custodyMode` is `PLATFORM_MANAGED`, `SKR`, `BYOK` or `HYOK`.

## Authentication and project context

Three options select who you are and where you work. See [Client options](#client-options) for the full list.

| Option | What it does |
| --- | --- |
| `apiKey` | Bearer token sent on every request. |
| `orgSlug` | Selects your organization. |
| `projectSlug` | Selects the project. Required by project-scoped calls. |

- Pass `orgSlug` alone. The SDK builds the organization host `<orgSlug>.api.<apex>` from the base URL.
- With no `baseUrl`, the apex is the default public host, `api.k9o.io`. That host is only a default.
- Any other deployment passes its own `baseUrl` and `orgSlug`. The API host always comes from the base URL.
- A `baseUrl` that is already an organization host, such as `https://acme.api.example.com`, is used as given.

```ts
const client = createClient({
  baseUrl: "https://api.example.com",
  apiKey: process.env.K9O_API_KEY,
  orgSlug: "acme",
  projectSlug: "member-portal",
});
```

This client sends its requests to `https://acme.api.example.com`. Any apex works, including an internal one or `localhost`.

To retry transient failures, add `retryConfig`. See [Retry settings](#retry-settings).

## Running queries

`client.from(collection)` reads and writes records. Chain filters and paging, then await the result.

```ts
const response = await client.from("tasks").select<Task>().eq("done", false).limit(10);

for (const openTask of response.data) {
  console.log(`Output: ${openTask.title}`);
}
```

```text
Output: Write the README
```

Update or delete one record by id:

```ts
const updated = await client.from("tasks").update<Task>({ done: true }).eq("id", task.id);

console.log(`Output: ${updated.data.done}`);
```

```text
Output: true
```

- `update` and `delete` need an `eq("id", ...)` filter. They never change many rows at once.
- See [Data methods](#data-methods) for filters and paging.
- Other namespaces are listed in [Methods by namespace](#methods-by-namespace).

## Query with SQL

`client.query(sql, params?)` runs one SQL statement against the project's data and returns the rows.

```ts
const rows = await client.query<Task>("SELECT id, title, done FROM tasks WHERE done = :done ORDER BY title", { done: false });

console.log(`Output: ${rows.data.length} ${rows.data[0]?.title}`);
```

```text
Output: 1 Write the README
```

Pass `params` as a list for positional `$1`, `$2` placeholders, or as an object for named `:name` placeholders:

```ts
await client.query("SELECT title FROM tasks WHERE done = $1 AND title LIKE $2", [false, "Write%"]);
await client.query("SELECT title FROM tasks WHERE done = :done AND title LIKE :prefix", { done: false, prefix: "Write%" });
```

- Raw SQL is read-only and takes one statement per call. A write is refused with `K9O_RAW_SQL_READ_ONLY`; change data with `client.from(collection)`.
- It needs the project-editor role. Row-level security applies.
- Values are always bound by the database, never pasted into the text. A value is a string, number, boolean or `null`; send anything richer as text.
- Named placeholders are rewritten to `$n` before sending. Text in quotes, comments and dollar-quoted strings is left alone, and `x::int` casts are not placeholders.
  The 11 shared translation cases are in `test/query.test.ts`.
- The SQL is at most 100000 characters, with at most 1000 parameters.

## Search

Text search matches words in one text column, best match first. `client.search` is shorthand for `textSearch` on a select:

```ts
const hits = await client.search("articles", { column: "body", q: "climate resilience", limit: 5 });

console.log(`Output: ${hits.data.length}`);
```

```text
Output: 2
```

```ts
const same = await client.from("articles").select().textSearch("body", "climate resilience", { language: "english", type: "plain" }).limit(5);
```

- `type` is `plain` (default), `phrase` or `websearch`. `language` is a text-search configuration name, `english` by default.
- `limit` and `cursor` page the result; the next cursor is `meta.cursor.next`. Filters on the select compose with the search.
- Semantic search finds the rows nearest to an embedding in a vector column, closest first. `metric` is `cosine` (default), `euclidean` or `dot`; `limit` is 1 to 1000 (default 10).

```ts
const embedded = await client.ai.embed({ input: "how do we cope with flooding" });
const nearest = await client.from("articles").select().vectorSearch("embedding", embedded.data.embeddings[0]!, { metric: "cosine", limit: 3 });

console.log(`Output: ${nearest.data.length}`);
```

```text
Output: 3
```

## Projects, functions and policies

These namespaces use the gateway's field names. See [Method reference](#method-reference) for every signature.

### Create a project

`projects.create` takes a `displayName`. The gateway derives the slug from it when you leave `slug` out.

```ts
const project = await client.projects.create({ displayName: "Member Portal" });

console.log(`Output: ${project.data.slug} ${project.data.status}`);
```

```text
Output: member-portal active
```

### Deploy a function

Upload the function's bytes first. Then deploy the returned `artifactKey` with a `version` and a `tier`. Sandbox functions run in a [Firelock](https://github.com/firelock-sandbox/firelock) microVM sandbox.

```ts
import { readFile } from "node:fs/promises";

const bytes = await readFile("score.tar");
const artifact = await client.functions.uploadArtifact(bytes, "tar");

const deployed = await client.functions.deploy({
  name: "score",
  runtime: "rust",
  tier: "sandbox",
  artifactKey: artifact.data.artifactKey,
  version: "1",
});

console.log(`Output: ${deployed.data.status}`);
```

```text
Output: deploying
```

- Upload an OCI image archive of the function's container image with kind `"tar"` (up to 256 MiB) and deploy it to the `sandbox` tier. The `gateway` tier is for functions owned by platform operators and is not available to most projects.
- The status changes to `active` when the function is ready.
- `functions.delete` retires the function and returns the retired record.

### Publish a policy

A policy bundle holds a `policy` document. Publishing queues the bundle for approval.

```ts
const queued = await client.policies.publish("pol_9x2k", { acknowledgeSelfLockout: true });

console.log(`Output: ${queued.data.status}`);
```

```text
Output: pending_approval
```

- The answer is `{ pendingChangeId, bundleId, status }`. The bundle becomes active once it is approved.
- Pass `acknowledgeSelfLockout: true` only if the bundle may remove your own read access.

### Audit log

Filter with `eventType`, `actorId`, `after` and `before`. Dates are ISO 8601.

```ts
const events = await client.audit.query({ eventType: "data.write.access.insert", limit: 5 });

console.log(`Output: ${events.data[0]?.type}`);
```

```text
Output: data.write.access.insert
```

### Generate text

`client.ai.generate(prompt, options)` sends a prompt to a language model. It is shorthand for `compute.llms.invoke`
and returns the same result. Embed text with `client.ai.embed({ input })`.

```ts
const result = await client.ai.generate("Name one colour.", { maxTokens: 20 });

console.log(`Output: ${result.data.content}`);
```

```text
Output: Blue.
```

- `model` is optional. Without it the org's default model is used, and the gateway answers 400 when the org has none.
- Other options: `maxTokens` (1 to 32000), `temperature` (0 to 2) and `usageType`.
- A model served by an outside provider answers 501 `K9O_NOT_IMPLEMENTED` until that provider is built.
- The result has `modelId`, `content`, `finishReason`, `usage` and `usageType`.

## Streams

A stream holds events in order. Publish to it, read a range back, or follow it live. Publishing needs project admin;
reading needs project admin or auditor.

```ts
const controller = new AbortController();

await client.streams.publish("orders", { id: 1, total: 42 }, { subject: "eu.new" });
await client.streams.publish("orders", { id: 2, total: 17 });

for await (const event of client.streams.subscribe("orders", { fromSequence: 0, signal: controller.signal })) {
  console.log(`Output: ${event.sequence} ${JSON.stringify(event.data)}`);
  if (event.sequence === "2") controller.abort();
}
```

```text
Output: 1 {"id":1,"total":42}
Output: 2 {"id":2,"total":17}
```

Read a bounded range once with `replay`:

```ts
const page = await client.streams.replay("orders", { fromSequence: 1, limit: 10 });

console.log(`Output: ${page.data.events.length} ${page.data.hasMore}`);
```

```text
Output: 1 false
```

- A sequence is the event's position in the stream, sent as a string. `fromSequence` is exclusive: you get events after it.
- `subscribe` reopens its connection by itself from the last sequence it saw, because the server limits how long one lasts.
- It ends when `signal` aborts, you call `close()` on the result, or you leave the loop.
- Create the stream first with `client.streams.create({ displayName, maxBytes })`. See [Method reference](#method-reference).
- A `K9O_STREAM_UNAVAILABLE` error (HTTP 503) means streams are not available in that deployment yet.
  `K9O_STREAM_INVALID` means the request was refused, for example a `subject` with an invalid token.

## Approvals

Writes sent with `requireApproval` can wait in a queue for a second person. `client.approvals` reads that queue and decides its changes.
Project admins and auditors see every change; other members see only the ones they proposed.

```ts
const queue = await client.approvals.list({ status: "pending_approval", limit: 20 });
const change = queue.data[0]!;

console.log(`Output: ${change.id} ${change.operation} ${change.collection}`);

const decided = await client.approvals.approve(change.id, { reason: "checked the amount" });

console.log(`Output: ${decided.data.status}`);
```

```text
Output: apr_01j9x3 update orders
Output: redeemed
```

- A change is `pending_approval`, `approved`, `rejected`, `expired` or `redeemed` (applied). An `expired` change can still read `pending_approval` until someone decides it.
- `approve` can answer 200 with `status` still `pending_approval`. That means your approval is recorded and more approvers are needed; the change is not applied yet.
- `reject(id, { reason })` needs a non-empty `reason`; the SDK checks it before sending.
- `list` is not paginated: it returns the newest `limit` changes (1 to 200, default 50). `get(id)` reads one.
- Deciding needs the queue-admin role (project admin or auditor).

Decide many at once with `bulk`. `criteria` is a predicate over each pending change (see [Approval policies](#approval-policies)):

```ts
const run = await client.approvals.bulk({
  action: "reject",
  criteria: { eq: ["change.table", "orders"] },
  reason: "stale",
});

console.log(`Output: ${run.data.affectedCount} ${run.data.affectedIds.join(",")}`);
```

```text
Output: 2 apr_01j9x3,apr_01j9x4
```

- A row that fails (a conflict, an apply error) is skipped silently and left out of `affectedIds`. Compare `affectedIds` with the set you intended.
- `reject` needs a `reason`; `criteria` must be a predicate object. `attestationId` identifies the batch, even when nothing matched.
- It considers the newest 10000 pending changes. Bulk approve is not guaranteed to apply every matched row.

## Approval policies

A policy decides what happens to writes on one collection that match a predicate: `queue` them for approval, or `auto_approve` them.
For a write the first matching policy, oldest first, decides. Policies apply to writes sent with `requireApproval`.

```ts
const policy = await client.approvalPolicies.create({
  collection: "orders",
  operation: "update",
  action: "queue",
  predicate: { gt: ["change.row.amount", 1000] },
});

console.log(`Output: ${policy.data.id} ${policy.data.action}`);

const removed = await client.approvalPolicies.delete(policy.data.id);

console.log(`Output: ${removed.data.id}`);
```

```text
Output: apo_01j9x5 queue
Output: apo_01j9x5
```

- `operation` is `insert`, `update` or `delete`; `action` is `auto_approve` or `queue`.
- `collection` matches `^[a-zA-Z_][a-zA-Z0-9_]{0,62}$` and `predicate` is a non-null object. The SDK checks both before sending.
- A predicate has one operator key: `and`, `or`, `not`, `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, `in_cidr`, `not_in_cidr` or `contains`.
  `and` and `or` take a list of predicates, `not` takes one, and a comparison takes `[left, right]`.
- Operands start with `maker.` or `change.` (for example `change.row.amount`, `change.table`, `change.operation`, `maker.id`).
- `list()` returns all policies. Identical policies are not de-duplicated. Creating and deleting need project admin or author.

## Schema collections

`client.schema.collections.list` lists the project's collections by name, with their size and last migration.

```ts
const page = await client.schema.collections.list({ limit: 2 });

for (const collection of page.data) {
  console.log(`Output: ${collection.name} ${collection.rowCount} rows, ${collection.columnCount} columns`);
}
console.log(`Output: next ${(page.meta.cursor as { next: string | null }).next}`);
```

```text
Output: orders 120 rows, 8 columns
Output: tasks 14 rows, 4 columns
Output: next dGFza3M
```

- Pass `meta.cursor.next` as `cursor` for the next page; it is `null` on the last page. `limit` is 1 to 200 (default 50).
- A row is `{ name, rowCount, rowCountIsExact, columnCount, indexCount, lastMigrationSlug, lastMigrationAppliedAt }`.
- `rowCount` is a live count that skips soft-deleted rows and ignores row-level security. Without an `org_id` claim on the token, `meta.warnings` says so.
- Project admins, auditors, editors, members and viewers can read it.

## Handling errors

Every method throws `KError` when a request fails or the SDK rejects your input. Switch on `code`.

```ts
import { KError } from "@k9o/core";

try {
  await client.from("tasks").insert<Task>({ title: "One more task", done: false });
} catch (error) {
  if (error instanceof KError && error.code === "K9O_TIER_CAP_HIT") {
    console.log(`Output: ${error.code}`);
  } else {
    throw error;
  }
}
```

```text
Output: K9O_TIER_CAP_HIT
```

The output appears only when the plan's cap is reached.

- `KError` also carries `context`, `status` and `requestId`. See [Error fields](#error-fields).
- The gateway can send many codes. See [Error codes](#error-codes) for the ones the SDK raises itself.

## Regional hosts

- On an organization host such as `https://acme.api.example.com`, the client sends one `HEAD` request first.
- The request carries no credentials. It finds the regional host for your organization.
- All later requests go to that host. The answer is cached for the life of the client.
- Any other `baseUrl` is used as given. If the lookup fails, the configured host is used.

## Appendix

- [Requirements](#requirements)
- [Client options](#client-options)
- [Retry settings](#retry-settings)
- [Methods by namespace](#methods-by-namespace)
- [Method reference](#method-reference)
- [Data methods](#data-methods)
- [Error fields](#error-fields)
- [Error codes](#error-codes)
- [Related packages](#related-packages)
- [About Kilimanjaro](#about-kilimanjaro)

### Requirements

| Requirement | Version |
| --- | --- |
| Node.js | 18 or newer |
| Bun | 1.1 or newer |
| TypeScript (optional) | 5.6 or newer |
| Browser | Any with a global `fetch` |

### Client options

| Option | What it does |
| --- | --- |
| `apiKey` | Bearer token sent on every request. |
| `orgSlug` | Selects your organization. On a platform host (`api.<apex>`) it builds `https://<orgSlug>.api.<apex>`. |
| `projectSlug` | Selects the project. Required by project-scoped calls. |
| `baseUrl` | Gateway host, no path. Defaults to `https://api.k9o.io`. |
| `fetch` | Custom `fetch` implementation. |
| `defaultHeaders` | Headers added to every request. |
| `retryConfig` | Retry policy. See [Retry settings](#retry-settings). |

- A `baseUrl` with a path, query or fragment throws `K9O_INVALID_BASE_URL`.
- Slugs use 2 to 63 lowercase letters, digits and hyphens. They start with a letter and do not end with a hyphen.
- Do not pass both an organization-host `baseUrl` and `orgSlug`. One of them is enough.

### Retry settings

| Field | Meaning |
| --- | --- |
| `maxRetries` | How many times to retry. |
| `backoff` | `"exponential"`, `"linear"` or `"none"`. |
| `initialDelayMs` | First delay. Optional. |
| `maxDelayMs` | Delay cap. Optional. |

- Only GET, HEAD, OPTIONS and DELETE are retried.
- Retries happen on network failure and on HTTP 429, 502, 503 and 504.

### Methods by namespace

| Namespace | Methods |
| --- | --- |
| `client.from(collection)` | See [Data methods](#data-methods). |
| `client.projects` | `list`, `create`, `get`, `update` |
| `client.migrations` | `apply`, `list`, `get`, `queue`, `listPending`, `applyPending`, `rejectPending`, `deletePending` |
| `client.functions` | `uploadArtifact`, `deploy`, `list`, `get`, `delete`, `invoke` |
| `client.audit` | `query`, `tail` (needs `projectSlug`) |
| `client.policies` | `current`, `list`, `create`, `validate`, `get`, `update`, `delete`, `publish` |
| `client.storage` | `listBuckets`, `getBucket`, `createBucket`, `updateBucket`, `deleteBucket`, `from(bucket)`, `locations` |
| `client.storage.from(bucket)` | `upload`, `createSignedUrl`, `list`, `remove` |
| `client.storage.locations` | `list`, `create`, `get`, `update`, `retire`, `test` |
| `client.orgs` | `list`, `get`, `restore`, `current` |
| `client.org` | `get`, plus the sub-namespaces below |
| `client.org.members` | `list`, `invite`, `remove` |
| `client.org.groups` | `list`, `get` |
| `client.org.auditLog` | `query` |
| `client.org.gate.roles` | `list`, `grant`, `get`, `revoke` |
| `client.org.gate.idpProviders` | `list`, `create`, `get`, `configure`, `delete` |
| `client.org.smtp` | `set`, `test`, `unset` |
| `client.org.defaultLLM` | `get`, `set` |
| `client.me.profile` | `get`, `update` |
| `client.me.sessions` | `list`, `revokeAll` |
| `client.me.apiTokens` | `list`, `create`, `delete` |
| `client.studio.workflows` | `list`, `create`, `read`, `update`, `delete`, `trigger`, `runs` |
| `client.studio.workflows.runs` | `list`, `read`, `cancel` |
| `client.studio.dashboards` | `list`, `create`, `read`, `update`, `delete`, `pin`, `unpin` |
| `client.compute.llms` | `list`, `read`, `invoke`, `invokeStream` |
| `client.ai` | `embed`, `generate` |
| `client.realtime` | `subscribe` (server-sent events) |
| `client.streams` | `create`, `list`, `get`, `delete`, `publish`, `replay`, `subscribe` (server-sent events) |
| `client.query(sql, params?)` | See [Query with SQL](#query-with-sql). |
| `client.search(collection, input)` | See [Search](#search). |
| `client.approvals` | `list`, `get`, `approve`, `reject`, `bulk` |
| `client.approvalPolicies` | `list`, `create`, `delete` |
| `client.schema.collections` | `list` |
| `client.gate` | End-user sign-in from `@k9o/gate` (needs `projectSlug`) |
| `client.kibo` | Vault and key operations from `@k9o/kibo` |
| `client.extensions` | `extension(slug)` from `@k9o/extensions` |

### Method reference

Signatures of the methods whose inputs or results are easy to get wrong. Types are exported from `@k9o/core`.

| Call | Input and result |
| --- | --- |
| `projects.create(input)` | `displayName` required. Optional `slug`, `region`, `custodyMode`, `processingContexts`, `idempotencyKey`, and a scope field (see `CreateProjectInput`). |
| `projects.update(slug, patch)` | `displayName`, `description`, `softDeleteRetentionDays`, `processingContexts`. A slug rename must be sent alone. |
| `functions.uploadArtifact(bytes, kind)` | `kind` is `"wasm"` (up to 16 MiB) or `"tar"` (up to 256 MiB). Returns `{ artifactKey }`. |
| `functions.deploy(input)` | `name`, `runtime`, `tier`, `artifactKey`, `version`. Optional `description`. |
| `functions.list(opts)` | Optional `limit`, `cursor`, `status`, `tier`, `source`. |
| `functions.invoke(name, payload, options)` | Optional `background`, `delegation`, `onBehalfOf`, `confinedTo`. |
| `policies.create(input)` | `policy` document. Optional `rules`, `editorMode`. |
| `policies.publish(bundleId, options)` | Optional `acknowledgeSelfLockout`. Returns `{ pendingChangeId, bundleId, status }`. |
| `policies.validate(input)` | `policy` document. Returns `{ valid: true }`, or throws. |
| `migrations.apply(input)` | Returns `{ applied, skipped }`. Applied rows have `version`, `slug` and `checksum`. |
| `migrations.queue(input)` | Returns one row per migration with `id`, `status` and `approvalId`. |
| `migrations.applyPending(id)` | Returns `{ pendingId, applied, skipped }`. |
| `audit.query(opts)` | Optional `eventType`, `actorId`, `after`, `before`, `limit`, `cursor`. |
| `org.members.invite(input)` | `email` and `role`. Returns the member, or `{ invitation, delivery }` for an unknown email. |
| `org.auditLog.query(opts)` | Optional `type` and `limit` (1 to 500). Events carry `createdAt`. |
| `org.smtp.set(config)` | Returns the org. The password is sent as `passwordRef`, never in clear. |
| `org.smtp.test(input)` | Returns `{ accepted, resolvedTier, to, dryRun }`. |
| `me.profile.update(patch)` | Optional `displayName`, `locale`, `timezone`. |
| `storage.createBucket(name, options)` | Optional `fileSizeLimit`, `allowedMimeTypes`, `byosBindingId`. `public`, `versioning` and `deleteAfterDays` are stored but not enforced yet. |
| `storage.from(bucket).createSignedUrl(path, options)` | `expiresIn` required. The gateway signs for 900 seconds at most. |
| `streams.create(input)` | `displayName` and `maxBytes` (1, 2, 4, 8, 16, 32 or 64 GiB) required. Optional `retentionSeconds`: whole hours, at least 3600. |
| `streams.publish(slug, data, options)` | `data` is any JSON value. Optional `subject`: up to 8 dot-separated tokens of `[a-z0-9_-]`. Returns `{ streamSlug, subject, bytes, accepted }`. |
| `streams.replay(slug, options)` | Optional `fromSequence`, `untilSequence`, `limit` (1 to 10000). Returns `{ streamSlug, events, nextCursor, hasMore }`. |
| `streams.subscribe(slug, options)` | Optional `fromSequence`, `signal`. Async iterable of events with `close()`. An event is `{ sequence, subject, data, publishedAt }`. |
| `approvals.list(opts)` | Optional `status`, `limit` (1 to 200). Not paginated. Returns changes with `id`, `status`, `collection`, `operation`, `makerId`, `proposedPayload`, `targetRecordId`, `approverId`, `decidedAt`, `decisionReason`, `createdAt`, `expiresAt`. |
| `approvals.approve(id, input)` | Optional `reason`. A result still `pending_approval` means more approvers are needed. |
| `approvals.reject(id, input)` | `reason` required. |
| `approvals.bulk(input)` | `action`, `criteria` required; `reason` required for `reject`. Returns `{ attestationId, action, affectedCount, affectedIds, reason }`. Failed rows are skipped silently. |
| `approvalPolicies.create(input)` | `collection`, `operation`, `action`, `predicate` required. |
| `approvalPolicies.delete(id)` | Returns `{ id }`. |
| `schema.collections.list(opts)` | Optional `limit` (1 to 200), `cursor`. Returns `{ name, rowCount, rowCountIsExact, columnCount, indexCount, lastMigrationSlug, lastMigrationAppliedAt }` rows. |
| `ai.generate(prompt, options)` | Optional `model`, `maxTokens`, `temperature`, `usageType`. Returns `{ modelId, content, finishReason, usage, usageType }`. |
| `compute.llms.invoke(model, input)` | `prompt` and optional `params`. Result fields are `content` and `usage`. |
| `compute.llms.invokeStream(model, input)` | Async iterable of chunks. Read text from `choices[0].delta.content`. |

### Data methods

| Method | What it does |
| --- | --- |
| `select<T>()` | Starts a query. Await it to get the rows. |
| `insert<T>(record)` | Creates one record. |
| `update<T>(patch)` | Updates one record by id. |
| `delete<T>()` | Deletes one record by id. |
| `eq`, `neq` | Equal, not equal. |
| `gt`, `gte`, `lt`, `lte` | Comparisons. |
| `in`, `notIn` | Value is in, or not in, a list. |
| `like`, `ilike` | Pattern match, case-sensitive or not. |
| `is` | Compare with `"null"`, `"true"` or `"false"`. |
| `filter(column, op, value)` | Generic form of the filters above. |
| `limit(n)` | Maximum rows to return. |
| `cursor(token)` | Continue from a cursor. |
| `count(mode)` | `"none"`, `"exact"` or `"estimated"`. |

Filters combine with AND.

### Error fields

| Field | Meaning |
| --- | --- |
| `code` | Stable string such as `K9O_PROJECT_NOT_FOUND`. Switch on this. |
| `message` | Human-readable explanation. |
| `context` | Read-only per-code details. |
| `recommendation` | Suggested next step, or `null`. |
| `status` | HTTP status, or `null` if no request was sent. |
| `requestId` | Gateway trace id for support, or `null`. |

### Error codes

The gateway can send other codes. The SDK passes them through unchanged.

| Code | When |
| --- | --- |
| `K9O_INVALID_BASE_URL` | `baseUrl` is not a plain http or https host. |
| `K9O_INVALID_FIELD_VALUE` | An argument or slug failed validation. |
| `K9O_INVALID_FILTER` | A realtime subscription filter was malformed. |
| `K9O_STREAM_UNAVAILABLE` | Streams are not available in this deployment yet (HTTP 503). Passed through from the gateway. |
| `K9O_STREAM_INVALID` | A stream request was refused, such as a bad `subject`. Passed through from the gateway. |
| `K9O_MISSING_PROJECT_CONTEXT` | A project-scoped call was made without `projectSlug`. |
| `K9O_UPSTREAM_UNAVAILABLE` | The gateway could not be reached. |
| `K9O_INTERNAL_ERROR` | No `fetch` is available, or the response was unexpected. |

### Related packages

| Package | What it does |
| --- | --- |
| `@k9o/gate` | End-user sign-up, sign-in, sessions and JWT verification. |
| `@k9o/extensions` | Typed bindings for platform extensions. |
| `@k9o/kibo` | Vault and key operations. |

### About Kilimanjaro

Kilimanjaro is a modular developer platform for building secure enterprise applications.
You define AI agents, functions and data pipelines on the platform.
The SDKs let you deploy and invoke them, read and write your data, publish to and subscribe to streams,
sign users in, and encrypt with keys you hold.

It provides four building blocks:

- **Keep**: AI security and governance. Guardrails and policy for the agents you run.
- **Pulse**: data intelligence and real-time stream processing. Streams, analytics and live feeds.
- **Gate**: customer identity and access management. Sign-in and sessions, and automatic data scoping so a signed-in user reaches only their own data.
- **Kibo**: cryptographic keys and secrets management. Client-side encryption with keys you hold, and a secrets vault.

## License

Apache-2.0 © Formelo Inc. See `LICENSE` and `NOTICE`.
