/**
 * User data streams SDK: `client.streams.*`.
 *
 * Wire mapping (project plane, `/@<slug>/data-streams/user`):
 *   - `create({ displayName, maxBytes, retentionSeconds? })` -> POST   /data-streams/user
 *   - `list()`                                               -> GET    /data-streams/user
 *   - `get(slug)`                                            -> GET    /data-streams/user/<slug>
 *   - `delete(slug)`                                         -> DELETE /data-streams/user/<slug>
 *   - `publish(slug, data, { subject? })`                    -> POST   /data-streams/user/<slug>/publish
 *   - `replay(slug, { fromSequence?, untilSequence?, limit? })` -> POST /data-streams/user/<slug>/replay
 *   - `subscribe(slug, { fromSequence?, signal? })`          -> GET    /data-streams/user/<slug>/subscribe (SSE)
 *
 * Publishing needs project admin; subscribe and replay need project admin or auditor. Errors surface as `KError`;
 * `K9O_STREAM_UNAVAILABLE` (503) means the stream data plane is not available in this deployment (or the project's
 * stream account is not provisioned yet), `K9O_STREAM_INVALID` means the request was refused (for example a bad subject).
 *
 * A sequence is the stream's own position number, sent as a string. `fromSequence` is exclusive: events after it.
 */

import { request, requestStream, type HttpClientConfig } from "./http.ts";
import { projectPath } from "./url-grammar.ts";
import type { Envelope } from "./envelope.ts";
import { parseSseFrames } from "./internal/sse.ts";

/** Error codes the stream routes return, besides the common ones. */
export const STREAM_ERROR_CODES = [
  "K9O_STREAM_UNAVAILABLE",
  "K9O_STREAM_INVALID",
  "K9O_STREAM_NOT_FOUND",
  "K9O_STREAM_LIMIT_EXCEEDED",
  "K9O_STREAM_STORAGE_ALLOTMENT_EXCEEDED",
] as const;

/** A user stream, as the gateway returns it. */
export type StreamRecord = {
  id: string;
  slug: string;
  projectId: string;
  displayName: string;
  subjectPrefix: string;
  region: string;
  retentionSeconds: number;
  retentionClass: string;
  maxBytes: number | null;
  status: string;
  createdAt: string;
  createdBy: string | null;
};

export type CreateStreamInput = {
  /** 1 to 80 characters. */
  displayName: string;
  /** Reserved storage ceiling in bytes (1, 2, 4, 8, 16, 32 or 64 GiB). */
  maxBytes: number;
  /** How long events are kept, in whole hours of seconds (3600 or more). Omit for the 24 hour default. */
  retentionSeconds?: number | undefined;
};

export type PublishOptions = {
  /** Routing suffix: up to 8 dot-separated tokens of `[a-z0-9_-]`, each 1 to 64 characters. */
  subject?: string | undefined;
};

export type PublishResult = { streamSlug: string; subject: string; bytes: number; accepted: boolean };

export type ReplayOptions = {
  /** Return events after this sequence (exclusive). */
  fromSequence?: number | string | undefined;
  /** Stop at this sequence. */
  untilSequence?: number | string | undefined;
  /** 1 to 10000; the gateway defaults to 100. */
  limit?: number | undefined;
};

/** One event on a stream. */
export type StreamEvent<T = unknown> = {
  /** The event's position in the stream. */
  sequence: string;
  /** The full subject the event was published under. */
  subject: string;
  /** The published payload. */
  data: T;
  publishedAt: string;
};

export type ReplayResult<T = unknown> = {
  streamSlug: string;
  events: ReadonlyArray<StreamEvent<T>>;
  /** The sequence to pass as `fromSequence` for the next page, or null when the stream is empty. */
  nextCursor: string | null;
  /** True when the page is full: there may be more events. */
  hasMore: boolean;
};

export type SubscribeStreamOptions = {
  /** Start after this sequence (exclusive). Omit to start from the beginning of the stream. */
  fromSequence?: number | string | undefined;
  /** Abort to end the subscription. */
  signal?: AbortSignal | undefined;
};

/** A live subscription: an async iterable of events with an explicit `close()`. */
export type StreamSubscription<T = unknown> = AsyncIterable<StreamEvent<T>> & {
  /** End the subscription and release the connection. */
  close(): void;
};

const DEFAULT_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30_000;

function requireProjectSlug(config: HttpClientConfig): string {
  if (typeof config.projectSlug !== "string" || config.projectSlug.length === 0) {
    throw new Error("streams operations require projectSlug bound on the client");
  }
  return config.projectSlug;
}

