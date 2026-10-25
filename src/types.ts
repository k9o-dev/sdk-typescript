/**
 * Cross-cutting type shapes for `@k9o/core`.
 *
 * Per-resource shapes (Project, Migration, Function, etc.) live in their
 * respective module (`projects.ts`, `migrations.ts`, etc.) and are
 * re-exported from `index.ts`.
 *
 * This module contains primitives that span multiple resources +
 * client-construction types.
 */

/**
 * Options accepted by `createClient`.
 *
 * Recommended:
 *   - `apiKey` — bearer token for default auth (per-call override is supported)
 *   - `orgSlug` — current org context; sent as `x-k9o-org-slug` header AND used
 *     to derive the canonical org-subdomain wire URL when `baseUrl` is the
 *     default apex (see `baseUrl` below)
 *   - `projectSlug` — current project context; sent as `x-k9o-project-slug` header;
 *     also folded into URL builders for member-plane resources via the
 *     `projectPath()` helper at call sites
 *
 * Optional:
 *   - `baseUrl` — gateway host root (scheme + host; no path). **Optional**;
 *     defaults to the platform apex `https://api.k9o.io`.
 *     When it is the bare apex and `orgSlug` is set, the SDK composes the
 *     canonical org subdomain `https://<orgSlug>.api.k9o.io`. Pass an explicit host to override — an explicit `<orgSlug>` subdomain,
 *     or a self-hosted / Sovereign-Control host, or a dev host — used as-is.
 *   - `fetch` — custom fetch implementation (defaults to global)
 *   - `retryConfig` — retry/backoff config (reserved; currently ships single-attempt)
 *   - `defaultHeaders` — headers merged into every request
 */
export type CreateClientOptions = {
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  orgSlug?: string | undefined;
  projectSlug?: string | undefined;
  fetch?: typeof globalThis.fetch | undefined;
  retryConfig?: RetryConfig | undefined;
  defaultHeaders?: Record<string, string> | undefined;
};

/**
 * Retry config. The type is reserved; the HTTP client currently makes a
 * single attempt per request and does not yet honour this config.
 */
export type RetryConfig = {
  maxRetries: number;
  backoff: "exponential" | "linear" | "none";
  /** Initial delay in ms; default 100. */
  initialDelayMs?: number;
  /** Maximum delay cap in ms; default 5000. */
  maxDelayMs?: number;
};

/**
 * Comparison operators for the filter vocabulary.
 *
 * Supabase-style `?<col>=<op>.<value>` query parameter syntax; multiple
 * filters compose as AND.
 */
export type FilterOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "notIn"
  | "like"
  | "ilike"
  | "is";
