# @k9o/core

The Kilimanjaro platform SDK for TypeScript and JavaScript. One client for your data, projects, functions, audit log and more.

Kilimanjaro is an AI-native platform on a Governed Database. Its products are Keep (AI Security and Governance), Pulse (Data Intelligence), Gate (Customer Identity and Access Management) and Kibo (Keys and Secrets Management).

## Contents

- [Links](#links)
- [Install](#install)
- [Quick start](#quick-start)
- [Authentication and project context](#authentication-and-project-context)
- [Running queries](#running-queries)
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

## Authentication and project context

Three options select who you are and where you work. See [Client options](#client-options) for the full list.

| Option | What it does |
| --- | --- |
| `apiKey` | Bearer token sent on every request. |
| `orgSlug` | Selects your organization. |
| `projectSlug` | Selects the project. Required by project-scoped calls. |

- On the default host, pass `orgSlug` and leave `baseUrl` out.
- On a self-hosted or custom host, pass `baseUrl` and leave `orgSlug` out.

```ts
const client = createClient({
  baseUrl: "https://acme.example.com",
  apiKey: process.env.K9O_API_KEY,
  projectSlug: "member-portal",
});
```

To retry transient failures, add `retryConfig`. See [Retry settings](#retry-settings).

## Running queries

`client.from(collection)` reads and writes records. Chain filters and paging, then await the result.

```ts
const response = await client.from("tasks").select<Task>().eq("done", false).limit(10);

for (const openTask of response.data) {
  console.log(openTask.title);
}
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
- Other namespaces such as projects, migrations and audit are listed in [Methods by namespace](#methods-by-namespace).

## Handling errors

Every method throws `KError` when a request fails or the SDK rejects your input. Switch on `code`.

```ts
import { KError } from "@k9o/core";

try {
  await client.from("tasks").insert<Task>({ title: "One more task", done: false });
} catch (error) {
  if (error instanceof KError && error.code === "K9O_TIER_CAP_HIT") {
    console.warn(error.message, error.recommendation);
  } else {
    throw error;
  }
}
```

- `KError` also carries `context`, `status` and `requestId`. See [Error fields](#error-fields).
- The gateway can send many codes. See [Error codes](#error-codes) for the ones the SDK raises itself.

## Regional hosts

- On an organization host such as `https://acme.api.k9o.io`, the client sends one `HEAD` request first.
- The request carries no credentials. It finds the regional host for your organization.
- All later requests go to that host. The answer is cached for the life of the client.
- Any other `baseUrl` is used as given. If the lookup fails, the configured host is used.

## Appendix

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
| `orgSlug` | Selects your organization. On the default host it builds `https://<orgSlug>.api.k9o.io`. |
| `projectSlug` | Selects the project. Required by project-scoped calls. |
| `baseUrl` | Gateway host, no path. Defaults to `https://api.k9o.io`. |
| `fetch` | Custom `fetch` implementation. |
| `defaultHeaders` | Headers added to every request. |
| `retryConfig` | Retry policy. See [Retry settings](#retry-settings). |

- A `baseUrl` with a path, query or fragment throws `K9O_INVALID_BASE_URL`.
- Slugs use 2 to 63 lowercase letters, digits and hyphens. They start with a letter and do not end with a hyphen.

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
| `client.functions` | `deploy`, `list`, `get`, `delete` |
| `client.audit` | `query`, `tail` (needs `projectSlug`) |
| `client.policies` | Policy bundle lifecycle |
| `client.storage` | Storage locations and buckets |
| `client.metadata` | Metadata queries across surfaces |
| `client.orgs` | `list`, `get`, `restore`, `current` |
| `client.org` | Members, groups, SMTP settings, audit log, identity providers |
| `client.me` | Your profile, sessions, API tokens, notifications |
| `client.studio` | `workflows` and `dashboards` |
| `client.compute.llms` | `list`, `read`, `invoke` |
| `client.ai` | `embed` |
| `client.realtime` | `subscribe`, `replay` |
| `client.gate` | End-user sign-in from `@k9o/gate` (needs `projectSlug`) |
| `client.kibo` | Vault and key operations from `@k9o/kibo` |
| `client.extensions` | `extension(slug)` from `@k9o/extensions` |

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
