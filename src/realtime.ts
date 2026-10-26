/**
 * Realtime Subscriptions SDK — `client.realtime.*`.
 *
 * Realtime Subscriptions ALL-LIVE primitive.
 *
 * `client.realtime.subscribe(topic, options?)` returns an async iterable
 * yielding `RealtimeEvent`s — the caller writes idiomatic
 * `for await (const event of client.realtime.subscribe(topic)) { ... }`.
 *
 * Transport: SSE over `GET /@<slug>/realtime/subscribe`. The gateway
 * serves no WebSocket upgrade and no durable replay, so neither is
 * offered; after an `event: resync` frame the client re-reads current
 * state from the data plane and resubscribes.
 *
 * Wire mapping (project-plane):
 *   - subscribe → GET  /@<slug>/realtime/subscribe?topic=<t>&filter=<jsonb>  (SSE)
 *
 * `filter` + RLS compose (filter narrows, RLS gates). Surfaces
 * K9O_INVALID_FILTER, K9O_SUBSCRIPTION_LIMIT_EXCEEDED and K9O_TIER_FEATURE_GATED.
 */

import { requestStream, type HttpClientConfig } from "./http.ts";
import { projectPath } from "./url-grammar.ts";
import { parseSseStream } from "./internal/sse.ts";

// ----------------------------------------------------------------------
// Topic catalogue 
// ----------------------------------------------------------------------

/**
 * The 6 closed subscription topic families . Concrete
 * topic strings carry a dynamic segment (collection name, resource id,
 * event family) — use `realtimeTopic.*` builders to construct them.
 */
export type RealtimeTopicFamily =
  | "collections"
  | "studio.workflows.runs"
  | "studio.queries.executed"
  | "studio.dashboards.refresh"
  | "forge.functions.invocations"
  | "audit.org";

/** A concrete topic string, e.g. `studio.dashboards.refresh.dsh_abc`. */
export type RealtimeTopic = string;

/**
 * Typed builders for the 6 topic families . Prefer these
 * over hand-built strings for compile-time family safety.
 */
export const realtimeTopic = {
  /** `collections.<collection>.*` — row insert / update / delete events. */
  collection(collection: string): RealtimeTopic {
    return `collections.${collection}.*`;
  },
  /** `studio.workflows.runs.*` — run started / step_changed / approval_pending / completed. */
  workflowRuns(): RealtimeTopic {
    return "studio.workflows.runs.*";
  },
  /** `studio.queries.executed.<query-id>` — query execute events. */
  queryExecuted(queryId: string): RealtimeTopic {
    return `studio.queries.executed.${queryId}`;
  },
  /** `studio.dashboards.refresh.<dashboard-id>` — widget data refresh. */
  dashboardRefresh(dashboardId: string): RealtimeTopic {
    return `studio.dashboards.refresh.${dashboardId}`;
  },
  /** `forge.functions.invocations.<function-id>` — invoked / completed / failed. */
  functionInvocations(functionId: string): RealtimeTopic {
    return `forge.functions.invocations.${functionId}`;
  },
  /** `audit.org.<event-family>` — org-plane audit events. */
  auditOrg(eventFamily: string): RealtimeTopic {
    return `audit.org.${eventFamily}`;
  },
} as const;

// ----------------------------------------------------------------------
// Event + filter shapes
// ----------------------------------------------------------------------

/** Per-topic filter predicate . */
export type RealtimeFilter = Record<string, unknown>;

/** A single realtime event, as the gateway frames it (wire spelling). */
export type RealtimeEvent<T = unknown> = {
  topic: RealtimeTopic;
  /** Event type within the topic family (e.g. `row_inserted`, `workflow.run.completed`). */
  eventType: string;
  payload: T;
  occurredAt: string;
};

export type SubscribeOptions = {
  filter?: RealtimeFilter;
  /** Abort the subscription (closes the underlying transport). */
  signal?: AbortSignal;
};

/**
 * A live subscription. It is itself an async iterable (`for await`) and
 * exposes `close()` for explicit teardown.
 */
export type RealtimeSubscription<T = unknown> = AsyncIterable<RealtimeEvent<T>> & {
  /** Stop the subscription + release the underlying transport. */
  close(): void;
};

function requireProjectSlug(config: HttpClientConfig): string {
  if (typeof config.projectSlug !== "string" || config.projectSlug.length === 0) {
    throw new Error("realtime operations require projectSlug bound on the client");
  }
  return config.projectSlug;
}

/** SSE transport — rides on fetch streaming. `resync` control frames are not events and are skipped. */
async function* sseTransport<T>(
  config: HttpClientConfig,
  topic: RealtimeTopic,
  options: SubscribeOptions,
  closed: { value: boolean },
): AsyncGenerator<RealtimeEvent<T>, void, void> {
  const slug = requireProjectSlug(config);
  const query: Record<string, string | number | boolean | undefined> = { topic };
  if (options.filter) query.filter = JSON.stringify(options.filter);
  const response = await requestStream(config, {
    method: "GET",
    path: projectPath(slug, "realtime/subscribe"),
    query,
    accept: "text/event-stream",
  });
  for await (const event of parseSseStream<RealtimeEvent<T>>(response.body as ReadableStream<Uint8Array>)) {
    if (closed.value || options.signal?.aborted) return;
    if (typeof (event as { eventType?: unknown }).eventType !== "string") continue;
    yield event;
  }
}

export function makeRealtimeNamespace(config: HttpClientConfig) {
  return {
    /**
     * Subscribe to a topic. Returns a `RealtimeSubscription` — an async
     * iterable of `RealtimeEvent`s over SSE.
     *
     * ```ts
     * const sub = client.realtime.subscribe(
     *   realtimeTopic.dashboardRefresh("dsh_abc"),
     * );
     * for await (const event of sub) {
     *   if (event.eventType === "dashboard.widget.data_refreshed") rerender(event.payload);
     * }
     * ```
     */
    subscribe<T = unknown>(topic: RealtimeTopic, options: SubscribeOptions = {}): RealtimeSubscription<T> {
      requireProjectSlug(config);
      const closed = { value: false };
      const iterate = (): AsyncGenerator<RealtimeEvent<T>, void, void> => sseTransport<T>(config, topic, options, closed);

      let active: AsyncGenerator<RealtimeEvent<T>, void, void> | null = null;
      return {
        [Symbol.asyncIterator]() {
          active = iterate();
          return active;
        },
        close() {
          closed.value = true;
          void active?.return(undefined);
        },
      };
    },
  };
}
