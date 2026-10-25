/**
 * Regional host resolution lives in `@k9o/gate` (which `@k9o/core` composes), so the Gate client and the core client
 * share one implementation of the probe and of the `Location` validation. See `packages/gate/src/region.ts`.
 */
export { resolveRegionalOrigin, regionalOriginFromLocation, type RegionConfig } from "@k9o/gate";
