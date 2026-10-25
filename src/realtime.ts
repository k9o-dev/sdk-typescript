/**
 * Realtime Subscriptions SDK — `client.realtime.*`.
 *
 * Realtime Subscriptions ALL-LIVE primitive.
 *
 * `client.realtime.subscribe(topic, options?)` returns an async iterable
 * yielding `RealtimeEvent`s — the caller writes idiomatic
 * `for await (const event of client.realtime.subscribe(topic)) { ... }`.
 *
 * Per `feedback_sdk_abstracted_primitive_default_to_richer_interaction.md`
 * +: the SDK chooses the transport (WebSocket primary → SSE
 * → poll), transparently. SPLIT (polling) is the SDK-internal fallback
 * when WebSocket / SSE are unavailable — NOT a consumer-side design
 * choice. The consumer sees one uniform async iterable regardless.
 *
 * Wire mapping (project-plane;):
 *   - subscribe → GET  /@<slug>/realtime/subscribe?topic=<t>&filter=<jsonb> (WS/SSE upgrade)
 *   - replay    → POST /@<slug>/realtime/replay  { topic, fromSequence, untilSequence?, limit? }
 *
 * Per, `filter` + RLS compose (filter narrows, RLS gates).
 * Per, surfaces no new codes — reuses K9O_INVALID_FILTER +
 * K9O_SUBSCRIPTION_LIMIT_EXCEEDED + K9O_TIER_FEATURE_GATED.
 */

import { request, requestStream, type HttpClientConfig } from "./http.ts";
import { projectPath } from "./url-grammar.ts";
import { KError } from "./kerror.ts";
import type { Envelope } from "./envelope.ts";
import { parseSseStream } from "./internal/sse.ts";

// ----------------------------------------------------------------------
// Topic catalogue (closed 6-family enum)
// ----------------------------------------------------------------------

/**
 * The 6 closed subscription topic families. Concrete
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
 * Typed builders for the 6 topic families. Prefer these
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

/** Per-topic filter predicate (vocabulary). */
export type RealtimeFilter = Record<string, unknown>;

/** A single realtime event delivered on a subscription. */
export type RealtimeEvent<T = unknown> = {
  topic: RealtimeTopic;
  /** Event type within the topic family (e.g. `row_inserted`, `workflow.run.completed`). */
  type: string;
  /** Monotonic sequence number — use as `fromSequence` for replay catch-up. */
  sequence: number;
  payload: T;
  occurredAt: string;
};

export type SubscribeOptions = {
  filter?: RealtimeFilter;
  /** Abort the subscription (closes the underlying transport). */
  signal?: AbortSignal;
  /**
   * Force a transport instead of the WebSocket → SSE → poll cascade.
   * Mainly for tests + constrained runtimes. Omit for production —
   * the SDK picks the richest available transport.
   */
  transport?: RealtimeTransportKind;
  /** Poll-transport interval in ms (default 2000). Only used when polling. */
  pollIntervalMs?: number;
};

export type RealtimeTransportKind = "websocket" | "sse" | "poll";

/**
 * A live subscription. It is itself an async iterable (`for await`) and
 * exposes `close()` for explicit teardown + `transport` for diagnostics.
 */
export type RealtimeSubscription<T = unknown> = AsyncIterable<RealtimeEvent<T>> & {
  /** Stop the subscription + release the underlying transport. */
  close(): void;
  /** The transport actually selected (post-fallback). */
  readonly transport: RealtimeTransportKind;
};

export type ReplayInput = {
  topic: RealtimeTopic;
  filter?: RealtimeFilter;
  fromSequence: number;
  untilSequence?: number;
  limit?: number;
};

function requireProjectSlug(config: HttpClientConfig): string {
  if (typeof config.projectSlug !== "string" || config.projectSlug.length === 0) {
    throw new Error("realtime operations require projectSlug bound on the client");
  }
  return config.projectSlug;
}

/** Pick the richest transport available in this runtime. */
function selectTransport(forced?: RealtimeTransportKind): RealtimeTransportKind {
  if (forced) return forced;
  if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "function") return "websocket";
  // SSE rides on fetch streaming, which the http layer already requires.
  return "sse";
}

/** Convert an http(s) baseUrl to a ws(s) URL for the WebSocket transport. */
function toWebSocketUrl(baseUrl: string, path: string, query: Record<string, string>): string {
  const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const wsBase = trimmed.replace(/^http/, "ws");
  const qs = new URLSearchParams(query).toString();
  return `${wsBase}${path}${qs ? `?${qs}` : ""}`;
}

