import { describe, expect, test } from "bun:test";
import { createClient, KError, translateNamedParams } from "../src/index.ts";

type Call = { url: URL; method: string; body: unknown };
function client() {
  const calls: Call[] = [];
  const fetch = (async (url: string | URL, init?: RequestInit) => {
    if (init?.method !== "HEAD") {
      calls.push({ url: new URL(String(url)), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    }
    return new Response(JSON.stringify({ data: [{ id: "u1" }], meta: { rawQuery: { intent: "read", rowCount: 1 } } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  const c = createClient({ baseUrl: "https://acme.api.k9o.io", apiKey: "k", projectSlug: "demo", fetch });
  return { c, calls };
}

describe("translateNamedParams (shared vectors)", () => {
  const ok = (sql: string, named: Record<string, unknown>, out: string, params: unknown[]) =>
    expect(translateNamedParams(sql, named)).toEqual({ sql: out, params });
  test("1 role", () => ok("SELECT * FROM users WHERE data->>'role' = :role", { role: "admin" }, "SELECT * FROM users WHERE data->>'role' = $1", ["admin"]));
  test("2 reuse", () => ok("SELECT :a, :b, :a", { a: 1, b: 2 }, "SELECT $1, $2, $1", [1, 2]));
  test("3 quotes and casts", () =>
    ok(`SELECT ':not_a_param', ":also_not", x::int FROM t WHERE y = :y`, { y: true }, `SELECT ':not_a_param', ":also_not", x::int FROM t WHERE y = $1`, [true]));
  test("4 escaped quote and line comment", () =>
    ok("SELECT 'it''s :no' , :v -- :comment\nFROM t", { v: null }, "SELECT 'it''s :no' , $1 -- :comment\nFROM t", [null]));
  test("5 nested block comment", () => ok("SELECT /* :c /* :d */ :e */ :f", { f: 1 }, "SELECT /* :c /* :d */ :e */ $1", [1]));
  test("6 dollar quoting", () => ok("SELECT $$ :x $$, $q$ :y $q$, :z", { z: "s" }, "SELECT $$ :x $$, $q$ :y $q$, $1", ["s"]));
  test("7 array slice and a:b", () => ok("SELECT arr[1:2], a:b, :n", { n: 5 }, "SELECT arr[1:2], a:b, $1", [5]));
  test("8 missing", () => expect(() => translateNamedParams("SELECT :missing", {})).toThrow(/:missing/));
  test("9 non-bindable value", () => {
    try {
      translateNamedParams("SELECT :a", { a: {} });
      throw new Error("no throw");
    } catch (e) {
      expect(e).toBeInstanceOf(KError);
      expect((e as KError).code).toBe("K9O_INVALID_FIELD_VALUE");
    }
  });
});

describe("client.query", () => {
  test("named params: posts rewritten SQL and positional values", async () => {
    const { c, calls } = client();
    const r = await c.query("SELECT * FROM users WHERE data->>'role' = :role", { role: "admin" });
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url.pathname).toBe("/@demo/query");
    expect(calls[0]!.body).toEqual({ sql: "SELECT * FROM users WHERE data->>'role' = $1", params: ["admin"] });
    expect(r.data).toEqual([{ id: "u1" }]);
  });
  test("10 list params sent unchanged", async () => {
    const { c, calls } = client();
    await c.query("SELECT $1", ["x"]);
    expect(calls[0]!.body).toEqual({ sql: "SELECT $1", params: ["x"] });
  });
  test("11 no params: no params key", async () => {
    const { c, calls } = client();
    await c.query("SELECT 1");
    expect(calls[0]!.body).toEqual({ sql: "SELECT 1" });
  });
  test("a bad list value throws before any request", async () => {
    const { c, calls } = client();
    await expect(c.query("SELECT $1", [{} as never])).rejects.toMatchObject({ code: "K9O_INVALID_FIELD_VALUE" });
    expect(calls.length).toBe(0);
  });
});

describe("select().textSearch / vectorSearch", () => {
  test("textSearch wire shape, defaults omitted", async () => {
    const { c, calls } = client();
    await c.from("articles").select().textSearch("body", "climate resilience").limit(5);
    const q = calls[0]!.url.searchParams;
    expect(q.get("textSearch")).toBe("body:climate resilience");
    expect(q.get("textSearchLanguage")).toBeNull();
    expect(q.get("textSearchType")).toBeNull();
    expect(q.get("limit")).toBe("5");
  });
  test("textSearch language and type", async () => {
    const { c, calls } = client();
    await c.from("articles").select().textSearch("body", "a b", { language: "french", type: "websearch" });
    const q = calls[0]!.url.searchParams;
    expect(q.get("textSearchLanguage")).toBe("french");
    expect(q.get("textSearchType")).toBe("websearch");
  });
  test("vectorSearch wire shape", async () => {
    const { c, calls } = client();
    await c.from("articles").select().vectorSearch("embedding", [0.1, 0.2], { metric: "dot", limit: 10 });
    const q = calls[0]!.url.searchParams;
    expect(q.get("vectorSearch")).toBe("embedding:[0.1,0.2]");
    expect(q.get("vectorMetric")).toBe("dot");
    expect(q.get("vectorLimit")).toBe("10");
  });
  test("validation errors throw K9O_INVALID_FIELD_VALUE", () => {
    const { c } = client();
    const s = c.from("articles").select();
    expect(() => s.textSearch("bad col", "x")).toThrow(KError);
    expect(() => s.textSearch("body", "")).toThrow(KError);
    expect(() => s.vectorSearch("embedding", [])).toThrow(KError);
    expect(() => s.vectorSearch("embedding", [1], { limit: 1001 })).toThrow(KError);
    expect(() => s.vectorSearch("embedding", [1], { metric: "x" as never })).toThrow(KError);
  });
});

describe("client.search", () => {
  test("full-text over one column, paged", async () => {
    const { c, calls } = client();
    const r = await c.search("articles", { column: "body", q: "climate resilience", language: "french", limit: 5 });
    const q = calls[0]!.url.searchParams;
    expect(calls[0]!.url.pathname).toBe("/@demo/data/articles");
    expect(q.get("textSearch")).toBe("body:climate resilience");
    expect(q.get("textSearchLanguage")).toBe("french");
    expect(q.get("limit")).toBe("5");
    expect(r.data).toEqual([{ id: "u1" }]);
  });
  test("a bad column throws before any request", async () => {
    const { c, calls } = client();
    await expect(c.search("articles", { column: "bad col", q: "x" })).rejects.toMatchObject({ code: "K9O_INVALID_FIELD_VALUE" });
    expect(calls.length).toBe(0);
  });
});
