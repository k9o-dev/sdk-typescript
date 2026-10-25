/**
 * Org lifecycle SDK — `client.orgs.*`.
 *
 * Backed by the gateway orgs routes.
 *
 * Wire mapping (all org-plane / platform-plane):
 *   - `list()`                    → GET    /orgs
 *   - `get(orgSlug)`              → GET    /orgs/<orgSlug>
 *   - `restore(orgId)`            → POST   /orgs/<orgId>/restore
 *   - `current()`                 → GET    /org
 *
 * The `current()` endpoint returns the org bound to the caller's session
 * context (via `x-k9o-org-slug` header or token claim). `get` addresses an
 * explicit org by its **slug** (slug-first management grammar) for
 * cross-org admin scenarios; most callers reach for `current()`.
 * `restore` is the one exception — it stays keyed by `orgId`, because a
 * soft-deleted org's slug is tombstoned and may have been reassigned.
 *
 *: org listing is scoped by the caller's accessible orgs
 * (most callers see exactly one — their own). Org creation is not available
 * through the SDK yet; `client.orgs.create()` will be added once sign-up
 * is exposed as an API).
 */

import { request, type HttpClientConfig } from "./http.ts";
import { orgPath, validateSlug } from "./url-grammar.ts";
import type { Envelope } from "./envelope.ts";

export type Org = {
  /** `org_<base62>`. */
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended" | "soft-deleted";
  createdAt: string;
  updatedAt: string | null;
};

export function makeOrgsNamespace(config: HttpClientConfig) {
  return {
    /** List orgs accessible to the caller. */
    async list(): Promise<Envelope<ReadonlyArray<Org>>> {
      return request(config, {
        method: "GET",
        path: orgPath("orgs"),
      });
    },

    /** Get a single org by slug. */
    async get(orgSlug: string): Promise<Envelope<Org>> {
      validateSlug(orgSlug, "org");
      return request(config, {
        method: "GET",
        path: orgPath(`orgs/${encodeURIComponent(orgSlug)}`),
      });
    },

    /** Restore a soft-deleted org. */
    async restore(orgId: string): Promise<Envelope<Org>> {
      return request(config, {
        method: "POST",
        path: orgPath(`orgs/${encodeURIComponent(orgId)}/restore`),
      });
    },

    /** Get the org bound to the caller's current session context. */
    async current(): Promise<Envelope<Org>> {
      return request(config, {
        method: "GET",
        path: orgPath("org"),
      });
    },
  };
}
