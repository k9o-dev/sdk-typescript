import type { CallEntry } from "./calls.ts";

export const CALLS_AI: CallEntry[] = [
  {
    id: "ai.generate",
    call: (c) => c.ai.generate("Say hello", { model: "llama-3.1-8b", maxTokens: 64, temperature: 0.2 }),
  },
];
