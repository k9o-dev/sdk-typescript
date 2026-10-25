/**
 * Project lifecycle SDK methods — `client.projects.*`.
 *
 * Wire mapping per gateway routes (`services/gateway/src/routes/projects-crud.ts` +
 * `discovery.ts`):
 *   - `client.projects.list()`           → GET    /projects
 *   - `client.projects.create({...})`    → POST   /projects
 *   - `client.projects.get(slug)`        → GET    /@<projectSlug>/project
 *   - `client.projects.update(slug,...)` → PATCH  /@<projectSlug>/project
 *
 * The `list` + `create` operations operate org-plane and require
 * `orgSlug` to be bound on the client (or the bearer token to carry
 * an org context). The `get` + `update` operations
 * operate member-plane and use the project slug.
 *
 * Per: all methods throw KError on non-2xx.
 */

import { request, type HttpClientConfig } from "./http.ts";
import { orgPath, projectPath, validateSlug } from "./url-grammar.ts";
import type { Envelope } from "./envelope.ts";

/**
 * Project shape. Fields are typed per the canonical shape;
 * the gateway may return additional fields that this type doesn't
 * narrow — those are accessible via `as unknown as` widening.
 */
export type Project = {
  /** `proj_<base62>`. */
  id: string;
  slug: string;
  name: string;
  custodyMode: "managed" | "byok" | "hyok";
  createdAt: string;
  updatedAt: string | null;
  orgId: string;
};

/**
 * Project-creation input.
 */
export type CreateProjectInput = {
  slug: string;
  name: string;
  custodyMode?: "managed" | "byok" | "hyok" | undefined;
};

/**
 * Project-update patch.
 */
export type UpdateProjectInput = {
  name?: string;
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
      validateSlug(input.slug, "project");
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
        path: projectPath(slug, "project"),
      });
    },

    /**
     * Update a project's mutable fields.
     */
    async update(slug: string, patch: UpdateProjectInput): Promise<Envelope<Project>> {
      validateSlug(slug, "project");
      return request<Project>(config, {
        method: "PATCH",
        path: projectPath(slug, "project"),
        body: patch,
      });
    },
  };
}
