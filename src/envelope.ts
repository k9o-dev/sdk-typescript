/**
 * Standard envelope + meta namespace types.
 *
 * The `meta` namespace surfaces structured per-namespace
 * accessors (cursor / subscription / idempotency / warnings / cost /
 * timing / context). The shapes here are advisory: gateway responses
 * carry `meta` as a `Record<string, unknown>`; typed accessor sugar is
 * applied at SDK boundaries that know the shape they're returning
 * (e.g. data-plane `select()` returns `{data, meta: { cursor, ... }}`
 * with `MetaCursor` typed).
 *
 * Callers can use `response.meta` as the unstructured wire shape OR
 * cast / narrow to the typed accessor when consuming a known surface
 * (e.g. `(response.meta as MetaWithCursor).cursor.next`).
 */

/**
 * The canonical envelope shape returned by every gateway endpoint
 * on success (2xx).
 */
export type Envelope<T> = {
  data: T;
  meta: Record<string, unknown>;
};

/**
 * Cursor pagination accessor. `next` is the opaque cursor
 * for the next page (null when no more); `totalCount` populated only
 * when the caller passes `?count=exact` (otherwise undefined).
 */
export type MetaCursor = {
  next: string | null;
  totalCount?: number;
};

/**
 * Subscription delivery metadata. `isInitial` is true on
 * the first batch of an initial-load subscription; false on subsequent
 * live deltas.
 */
export type MetaSubscription = {
  isInitial: boolean;
};

/**
 * Idempotency replay metadata. `replayed` is true when
 * the gateway recognised a previously-seen idempotency key and returned
 * the original response.
 */
export type MetaIdempotency = {
  replayed: boolean;
};

/**
 * Non-fatal warning shape. Surfaced on responses where
 * the operation succeeded but the caller should know about caveats
 * (e.g. tier-approaching-cap; deprecated field used).
 */
export type MetaWarning = {
  code: string;
  message: string;
};

/**
 * Cost metadata — per-dimension consumption attribution.
 * Field names (waypoints, storageGbHours, egress,
 * apiCalls, vaultOps, etc.). Dimensions are sparsely populated and values
 * may be scalars (e.g. `waypoints: 3`) or structured objects (e.g.
 * `egress: { gb, zone }`, `vaultOps: { encrypt, decrypt, ... }`), so the
 * shape is an open map keyed by dimension name. It is open-ended to absorb
 * future cost dimensions without SDK churn.
 */
export type MetaCost = Record<string, unknown>;

/**
 * Timing metadata. `totalMs` is the gateway-side wall-clock
 * for the request.
 */
export type MetaTiming = {
  totalMs: number;
};

/**
 * Request-correlation metadata. `requestId` is the
 * gateway-emitted trace ID; surface in error reports for support.
 */
export type MetaContext = {
  requestId: string;
};

/**
 * Convenience type for endpoints that return paginated lists. Composes
 * `Envelope<T>` with the cursor + optional warnings + context accessors.
 */
export type PaginatedEnvelope<T> = Envelope<T> & {
  meta: {
    cursor: MetaCursor;
    warnings?: ReadonlyArray<MetaWarning>;
    context?: MetaContext;
  };
};
