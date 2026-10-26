/**
 * Regional host resolution.
 *
 * A region-free org host `<org>.api.<rest>` (or `<org>.api-staging.<rest>`) redirects GET/HEAD only and REFUSES a
 * request that carries a body, an `Authorization` header or a cookie (`400 K9O_INVALID_REQUEST_SHAPE`,
 * `region_free_host_takes_no_credentials`), so credentials must go to `<org>.api-<rgn>.<rest>`. The client learns the
 * region with ONE unauthenticated `HEAD` to the configured host, takes the `308` `Location`, and caches the regional
 * origin.
 *
 * Nothing here knows an apex. The host comes from the configured baseUrl; `<rest>` is whatever follows the second
 * label, so a public-cloud, internal-apex, air-gapped or localhost deployment all work. Properties:
 *   - Only a host shaped `<org>.api.<rest>` / `<org>.api-staging.<rest>` is probed. A regional, single-label, IP,
 *     localhost or any other baseUrl is used exactly as given.
 *   - The probe carries NO credential and none of the configured default headers (they may hold one).
 *   - The `Location` is trusted only if it is `https`, has no userinfo/port, and its host is exactly the SAME org and
 *     SAME remainder with a 4-character region code appended to the second label. Anything else is ignored and the
 *     configured baseUrl stays, so a hostile redirect can never receive a credential.
 *   - Not a redirect, or any failure: the configured baseUrl stays and the server's own refusal, if any, is what the
 *     caller sees. A definite answer is cached for the life of the client's config; a network failure is not cached.
 */

import { parseApiHost } from "./url-grammar.ts";

/** The slice of a client config this module needs. */
export type RegionConfig = { baseUrl: string; fetch?: typeof globalThis.fetch | undefined };

const cache = new WeakMap<RegionConfig, Promise<string>>();

/** The regional origin a `Location` may name for `host`, or null if it is not exactly that. Pure. */
export function regionalOriginFromLocation(host: string, location: string, base: string): string | null {
  const from = parseApiHost(host);
  if (from === null || from.orgSlug === null || from.region !== null) return null;
  let u: URL;
  try {
    u = new URL(location, base);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username !== "" || u.password !== "" || u.port !== "") return null;
  const to = parseApiHost(u.hostname);
  if (to === null || to.region === null) return null;
  if (to.orgSlug !== from.orgSlug || to.family !== from.family || to.apex !== from.apex) return null;
  return `https://${u.hostname}`;
}

async function probe(config: RegionConfig): Promise<{ origin: string; cacheable: boolean }> {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const configured = config.baseUrl;
  if (typeof fetchImpl !== "function") return { origin: configured, cacheable: false };
  let host: string;
  try {
    host = new URL(configured).hostname;
  } catch {
    return { origin: configured, cacheable: true };
  }
  const parsedHost = parseApiHost(host);
  if (parsedHost === null || parsedHost.orgSlug === null || parsedHost.region !== null) return { origin: configured, cacheable: true };
  try {
    const res = await fetchImpl(`${configured.replace(/\/+$/, "")}/`, {
      method: "HEAD",
      redirect: "manual",
      headers: { accept: "*/*" },
    } as Parameters<typeof fetchImpl>[1]);
    if (res.status === 308) {
      const loc = res.headers.get("location");
      const origin = loc === null ? null : regionalOriginFromLocation(host, loc, configured);
      if (origin !== null) return { origin, cacheable: true };
    }
    return { origin: configured, cacheable: true };
  } catch {
    return { origin: configured, cacheable: false };
  }
}

/** The origin requests for this client go to: the cached regional origin once learned, else the configured baseUrl. */
export function resolveRegionalOrigin(config: RegionConfig): Promise<string> {
  const hit = cache.get(config);
  if (hit !== undefined) return hit;
  const p = probe(config).then((r) => {
    if (!r.cacheable) cache.delete(config);
    return r.origin;
  });
  cache.set(config, p);
  return p;
}
