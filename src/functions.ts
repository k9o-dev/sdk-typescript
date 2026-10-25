/**
 * Function lifecycle SDK — `client.functions.*`.
 *
 * Backed by the gateway functions and invoke routes.
 *
 * Wire mapping:
 *   - `deploy({ name, runtime, code, ... })`  → POST   /@<slug>/functions
 *   - `list()`                                → GET    /@<slug>/functions
 *   - `get(name)`                             → GET    /@<slug>/functions/<name>
 *   - `delete(name)`                          → DELETE /@<slug>/functions/<name>
 *   - `invoke(name, payload)`                 → POST   /@<slug>/functions/<name>/invoke
 *
 * Per: deploy requires PROJECT_ADMIN; invoke authority is per
 * function manifest. Per: deploy returns 202 with status
 * `deploying`; the function is ready when status flips to `active`.
 */

import { request, type HttpClientConfig } from "./http.ts";
import { projectPath } from "./url-grammar.ts";
import type { Envelope } from "./envelope.ts";

/**
 * Function record returned by gateway endpoints.
 */
export type FunctionRecord = {
  /** `fn_<base62>`. */
  id: string;
  name: string;
  runtime: "wasm" | "bun" | "node";
  status: "deploying" | "active" | "retired" | "failed";
  tier: "low" | "medium" | "high";
  createdAt: string;
  updatedAt: string | null;
};

/**
 * Deploy input. The `code` field is the runtime bundle (base64-encoded
 * WASM or JS source).
 */
export type DeployFunctionInput = {
  name: string;
  runtime: "wasm" | "bun" | "node";
  code: string;
  tier?: "low" | "medium" | "high";
  config?: Record<string, unknown>;
};

function requireProjectSlug(config: HttpClientConfig): string {
  if (typeof config.projectSlug !== "string" || config.projectSlug.length === 0) {
    throw new Error("functions operations require projectSlug bound on the client");
  }
  return config.projectSlug;
}

export function makeFunctionsNamespace(config: HttpClientConfig) {
  return {
    /** Deploy or redeploy a function. Returns the function record with status. */
    async deploy(input: DeployFunctionInput): Promise<Envelope<FunctionRecord>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "POST",
        path: projectPath(slug, "functions"),
        body: input,
      });
    },

    /** List deployed functions (cursor pagination). */
    async list(opts?: { limit?: number; cursor?: string; status?: FunctionRecord["status"] }): Promise<Envelope<ReadonlyArray<FunctionRecord>>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "GET",
        path: projectPath(slug, "functions"),
        query: opts,
      });
    },

    /** Get a function by name. */
    async get(name: string): Promise<Envelope<FunctionRecord>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "GET",
        path: projectPath(slug, `functions/${encodeURIComponent(name)}`),
      });
    },

    /** Retire a function. Returns confirmation; the function name enters a 24h cooldown. */
    async delete(name: string): Promise<Envelope<{ retired: boolean; cooldownUntil: string }>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "DELETE",
        path: projectPath(slug, `functions/${encodeURIComponent(name)}`),
      });
    },

    /**
     * Invoke a function. The `payload` is passed to the function runtime
     * verbatim; the gateway returns whatever the function returns wrapped
     * in the standard envelope.
     *
     * Per: invoke authority is per-function (declared in the
     * function manifest). Per: streaming responses use the
     * subscription/async-iterator pattern; this method covers the
     * request-response variant only.
     */
    async invoke<TResult = unknown, TPayload = unknown>(name: string, payload: TPayload): Promise<Envelope<TResult>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "POST",
        path: projectPath(slug, `functions/${encodeURIComponent(name)}/invoke`),
        body: payload,
      });
    },
  };
}
