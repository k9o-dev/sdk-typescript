# @k9o/core

The Kilimanjaro platform SDK for TypeScript and JavaScript. One client for your data, projects, functions, audit log and more.

Kilimanjaro is the AI-native foundation for building critical applications.
Its products are Keep (AI Security and Governance), Pulse (Data Intelligence),
Gate (Customer Identity and Access Management) and Kibo (Keys and Secrets Management).

## Contents

- [Links](#links)
- [Install](#install)
- [Quick start](#quick-start)
- [Authentication and project context](#authentication-and-project-context)
- [Running queries](#running-queries)
- [Projects, functions and policies](#projects-functions-and-policies)
- [Handling errors](#handling-errors)
- [Regional hosts](#regional-hosts)
- [Appendix](#appendix)

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

console.log(task.title);
```

```text
Write the README
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
  console.log(openTask.title);
}
```

```text
Write the README
```

Update or delete one record by id:

```ts
const updated = await client.from("tasks").update<Task>({ done: true }).eq("id", task.id);

console.log(updated.data.done);
```

```text
true
```

- `update` and `delete` need an `eq("id", ...)` filter. They never change many rows at once.
- See [Data methods](#data-methods) for filters and paging.
- Other namespaces are listed in [Methods by namespace](#methods-by-namespace).

## Projects, functions and policies

These namespaces use the gateway's field names. See [Method reference](#method-reference) for every signature.

### Create a project

`projects.create` takes a `displayName`. The gateway derives the slug from it when you leave `slug` out.

```ts
const project = await client.projects.create({ displayName: "Member Portal" });

console.log(project.data.slug, project.data.status);
```

```text
member-portal active
```

### Deploy a function

Upload the function's bytes first. Then deploy the returned `artifactKey` with a `version` and a `tier`.

```ts
import { readFile } from "node:fs/promises";

const bytes = await readFile("score.wasm");
const artifact = await client.functions.uploadArtifact(bytes, "wasm");

const deployed = await client.functions.deploy({
  name: "score",
  runtime: "rust",
  tier: "gateway",
  artifactKey: artifact.data.artifactKey,
  version: "1",
});

console.log(deployed.data.status);
```

```text
deploying
```

- Use `"wasm"` for the `gateway` tier and `"tar"` (an OCI image archive) for the `sandbox` tier.
- The status changes to `active` when the function is ready.
- `functions.delete` retires the function and returns the retired record.

### Publish a policy

A policy bundle holds a `policy` document. Publishing queues the bundle for approval.

```ts
const queued = await client.policies.publish("pol_9x2k", { acknowledgeSelfLockout: true });

console.log(queued.data.status);
```

```text
pending_approval
```

- The answer is `{ pendingChangeId, bundleId, status }`. The bundle becomes active once it is approved.
- Pass `acknowledgeSelfLockout: true` only if the bundle may remove your own read access.

### Audit log

Filter with `eventType`, `actorId`, `after` and `before`. Dates are ISO 8601.

```ts
const events = await client.audit.query({ eventType: "data.write.access.insert", limit: 5 });

console.log(events.data[0]?.type);
```

```text
data.write.access.insert
```

## Handling errors

Every method throws `KError` when a request fails or the SDK rejects your input. Switch on `code`.

```ts
import { KError } from "@k9o/core";

try {
  await client.from("tasks").insert<Task>({ title: "One more task", done: false });
} catch (error) {
  if (error instanceof KError && error.code === "K9O_TIER_CAP_HIT") {
    console.log(error.code);
  } else {
    throw error;
  }
}
```

```text
K9O_TIER_CAP_HIT
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
| `client.ai` | `embed` |
| `client.realtime` | `subscribe` (server-sent events) |
| `client.gate` | End-user sign-in from `@k9o/gate` (needs `projectSlug`) |
| `client.kibo` | Vault and key operations from `@k9o/kibo` |
| `client.extensions` | `extension(slug)` from `@k9o/extensions` |

### Method reference

Signatures of the methods whose inputs or results are easy to get wrong. Types are exported from `@k9o/core`.

| Call | Input and result |
| --- | --- |
| `projects.create(input)` | `displayName` required. Optional `slug`, `region`, `custodyMode`, `productScope`, `processingContexts`, `idempotencyKey`. |
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
| `K9O_MISSING_PROJECT_CONTEXT` | A project-scoped call was made without `projectSlug`. |
| `K9O_UPSTREAM_UNAVAILABLE` | The gateway could not be reached. |
| `K9O_INTERNAL_ERROR` | No `fetch` is available, or the response was unexpected. |

### Related packages

| Package | What it does |
| --- | --- |
| `@k9o/gate` | End-user sign-up, sign-in, sessions and JWT verification. |
| `@k9o/extensions` | Typed bindings for platform extensions. |
| `@k9o/kibo` | Vault and key operations. |

## License

Apache-2.0 © Formelo Inc. See `LICENSE` and `NOTICE`.
