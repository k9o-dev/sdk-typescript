/**
 * Migration lifecycle SDK — `client.migrations.*`.
 *
 * Backed by the gateway migrations routes.
 * All routes are member-plane (`/@<projectSlug>/migrations/...`).
 *
 * Wire mapping:
 *   - `apply({ migrations })`     → POST   /@<slug>/migrations/apply
 *   - `list()`                    → GET    /@<slug>/migrations
 *   - `get(version)`              → GET    /@<slug>/migrations/<version>
 *   - `queue({ migrations })`     → POST   /@<slug>/migrations/queue
 *   - `listPending()`             → GET    /@<slug>/migrations/pending
 *   - `applyPending(pendingId)`   → POST   /@<slug>/migrations/pending/<pendingId>/apply
 *   - `rejectPending(pendingId)`  → POST   /@<slug>/migrations/pending/<pendingId>/reject
 *   - `deletePending(pendingId)`  → DELETE /@<slug>/migrations/pending/<pendingId>
 *
 * Migration shape — STRUCTURED
 * DECLARATIVE DDL, never raw SQL. Every schema change is a typed, key-tagged
 * operation, so schema drift is impossible at the SDK layer (the
 * invariant). Raw SQL is the separate runtime `client.query()` surface,
 * which cannot create/alter schema. The gateway checksums each migration and
 * stores it in `_sys.migrations`; already-applied versions are skipped on
 * re-run and mismatched checksums are rejected, preserving the drift invariant.
 *
 * Per-operation field shapes are grounded in the gateway DDL parser
 * (`services/gateway/src/db/migration-runner.ts`), NOT invented.
 *
 * Verified against the gateway DDL parser:
 *   - `up`/`down` arrays — parser now iterates them (shipped `2.58.0-beta.1`).
 *   - ColumnSpec protection attrs — live since `2.56.0`; `encrypted` is the
 *     `true | { store, searchable }` union with `searchable` NESTED (not a
 *     sibling); `blind_indexed` is the C-mode sibling. Aligned above.
 *   - Op set FROZEN at 6 (no alter_column/rename_table/constraint at v2).
 *     `rename_column` is a pending 7th — to be added once its field
 *     names are finalised and the re-encryption pass ships.
 */

import { request, type HttpClientConfig } from "./http.ts";
import { projectPath } from "./url-grammar.ts";
import type { Envelope } from "./envelope.ts";

/** Foreign-key reference on a column — compiles to a REFERENCES clause. */
export type ColumnReferences = {
  collection: string;
  on: string;
  on_delete?: "CASCADE" | "RESTRICT" | "SET NULL" | "NO ACTION";
  on_update?: "CASCADE" | "RESTRICT" | "SET NULL" | "NO ACTION";
};

/**
 * A column definition. `type` is the column-type vocabulary
 * (parser-owned; kept as `string` rather than a fabricated enum). The
 * protection attributes declare at-rest field encryption (gateway
 * shape verified vs the parser, live since `2.56.0`).
 */
export type ColumnSpec = {
  name: string;
  type: string;
  primary_key?: boolean;
  not_null?: boolean;
  unique?: boolean;
  default?: string;
  references?: ColumnReferences;
  /**
   * At-rest field encryption. `true` = inline-stored encrypted column;
   * the object form opts into a `store` ("inline" | "vault") and the D-mode
   * searchable-encryption index (`searchable`). NOTE: `searchable` is NESTED
   * here — it is NOT a sibling attribute.
   */
  encrypted?: true | { store: "inline" | "vault"; searchable?: boolean };
  /** C-mode: deterministic blind index for equality lookup over an encrypted column. */
  blind_indexed?: boolean;
};

/** An index definition. `name` defaults to `<table>_<cols>_idx`. */
export type IndexSpec = {
  name?: string;
  columns: ReadonlyArray<string>;
  unique?: boolean;
};

/**
 * A single declarative DDL operation — KEY-TAGGED (exactly one key set), the
 * shape the gateway applies. The v2 set is these 7 — no `alter_column`,
 * `rename_table`, or constraint ops at v2. `alter_table` is the BATCHED column
 * mutation (one op carries optional `add_columns[]` + `drop_columns[]`), live in
 * the gateway runner (`migration-runner.ts:156`).
 * `rename_column` remains a pending future op (its parser field names are not yet
 * finalised); NOTE / a `rename_column` on an ENCRYPTED column
 * is fail-closed-rejected (`K9O_ENCRYPTED_COLUMN_DECLARATION_INVALID`) pending the
 * re-encryption pass — to document when that op lands.
 */
