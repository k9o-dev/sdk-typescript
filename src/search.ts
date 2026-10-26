/**
 * `client.search(collection, { column, q })` — full-text search over one text column of a collection. Sugar over
 * `client.from(collection).select().textSearch(column, q, { language, type })`; the result is the normal list
 * envelope, best matches first, and `limit` / `cursor` page it.
 */

import type { HttpClientConfig } from "./http.ts";
import { makeFromFactory, type TextSearchOptions } from "./data/from.ts";
import type { Envelope } from "./envelope.ts";

export type SearchInput = TextSearchOptions & {
  /** The text column to search (required). */
  column: string;
  /** The search text. */
  q: string;
  /** Page size. */
  limit?: number;
  /** Opaque cursor from a previous response's `meta.cursor.next`. */
  cursor?: string;
};

export function makeSearch(config: HttpClientConfig) {
  const from = makeFromFactory(config);
  return async function search<T = Record<string, unknown>>(
    collection: string,
    input: SearchInput,
  ): Promise<Envelope<ReadonlyArray<T>>> {
    const opts: TextSearchOptions = {};
    if (input.language !== undefined) opts.language = input.language;
    if (input.type !== undefined) opts.type = input.type;
    let builder = from(collection).select<T>().textSearch(input.column, input.q, opts);
    if (input.limit !== undefined) builder = builder.limit(input.limit);
    if (input.cursor !== undefined) builder = builder.cursor(input.cursor);
    return builder;
  };
}
