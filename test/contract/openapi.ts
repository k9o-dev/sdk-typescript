/**
 * Reads the gateway's emitted OpenAPI (`services/gateway/openapi.json`) and answers two questions about a request an SDK
 * actually sent: does the route exist, and does the body fit the schema the gateway declares for it.
 *
 * The OpenAPI is not yet complete: a write route can declare no body at all. For those the contract test falls back to a
 * body contract written in the test itself (see `calls.ts`), so a missing declaration never lets a wrong body through.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Json = Record<string, unknown>;

export type BodySchema = {
  required: string[];
  /** null: the gateway accepts any property (no `properties` declared, or additionalProperties is true). */
  properties: string[] | null;
};

export type Operation = {
  method: string;
  /** OpenAPI path template, e.g. `/@{projectSlug}/functions/{name}`. */
  template: string;
  /** null: the route declares no request body. */
  body: BodySchema | null;
  /** Names of the query parameters the route declares. */
  query: string[];
};

const SPEC_PATH = resolve(import.meta.dir, "../../../../services/gateway/openapi.json");

let spec: Json | null = null;
let ops: { op: Operation; re: RegExp }[] | null = null;

function load(): Json {
  spec ??= JSON.parse(readFileSync(SPEC_PATH, "utf8")) as Json;
  return spec;
}

function deref(node: unknown): Json {
  let cur = node as Json;
  for (let i = 0; i < 20 && typeof cur?.["$ref"] === "string"; i++) {
    const ref = cur["$ref"] as string;
    let target: unknown = load();
    for (const part of ref.replace(/^#\//, "").split("/")) target = (target as Json)[part];
    cur = target as Json;
  }
  return cur ?? {};
}

/** Flatten allOf/oneOf/anyOf-free object schemas to {required, properties}. */
function summarise(schemaNode: unknown): BodySchema {
  const s = deref(schemaNode);
  const required = new Set<string>(Array.isArray(s["required"]) ? (s["required"] as string[]) : []);
  let props: Set<string> | null = s["properties"] ? new Set(Object.keys(s["properties"] as Json)) : null;
  let open = s["additionalProperties"] === true;
  for (const part of Array.isArray(s["allOf"]) ? (s["allOf"] as unknown[]) : []) {
    const sub = summarise(part);
    sub.required.forEach((r) => required.add(r));
    if (sub.properties === null) open = true;
    else (props ??= new Set()), sub.properties.forEach((p) => props!.add(p));
  }
  if (Array.isArray(s["oneOf"]) || Array.isArray(s["anyOf"])) open = true; // a union: do not guess which branch
  return { required: [...required], properties: open || props === null ? null : [...props] };
}

function index(): { op: Operation; re: RegExp }[] {
  if (ops) return ops;
  const out: { op: Operation; re: RegExp }[] = [];
  for (const [template, item] of Object.entries(load()["paths"] as Json)) {
    for (const [method, raw] of Object.entries(item as Json)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const o = raw as Json;
      const content = (deref(o["requestBody"])["content"] ?? {}) as Json;
      const json = (content["application/json"] ?? Object.values(content)[0]) as Json | undefined;
      const query = (Array.isArray(o["parameters"]) ? (o["parameters"] as unknown[]) : [])
        .map(deref)
        .filter((p) => p["in"] === "query")
        .map((p) => String(p["name"]));
      const re = new RegExp("^" + template.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+") + "$");
      out.push({ op: { method: method.toUpperCase(), template, body: json?.["schema"] ? summarise(json["schema"]) : null, query }, re });
    }
  }
  // Prefer the most specific template: fewer path parameters first, so `/a/b` beats `/a/{x}`.
  out.sort((a, b) => (a.op.template.match(/\{/g)?.length ?? 0) - (b.op.template.match(/\{/g)?.length ?? 0));
  ops = out;
  return out;
}

/** The operation serving `method path`, or undefined when the gateway has no such route. */
export function findOperation(method: string, path: string): Operation | undefined {
  return index().find((e) => e.op.method === method.toUpperCase() && e.re.test(path))?.op;
}

/** Other methods the same path accepts, for a precise "wrong method" message. */
export function methodsFor(path: string): string[] {
  return [...new Set(index().filter((e) => e.re.test(path)).map((e) => e.op.method))];
}

export type Violation = string;

/** Check a request body against a schema: required fields present, no field the gateway does not read. */
export function checkBody(schema: BodySchema, body: unknown): Violation[] {
  const v: Violation[] = [];
  if (body === undefined || body === null || typeof body !== "object" || Array.isArray(body)) {
    return schema.required.length > 0 ? [`body missing; the route requires: ${schema.required.join(", ")}`] : [];
  }
  const keys = Object.keys(body as Json);
  for (const r of schema.required) if (!keys.includes(r)) v.push(`missing required field '${r}'`);
  if (schema.properties !== null) for (const k of keys) if (!schema.properties.includes(k)) v.push(`sends '${k}', which the route does not read`);
  return v;
}
