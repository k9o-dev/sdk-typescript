/**
 * URL grammar.
 *
 * Canonical URL shapes:
 *   - Member-plane (project-scoped): `<orgSlug>.api.k9o.io/@<projectSlug>/<sub-resource>/...`
 *   - Org-plane (org-scoped):        `<orgSlug>.api.k9o.io/<resource>/...`
 *   - Platform-plane (cross-org):    `api.k9o.io/discovery/...` + `api.k9o.io/auth/...` etc.
 *
 * The `baseUrl` passed to `createClient` is the gateway host root —
 * scheme + host (+ optional port). Path-bearing baseUrls
 * are rejected with `K9O_INVALID_BASE_URL`.
 *
 * The SDK constructs URLs by composing `baseUrl + path-from-builder`.
 * Per-resource SDK methods use the builders below to assemble their
 * `path` argument before handing to the HTTP client.
 */

import { KError } from "./kerror.ts";

/**
 * Validate a `baseUrl`. Returns the normalised form
 * (trailing-slash stripped) on success; throws `K9O_INVALID_BASE_URL`
 * on any violation.
 *
 * Accepted shapes:
 *   - `https://api.k9o.io`
 *   - `https://acme.api.k9o.io`
 *   - `http://localhost:8080`
 *   - `https://api.k9o.io:443`
 *
 * Rejected shapes:
 *   - path segments (`https://api.k9o.io/v2`)
 *   - missing scheme (`api.k9o.io`)
 *   - non-http(s) scheme (`wss://api.k9o.io`)
 *   - query / fragment (`https://api.k9o.io?x=1`)
 */
export function validateBaseUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new KError({
      code: "K9O_INVALID_BASE_URL",
      message: `baseUrl "${baseUrl}" is not a valid URL`,
      context: { baseUrl },
      recommendation: "Pass a scheme + host like `https://api.k9o.io` or `https://<orgSlug>.api.k9o.io`",
      status: null,
    });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new KError({
      code: "K9O_INVALID_BASE_URL",
      message: `baseUrl "${baseUrl}" uses unsupported scheme "${parsed.protocol}"; expected http: or https:`,
      context: { baseUrl, scheme: parsed.protocol },
      recommendation: "Use http:// or https://. WebSocket subscriptions are wired internally over SSE on the same host.",
      status: null,
    });
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new KError({
      code: "K9O_INVALID_BASE_URL",
      message: `baseUrl "${baseUrl}" must not contain a path segment; got "${parsed.pathname}"`,
      context: { baseUrl, path: parsed.pathname },
      recommendation: "Strip the path segment — pass host only. URL paths are composed by the SDK.",
      status: null,
    });
  }
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new KError({
      code: "K9O_INVALID_BASE_URL",
      message: `baseUrl "${baseUrl}" must not contain query or fragment`,
      context: { baseUrl, query: parsed.search, fragment: parsed.hash },
      recommendation: "Pass host only.",
      status: null,
    });
  }
  // Normalise — strip trailing slash so concatenation is predictable.
  const normalised = `${parsed.protocol}//${parsed.host}`;
  return normalised;
}

/**
 * The bare platform apex hosts org-subdomain derivation applies to. `api.k9o.io`
 * (production) and `api-staging.k9o.io` (staging) share the same
 * `<orgSlug>.<apex>` wire-routing scheme — confirmed live (conformance,
 * `k9o login` examples, staging demo configs all address orgs this way on
 * both). A THIRD apex here needs the same confirmation before joining this
 * set — never inferred from a hostname merely looking apex-shaped.
 */
const K9O_ORG_DERIVABLE_APEXES = new Set(["api.k9o.io", "api-staging.k9o.io"]);

/**
 * Resolve the effective baseUrl. `baseUrl` is
 * OPTIONAL — it defaults to the platform apex `https://api.k9o.io`. When the
 * (validated) host is a bare apex in `K9O_ORG_DERIVABLE_APEXES` and `orgSlug`
 * is supplied, the SDK composes the canonical org-subdomain wire root
 * `https://<orgSlug>.<apex>`. An explicit `<orgSlug>` subdomain, a
 * self-hosted / Sovereign host, or a dev host (anything not in that set)
 * passes through unchanged — `orgSlug` is intentionally NOT validated or
 * composed onto a non-apex host (fixed 2026-08-30: this used to silently
 * ignore `orgSlug` for `api-staging.k9o.io` too, not just genuine
 * self-hosted/custom hosts, since only the literal production apex string
 * was checked).
 */
export function resolveBaseUrl(baseUrl: string | undefined, orgSlug?: string): string {
  const validated = validateBaseUrl(baseUrl ?? "https://api.k9o.io");
  const parsed = new URL(validated);
  if (K9O_ORG_DERIVABLE_APEXES.has(parsed.hostname) && orgSlug) {
    validateSlug(orgSlug, "org");
    return `${parsed.protocol}//${orgSlug}.${parsed.hostname}`;
  }
  return validated;
}

/**
 * Slug format validator:
 *   `[a-z][a-z0-9-]{1,62}` and must not end with `-`.
 */
const SLUG_RE = /^[a-z][a-z0-9-]{1,62}$/;

export function validateSlug(slug: string, kind: "org" | "project"): void {
  if (!SLUG_RE.test(slug) || slug.endsWith("-")) {
    throw new KError({
      code: "K9O_INVALID_FIELD_VALUE",
      message: `${kind}Slug "${slug}" does not match required format ^[a-z][a-z0-9-]{1,62}$ (must not end with '-')`,
      context: { slug, kind },
      recommendation: `Pass a slug matching the format — lowercase letters / digits / hyphens; 2-63 chars; starts with a letter; does not end with hyphen.`,
      status: null,
    });
  }
}

/**
 * Build a project-scoped (member-plane) URL path per the URL grammar
 * E.g. `projectPath('member-portal', 'collections/posts/documents')`
 *      → `/@member-portal/collections/posts/documents`.
 *
 * The caller is responsible for normalising sub-resource components
 * (URL-encoding goes through the caller's path construction; this
 * helper handles only the prefix + slug shape).
 */
export function projectPath(projectSlug: string, subResource: string): string {
  validateSlug(projectSlug, "project");
  const cleaned = subResource.startsWith("/") ? subResource.slice(1) : subResource;
  return `/@${projectSlug}/${cleaned}`;
}

/**
 * Build an org-plane path. E.g. `orgPath('org')` → `/org`,
 * `orgPath('projects')` → `/projects`.
 */
export function orgPath(resource: string): string {
  const cleaned = resource.startsWith("/") ? resource.slice(1) : resource;
  return `/${cleaned}`;
}

/**
 * Build a platform-plane path (cross-org). E.g.
 * `platformPath('discovery/projects')` → `/discovery/projects`,
 * `platformPath('auth/sign-in')` → `/auth/sign-in`.
 *
 * Composes with the platform baseUrl (`https://api.k9o.io`) — not the
 * org-subdomain baseUrl.
 */
export function platformPath(resource: string): string {
  const cleaned = resource.startsWith("/") ? resource.slice(1) : resource;
  return `/${cleaned}`;
}
