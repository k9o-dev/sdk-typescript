import type { CallEntry } from "./calls.ts";

/** subscribe is an SSE read that reopens until stopped: abort it once the first request is out. */
async function subscribeOnce(c: any, options: Record<string, unknown>): Promise<void> {
  const stop = new AbortController();
  const sub = c.streams.subscribe("orders", { ...options, signal: stop.signal });
  setTimeout(() => stop.abort(), 20);
  for await (const _ of sub) {
    /* the recording client answers with no events */
  }
}

export const CALLS_STREAMS: CallEntry[] = [
  { id: "streams.create", call: (c) => c.streams.create({ displayName: "Orders", maxBytes: 1073741824, retentionSeconds: 86400 }) },
  { id: "streams.list", call: (c) => c.streams.list() },
  { id: "streams.get", call: (c) => c.streams.get("orders") },
  { id: "streams.delete", call: (c) => c.streams.delete("orders") },
  { id: "streams.publish", call: (c) => c.streams.publish("orders", { id: 1 }, { subject: "eu.new" }) },
  { id: "streams.replay", call: (c) => c.streams.replay("orders", { fromSequence: 10, untilSequence: 50, limit: 25 }) },
  { id: "streams.subscribe", call: (c) => subscribeOnce(c, { fromSequence: 5 }) },
];
