/**
 * Schema SDK: `client.schema.*`.
 *
 * Wire mapping (project plane):
 *   - `collections.list({ limit?, cursor? })` -> GET /@<slug>/schema/collections
 *
 * The list is cursor-paginated, ordered by collection name: pass `meta.cursor.next` of one page as `cursor` of the
 * next, until it is null.
 */

import { request, type HttpClientConfig } from "./http.ts";
import { KError } from "./kerror.ts";
import { projectPath } from "./url-grammar.ts";
import type { Envelope } from "./envelope.ts";

/** One collection (table) of the project's data. */
export type CollectionSummary = {
  name: string;
  /** Live row count, excluding soft-deleted rows. Ignores row-level security. */
  rowCount: number;
  rowCountIsExact: boolean;
  columnCount: number;
  indexCount: number;
  lastMigrationSlug: string | null;
  lastMigrationAppliedAt: string | null;
};

export type ListCollectionsOptions = {
  /** 1 to 200; the gateway defaults to 50. */
  limit?: number | undefined;
  /** `meta.cursor.next` of the previous page. */
  cursor?: string | undefined;
};

export function makeSchemaNamespace(config: HttpClientConfig) {
  return {
    collections: {
      /** List the project's collections by name, one page at a time. */
      async list(opts: ListCollectionsOptions = {}): Promise<Envelope<ReadonlyArray<CollectionSummary>>> {
        if (typeof config.projectSlug !== "string" || config.projectSlug.length === 0) {
          throw new Error("schema operations require projectSlug bound on the client");
        }
        if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > 200)) {
          throw new KError({
            code: "K9O_INVALID_FIELD_VALUE",
            message: "limit must be a whole number from 1 to 200",
            context: { limit: opts.limit },
            recommendation: null,
          });
        }
        return request(config, { method: "GET", path: projectPath(config.projectSlug, "schema/collections"), query: opts });
      },
    },
  };
}
