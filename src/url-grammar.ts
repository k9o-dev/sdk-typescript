/**
 * URL grammar.
 *
 * Canonical URL shapes:
 *   - Member-plane (project-scoped): `<orgSlug>.api.<apex>/@<projectSlug>/<sub-resource>/...`
 *   - Org-plane (org-scoped):        `<orgSlug>.api.<apex>/<resource>/...`
 *   - Platform-plane (cross-org):    `api.<apex>/discovery/...` + `api.<apex>/auth/...` etc.
 *
 * `<apex>` is whatever the deployment uses (public cloud, internal, air-gapped, localhost);
 * the SDK takes the host from the baseUrl it is given and never matches it against a list.
 *
 * The `baseUrl` passed to `createClient` is the gateway host root —
 * scheme + host (+ optional port) Path-bearing baseUrls
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

/** The convenience default when the caller passes no baseUrl. A default value only: never used to parse a host. */
export const DEFAULT_BASE_URL = "https://api.k9o.io";

/** The structure of a gateway API host, read from the host itself. */
export type ApiHost = {
  /** First label of an org host (`acme` in `acme.api.corp.internal`); null for a platform host (`api.corp.internal`). */
  orgSlug: string | null;
  /** `api` or `api-staging`: the label that marks a gateway host. */
  family: "api" | "api-staging";
  /** 4-character region code when the host is regional (`api-de01`), else null (region-free). */
  region: string | null;
  /** Everything after the gateway label (`corp.internal`, `k9o.io`): the apex, never matched against a list. */
  apex: string;
};

const API_LABEL = /^(api|api-staging)(?:-([a-z]{2}\d{2}))?$/;

/**
 * Read the org slug and region out of a gateway host without knowing its apex. The gateway label is `api` or
 * `api-staging`, optionally followed by `-<rgn>`; the label before it is the org slug and whatever follows it is the
 * apex. Returns null for any other shape (localhost, an IP, a single-label host, a host with no gateway label), which
 * callers use exactly as given.
 */
export function parseApiHost(host: string): ApiHost | null {
  const labels = host.toLowerCase().split(".");
  if (labels.some((l) => l.length === 0)) return null;
  const mk = (gatewayLabel: string, orgSlug: string | null, rest: string[]): ApiHost | null => {
    const m = API_LABEL.exec(gatewayLabel);
    if (m === null || rest.length === 0) return null;
    return { orgSlug, family: m[1] as "api" | "api-staging", region: m[2] ?? null, apex: rest.join(".") };
  };
  // Org host first: `<org>.<api[-rgn]>.<apex>`.
  if (labels.length >= 3 && SLUG_RE.test(labels[0]!) && !labels[0]!.endsWith("-") && API_LABEL.test(labels[1]!)) {
    return mk(labels[1]!, labels[0]!, labels.slice(2));
  }
  // Platform host: `api.<apex>`.
  if (labels.length >= 2 && API_LABEL.test(labels[0]!)) return mk(labels[0]!, null, labels.slice(1));
  return null;
}

/**
 * Resolve the effective baseUrl. `baseUrl` is OPTIONAL: omitted, it defaults to {@link DEFAULT_BASE_URL} (the public
 * cloud, a convenience only). When the (validated) host is a platform host (`api.<apex>` or `api-staging.<apex>`, any
 * apex) and `orgSlug` is supplied, the canonical org host `<orgSlug>.<host>` is composed. Any other host (an org host
 * already, an internal or air-gapped host, localhost) passes through unchanged; `orgSlug` is then only sent as a header.
 */
export function resolveBaseUrl(baseUrl: string | undefined, orgSlug?: string): string {
  const validated = validateBaseUrl(baseUrl ?? DEFAULT_BASE_URL);
  const parsed = new URL(validated);
  const host = parseApiHost(parsed.hostname);
  if (host !== null && host.orgSlug === null && host.region === null && orgSlug) {
    validateSlug(orgSlug, "org");
    return `${parsed.protocol}//${orgSlug}.${parsed.host}`;
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
