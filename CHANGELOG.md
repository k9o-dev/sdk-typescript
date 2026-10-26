# Changelog — @k9o/core

## 1.4.0 (unreleased)

### Added

- `client.ai.generate(prompt, options)`: generate text from a prompt (`model`, `maxTokens`, `temperature`, `usageType`). Same result as `compute.llms.invoke`.
- `client.streams`: `create`, `list`, `get`, `delete`, `publish`, `replay` and `subscribe` for a project's data streams.
- `streams.subscribe` is an async iterable of events (`{ sequence, subject, data, publishedAt }`) with `close()`. It reopens the
  connection from the last sequence when the server closes it, and ends on `signal` or `close()`.
- `client.approvals`: `list`, `get`, `approve`, `reject` and `bulk` for the pending-change queue. `approve` can answer with a change that is
  still `pending_approval`: the approval was recorded and more approvers are needed. `bulk` returns `{ attestationId, action, affectedCount, affectedIds, reason }`
  and skips failed rows silently, so compare `affectedIds` with what you intended. `reject` and bulk `reject` need a `reason`; the SDK checks it.
- `client.approvalPolicies`: `list`, `create` and `delete` for the rules that queue or auto-approve writes. `delete` returns `{ id }`.
- `client.schema.collections.list({ limit, cursor })`: the project's collections with row, column and index counts and the last migration, one cursor page at a time.
- README sections for raw SQL (`client.query`) and search (`client.search`, `textSearch`, `vectorSearch`), approvals, approval policies and schema collections.
- `K9O_STREAM_UNAVAILABLE` and `K9O_STREAM_INVALID` reach you as `KError`, with the gateway's message.
- Streaming requests accept an abort `signal`.

### Changed

- Function deploy examples use the sandbox tier.

## 1.3.0 — 2026-10-26

The SDK now matches the gateway. It passes the gateway's field names through, so some inputs and results change.

### Changed

- Inputs: `projects.create` takes `displayName`. `functions.deploy` takes `artifactKey`, `version` and `tier`.
- Inputs: policies and `policies.validate` take a `policy` document.
- Inputs: audit filters are `eventType`, `actorId`, `after` and `before`.
- Inputs: `policies.publish` takes an optional `acknowledgeSelfLockout`. `me.profile.update` takes `locale` and `timezone`.
- Inputs: `me.apiTokens.create` takes `label`, `scopeManifest` and `ttlSeconds`. `org.smtp.set` takes `passwordRef`, not a password.
- Inputs: `org.auditLog.query` takes `type` and `limit` only. `migrations.listPending` takes an optional `status`.
- Inputs: `org.members.list` filters by `userId`, `role`, `acceptanceStatus`, `status` and `state`.
- Inputs: `functions.list` also filters by `tier` and `source`.
- Project results: `displayName` replaces `name`. `custodyMode` is `PLATFORM_MANAGED`, `SKR`, `BYOK` or `HYOK`.
- Project results also carry `region`, `status`, `role` and `residencySet`.
- Policy results: bundles carry `policy`, `projectId` and a `status` of `draft`, `published` or `superseded`. `validate` answers `{ valid: true }`.
- `policies.publish` answers `{ pendingChangeId, bundleId, status }`: the publish waits for approval. `policies.delete` returns no data.
- Migration results: `apply` and `applyPending` answer `{ applied, skipped }` without `appliedAt`. Pending rows use `id`, `queuedAt` and `queuedBy`.
- Function results: records add `version`, `entryPoint`, `retiredAt` and `errorDetail`. The failed status is `error`.
- `functions.delete` returns the retired record.
- Org results: `org.get()` and the `orgs` methods return `displayName`. Members add `invitedAt`, `acceptedAt` and `state`.
- `org.members.invite` answers `{ invitation, delivery }` when the email has no account. `org.members.remove` returns no data.
- Org groups carry `source` and no `memberCount`. Org audit events carry `createdAt`. `org.smtp.set` and `org.smtp.unset` return the org.
- `org.smtp.test` answers `{ accepted, resolvedTier, to, dryRun }`.
- `me` results: profiles add `mfaEnabled` and `updatedAt`. Sessions use `issuedAt`, `expiresAt` and `isCurrentSession`.
- `compute.llms.invoke` results use `content` and `usage`. Inference parameters are sent flat in the request.
- Signed URLs: the gateway signs for 900 seconds at most. The answer's `expiresIn` is the lifetime it used.
- Host handling: the API host comes from the base URL. `orgSlug` builds `<orgSlug>.api.<apex>` on any platform host, not only the default one.
- The README is rewritten and checked against the source.

### Removed

- `client.metadata`.
- `client.realtime.replay`, the WebSocket transport and polling. `subscribe` (server-sent events) remains.
- `org.members.get` and `org.smtp.get`.
- `org.auditLog.tail`. The org audit log cannot filter by time.
- `org.groups.create` and `org.groups.delete`. Groups come from your identity provider, so only `list` and `get` remain.
- `me.notifications`, `me.auditLog` and `me.dataExport`.

### Added

- `functions.uploadArtifact(bytes, kind)` uploads a function's bytes and returns its `artifactKey`.
- A contract test checks 100 SDK calls against the gateway's published API description.

## 1.2.0 — 2026-10-25

- The README now introduces the Kilimanjaro building blocks (Keep, Pulse, Gate, Kibo). No change to the public API.

## 1.1.1 — 2026-10-25

- Documentation links corrected: the documentation hub is https://docs.kilimanjaro.dev, with the website, platform API and console listed in a Links section. Package metadata points at the same places.

## 1.1.0 — 2026-10-25

- Documentation rewritten with runnable examples and expected output; internal cross-references removed from the published sources. No change to the public API.
- Error text for `update()` / `delete()` without an `id` filter no longer mentions a version or a roadmap.

## 1.0.0 — 2026-10-23

First public release. See the README for the full API overview.
