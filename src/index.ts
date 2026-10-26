/**
 * `@k9o/core` — Kilimanjaro platform SDK entry point.
 *
 * Customer-facing surface. The `createClient(options)`
 * factory returns a `K9oClient` instance with namespaces:
 *
 *   - `client.from(collection)`  — data-plane DSL
 *   - `client.projects`          — project lifecycle
 *   - `client.gate`, `client.extensions`, `client.migrations`, `client.functions`, `client.policies`,
 *     `client.audit`, `client.orgs` and the other namespaces on the client type
 *
 * `@k9o/core` composes `@k9o/gate` and `@k9o/extensions` and adds client construction and the data-plane surface.
 * The SDK shape stays stable whether pillars are imported directly or
 * through `@k9o/core` — only the package boundary moves.
 *
 * Every async method throws `KError` on non-2xx
 * gateway responses, transport failures, or SDK-side validation errors.
 * Caller code narrows on `error.code` per the closed taxonomy.
 *
 * Canonical usage:
 *
 * ```typescript
 * import { createClient, KError } from "@k9o/core";
 *
 * // `orgSlug` selects your organization's host (https://acme.api.k9o.io); do not also pass `baseUrl`.
 * const client = createClient({
 *   apiKey: process.env.K9O_API_KEY,
 *   orgSlug: "acme",
 *   projectSlug: "member-portal",
 * });
 *
 * try {
 *   const { data, meta } = await client.from("posts").select().limit(10);
 *   console.log(data, meta.cursor.next);
 * } catch (e) {
 *   if (e instanceof KError && e.code === "K9O_TIER_CAP_HIT") {
 *     console.warn(e.message, e.recommendation);
 *   }
 *   throw e;
 * }
 * ```
 */

import { resolveBaseUrl } from "./url-grammar.ts";
import type { HttpClientConfig } from "./http.ts";
import { makeFromFactory } from "./data/from.ts";
import { makeProjectsNamespace } from "./projects.ts";
import { makeStorageNamespace } from "./storage-locations.ts";
export type {
  StorageBucket, CreateBucketOptions, UpdateBucketOptions, StorageObject, UploadOptions, SignedUrlOptions,
  SignedUrl, RemovedObject, DeletedBucket,
} from "./storage-buckets.ts";
import { makeMigrationsNamespace } from "./migrations.ts";
import { makeFunctionsNamespace } from "./functions.ts";
import { makePoliciesNamespace } from "./policies.ts";
import { makeAuditNamespace } from "./audit.ts";
import { makeOrgsNamespace } from "./orgs.ts";
import { makeOrgNamespace } from "./org.ts";
import { makeMeNamespace } from "./me.ts";
import { makeStudioNamespace } from "./studio/index.ts";
import { makeComputeNamespace } from "./compute/llms.ts";
import { makeAiNamespace } from "./ai.ts";
import { makeRealtimeNamespace } from "./realtime.ts";
import { makeGateBridge, gateNotAvailable } from "./gate-bridge.ts";
import { makeExtensionsBridge } from "./extensions-bridge.ts";
import type { GateClient } from "@k9o/gate";
import { createKiboClient, type KiboClient } from "@k9o/kibo";
import type { CreateClientOptions } from "./types.ts";

