/**
 * `client.ai.*` — platform AI primitives (`k9o.ai.embed()` is a platform primitive, not sugar over
 * `context.embed`).
 *
 * Wire mapping (project-plane):
 *   - embed({ model?, input }) → POST /@<slug>/ai/embeddings   body { model?, input: string | string[] }
 *                              → { data: { embeddings: number[][], model, dimensions }, meta }
 *
 * Callers are an extension (authority is the `(ai, embed, "*")` manifest grant) or a project member's own
 * backend; the gateway refuses an end user's client. Bounds (enforced by the gateway, not here): at most 64
 * inputs, each non-empty, at most 256 KiB of input per request, at most 4 requests in flight per project.
 * The platform adds nothing to the input: callers add the model's task prefixes themselves. The SDK sends the
 * input exactly as given and never puts it in an error.
 */

import { request, type HttpClientConfig } from "./http.ts";
import { projectPath } from "./url-grammar.ts";
import type { Envelope } from "./envelope.ts";

/** The one declared embedding model today. A different `model` is refused with `K9O_MODEL_NOT_DECLARED`. */
export type EmbeddingModelId = "nomic-embed-text-v1.5";

export type EmbedInput = {
  /** Optional; defaults server-side to the one declared embedding model. */
  model?: EmbeddingModelId | (string & {});
  /** One string, or an array of strings; the result has one vector per string, in order. */
  input: string | ReadonlyArray<string>;
};

export type EmbedResult = {
  /** One vector per input string, in input order. */
  embeddings: number[][];
  model: string;
  dimensions: number;
};

function requireProjectSlug(config: HttpClientConfig): string {
  if (typeof config.projectSlug !== "string" || config.projectSlug.length === 0) {
    throw new Error("ai operations require projectSlug bound on the client");
  }
  return config.projectSlug;
}

export function makeAiNamespace(config: HttpClientConfig) {
  return {
    /** POST /@<slug>/ai/embeddings — embed one or more strings. */
    async embed(input: EmbedInput): Promise<Envelope<EmbedResult>> {
      const slug = requireProjectSlug(config);
      const body: { model?: string; input: string | string[] } = {
        input: typeof input.input === "string" ? input.input : [...input.input],
      };
      if (input.model !== undefined) body.model = input.model;
      return request(config, { method: "POST", path: projectPath(slug, "ai/embeddings"), body });
    },
  };
}
