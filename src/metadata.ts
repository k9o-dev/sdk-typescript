/**
 * `client.metadata.*` — cross-surface metadata query (`k9o.metadata.*`).
 *
 * Client-side surface for `POST /@:projectSlug/metadata/query`. The wire shape is fixed here ahead of the
 * server route: until the gateway ships that route, calling `.execute()` returns a 404 rather than a result.
 * Once it is available, only `telemetry:*` surfaces return data at first; collection and storage metadata
 * follow as their server-side schemas land.
 *
 * `textSearch`/`vectorSearch` are explicitly a later increment (Inc 5) — not implemented
 * here; adding stub methods for an unspecified future mode would be speculative, not spec-grounded.
 */

import { request, type HttpClientConfig } from "./http.ts";
import { projectPath } from "./url-grammar.ts";
import { KError } from "./kerror.ts";
import type { Envelope } from "./envelope.ts";

/** The three cross-surface slices. */
export type MetadataSlice = "collection" | "storage" | "telemetry";

/** operator vocabulary (= JSON-policy set), mirrored verbatim from the gateway's
 *  `metadata-query-parse.ts` so a typo can't silently pass client-side and fail only server-side. */
export const METADATA_OPERATORS = [
  "eq", "neq", "gt", "gte", "lt", "lte",
  "contains", "startsWith", "endsWith", "in", "notIn",
  "and", "or", "not",
] as const;
export type MetadataOperator = (typeof METADATA_OPERATORS)[number];

/** A surface label `<slice>:<scope>`, e.g. `collection:posts`, `storage:images`,
 *  `telemetry:auth.session.created`. */
export type MetadataSurface = `${MetadataSlice}:${string}`;

export type MetadataWhereClause = {
  readonly field: string;
  readonly op: MetadataOperator;
  readonly value: unknown;
};

/**
 * One result row: "each record carries its surface + scope + the queried metadata
 * fields plus a back-reference id" — `recordId` (collection), `objectPath` (storage), or `eventId`
 * (telemetry), depending on which surface the row came from. Exact field names are provisional
 * pending Inc 2 landing a concrete response schema; kept loose (`metadata: Record<string, unknown>`)
 * rather than guessing a shape that isn't coined in code anywhere yet.
 */
export type MetadataQueryRecord = {
  surface: MetadataSurface;
  scope: string;
  recordId?: string;
  objectPath?: string;
  eventId?: string;
  metadata: Record<string, unknown>;
};

export type MetadataQueryResult = {
  records: readonly MetadataQueryRecord[];
  nextCursor: string | null;
};

/** The `k9o.metadata.from(...).where(...).limit(...).execute()` builder. Immutable —
 *  every chained call returns a new builder, so a partially-built query can be safely reused/branched. */
export type MetadataQueryBuilder = {
  where(field: string, op: MetadataOperator, value: unknown): MetadataQueryBuilder;
  limit(n: number): MetadataQueryBuilder;
  cursor(c: string | null): MetadataQueryBuilder;
  execute(): Promise<Envelope<MetadataQueryResult>>;
};

function requireProjectSlug(config: HttpClientConfig): string {
  if (config.projectSlug === undefined || config.projectSlug.length === 0) {
    throw new KError({
      code: "K9O_MISSING_PROJECT_CONTEXT",
      message: "client.metadata requires a bound projectSlug (project data-plane resource,)",
      context: {},
      recommendation: "Pass projectSlug when constructing the client.",
    });
  }
  return config.projectSlug;
}

function makeBuilder(
  config: HttpClientConfig,
  surfaces: readonly MetadataSurface[],
  where: readonly MetadataWhereClause[],
  limit: number | undefined,
  cursorValue: string | null,
): MetadataQueryBuilder {
  return {
    where(field, op, value) {
      return makeBuilder(config, surfaces, [...where, { field, op, value }], limit, cursorValue);
    },
    limit(n) {
      return makeBuilder(config, surfaces, where, n, cursorValue);
    },
    cursor(c) {
      return makeBuilder(config, surfaces, where, limit, c);
    },
    async execute() {
      return request<MetadataQueryResult>(config, {
        method: "POST",
        path: projectPath(requireProjectSlug(config), "metadata/query"),
        body: {
          surfaces,
          where,
          ...(limit !== undefined ? { limit } : {}),
          cursor: cursorValue,
        },
      });
    },
  };
}

export function makeMetadataNamespace(config: HttpClientConfig) {
  return {
    /** Start a cross-surface metadata query against one or more surfaces. */
    from(surface: MetadataSurface | readonly MetadataSurface[]): MetadataQueryBuilder {
      const surfaces = Array.isArray(surface) ? surface : [surface as MetadataSurface];
      if (surfaces.length === 0) {
        throw new KError({
          code: "K9O_UNKNOWN_SURFACE",
          message: "client.metadata.from(...) requires at least one surface label.",
          context: {},
          recommendation: "Pass a surface like 'collection:posts', 'storage:images', or 'telemetry:auth.session.created'.",
        });
      }
      return makeBuilder(config, surfaces, [], undefined, null);
    },
  };
}