export { KError, kerrorFromWire, type KErrorWire } from "./kerror.ts";
export {
  type Envelope,
  type MetaCursor,
  type MetaSubscription,
  type MetaIdempotency,
  type MetaWarning,
  type MetaCost,
  type MetaTiming,
  type MetaContext,
  type PaginatedEnvelope,
} from "./envelope.ts";
export {
  validateBaseUrl,
  resolveBaseUrl,
  parseApiHost,
  DEFAULT_BASE_URL,
  type ApiHost,
  validateSlug,
  projectPath,
  orgPath,
  platformPath,
} from "./url-grammar.ts";
export type {
  CreateClientOptions,
  RetryConfig,
  FilterOp,
} from "./types.ts";
export type { Project, CreateProjectInput, UpdateProjectInput } from "./projects.ts";
export {
  BYOS_CRED_REF_PREFIX,
  BYOS_CRED_FORMAT_VERSION,
  BYOS_CRED_VAULT_NAME_PREFIX,
  BYOS_PROVIDER_SCHEME,
  encodeByosCredential,
  byosCredentialRef,
  byosCredVaultName,
  type ByosCredProvider,
  type ByosCredInput,
} from "./byos.ts";
export type {
  StorageLocation, StorageLocationProvider, StorageLocationCustodyMode, StorageLocationProviderParams,
  CreateStorageLocationInput, UpdateStorageLocationInput, RetiredStorageLocation, StorageLocationTestResult,
} from "./storage-locations.ts";
export type {
  Migration, AppliedMigration, AppliedMigrationRow, SkippedMigrationRow, ApplyMigrationsResult, ApplyPendingResult,
  PendingMigration, PendingMigrationStatus, QueuedMigration,
  Operation, ColumnSpec, IndexSpec, ColumnReferences,
  MigrationPolicy, CollectionPolicy, StorageBucketPolicy, RelationshipSpec, ActionRule,
} from "./migrations.ts";
export type { FunctionRecord, DeployFunctionInput } from "./functions.ts";
export type {
  PolicyBundle, PolicyDocument, PolicyPublishResult, PublishPolicyOptions, CreatePolicyInput, UpdatePolicyInput, ValidatePolicyResult,
} from "./policies.ts";
export type { AuditEvent, AuditQueryOpts } from "./audit.ts";
export type { Org } from "./orgs.ts";
export type {
  OrgMember,
  OrgInviteResult,
  OrgGroup,
  OrgRoleGrant,
  OrgAuditEvent,
  SmtpConfig,
  SmtpTestEmailInput,
  SmtpTestEmailResult,
  OrgIdpProvider,
  CreateOrgIdpInput,
  UpdateOrgIdpInput,
  OrgIdpProviderKind,
  OrgDefaultLlm,
} from "./org.ts";
export type {
  MyProfile,
  MySession,
  UpdateMyProfileInput,
  MyApiToken,
  CreateMyApiTokenInput,
} from "./me.ts";
export type { ExtensionSlug, Extension } from "./extensions-bridge.ts";
export type { GateClient } from "@k9o/gate";
export type {
  KiboClient, KmsProvider, StoreZkDekInput, ZkDekHandle, ZkDekRecord,
  SecretVisibility, CreateSecretInput, SecretSummary,
  ListSecretsInput, ListSecretsResult, AttestationTier, RevealChallenge, RevealSecretResult,
  UpdateSecretInput, UpdateSecretResult, RotateSecretResult, MoveSecretResult,
} from "@k9o/kibo";

// Studio surfaces (workflows + dashboards)
export {
  WORKFLOW_ERROR_CODES,
  type Workflow,
  type WorkflowRun,
  type WorkflowRunStep,
  type WorkflowAction,
  type WorkflowStatus,
  type WorkflowRunStatus,
  type WorkflowTriggerType,
  type WorkflowActionType,
  type CreateWorkflowInput,
  type UpdateWorkflowInput,
  type WorkflowListFilters,
  type WorkflowRunListFilters,
} from "./studio/workflows.ts";
export {
  DASHBOARD_ERROR_CODES,
  type Dashboard,
  type Widget,
  type WidgetType,
  type WidgetDataSourceMode,
  type DashboardStatus,
  type CreateDashboardInput,
  type UpdateDashboardInput,
  type DashboardListFilters,
} from "./studio/dashboards.ts";

// Compute LLMs
export {
  LLM_ERROR_CODES,
  type LLMModelId,
  type LLMModel,
  type LLMModality,
  type LLMProviderClass,
  type LLMInvokeParams,
  type LLMInvokeInput,
  type LLMResponse,
  type LLMUsage,
  type LLMStreamChunk,
} from "./compute/llms.ts";

export type { EmbedInput, EmbedResult, EmbeddingModelId } from "./ai.ts";

export { assertProviderRegion, isProviderRegion, type ProviderRegionProvider } from "./provider-region.ts";

// Realtime subscriptions
export {
  realtimeTopic,
  type RealtimeTopic,
  type RealtimeTopicFamily,
  type RealtimeFilter,
  type RealtimeEvent,
  type RealtimeSubscription,
  type SubscribeOptions,
} from "./realtime.ts";

/**
 * The client returned by `createClient`. Namespaces hang off the
 * instance — composed from per-resource factories that share the
 * bound HTTP config.
 */
