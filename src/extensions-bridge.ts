/**
 * Pillar composition: `@k9o/core` ↔ `@k9o/extensions`.
 *
 * Re-exports the `k9o.extension(slug)` factory from `@k9o/extensions`.
 *
 * `@k9o/extensions` exports a `k9o` namespace with `extension(slug)`
 * factory returning typed bindings for Trailblazer/Anchor/Keystone
 * class extensions (baked in at SDK publish time). Circuit-class
 * (Long Tail) extensions use the install-time `k9o codegen` tool
 * path (a) OR raw HTTP / vendor-SDK fallback per path (b).
 *
 * The bridge re-exports the factory directly — it is config-free
 * (extension stubs do not require HTTP routing yet). Once per-method dispatch
 * ships, the bridge will thread baseUrl + auth into the extension runtime;
 * until then the re-export is a thin pass-through.
 */

import { k9o as extensionsNamespace, type ExtensionSlug, type Extension } from "@k9o/extensions";

export { extensionsNamespace, type ExtensionSlug, type Extension };

/**
 * Build the composed `client.extensions` namespace. Currently a thin
 * re-export of the `@k9o/extensions` `k9o.extension(slug)` factory.
 * Config-free for now; it will use the client HTTP config once runtime
 * dispatch ships.
 */
export function makeExtensionsBridge() {
  return {
    /** Resolve a typed extension instance by slug. See `@k9o/extensions` for the factory contract. */
    extension: extensionsNamespace.extension,
  };
}
