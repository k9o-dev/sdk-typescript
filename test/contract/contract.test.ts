/**
 * Contract test: every documented @k9o/core call, sent through a recording client, must hit a route the gateway serves and send
 * a body that route reads. The gateway's emitted OpenAPI is the source of truth; for a route that declares no body, the entry's
 * own `contract` stands in. See audit/reference/sdk-contract.md (rules 1 to 3).
 *
 * `broken` calls are known disagreements. They must keep failing (so a fix cannot go unnoticed) and are listed in the report.
 */
import { describe, expect, it } from "bun:test";
import { CALLS, type CallEntry } from "./calls.ts";
import { checkBody, findOperation, methodsFor } from "./openapi.ts";
import { recordingClient } from "./recorder.ts";

async function verdict(entry: CallEntry): Promise<string[]> {
  const { client, sent } = recordingClient();
  try {
    await entry.call(client);
  } catch (e) {
    if (sent.length === 0) return [`the call threw before sending: ${e instanceof Error ? e.message : String(e)}`];
  }
  if (sent.length === 0) return ["the call sent no request"];
  const problems: string[] = [];
  for (const req of sent) {
    const op = findOperation(req.method, req.path);
    if (!op) {
      const other = methodsFor(req.path);
      problems.push(other.length > 0 ? `${req.method} ${req.path}: the route exists for ${other.join("/")} only` : `${req.method} ${req.path}: no such route`);
      continue;
    }
    const schema = op.body ?? entry.contract ?? null;
    if (!entry.raw && req.method !== "GET" && req.method !== "DELETE" && schema === null && req.body !== undefined) {
      problems.push(`${req.method} ${op.template}: the route declares no body and the call sends one, with no contract in the table`);
      continue;
    }
    if (schema && !entry.raw) problems.push(...checkBody(schema, req.body).map((m) => `${req.method} ${op.template}: ${m}`));
    // A route that declares no query parameters at all is not evidence either way (the declaration may be missing);
    // a route that declares some and lacks this one is.
    if (op.query.length > 0) for (const q of req.query) if (!op.query.includes(q) && !(entry.extraQuery ?? []).includes(q)) problems.push(`${req.method} ${op.template}: query '${q}' is not declared by the route`);
  }
  return problems;
}

describe("@k9o/core against the gateway OpenAPI", () => {
  for (const entry of CALLS) {
    it(entry.id, async () => {
      const problems = await verdict(entry);
      if (entry.broken) {
        expect(problems.length, `${entry.id} is listed as broken (${entry.broken}) but now passes: remove its 'broken' mark`).toBeGreaterThan(0);
      } else {
        expect(problems, `${entry.id} disagrees with the gateway`).toEqual([]);
      }
    });
  }
});
