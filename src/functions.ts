/**
 * Function lifecycle SDK — `client.functions.*`.
 *
 * Backed by the gateway functions and invoke routes.
 *
 * Wire mapping:
 *   - `deploy({ name, runtime, tier, artifactKey, version })` → POST /@<slug>/functions
 *   - `list()`                                → GET    /@<slug>/functions
 *   - `get(name)`                             → GET    /@<slug>/functions/<name>
 *   - `delete(name)`                          → DELETE /@<slug>/functions/<name>
 *   - `invoke(name, payload)`                 → POST   /@<slug>/functions/<name>/invoke
 *
 * Deploy requires PROJECT_ADMIN and returns with status `deploying`; the
 * function is ready when status flips to `active`.
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
  runtime: DeployFunctionInput["runtime"];
  tier: "gateway" | "sandbox";
  entryPoint: string;
  version: string;
  status: "deploying" | "active" | "error" | "retired";
  /** Who manages the function: a developer deploy, or an extension (`extension:<id>`). */
  source: string;
  description: string | null;
  createdAt: string;
  deployedAt: string | null;
  retiredAt: string | null;
  errorDetail: string | null;
};

/**
 * Deploy input. The function's bytes are uploaded first (the gateway's
 * function-artifact upload returns the `artifactKey`); deploy references
 * that artifact.
 */
export type DeployFunctionInput = {
  /** Function name (1 to 128 characters). */
  name: string;
  runtime: "bun" | "python" | "go" | "java" | "kotlin" | "dotnet" | "swift" | "php" | "ruby" | "rust" | "tinygo" | "zig" | "assemblyscript";
  /** `gateway` runs WebAssembly in the gateway; `sandbox` runs an OCI image archive. */
  tier: "gateway" | "sandbox";
  /** Content-addressed key of the uploaded artifact. */
  artifactKey: string;
  /** Version label for this deploy (1 to 64 characters). */
  version: string;
  description?: string | undefined;
};

/** Optional invoke controls; property names are the gateway's. */
export type InvokeFunctionOptions = {
  /** Run asynchronously instead of waiting for the result. */
  background?: boolean | undefined;
  delegation?: { token: string; invokeSessionId?: string | undefined } | undefined;
  onBehalfOf?: string | undefined;
  confinedTo?: string | undefined;
};

function requireProjectSlug(config: HttpClientConfig): string {
  if (typeof config.projectSlug !== "string" || config.projectSlug.length === 0) {
    throw new Error("functions operations require projectSlug bound on the client");
  }
  return config.projectSlug;
}

export function makeFunctionsNamespace(config: HttpClientConfig) {
  return {
    /**
     * Upload a function artifact and get back its content-addressed `artifactKey`, to pass to `deploy`.
     * `POST /@<projectSlug>/functions/artifacts` with the raw bytes: a WebAssembly module for the gateway tier (up to
     * 16 MiB) or an OCI image archive for the sandbox tier (up to 256 MiB). Uploading the same bytes again returns the same key.
     */
    async uploadArtifact(bytes: Uint8Array | ArrayBuffer | Blob, kind: "wasm" | "tar"): Promise<Envelope<{ artifactKey: string }>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "POST",
        path: projectPath(slug, "functions/artifacts"),
        rawBody: bytes,
        headers: { "content-type": kind === "wasm" ? "application/wasm" : "application/x-tar" },
      });
    },

    /** Deploy or redeploy a function from an uploaded artifact. Returns the function record with status. */
    async deploy(input: DeployFunctionInput): Promise<Envelope<FunctionRecord>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "POST",
        path: projectPath(slug, "functions"),
        body: input,
      });
    },

    /** List deployed functions (cursor pagination). */
    async list(opts?: { limit?: number; cursor?: string; status?: FunctionRecord["status"]; tier?: FunctionRecord["tier"]; source?: string }): Promise<Envelope<ReadonlyArray<FunctionRecord>>> {
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

    /** Retire a function. Returns the retired record; the function name enters a 24h cooldown. */
    async delete(name: string): Promise<Envelope<FunctionRecord>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "DELETE",
        path: projectPath(slug, `functions/${encodeURIComponent(name)}`),
      });
    },

    /**
     * Invoke a function. The `payload` is sent as the `payload` field of
     * the request body and passed to the function runtime verbatim; the
     * gateway returns whatever the function returns wrapped in the standard
     * envelope. Invoke authority is per function. This method covers the
     * request-response variant only.
     */
    async invoke<TResult = unknown, TPayload = unknown>(name: string, payload?: TPayload, options?: InvokeFunctionOptions): Promise<Envelope<TResult>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "POST",
        path: projectPath(slug, `functions/${encodeURIComponent(name)}/invoke`),
        body: { ...(payload !== undefined ? { payload } : {}), ...(options ?? {}) },
      });
    },
  };
}
