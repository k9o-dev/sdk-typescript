import { describe, expect, it } from "bun:test";
import { createClient, KError, type StreamEvent } from "../src/index.ts";

type Seen = { url: string; method: string; body?: string; signal?: AbortSignal | null };

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data, meta: {} }), { status, headers: { "content-type": "application/json" } });

function sse(text: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function frame(seq: number, data: unknown): string {
  const ev = { sequence: String(seq), subject: "k9o.x.user.pstr_1._", data, publishedAt: "2026-10-26T10:00:00.000Z" };
  return `id: ${seq}\ndata: ${JSON.stringify(ev)}\n\n`;
}

function client(handler: (seen: Seen, n: number) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // The client probes the origin (HEAD /) to resolve a regional host; that is not an API call.
    if (init?.method === "HEAD") return new Response(null, { status: 200 });
    seen.push({
      url: String(input),
      method: String(init?.method),
      ...(init?.body !== undefined ? { body: String(init.body) } : {}),
      signal: init?.signal ?? null,
    });
    return handler(seen[seen.length - 1]!, seen.length);
  }) as unknown as typeof globalThis.fetch;
  return { c: createClient({ baseUrl: "https://acme.api.k9o.io", projectSlug: "portal", apiKey: "k", fetch: fetchImpl }), seen };
}

const BASE = "https://acme.api.k9o.io/@portal/data-streams/user";

describe("client.streams control plane", () => {
  it("create, list, get, delete use the user stream routes", async () => {
    const { c, seen } = client(() => ok({}));
    await c.streams.create({ displayName: "Orders", maxBytes: 1073741824 });
    await c.streams.list();
    await c.streams.get("orders");
    await c.streams.delete("orders");
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      `POST ${BASE}`,
      `GET ${BASE}`,
      `GET ${BASE}/orders`,
      `DELETE ${BASE}/orders`,
    ]);
    expect(JSON.parse(seen[0]!.body!)).toEqual({ displayName: "Orders", maxBytes: 1073741824 });
  });
});

describe("client.streams.publish", () => {
  it("sends { data, subject } exactly", async () => {
    const { c, seen } = client(() => ok({ streamSlug: "orders", subject: "s", bytes: 8, accepted: true }, 202));
    const r = await c.streams.publish("orders", { id: 1 }, { subject: "eu.new" });
    expect(seen[0]!.url).toBe(`${BASE}/orders/publish`);
    expect(JSON.parse(seen[0]!.body!)).toEqual({ data: { id: 1 }, subject: "eu.new" });
    expect(r.data.accepted).toBe(true);
  });

  it("omits subject when not given and keeps falsy data", async () => {
    const { c, seen } = client(() => ok({}, 202));
    await c.streams.publish("orders", 0);
    expect(JSON.parse(seen[0]!.body!)).toEqual({ data: 0 });
  });

  it("maps 503 K9O_STREAM_UNAVAILABLE to a typed KError", async () => {
    const { c } = client(
      () =>
        new Response(
          JSON.stringify({ code: "K9O_STREAM_UNAVAILABLE", message: "The Pulse Stream data plane is not yet available in this deployment.", context: {} }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
    );
    const err = await c.streams.publish("orders", {}).catch((e) => e);
    expect(err).toBeInstanceOf(KError);
    expect(err.code).toBe("K9O_STREAM_UNAVAILABLE");
    expect(err.status).toBe(503);
    expect(err.message).toContain("not yet available");
  });
});

describe("client.streams.replay", () => {
  it("sends only the given range fields", async () => {
    const { c, seen } = client(() => ok({ streamSlug: "orders", events: [], nextCursor: null, hasMore: false }));
    await c.streams.replay("orders", { fromSequence: 10, untilSequence: "50", limit: 25 });
    await c.streams.replay("orders");
    expect(seen[0]!.url).toBe(`${BASE}/orders/replay`);
    expect(JSON.parse(seen[0]!.body!)).toEqual({ fromSequence: 10, untilSequence: "50", limit: 25 });
    expect(JSON.parse(seen[1]!.body!)).toEqual({});
  });
});

describe("client.streams.subscribe", () => {
  it("reconnects from the last sequence when the server closes the connection", async () => {
    const { c, seen } = client((_s, n) => {
      if (n === 1) return sse(`retry: 5\n:ok\n\n${frame(1, { a: 1 })}${frame(2, { a: 2 })}`);
      return sse(`retry: 5\n:ok\n\n${frame(3, { a: 3 })}`);
    });
    const got: StreamEvent[] = [];
    for await (const e of c.streams.subscribe("orders", { fromSequence: 0 })) {
      got.push(e);
      if (got.length === 3) break;
    }
    expect(got.map((e) => e.sequence)).toEqual(["1", "2", "3"]);
    expect(got[2]!.data).toEqual({ a: 3 });
    expect(seen).toHaveLength(2);
    expect(seen[0]!.url).toBe(`${BASE}/orders/subscribe?fromSequence=0`);
    expect(seen[1]!.url).toBe(`${BASE}/orders/subscribe?fromSequence=2`);
  });

  it("starts without fromSequence when none is given", async () => {
    const { c, seen } = client(() => sse(frame(1, "x")));
    for await (const _ of c.streams.subscribe("orders")) break;
    expect(seen[0]!.url).toBe(`${BASE}/orders/subscribe`);
  });

  it("ends when the signal aborts while waiting to reconnect", async () => {
    const stop = new AbortController();
    const { c, seen } = client(() => sse(`retry: 60000\n${frame(1, "x")}`));
    const got: string[] = [];
    const done = (async () => {
      for await (const e of c.streams.subscribe("orders", { signal: stop.signal })) {
        got.push(e.sequence);
        setTimeout(() => stop.abort(), 10);
      }
    })();
    await done;
    expect(got).toEqual(["1"]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.signal).toBeTruthy();
  });

  it("ends when the signal is already aborted, without a request", async () => {
    const stop = new AbortController();
    stop.abort();
    const { c, seen } = client(() => sse(""));
    for await (const _ of c.streams.subscribe("orders", { signal: stop.signal })) throw new Error("unexpected event");
    expect(seen).toHaveLength(0);
  });

  it("close() ends the iteration", async () => {
    const { c } = client(() => sse(`retry: 60000\n${frame(1, "x")}`));
    const sub = c.streams.subscribe("orders");
    const got: string[] = [];
    for await (const e of sub) {
      got.push(e.sequence);
      sub.close();
    }
    expect(got).toEqual(["1"]);
  });

  it("surfaces 503 on open as a KError", async () => {
    const { c } = client(
      () =>
        new Response(JSON.stringify({ code: "K9O_STREAM_UNAVAILABLE", message: "Pulse Stream data plane unavailable", context: {} }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
    );
    const err = await (async () => {
      for await (const _ of c.streams.subscribe("orders")) return null;
      return null;
    })().catch((e) => e);
    expect(err).toBeInstanceOf(KError);
    expect(err.code).toBe("K9O_STREAM_UNAVAILABLE");
  });
});
