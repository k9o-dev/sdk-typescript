/**
 * Data-plane DSL: `client.from(collection).select()` etc.
 *
 * The DSL is a
 * chainable builder that composes a query against a project's user-
 * collection. The chain terminates in a verb (`select`, `insert`,
 * `update`, `delete`) that issues the HTTP request and returns the
 * envelope.
 *
 * Wire mapping:
 *   - `from('posts').select()`                          → GET    /@<projectSlug>/data/posts
 *   - `from('posts').select().eq('id','rec_X')`         → GET    /@<projectSlug>/data/posts?id=eq.rec_X
 *   - `from('posts').insert({ title: '...' })`          → POST   /@<projectSlug>/data/posts
 *   - `from('posts').update({ title: '...' }).eq(...)`  → PATCH  /@<projectSlug>/data/posts/:id
 *   - `from('posts').delete().eq('id','rec_X')`         → DELETE /@<projectSlug>/data/posts/:id
 *
 * Filters compose as AND; multiple chained `.eq()` /
 * `.gt()` / etc. calls all attach to the query string.
 *
 * Pagination + counting: `.limit(n)`, `.cursor(opaque)`,
 * `.count('none' | 'exact' | 'estimated')`. The returned envelope's
 * `meta.cursor.next` is the cursor for the next page.
 *
 * Per KError delivery: every terminal verb throws KError on
 * non-2xx. Caller catches via `instanceof KError` + narrows on `.code`.
 */

import { projectPath, validateSlug } from "../url-grammar.ts";
import { request, type HttpClientConfig } from "../http.ts";
import { KError } from "../kerror.ts";
import type { Envelope } from "../envelope.ts";
import type { FilterOp } from "../types.ts";

/**
 * Internal filter representation. Serialised to query parameters at
 * terminal-verb time.
 */
type Filter = {
  column: string;
  op: FilterOp;
  value: string | number | boolean | ReadonlyArray<string | number>;
};

/**
 * Query builder shared across all verbs. The `select`/`insert`/`update`/
 * `delete` factories below extend this via composition so the chainable
 * shape is consistent.
 */
class QueryBuilder {
  protected filters: Filter[] = [];
  protected limitVal?: number;
  protected cursorVal?: string;
  protected countMode?: "none" | "exact" | "estimated";

  /**
   * Attach an equality filter. Composes with other filters via AND.
   */
  eq(column: string, value: string | number | boolean): this {
    this.filters.push({ column, op: "eq", value });
    return this;
  }

  neq(column: string, value: string | number | boolean): this {
    this.filters.push({ column, op: "neq", value });
    return this;
  }

  gt(column: string, value: string | number): this {
    this.filters.push({ column, op: "gt", value });
    return this;
  }

  gte(column: string, value: string | number): this {
    this.filters.push({ column, op: "gte", value });
    return this;
  }

  lt(column: string, value: string | number): this {
    this.filters.push({ column, op: "lt", value });
    return this;
  }

  lte(column: string, value: string | number): this {
    this.filters.push({ column, op: "lte", value });
    return this;
  }

  in(column: string, values: ReadonlyArray<string | number>): this {
    this.filters.push({ column, op: "in", value: values });
    return this;
  }

  notIn(column: string, values: ReadonlyArray<string | number>): this {
    this.filters.push({ column, op: "notIn", value: values });
    return this;
  }

  like(column: string, pattern: string): this {
    this.filters.push({ column, op: "like", value: pattern });
    return this;
  }

  ilike(column: string, pattern: string): this {
    this.filters.push({ column, op: "ilike", value: pattern });
    return this;
  }

  is(column: string, value: "null" | "true" | "false"): this {
    this.filters.push({ column, op: "is", value });
    return this;
  }

  /**
   * Attach a `.filter(column, op, value)` for explicit op selection.
   */
  filter(column: string, op: FilterOp, value: string | number | boolean | ReadonlyArray<string | number>): this {
    this.filters.push({ column, op, value });
    return this;
  }

  /**
   * Page-size hint (default per gateway tier; max bounded server-side).
   */
  limit(n: number): this {
    this.limitVal = n;
    return this;
  }

  /**
   * Opaque cursor for next-page fetch — returned in prior response's
   * `meta.cursor.next`.
   */
  cursor(opaque: string): this {
    this.cursorVal = opaque;
    return this;
  }

  /**
   * Total-count behaviour. `none` (default) skips the
   * count query (cheapest); `exact` runs `SELECT COUNT(*)` (most
   * expensive at scale); `estimated` reads from pg_stats (fast +
   * approximate).
   */
  count(mode: "none" | "exact" | "estimated"): this {
    this.countMode = mode;
    return this;
  }

  /**
   * Serialise filters + pagination + count to query parameters.
   * Format: per-filter `<column>=<op>.<value>`; multi-value (in/notIn)
   * uses comma-joined parenthesised value `<col>=in.(a,b,c)`.
   */
  protected toQuery(): Record<string, string | number | undefined> {
    const q: Record<string, string | number | undefined> = {};
    for (const f of this.filters) {
      const val = Array.isArray(f.value)
        ? `(${(f.value as ReadonlyArray<string | number>).join(",")})`
        : String(f.value);
      // Multiple filters on the same column are not currently supported via
      // the simple key=value query map. future cycles cover
      // `.or()` / multi-filter — when those land the builder will switch
      // to a serialisation that supports collisions.
      q[f.column] = `${f.op}.${val}`;
    }
    if (this.limitVal !== undefined) q["limit"] = this.limitVal;
    if (this.cursorVal !== undefined) q["cursor"] = this.cursorVal;
    if (this.countMode !== undefined) q["count"] = this.countMode;
    return q;
  }
}