export type K9oClient = {
  /** Data-plane DSL — `client.from(collection).select()` etc. */
  from: ReturnType<typeof makeFromFactory>;
  /** Project lifecycle — `client.projects.list()` etc. */
  projects: ReturnType<typeof makeProjectsNamespace>;
  /** Storage locations — `client.storage.locations.create({..., credentialRef})` etc. Independent of
   *  `client.kibo.vault.secrets` (credential pre-create): this namespace only registers a caller-supplied
   *  `credentialRef` string, never creates or resolves one. */
  storage: ReturnType<typeof makeStorageNamespace>;
  /** Migration lifecycle — `client.migrations.apply()` etc. */
  migrations: ReturnType<typeof makeMigrationsNamespace>;
  /** Function deploy + invoke — `client.functions.deploy()` etc. */
  functions: ReturnType<typeof makeFunctionsNamespace>;
  /** Policy bundle lifecycle — `client.policies.publish()` etc. */
  policies: ReturnType<typeof makePoliciesNamespace>;
  /** Audit log queries — `client.audit.query()` etc. */
  audit: ReturnType<typeof makeAuditNamespace>;
  /** Org lifecycle — `client.orgs.list()` etc. (collection-style across accessible orgs) */
  orgs: ReturnType<typeof makeOrgsNamespace>;
  /** Org-bound namespace — `client.org.members`, `client.org.groups`, `client.org.smtp`, `client.org.auditLog`, `client.org.gate`. */
  org: ReturnType<typeof makeOrgNamespace>;
  /** Operator-self namespace — `client.me.profile`, `client.me.sessions`, etc. Cross-org; no tenant context required. */
  me: ReturnType<typeof makeMeNamespace>;
  /** Studio surfaces — `client.studio.workflows.*` + `client.studio.dashboards.*`. */
  studio: ReturnType<typeof makeStudioNamespace>;
  /** Compute surfaces — `client.compute.llms.*`. */
  compute: ReturnType<typeof makeComputeNamespace>;
  /** Platform AI primitives — `client.ai.embed({ model?, input })`. */
  ai: ReturnType<typeof makeAiNamespace>;
  /** Realtime subscriptions — `client.realtime.subscribe()` (SSE). */
  realtime: ReturnType<typeof makeRealtimeNamespace>;
  /** Gate (Identity-Aware Kernel) — composed from `@k9o/gate`. Available when projectSlug is bound on the client. */
  readonly gate: GateClient;
  /** Kibo (Zero-Knowledge vault) — composed from `@k9o/kibo`. `client.kibo.vault.zkDeks.*` (F.5); project-scoped methods self-guard the project context. */
  readonly kibo: KiboClient;
  /** Extensions consumption — composed from `@k9o/extensions`. `client.extensions.extension(slug)` returns typed extension bindings. */
  extensions: ReturnType<typeof makeExtensionsBridge>;
  /** Bound config — exposed for advanced use (custom HTTP per-call). */
  readonly config: Readonly<HttpClientConfig>;
};

/**
 * Construct a `K9oClient` bound to the supplied gateway baseUrl + auth
 * + project context. Validates the baseUrl at construct time
 * — path-bearing baseUrls throw `K9O_INVALID_BASE_URL` synchronously.
 */
export function createClient(options: CreateClientOptions): K9oClient {
  const baseUrl = resolveBaseUrl(options.baseUrl, options.orgSlug);
  const config: HttpClientConfig = {
    baseUrl,
    apiKey: options.apiKey,
    projectSlug: options.projectSlug,
    orgSlug: options.orgSlug,
    fetch: options.fetch,
    defaultHeaders: options.defaultHeaders,
    retryConfig: options.retryConfig,
  };
  const gateBridge = makeGateBridge(config);
  return {
    from: makeFromFactory(config),
    projects: makeProjectsNamespace(config),
    storage: makeStorageNamespace(config),
    migrations: makeMigrationsNamespace(config),
    functions: makeFunctionsNamespace(config),
    policies: makePoliciesNamespace(config),
    audit: makeAuditNamespace(config),
    orgs: makeOrgsNamespace(config),
    org: makeOrgNamespace(config),
    me: makeMeNamespace(config),
    studio: makeStudioNamespace(config),
    compute: makeComputeNamespace(config),
    ai: makeAiNamespace(config),
    realtime: makeRealtimeNamespace(config),
    // gate is a proxy — null when projectSlug isn't bound; surfacing a
    // helpful K9O_MISSING_PROJECT_CONTEXT instead of a null deref when
    // the caller reaches for any gate method without project context.
    get gate() {
      if (gateBridge === null) return gateNotAvailable();
      return gateBridge;
    },
    extensions: makeExtensionsBridge(),
    kibo: createKiboClient(config),
    config: Object.freeze({ ...config }),
  };
}
