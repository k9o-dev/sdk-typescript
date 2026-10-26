/** `client.ai.generate()` — path, verb, body shape (prompt first, optional fields omitted), result and error mapping. */

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

const OK = {
  data: {
    modelId: "llama-3.1-8b",
    content: "Hello there",
    finishReason: "stop",
    usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
    usageType: "inference",
  },
  meta: {},
};
const mk = (cap: Captured, response: unknown = OK, status = 200) =>
  createClient({ baseUrl: "https://acme.api.k9o.io", projectSlug: "member-portal", fetch: captureFetch(cap, response, status) });

describe("client.ai.generate", () => {
  it("POSTs /@<slug>/ai/generate with only the prompt and parses the result", async () => {
    const cap: Captured = { url: "", method: "" };
    const r = await mk(cap).ai.generate("Say hello");
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://acme.api.k9o.io/@member-portal/ai/generate");
    expect(JSON.parse(cap.body!)).toEqual({ prompt: "Say hello" });
    expect(r.data.content).toBe("Hello there");
    expect(r.data.usage.totalTokens).toBe(5);
    expect(r.data.modelId).toBe("llama-3.1-8b");
  });

  it("passes the options through under the wire names", async () => {
    const cap: Captured = { url: "", method: "" };
    await mk(cap).ai.generate("p", { model: "m", maxTokens: 10, temperature: 0, usageType: "batch" });
    expect(JSON.parse(cap.body!)).toEqual({ prompt: "p", model: "m", maxTokens: 10, temperature: 0, usageType: "batch" });
  });

  it("omits options that are absent", async () => {
    const cap: Captured = { url: "", method: "" };
    await mk(cap).ai.generate("p", { temperature: 1 });
    expect(Object.keys(JSON.parse(cap.body!))).toEqual(["prompt", "temperature"]);
  });

  it("requires a bound project", async () => {
    const c = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch({ url: "", method: "" }, OK) });
    await expect(c.ai.generate("x")).rejects.toThrow(/projectSlug/);
  });

  it("maps the 400 no-default-model answer to a KError", async () => {
    const cap: Captured = { url: "", method: "" };
    const err = { code: "K9O_INVALID_FIELD_VALUE", message: "the org has no default LLM; pass model", context: {}, recommendation: null };
    const e = await mk(cap, err, 400).ai.generate("p").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(KError);
    expect((e as KError).code).toBe("K9O_INVALID_FIELD_VALUE");
  });

  it("maps the 501 outside-provider answer to K9O_NOT_IMPLEMENTED", async () => {
    const cap: Captured = { url: "", method: "" };
    const err = { code: "K9O_NOT_IMPLEMENTED", message: "External LLM provider is not configured", context: {}, recommendation: null };
    const e = await mk(cap, err, 501).ai.generate("p", { model: "gpt-x" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(KError);
    expect((e as KError).code).toBe("K9O_NOT_IMPLEMENTED");
  });
});
