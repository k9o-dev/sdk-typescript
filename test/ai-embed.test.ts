/** `client.ai.embed()` — URL, verb, body shape, bound-project guard, and that errors never echo the input. */

import { describe, expect, it } from "bun:test";
import { createClient } from "../src/index.ts";
import { KError } from "../src/kerror.ts";

type Captured = { url: string; method: string; body?: string };

function captureFetch(cap: Captured, response: unknown, status = 200): typeof globalThis.fetch {
  return ((async (input: RequestInfo | URL, init?: RequestInit) => {
    cap.url = typeof input === "string" ? input : input.toString();
    cap.method = init?.method as string;
    if (init?.body !== undefined) cap.body = String(init.body);
    return new Response(JSON.stringify(response), { status, headers: { "content-type": "application/json" } });
  }) as unknown) as typeof globalThis.fetch;
}

const OK = { data: { embeddings: [[0.1, 0.2]], model: "nomic-embed-text-v1.5", dimensions: 2 }, meta: {} };
const mk = (cap: Captured, response: unknown = OK, status = 200) =>
  createClient({ baseUrl: "https://acme.api.k9o.io", projectSlug: "member-portal", fetch: captureFetch(cap, response, status) });

describe("client.ai.embed", () => {
  it("POSTs /@<slug>/ai/embeddings and returns the vectors", async () => {
    const cap: Captured = { url: "", method: "" };
    const r = await mk(cap).ai.embed({ input: "hello" });
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://acme.api.k9o.io/@member-portal/ai/embeddings");
    expect(JSON.parse(cap.body!)).toEqual({ input: "hello" });
    expect(r.data.embeddings).toEqual([[0.1, 0.2]]);
    expect(r.data.dimensions).toBe(2);
  });

  it("sends an array input and a model exactly as given", async () => {
    const cap: Captured = { url: "", method: "" };
    await mk(cap).ai.embed({ model: "nomic-embed-text-v1.5", input: ["search_document: a", "search_document: b"] });
    expect(JSON.parse(cap.body!)).toEqual({ model: "nomic-embed-text-v1.5", input: ["search_document: a", "search_document: b"] });
  });

  it("omits `model` when not given (server default)", async () => {
    const cap: Captured = { url: "", method: "" };
    await mk(cap).ai.embed({ input: ["x"] });
    expect("model" in JSON.parse(cap.body!)).toBe(false);
  });

  it("requires a bound project", async () => {
    const c = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch({ url: "", method: "" }, OK) });
    await expect(c.ai.embed({ input: "x" })).rejects.toThrow(/projectSlug/);
  });

  it("surfaces the server's refusal as a KError without the input text", async () => {
    const cap: Captured = { url: "", method: "" };
    const err = { code: "K9O_MODEL_NOT_DECLARED", message: "model is not a declared embedding model", context: { declared: ["nomic-embed-text-v1.5"] }, recommendation: null };
    const secret = "the-secret-document-body";
    let caught: unknown;
    try {
      await mk(cap, err, 400).ai.embed({ model: "other", input: secret });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(KError);
    expect((caught as KError).code).toBe("K9O_MODEL_NOT_DECLARED");
    expect(JSON.stringify(caught)).not.toContain(secret);
  });
});