/** WebSocket transport — primary. Bridges socket → async queue. */
async function* websocketTransport<T>(
  config: HttpClientConfig,
  topic: RealtimeTopic,
  options: SubscribeOptions,
  closed: { value: boolean },
): AsyncGenerator<RealtimeEvent<T>, void, void> {
  const slug = requireProjectSlug(config);
  const query: Record<string, string> = { topic };
  if (options.filter) query.filter = JSON.stringify(options.filter);
  if (config.apiKey) query.access_token = config.apiKey; // WS can't set Authorization header
  const url = toWebSocketUrl(config.baseUrl, projectPath(slug, "realtime/subscribe"), query);
  const WS = (globalThis as { WebSocket: new (url: string) => WebSocket }).WebSocket;
  const socket = new WS(url);

  const queue: RealtimeEvent<T>[] = [];
  let resolveNext: (() => void) | null = null;
  let socketClosed = false;
  let socketError: Error | null = null;

  const wake = () => {
    if (resolveNext) {
      resolveNext();
      resolveNext = null;
    }
  };
  socket.onmessage = (ev: MessageEvent) => {
    try {
      queue.push(JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)) as RealtimeEvent<T>);
    } catch {
      /* ignore malformed frame */
    }
    wake();
  };
  socket.onerror = () => {
    socketError = new Error("realtime websocket transport error");
    wake();
  };
  socket.onclose = () => {
    socketClosed = true;
    wake();
  };
  options.signal?.addEventListener("abort", () => socket.close());

  try {
    while (!closed.value) {
      if (queue.length > 0) {
        yield queue.shift() as RealtimeEvent<T>;
        continue;
      }
      if (socketClosed) {
        if (socketError) throw socketError;
        return;
      }
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
      });
    }
  } finally {
    try {
      socket.close();
    } catch {
      /* already closed */
    }
  }
}

/** SSE transport — fallback. Rides on fetch streaming. */
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
    yield event;
  }
}

/** Poll transport — last-resort fallback (SPLIT, SDK-internal). */
async function* pollTransport<T>(
  config: HttpClientConfig,
  topic: RealtimeTopic,
  options: SubscribeOptions,
  closed: { value: boolean },
): AsyncGenerator<RealtimeEvent<T>, void, void> {
  const slug = requireProjectSlug(config);
  const interval = options.pollIntervalMs ?? 2000;
  let cursor = 0;
  while (!closed.value && !options.signal?.aborted) {
    const { data } = await request<ReadonlyArray<RealtimeEvent<T>>>(config, {
      method: "POST",
      path: projectPath(slug, "realtime/replay"),
      body: { topic, filter: options.filter, fromSequence: cursor },
    });
    for (const event of data ?? []) {
      if (closed.value || options.signal?.aborted) return;
      cursor = Math.max(cursor, event.sequence + 1);
      yield event;
    }
    if (closed.value || options.signal?.aborted) return;
    await new Promise<void>((resolve) => setTimeout(resolve, interval));
  }
}

export function makeRealtimeNamespace(config: HttpClientConfig) {
  return {
    /**
     * Subscribe to a topic. Returns a `RealtimeSubscription` — an async
     * iterable of `RealtimeEvent`s. The SDK selects the richest available
     * transport (WebSocket → SSE → poll); the caller's
     * `for await` loop is transport-agnostic.
     *
     * ```ts
     * const sub = client.realtime.subscribe(
     *   realtimeTopic.dashboardRefresh("dsh_abc"),
     * );
     * for await (const event of sub) {
     *   if (event.type === "dashboard.widget.data_refreshed") rerender(event.payload);
     * }
     * ```
     */
    subscribe<T = unknown>(topic: RealtimeTopic, options: SubscribeOptions = {}): RealtimeSubscription<T> {
      requireProjectSlug(config);
      const transport = selectTransport(options.transport);
      const closed = { value: false };

      const iterate = (): AsyncGenerator<RealtimeEvent<T>, void, void> => {
        switch (transport) {
          case "websocket":
            return websocketTransport<T>(config, topic, options, closed);
          case "poll":
            return pollTransport<T>(config, topic, options, closed);
          case "sse":
          default:
            return sseTransport<T>(config, topic, options, closed);
        }
      };

      let active: AsyncGenerator<RealtimeEvent<T>, void, void> | null = null;
      return {
        transport,
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

    /**
     * One-shot historical replay — catch up on missed
     * events from `fromSequence`. Capped at 10k events server-side;
     * paginate via the returned events' `sequence`. Use the highest
     * `sequence` you've seen as the next `fromSequence`.
     */
    async replay<T = unknown>(input: ReplayInput): Promise<Envelope<ReadonlyArray<RealtimeEvent<T>>>> {
      const slug = requireProjectSlug(config);
      if (!Number.isInteger(input.fromSequence) || input.fromSequence < 0) {
        throw new KError({
          code: "K9O_INVALID_FILTER",
          message: "replay fromSequence must be a non-negative integer",
          context: { fromSequence: input.fromSequence },
          recommendation: "Pass the highest sequence number you have already observed (or 0 to replay from the start).",
        });
      }
      return request(config, {
        method: "POST",
        path: projectPath(slug, "realtime/replay"),
        body: {
          topic: input.topic,
          filter: input.filter,
          fromSequence: input.fromSequence,
          untilSequence: input.untilSequence,
          limit: input.limit,
        },
      });
    },
  };
}
