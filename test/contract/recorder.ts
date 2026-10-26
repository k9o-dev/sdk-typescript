/**
 * A client whose network is a recorder: every request the SDK sends is captured (method, path, query, JSON body) and
 * answered with an empty success envelope. The contract test calls each documented SDK method through it and compares what
 * was actually sent against the gateway's OpenAPI.
 */
import { createClient, type K9oClient } from "../../src/index.ts";

export type Sent = { method: string; path: string; query: string[]; body: unknown };

export function recordingClient(): { client: K9oClient; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    } else if (init?.body !== undefined) {
      body = "<non-json body>";
    }
    // The client probes the origin (HEAD /) to resolve a regional host; that is not an API call.
    if ((init?.method ?? "GET") === "HEAD" && url.pathname === "/") return new Response(null, { status: 200 });
    sent.push({ method: String(init?.method ?? "GET"), path: url.pathname, query: [...url.searchParams.keys()], body });
    return new Response(JSON.stringify({ data: {}, meta: {} }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  const client = createClient({
    baseUrl: "https://acme.api.k9o.io",
    projectSlug: "demo-app",
    apiKey: "k9o_test",
    fetch: fetchImpl,
    retryConfig: { maxRetries: 0 },
  } as never);
  return { client, sent };
}
