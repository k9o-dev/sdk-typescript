/**
 * Project lifecycle SDK methods — `client.projects.*`.
 *
 * Wire mapping per gateway routes (`services/gateway/src/routes/projects-crud.ts` +
 * `discovery.ts`):
 *   - `client.projects.list()`           → GET    /projects
 *   - `client.projects.create({...})`    → POST   /projects
 *   - `client.projects.get(slug)`        → GET    /projects/<projectSlug>
 *   - `client.projects.update(slug,...)` → PATCH  /projects/<projectSlug>
 *
 * All four operations are org-plane: the client needs an org context
 * (an `orgSlug` or a bearer token that carries one). Input property
 * names are the gateway's body property names.
 *
 * All methods throw KError on non-2xx.
 */

import { request, type HttpClientConfig } from "./http.ts";
import { orgPath, validateSlug } from "./url-grammar.ts";
import type { Envelope } from "./envelope.ts";

/**
 * Project record, as the gateway returns it. Field names are passed through unchanged.
 * Lists and creates also carry `capabilities`; lists add `accessLevel`.
 */
export type Project = {
  /** `proj_<base62>`. */
  id: string;
  slug: string;
  orgId: string;
  displayName: string;
  description: string | null;
  productScope: string;
  /** Region code of the project's data. */
  region: string;
  custodyMode: "PLATFORM_MANAGED" | "SKR" | "BYOK" | "HYOK";
  /** `provisioning` while the project is being set up, then `active`; other values may appear. */
  status: string;
  /** The caller's role on the project, or `null` when the caller is not a member. */
  role: string | null;
  deletedAt: string | null;
  createdAt: string;
  /** Soft-delete retention window in days. */
  softDeleteRetentionDays: number;
  /** Regions the project's data may live in; `[region]` for a single-region project. */
  residencySet: ReadonlyArray<string>;
  /** `"strict"`, or `{ fallbackRegion }` when a catch-all region is set. */
  residencyPolicy: "strict" | { fallbackRegion: string };
  processingContexts: ReadonlyArray<string>;
  /** Present on list and create responses: what the caller may write. */
  capabilities?: { authFlows: { write: boolean }; authProviders: { write: boolean } } | undefined;
  /** Present on list responses: `member` or `locked`. */
  accessLevel?: "member" | "locked" | undefined;
};

/**
 * Project-creation input.
 */
export type CreateProjectInput = {
  /** Display name (1 to 128 characters). Required. */
  displayName: string;
  /** URL slug (lowercase); the gateway derives one from `displayName` when omitted. */
  slug?: string | undefined;
  productScope?: "core" | "kibo" | undefined;
  /** Region code of the project's data. */
  region?: string | undefined;
  defaultProjectRegion?: string | undefined;
  custodyMode?: "PLATFORM_MANAGED" | "SKR" | "BYOK" | "HYOK" | undefined;
  processingContexts?: ReadonlyArray<string> | undefined;
  execSeamConfined?: boolean | undefined;
  showroomVertical?: string | undefined;
  persona?: string | undefined;
  showroomLocale?: { code: string; currency: string; moneyScale: number } | undefined;
  /** Makes a retried create return the first result instead of a second project. */
  idempotencyKey?: string | undefined;
};

/**
 * Project-update patch.
 */
export type UpdateProjectInput = {
  slug?: string | undefined;
  displayName?: string | undefined;
  description?: string | null | undefined;
  region?: string | undefined;
  productScope?: string | undefined;
  softDeleteRetentionDays?: number | undefined;
  processingContexts?: ReadonlyArray<string> | undefined;
};

/**
 * Factory — produces the `client.projects.*` namespace bound to the
 * supplied config.
 */
export function makeProjectsNamespace(config: HttpClientConfig) {
  return {
    /**
     * List projects accessible to the caller. Requires authenticated
     * session; results are scoped by RBAC.
     */
    async list(): Promise<Envelope<ReadonlyArray<Project>>> {
      return request<ReadonlyArray<Project>>(config, {
        method: "GET",
        path: orgPath("projects"),
      });
    },

    /**
     * Create a new project under the caller's active org.
     */
    async create(input: CreateProjectInput): Promise<Envelope<Project>> {
      if (input.slug !== undefined) validateSlug(input.slug, "project");
      return request<Project>(config, {
        method: "POST",
        path: orgPath("projects"),
        body: input,
      });
    },

    /**
     * Get a project by slug. Returns the project record + meta.
     */
    async get(slug: string): Promise<Envelope<Project>> {
      validateSlug(slug, "project");
      return request<Project>(config, {
        method: "GET",
        path: orgPath(`projects/${slug}`),
      });
    },

    /**
     * Update a project's mutable fields.
     */
    async update(slug: string, patch: UpdateProjectInput): Promise<Envelope<Project>> {
      validateSlug(slug, "project");
      return request<Project>(config, {
        method: "PATCH",
        path: orgPath(`projects/${slug}`),
        body: patch,
      });
    },
  };
}
