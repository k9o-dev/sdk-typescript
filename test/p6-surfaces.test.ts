/**
 * Tests for the P6 surface families:
 *   - client.studio.workflows.*
 *   - client.studio.dashboards.*
 *   - client.compute.llms.* + client.org.defaultLLM
 *   - client.realtime.subscribe() + replay()
 *
 * Verifies URL composition + HTTP method against the cemented routes +
 * the realtime async-iterable abstraction (SSE + poll transports).
 */

import { describe, expect, it } from "bun:test";
import { createClient, realtimeTopic, type RealtimeEvent, type LLMStreamChunk } from "../src/index.ts";

type CapturedRequest = { url: string; method: string; body?: string };

function captureFetch(captured: CapturedRequest, response: unknown = { data: null, meta: {} }, status = 200): typeof globalThis.fetch {
  return ((async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.url = typeof input === "string" ? input : input.toString();
    captured.method = init?.method as string;
    if (init?.body !== undefined) captured.body = String(init.body);
    return new Response(JSON.stringify(response), { status, headers: { "content-type": "application/json" } });
  }) as unknown) as typeof globalThis.fetch;
}

/** Build a fetch that returns an SSE byte stream from the given lines. */
function sseFetch(captured: CapturedRequest, sseText: string): typeof globalThis.fetch {
  return ((async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.url = typeof input === "string" ? input : input.toString();
    captured.method = init?.method as string;
    if (init?.body !== undefined) captured.body = String(init.body);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseText));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown) as typeof globalThis.fetch;
}

const PROJ = { baseUrl: "https://acme.api.k9o.io", projectSlug: "portal" };

describe("client.studio.workflows", () => {
  it("list GETs /@portal/workflows", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const c = createClient({ ...PROJ, fetch: captureFetch(cap, { data: [], meta: {} }) });
    await c.studio.workflows.list();
    expect(cap.method).toBe("GET");
    expect(cap.url).toBe("https://acme.api.k9o.io/@portal/workflows");
  });

  it("list composes filters", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const c = createClient({ ...PROJ, fetch: captureFetch(cap, { data: [], meta: {} }) });
    await c.studio.workflows.list({ status: "active", triggerType: "manual", limit: 10 });
    expect(cap.url).toBe("https://acme.api.k9o.io/@portal/workflows?status=active&triggerType=manual&limit=10");
  });

  it("create POSTs /@portal/workflows with body", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const c = createClient({ ...PROJ, fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await c.studio.workflows.create({
      name: "onboard", triggerType: "manual", triggerConfig: {},
      actions: [{ index: 0, action_type: "send_notification", config: {} }],
    });
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://acme.api.k9o.io/@portal/workflows");
    expect(cap.body).toContain("send_notification");
  });

  it("read / update / delete address /@portal/workflows/<id>", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const c = createClient({ ...PROJ, fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await c.studio.workflows.read("wfl_x");
    expect(cap.url).toBe("https://acme.api.k9o.io/@portal/workflows/wfl_x");
    await c.studio.workflows.update("wfl_x", { status: "archived" });
    expect(cap.method).toBe("PATCH");
    await c.studio.workflows.delete("wfl_x");
    expect(cap.method).toBe("DELETE");
  });

  it("trigger POSTs /@portal/workflows/<id>/runs", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const c = createClient({ ...PROJ, fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await c.studio.workflows.trigger("wfl_x", { foo: "bar" });
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://acme.api.k9o.io/@portal/workflows/wfl_x/runs");
    expect(cap.body).toContain("bar");
  });

  it("runs.list / runs.read / runs.cancel address the runs sub-path", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const c = createClient({ ...PROJ, fetch: captureFetch(cap, { data: [], meta: {} }) });
    await c.studio.workflows.runs.list("wfl_x", { status: "running" });
    expect(cap.url).toBe("https://acme.api.k9o.io/@portal/workflows/wfl_x/runs?status=running");
    await c.studio.workflows.runs.read("wfl_x", "wfr_y");
    expect(cap.url).toBe("https://acme.api.k9o.io/@portal/workflows/wfl_x/runs/wfr_y");
    await c.studio.workflows.runs.cancel("wfl_x", "wfr_y");
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://acme.api.k9o.io/@portal/workflows/wfl_x/runs/wfr_y/cancel");
  });
});

describe("client.studio.dashboards", () => {
  it("CRUD + pin/unpin address the right routes", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const c = createClient({ ...PROJ, fetch: captureFetch(cap, { data: {}, meta: {} }) });
    await c.studio.dashboards.list();
    expect(cap.url).toBe("https://acme.api.k9o.io/@portal/dashboards");
    await c.studio.dashboards.create({ name: "ops" });
    expect(cap.method).toBe("POST");
    await c.studio.dashboards.read("dsh_x");
    expect(cap.url).toBe("https://acme.api.k9o.io/@portal/dashboards/dsh_x");
    await c.studio.dashboards.pin("dsh_x");
    expect(cap.url).toBe("https://acme.api.k9o.io/@portal/dashboards/dsh_x/pin");
    await c.studio.dashboards.unpin("dsh_x");
    expect(cap.url).toBe("https://acme.api.k9o.io/@portal/dashboards/dsh_x/unpin");
  });
});