function streamPath(config: HttpClientConfig, slug: string, tail = ""): string {
  const project = requireProjectSlug(config);
  return projectPath(project, `data-streams/user${slug === "" ? "" : `/${encodeURIComponent(slug)}`}${tail}`);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

function isEvent(v: unknown): v is StreamEvent {
  return typeof v === "object" && v !== null && "data" in v;
}

/**
 * The tail loop. The gateway bounds each connection's lifetime and sends a `retry:` hint; when a connection ends, open the
 * next one after the last sequence received. Ends when `stop` aborts. A non-2xx answer (for example 503) throws.
 */
async function* tail<T>(
  config: HttpClientConfig,
  slug: string,
  from: string | undefined,
  stop: AbortSignal,
): AsyncGenerator<StreamEvent<T>, void, void> {
  let cursor = from;
  let delay = DEFAULT_RECONNECT_MS;
  while (!stop.aborted) {
    let response: Response;
    try {
      response = await requestStream(config, {
        method: "GET",
        path: streamPath(config, slug, "/subscribe"),
        query: cursor === undefined ? undefined : { fromSequence: cursor },
        accept: "text/event-stream",
        signal: stop,
      });
    } catch (e) {
      if (stop.aborted) return;
      throw e;
    }
    try {
      for await (const frame of parseSseFrames(response.body as ReadableStream<Uint8Array>)) {
        if (stop.aborted) return;
        if (frame.retry !== undefined) delay = Math.min(frame.retry, MAX_RECONNECT_MS);
        if (frame.data === null) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(frame.data);
        } catch {
          continue;
        }
        if (!isEvent(parsed)) continue;
        const sequence = frame.id ?? (parsed.sequence === undefined ? undefined : String(parsed.sequence));
        if (sequence !== undefined) cursor = sequence;
        yield { ...parsed, sequence: sequence ?? String(parsed.sequence ?? "") } as StreamEvent<T>;
      }
    } catch (e) {
      // An abort ends the loop; any other break in the connection is treated like the server closing it.
      if (stop.aborted) return;
      void e;
    }
    await sleep(delay, stop);
  }
}

export function makeStreamsNamespace(config: HttpClientConfig) {
  return {
    /** Create a stream. Needs project admin. */
    async create(input: CreateStreamInput): Promise<Envelope<StreamRecord>> {
      return request(config, { method: "POST", path: streamPath(config, ""), body: input });
    },

    /** List the project's active streams. */
    async list(): Promise<Envelope<ReadonlyArray<StreamRecord>>> {
      return request(config, { method: "GET", path: streamPath(config, "") });
    },

    /** Get a stream by slug. */
    async get(slug: string): Promise<Envelope<StreamRecord>> {
      return request(config, { method: "GET", path: streamPath(config, slug) });
    },

    /** Retire a stream. It reads as absent afterwards. Needs project admin. */
    async delete(slug: string): Promise<Envelope<{ slug: string; status: string }>> {
      return request(config, { method: "DELETE", path: streamPath(config, slug) });
    },

    /**
     * Append an event. `data` is any JSON value. Resolves once the gateway has accepted it (HTTP 202).
     * Needs project admin.
     */
    async publish(slug: string, data: unknown, options: PublishOptions = {}): Promise<Envelope<PublishResult>> {
      const body: { data: unknown; subject?: string } = { data: data === undefined ? null : data };
      if (options.subject !== undefined) body.subject = options.subject;
      return request(config, { method: "POST", path: streamPath(config, slug, "/publish"), body });
    },

    /** Read a bounded range of events. Needs project admin or auditor. */
    async replay<T = unknown>(slug: string, options: ReplayOptions = {}): Promise<Envelope<ReplayResult<T>>> {
      const body: ReplayOptions = {};
      if (options.fromSequence !== undefined) body.fromSequence = options.fromSequence;
      if (options.untilSequence !== undefined) body.untilSequence = options.untilSequence;
      if (options.limit !== undefined) body.limit = options.limit;
      return request(config, { method: "POST", path: streamPath(config, slug, "/replay"), body });
    },

    /**
     * Tail a stream live. Returns an async iterable of events; the connection reopens by itself from the last sequence
     * received whenever the server closes it. It ends when `signal` aborts or `close()` is called.
     * Needs project admin or auditor.
     *
     * ```ts
     * for await (const event of client.streams.subscribe("orders")) console.log(event.sequence, event.data);
     * ```
     */
    subscribe<T = unknown>(slug: string, options: SubscribeStreamOptions = {}): StreamSubscription<T> {
      requireProjectSlug(config);
      const own = new AbortController();
      const outer = options.signal;
      if (outer?.aborted) own.abort();
      else outer?.addEventListener("abort", () => own.abort(), { once: true });
      const from = options.fromSequence === undefined ? undefined : String(options.fromSequence);
      return {
        [Symbol.asyncIterator]() {
          const it = tail<T>(config, slug, from, own.signal);
          const finish = async (): Promise<IteratorResult<StreamEvent<T>>> => {
            own.abort();
            await it.return(undefined);
            return { done: true, value: undefined };
          };
          return {
            next: () => it.next(),
            return: finish,
            throw: async (err) => {
              own.abort();
              await it.return(undefined);
              throw err;
            },
          };
        },
        close() {
          own.abort();
        },
      };
    },
  };
}