export type Operation =
  | { create_table: { name: string; columns: ReadonlyArray<ColumnSpec>; indexes?: ReadonlyArray<IndexSpec> } }
  | { drop_table: string }
  | { add_column: { table: string; column: ColumnSpec } }
  | { drop_column: { table: string; column: string } }
  | { alter_table: { name: string; add_columns?: ReadonlyArray<ColumnSpec>; drop_columns?: ReadonlyArray<string> } }
  | { create_index: { table: string; index: IndexSpec } }
  | { drop_index: { name: string } };

/** A declarative authorization/relationship rule (compiles to RLS USING + WITH
 *  CHECK). The rule grammar is the policy-expression DSL. */
export type ActionRule = { rule?: unknown };

/** A declared relationship for embedding/joins (references). */
export type RelationshipSpec = {
  collection: string;
  on: string;
  as: string;
  type?: "inner" | "left";
};

/** Per-collection policy block (RLS + relationships),. */
export type CollectionPolicy = {
  references?: ReadonlyArray<RelationshipSpec>;
  actions?: {
    select?: ActionRule;
    insert?: ActionRule;
    update?: ActionRule;
    delete?: ActionRule;
  };
};

/** Per-bucket storage policy block,. */
export type StorageBucketPolicy = {
  public?: boolean;
  actions?: {
    read?: ActionRule;
    upload?: ActionRule;
    delete?: ActionRule;
    list?: ActionRule;
  };
};

/** The optional `policy` section authored alongside a migration. */
export type MigrationPolicy = {
  collections?: Record<string, CollectionPolicy>;
  storage?: { buckets?: Record<string, StorageBucketPolicy> };
};

/**
 * A migration — a versioned, checksummed unit of structured DDL. `up` applies
 * the change; `down` reverses it. Both are operation arrays.
 */
export type Migration = {
  version: number;
  slug: string;
  up: ReadonlyArray<Operation>;
  down: ReadonlyArray<Operation>;
  policy?: MigrationPolicy;
};

/**
 * Applied-migration record returned by `list` + `get`.
 */
export type AppliedMigration = {
  version: number;
  slug: string;
  checksum: string;
  appliedAt: string;
};

/**
 * Pending migration record returned by `listPending`.
 */
export type PendingMigration = {
  pendingId: string;
  version: number;
  slug: string;
  checksum: string;
  submittedAt: string;
  submittedBy: string;
};

function requireProjectSlug(config: HttpClientConfig): string {
  if (typeof config.projectSlug !== "string" || config.projectSlug.length === 0) {
    throw new Error("migrations operations require projectSlug bound on the client");
  }
  return config.projectSlug;
}

export function makeMigrationsNamespace(config: HttpClientConfig) {
  return {
    /** Apply migrations immediately (PROJECT_ADMIN minimum). */
    async apply(input: { migrations: ReadonlyArray<Migration> }): Promise<Envelope<{ applied: ReadonlyArray<AppliedMigration> }>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "POST",
        path: projectPath(slug, "migrations/apply"),
        body: input,
      });
    },

    /** List applied migrations on the project. */
    async list(): Promise<Envelope<ReadonlyArray<AppliedMigration>>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "GET",
        path: projectPath(slug, "migrations"),
      });
    },

    /** Get a single applied migration by version. */
    async get(version: number): Promise<Envelope<AppliedMigration>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "GET",
        path: projectPath(slug, `migrations/${encodeURIComponent(String(version))}`),
      });
    },

    /** Queue migrations for maker-checker approval. */
    async queue(input: { migrations: ReadonlyArray<Migration> }): Promise<Envelope<{ pending: ReadonlyArray<PendingMigration> }>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "POST",
        path: projectPath(slug, "migrations/queue"),
        body: input,
      });
    },

    /** List pending (queued, not yet approved) migrations. */
    async listPending(): Promise<Envelope<ReadonlyArray<PendingMigration>>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "GET",
        path: projectPath(slug, "migrations/pending"),
      });
    },

    /**
     * Apply a queued migration by id (same-actor fast path — floors at
     * PROJECT_ADMIN; a `pending_approval` row, i.e. a protected-collection
     * migration awaiting a distinct-admin's review, is refused here and
     * needs its own approval flow, not this call).
     */
    async applyPending(pendingId: string): Promise<Envelope<AppliedMigration>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "POST",
        path: projectPath(slug, `migrations/pending/${encodeURIComponent(pendingId)}/apply`),
      });
    },

    /** Reject a pending migration (transitions to rejected; does not apply). */
    async rejectPending(pendingId: string, input?: { reason?: string }): Promise<Envelope<{ rejected: boolean }>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "POST",
        path: projectPath(slug, `migrations/pending/${encodeURIComponent(pendingId)}/reject`),
        body: input,
      });
    },

    /** Delete a pending migration from the queue. */
    async deletePending(pendingId: string): Promise<Envelope<{ deleted: boolean }>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "DELETE",
        path: projectPath(slug, `migrations/pending/${encodeURIComponent(pendingId)}`),
      });
    },
  };
}
