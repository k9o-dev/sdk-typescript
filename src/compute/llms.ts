/**
 * Compute LLMs SDK — `client.compute.llms.*`.
 *
 * Compute LLMs registry. Curated 9-model library
 * + 4-endpoint family + per-model tier-gating.
 *
 * Wire mapping (project-plane;):
 *   - list()                    → GET  /@<slug>/compute/llms
 *   - read(modelId)             → GET  /@<slug>/compute/llms/<model-id>
 *   - invoke(modelId, ...)      → POST /@<slug>/compute/llms/<model-id>/invoke
 *   - invokeStream(modelId,...) → POST /@<slug>/compute/llms/<model-id>/invoke-stream (SSE)
 *
 * Per RBAC: list/read against all cohort roles; invoke +
 * invokeStream require PROJECT_AUTHOR or PROJECT_ADMIN (LLM cost gate).
 * Per, surfaces K9O_LLM_PROVIDER_UNAVAILABLE (503) +
 * reuses K9O_MODEL_NOT_DECLARED / K9O_TIER_FEATURE_GATED /
 * K9O_AGENT_INFERENCE_TIMEOUT.
 */

import { request, requestStream, type HttpClientConfig } from "../http.ts";
import { projectPath } from "../url-grammar.ts";
import type { Envelope } from "../envelope.ts";
import { parseSseStream } from "../internal/sse.ts";

/** Curated 9-model closed enum at v2 launch (extensible v2.x). */
export type LLMModelId =
  | "mistral-7b"
  | "mistral-8x7b"
  | "llama-3-8b"
  | "llama-3-70b"
  | "claude-3-5-sonnet"
  | "gpt-4o"
  | "gpt-4o-mini"
  | "text-embedding-3-small"
  | "text-embedding-3-large";

export type LLMProviderClass = "self-hosted" | "external";
export type LLMModality = "text-completion" | "text-completion+tool-use" | "embeddings";

/** Model metadata + (cost transparency). */
export type LLMModel = {
  id: LLMModelId;
  providerClass: LLMProviderClass;
  modality: LLMModality;
  /** Minimum tier gate (e.g. "base-camp", "ascent", "ridge"). */
  tierGate: string;
  contextWindow: number;
  capabilities: ReadonlyArray<string>;
  /** Per-model token cost for cost-transparency. */
  costPerMillionInputTokens: number;
  costPerMillionOutputTokens: number;
};

/** Inference parameters (passed through to provider). */
export type LLMInvokeParams = {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: ReadonlyArray<string>;
  [key: string]: unknown;
};

/** Synchronous inference response `/invoke`. */
export type LLMResponse = {
  completion: string;
  tokensUsed: number;
  latencyMs: number;
};

/** Streaming chunk `/invoke-stream` (SSE per-token). */
export type LLMStreamChunk = {
  /** Incremental completion delta. */
  delta: string;
  /** True on the terminal chunk. */
  done?: boolean;
  /** Populated on terminal chunk. */
  tokensUsed?: number;
};

export type LLMInvokeInput = {
  prompt: string;
  params?: LLMInvokeParams;
};

/** Error code coined in (others reused). */
export const LLM_ERROR_CODES = {
  PROVIDER_UNAVAILABLE: "K9O_LLM_PROVIDER_UNAVAILABLE",
} as const;

function requireProjectSlug(config: HttpClientConfig): string {
  if (typeof config.projectSlug !== "string" || config.projectSlug.length === 0) {
    throw new Error("compute.llms operations require projectSlug bound on the client");
  }
  return config.projectSlug;
}

export function makeLlmsNamespace(config: HttpClientConfig) {
  return {
    /** GET /@<slug>/compute/llms — list models available to the project tier. */
    async list(opts?: { modality?: LLMModality; providerClass?: LLMProviderClass }): Promise<Envelope<ReadonlyArray<LLMModel>>> {
      const slug = requireProjectSlug(config);
      return request(config, { method: "GET", path: projectPath(slug, "compute/llms"), query: opts });
    },

    /** GET /@<slug>/compute/llms/<model-id> — read single model metadata + cost. */
    async read(modelId: LLMModelId | string): Promise<Envelope<LLMModel>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "GET",
        path: projectPath(slug, `compute/llms/${encodeURIComponent(modelId)}`),
      });
    },

    /**
     * POST /@<slug>/compute/llms/<model-id>/invoke — synchronous inference.
     * Requires PROJECT_AUTHOR or PROJECT_ADMIN (LLM cost gate).
     */
    async invoke(modelId: LLMModelId | string, input: LLMInvokeInput): Promise<Envelope<LLMResponse>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "POST",
        path: projectPath(slug, `compute/llms/${encodeURIComponent(modelId)}/invoke`),
        body: { prompt: input.prompt, params: input.params },
      });
    },

    /**
     * POST /@<slug>/compute/llms/<model-id>/invoke-stream — streaming
     * inference (SSE; per-token delta for low-latency UX).
     * Returns an async iterable of `LLMStreamChunk` — caller writes
     * `for await (const chunk of client.compute.llms.invokeStream(...))`.
     * The SDK handles SSE framing internally per
     * `feedback_sdk_abstracted_primitive_default_to_richer_interaction.md`.
     */
    async *invokeStream(modelId: LLMModelId | string, input: LLMInvokeInput): AsyncGenerator<LLMStreamChunk, void, void> {
      const slug = requireProjectSlug(config);
      const response = await requestStream(config, {
        method: "POST",
        path: projectPath(slug, `compute/llms/${encodeURIComponent(modelId)}/invoke-stream`),
        body: { prompt: input.prompt, params: input.params },
        accept: "text/event-stream",
      });
      // requestStream guarantees a non-null body on 2xx.
      yield* parseSseStream<LLMStreamChunk>(response.body as ReadableStream<Uint8Array>);
    },
  };
}

export function makeComputeNamespace(config: HttpClientConfig) {
  return {
    /** LLM registry + inference — `client.compute.llms.*`. */
    llms: makeLlmsNamespace(config),
  };
}