/**
 * Terminal-verb builder returned by `from(collection)`. Each verb method
 * returns a sub-builder that resolves to the HTTP envelope when awaited.
 */
class FromBuilder {
  constructor(
    private readonly config: HttpClientConfig,
    private readonly collection: string,
  ) {}

  /**
   * Initiate a SELECT query. Returns a chainable filter/page builder
   * that resolves to the data envelope on await.
   */
  select<T = unknown>(): SelectBuilder<T> {
    return new SelectBuilder<T>(this.config, this.collection);
  }

  /**
   * Insert one record. Returns the inserted record (with platform-
   * generated `id` + `metadata`).
   */
  async insert<T = unknown>(record: Partial<T>): Promise<Envelope<T>> {
    return request<T>(this.config, {
      method: "POST",
      path: collectionPath(this.config, this.collection),
      body: record,
    });
  }

  /**
   * Initiate an UPDATE. Returns a builder; the chain MUST include a
   * filter clause (typically `.eq('id', 'rec_...')`) and resolves to
   * the updated record envelope.
   */
  update<T = unknown>(patch: Partial<T>): UpdateBuilder<T> {
    return new UpdateBuilder<T>(this.config, this.collection, patch);
  }

  /**
   * Initiate a DELETE. Returns a builder; the chain MUST include a
   * filter clause and resolves to the deleted record envelope.
   */
  delete<T = unknown>(): DeleteBuilder<T> {
    return new DeleteBuilder<T>(this.config, this.collection);
  }
}

class SelectBuilder<T> extends QueryBuilder implements PromiseLike<Envelope<ReadonlyArray<T>>> {
  constructor(
    private readonly config: HttpClientConfig,
    private readonly collection: string,
  ) {
    super();
  }

  private exec(): Promise<Envelope<ReadonlyArray<T>>> {
    return request<ReadonlyArray<T>>(this.config, {
      method: "GET",
      path: collectionPath(this.config, this.collection),
      query: this.toQuery(),
    });
  }

  then<TResult1 = Envelope<ReadonlyArray<T>>, TResult2 = never>(
    onfulfilled?: ((value: Envelope<ReadonlyArray<T>>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }
}

class UpdateBuilder<T> extends QueryBuilder implements PromiseLike<Envelope<T>> {
  constructor(
    private readonly config: HttpClientConfig,
    private readonly collection: string,
    private readonly patch: Partial<T>,
  ) {
    super();
  }

  private exec(): Promise<Envelope<T>> {
    const idFilter = this.filters.find((f) => f.column === "id" && f.op === "eq");
    if (idFilter === undefined) {
      throw new KError({
        code: "K9O_INVALID_FIELD_VALUE",
        message: "update() requires an `.eq('id', '...')` filter; changing many rows in one call is not supported",
        context: { collection: this.collection },
        recommendation: "Chain `.eq('id', 'rec_…')` before awaiting the update; to change several rows, call update once per id.",
      });
    }
    return request<T>(this.config, {
      method: "PATCH",
      path: `${collectionPath(this.config, this.collection)}/${encodeURIComponent(String(idFilter.value))}`,
      body: this.patch,
    });
  }

  then<TResult1 = Envelope<T>, TResult2 = never>(
    onfulfilled?: ((value: Envelope<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }
}

class DeleteBuilder<T> extends QueryBuilder implements PromiseLike<Envelope<T>> {
  constructor(
    private readonly config: HttpClientConfig,
    private readonly collection: string,
  ) {
    super();
  }

  private exec(): Promise<Envelope<T>> {
    const idFilter = this.filters.find((f) => f.column === "id" && f.op === "eq");
    if (idFilter === undefined) {
      throw new KError({
        code: "K9O_INVALID_FIELD_VALUE",
        message: "delete() requires an `.eq('id', '...')` filter; deleting many rows in one call is not supported",
        context: { collection: this.collection },
        recommendation: "Chain `.eq('id', 'rec_…')` before awaiting the delete; to delete several rows, call delete once per id.",
      });
    }
    return request<T>(this.config, {
      method: "DELETE",
      path: `${collectionPath(this.config, this.collection)}/${encodeURIComponent(String(idFilter.value))}`,
    });
  }

  then<TResult1 = Envelope<T>, TResult2 = never>(
    onfulfilled?: ((value: Envelope<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }
}

/**
 * Build the collection-records URL path. Requires `config.projectSlug`
 * to be bound; member-plane resources route via the `/@<projectSlug>/...`
 * prefix per the URL grammar.
 */
function collectionPath(config: HttpClientConfig, collection: string): string {
  if (typeof config.projectSlug !== "string" || config.projectSlug.length === 0) {
    throw new KError({
      code: "K9O_MISSING_PROJECT_CONTEXT",
      message: "data-plane operations require projectSlug to be bound on the client",
      context: { collection },
      recommendation: "Pass `projectSlug` in createClient options or use a project-scoped sub-client.",
    });
  }
  validateSlug(config.projectSlug, "project");
  // Validate collection name shape — same slug grammar.
  if (!/^[a-z][a-z0-9_-]{0,62}$/.test(collection)) {
    throw new KError({
      code: "K9O_INVALID_FIELD_VALUE",
      message: `collection name "${collection}" does not match required format`,
      context: { collection },
      recommendation: "Use lowercase letters / digits / underscores / hyphens; start with a letter; 1-63 chars.",
    });
  }
  return projectPath(config.projectSlug, `data/${collection}`);
}

/**
 * Factory — entry point for the data-plane DSL. Returned via
 * `client.from(collection)` on the K9oClient instance.
 */
export function makeFromFactory(config: HttpClientConfig) {
  return function from(collection: string): FromBuilder {
    return new FromBuilder(config, collection);
  };
}
