/**
 * Compute LLMs SDK — `client.compute.llms.*`.
 *
 * Compute LLMs registry: a curated model library, four endpoints and
 * per-model tier gating.
 *
 * Wire mapping (project-plane):
 *   - list()                    → GET  /@<slug>/compute/llms
 *   - read(modelId)             → GET  /@<slug>/compute/llms/<model-id>
 *   - invoke(modelId, ...)      → POST /@<slug>/compute/llms/<model-id>/invoke
 *   - invokeStream(modelId,...) → POST /@<slug>/compute/llms/<model-id>/invoke-stream (SSE)
 *
 * RBAC: list/read against all cohort roles; invoke + invokeStream require
 * PROJECT_AUTHOR or PROJECT_ADMIN (LLM cost gate). External-provider models
 * answer 501 `K9O_NOT_IMPLEMENTED` until the provider client is built.
 * Surfaces K9O_LLM_PROVIDER_UNAVAILABLE (503), K9O_MODEL_NOT_DECLARED and
 * K9O_TIER_FEATURE_GATED.
 */

import { request, requestStream, type HttpClientConfig } from "../http.ts";
import { projectPath } from "../url-grammar.ts";
import type { Envelope } from "../envelope.ts";
import { parseSseStream } from "../internal/sse.ts";

/** Curated model ids. */
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

/** Model metadata with per-model cost. */
export type LLMModel = {
  id: LLMModelId;
  providerClass: LLMProviderClass;
  modality: LLMModality;
  /** Minimum tier gate (e.g. "base-camp", "ascent", "ridge"). */
  tierGate: string;
  contextWindow: number;
  capabilities: ReadonlyArray<string>;
  /** Per-model token cost. */
  costPerMillionInputTokens: number;
  costPerMillionOutputTokens: number;
};

/** Inference parameters the route reads; sent flat in the request body. */
export type LLMInvokeParams = {
  /** 1 to 32000. */
  maxTokens?: number;
  /** 0 to 2. */
  temperature?: number;
  /** Free-form usage label recorded with the call. */
  usageType?: string;
};

/** Token counts the model server reported for a call. */
export type LLMUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/** Synchronous inference response from `/invoke`. */
export type LLMResponse = {
  modelId: string;
  /** The generated text. */
  content: string;
  finishReason: string | null;
  usage: LLMUsage;
  usageType: string;
};

/**
 * One chunk of the `/invoke-stream` response: the model server's OpenAI-style
 * chat-completion chunk, passed through unchanged. Read incremental text from
 * `choices[0].delta.content`; the final chunk may carry `usage`.
 */
export type LLMStreamChunk = {
  id?: string;
  object?: string;
  model?: string;
  choices?: ReadonlyArray<{
    index?: number;
    delta?: { role?: string; content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  [key: string]: unknown;
};

export type LLMInvokeInput = {
  prompt: string;
  params?: LLMInvokeParams;
};

function invokeBody(input: LLMInvokeInput): Record<string, unknown> {
  return { prompt: input.prompt, ...input.params };
}

/** Error codes specific to LLM calls. */
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
        body: invokeBody(input),
      });
    },

    /**
     * POST /@<slug>/compute/llms/<model-id>/invoke-stream — streaming
     * inference (SSE; the model server's OpenAI-style chunks).
     * Returns an async iterable of `LLMStreamChunk` — caller writes
     * `for await (const chunk of client.compute.llms.invokeStream(...))`.
     * The SDK handles SSE framing internally.
     */
    async *invokeStream(modelId: LLMModelId | string, input: LLMInvokeInput): AsyncGenerator<LLMStreamChunk, void, void> {
      const slug = requireProjectSlug(config);
      const response = await requestStream(config, {
        method: "POST",
        path: projectPath(slug, `compute/llms/${encodeURIComponent(modelId)}/invoke-stream`),
        body: invokeBody(input),
        accept: "text/event-stream",
      });
      // requestStream guarantees a non-null body on 2xx.
      yield* parseSseStream<LLMStreamChunk>(response.body as ReadableStream<Uint8Array>);
    },
  };
}

export function makeComputeNamespace(config: HttpClientConfig) {
  return {
    /** LLM registry + inference — `client.compute.llms.*` . */
    llms: makeLlmsNamespace(config),
  };
}