describe("client.compute.llms", () => {
  it("list / read address /@portal/compute/llms", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const c = createClient({ ...PROJ, fetch: captureFetch(cap, { data: [], meta: {} }) });
    await c.compute.llms.list({ modality: "embeddings" });
    expect(cap.url).toBe("https://acme.api.k9o.io/@portal/compute/llms?modality=embeddings");
    await c.compute.llms.read("gpt-4o");
    expect(cap.url).toBe("https://acme.api.k9o.io/@portal/compute/llms/gpt-4o");
  });

  it("invoke POSTs /@portal/compute/llms/<id>/invoke", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const c = createClient({ ...PROJ, fetch: captureFetch(cap, { data: { completion: "hi", tokensUsed: 2, latencyMs: 9 }, meta: {} }) });
    const { data } = await c.compute.llms.invoke("mistral-7b", { prompt: "hello", params: { maxTokens: 16 } });
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://acme.api.k9o.io/@portal/compute/llms/mistral-7b/invoke");
    expect(cap.body).toContain("hello");
    expect(data.completion).toBe("hi");
  });

  it("invokeStream yields parsed SSE chunks until [DONE]", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const sse =
      `data: ${JSON.stringify({ delta: "Hel" })}\n\n` +
      `data: ${JSON.stringify({ delta: "lo", done: true, tokensUsed: 1 })}\n\n` +
      `data: [DONE]\n\n`;
    const c = createClient({ ...PROJ, fetch: sseFetch(cap, sse) });
    const chunks: LLMStreamChunk[] = [];
    for await (const chunk of c.compute.llms.invokeStream("gpt-4o", { prompt: "hi" })) {
      chunks.push(chunk);
    }
    expect(cap.url).toBe("https://acme.api.k9o.io/@portal/compute/llms/gpt-4o/invoke-stream");
    expect(chunks.map((x) => x.delta).join("")).toBe("Hello");
    expect(chunks[1]?.done).toBe(true);
  });
});

describe("client.org.defaultLLM", () => {
  it("get GETs /org/default-llm; set PATCHes it", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const c = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(cap, { data: "mistral-7b", meta: {} }) });
    await c.org.defaultLLM.get();
    expect(cap.url).toBe("https://acme.api.k9o.io/org/default-llm");
    await c.org.defaultLLM.set({ modelId: "claude-3-5-sonnet" });
    expect(cap.method).toBe("PATCH");
    expect(cap.body).toContain("claude-3-5-sonnet");
  });
});

describe("client.realtime", () => {
  it("topic builders produce the 6 closed families", () => {
    expect(realtimeTopic.collection("orders")).toBe("collections.orders.*");
    expect(realtimeTopic.workflowRuns()).toBe("studio.workflows.runs.*");
    expect(realtimeTopic.dashboardRefresh("dsh_x")).toBe("studio.dashboards.refresh.dsh_x");
    expect(realtimeTopic.functionInvocations("fn_x")).toBe("forge.functions.invocations.fn_x");
    expect(realtimeTopic.auditOrg("role_granted")).toBe("audit.org.role_granted");
  });

  it("replay POSTs /@portal/realtime/replay with sequence cursor", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const c = createClient({ ...PROJ, fetch: captureFetch(cap, { data: [], meta: {} }) });
    await c.realtime.replay({ topic: realtimeTopic.workflowRuns(), fromSequence: 42, limit: 100 });
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://acme.api.k9o.io/@portal/realtime/replay");
    expect(cap.body).toContain("42");
  });

  it("replay rejects negative fromSequence with K9O_INVALID_FILTER", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const c = createClient({ ...PROJ, fetch: captureFetch(cap) });
    await expect(
      c.realtime.replay({ topic: realtimeTopic.workflowRuns(), fromSequence: -1 }),
    ).rejects.toMatchObject({ code: "K9O_INVALID_FILTER" });
  });

  it("subscribe via SSE transport yields events as an async iterable", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const ev1: RealtimeEvent = { topic: "collections.orders.*", type: "row_inserted", sequence: 1, payload: { id: 1 }, occurredAt: "t1" };
    const ev2: RealtimeEvent = { topic: "collections.orders.*", type: "row_updated", sequence: 2, payload: { id: 1 }, occurredAt: "t2" };
    const sse = `data: ${JSON.stringify(ev1)}\n\ndata: ${JSON.stringify(ev2)}\n\n`;
    const c = createClient({ ...PROJ, fetch: sseFetch(cap, sse) });
    const sub = c.realtime.subscribe(realtimeTopic.collection("orders"), { transport: "sse" });
    expect(sub.transport).toBe("sse");
    const seen: RealtimeEvent[] = [];
    for await (const e of sub) seen.push(e);
    expect(cap.url).toBe("https://acme.api.k9o.io/@portal/realtime/subscribe?topic=collections.orders.*");
    expect(seen.map((e) => e.type)).toEqual(["row_inserted", "row_updated"]);
  });

  it("subscribe via poll transport replays then can be closed", async () => {
    const cap: CapturedRequest = { url: "", method: "" };
    const ev: RealtimeEvent = { topic: "studio.workflows.runs.*", type: "workflow.run.completed", sequence: 5, payload: {}, occurredAt: "t" };
    const c = createClient({ ...PROJ, fetch: captureFetch(cap, { data: [ev], meta: {} }) });
    const sub = c.realtime.subscribe(realtimeTopic.workflowRuns(), { transport: "poll", pollIntervalMs: 5 });
    expect(sub.transport).toBe("poll");
    const seen: RealtimeEvent[] = [];
    for await (const e of sub) {
      seen.push(e);
      break; // break terminates the generator (calls .return())
    }
    expect(cap.url).toBe("https://acme.api.k9o.io/@portal/realtime/replay");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.type).toBe("workflow.run.completed");
  });
});
