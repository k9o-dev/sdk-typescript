/**
 * Pillar composition: `@k9o/core` ↔ `@k9o/gate`.
 *
 * `@k9o/core` composes `@k9o/gate` as the `client.gate` namespace on
 * the K9oClient, sharing the same `baseUrl` + `projectSlug` config.
 *
 * `@k9o/gate` remains independently importable for Auth0-parity
 * standalone deployments (Trojan Horse motion); the bridge here is the
 * composition path when the caller imports `@k9o/core` and wants the
 * full platform surface.
 *
 * Mode defaults to `native` for the composition path — Native is the
 * mode that pairs with the broader Kilimanjaro billing model per
 * `@k9o/gate/mode.ts`. Standalone customers should import
 * `@k9o/gate` directly and call `createGateClient({ mode: 'standalone', ... })`.
 *
 * KError vs GateError alignment is still open.
 * Until then both error types remain shape-compatible (`code` /
 * `message` / `context` / `recommendation` fields are identical),
 * and caller code that narrows on `error.code` works against either.
 */

import { createGateClient, type GateClient } from "@k9o/gate";
import type { HttpClientConfig } from "./http.ts";
import { KError } from "./kerror.ts";

/**
 * Build the composed `client.gate` namespace bound to the K9oClient's
 * baseUrl + projectSlug. Requires `projectSlug` to be set on the
 * client config — gate operations are inherently project-scoped per
 * URL grammar.
 *
 * Returns `null` when projectSlug is not bound — the K9oClient may be
 * constructed for org-plane operations only (e.g. `client.orgs.list()`
 * or `client.projects.create()`), in which case gate operations are
 * not available until a per-project client is constructed.
 */
export function makeGateBridge(config: HttpClientConfig): GateClient | null {
  if (typeof config.projectSlug !== "string" || config.projectSlug.length === 0) {
    return null;
  }
  // Spread optional fields only when defined — GateConfig's partnerToken
  // + fetch are non-optional-undefined under exactOptionalPropertyTypes.
  return createGateClient({
    mode: "native",
    baseUrl: config.baseUrl,
    projectSlug: config.projectSlug,
    ...(config.apiKey !== undefined ? { partnerToken: config.apiKey } : {}),
    ...(config.fetch !== undefined ? { fetch: config.fetch } : {}),
  });
}

/**
 * Throw a helpful error when `client.gate` is accessed but projectSlug
 * is not bound. Wraps the null-return from `makeGateBridge` so callers
 * get a typed `K9O_MISSING_PROJECT_CONTEXT` rather than a null deref.
 */
export function gateNotAvailable(): never {
  throw new KError({
    code: "K9O_MISSING_PROJECT_CONTEXT",
    message: "client.gate requires projectSlug bound on the createClient options",
    context: {},
    recommendation: "Pass `projectSlug` in createClient options. For multi-project apps, construct one client per project context.",
  });
}
