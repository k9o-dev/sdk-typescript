/**
 * `client.storage` buckets and objects: per-project logical buckets and the objects in them, against
 * `/@<projectSlug>/storage/buckets…`. `client.storage.locations.*` (the customer's own object stores) lives in
 * `storage-locations.ts` and is unchanged.
 *
 * Bucket names are logical: the platform resolves them to a physical store, so a developer never sees a
 * physical bucket or key. Signed URLs require an explicit `expiresIn` (no default, max 7 days).
 *
 * What is NOT here yet, by design: a signed PUT (a method- and content-type-bound upload URL). The gateway has
 * no route for it; uploads go through the multipart `upload` below.
 */

import { request, type HttpClientConfig } from "./http.ts";
import { projectPath } from "./url-grammar.ts";
import { KError } from "./kerror.ts";
import type { Envelope } from "./envelope.ts";

/** A bucket. */
export type StorageBucket = {
  name: string;
  /** `true` removes the authentication requirement on GET; per-object access policies still apply. */
  public: boolean;
  /** Bytes; `null` = no limit. */
  fileSizeLimit: number | null;
  /** MIME allow-list; empty = any. */
  allowedMimeTypes: string[];
  versioning: boolean;
  /** Lifecycle auto-expiry in days; `null` = never. */
  deleteAfterDays: number | null;
  createdAt: string;
  updatedAt: string;
  /** Platform-owned buckets (for example audit assets) cannot be written through the public routes. */
  system: boolean;
  /** The storage location the bucket is linked to, or `null` for platform-managed storage. */
  byosBindingId: string | null;
};

/** Options for `createBucket`. The bucket name is the first argument (3 to 63 chars, lowercase, digits, hyphens). */
export type CreateBucketOptions = {
  public?: boolean;
  fileSizeLimit?: number;
  allowedMimeTypes?: string[] | null;
  versioning?: boolean;
  deleteAfterDays?: number;
  /** Link the bucket to one of the project's storage locations (see `client.storage.locations`). */
  byosBindingId?: string;
};

/** Fields you may change on a bucket. `null` clears a limit; `allowedMimeTypes: null` allows any type. */
export type UpdateBucketOptions = {
  public?: boolean;
  fileSizeLimit?: number | null;
  allowedMimeTypes?: string[] | null;
  versioning?: boolean;
  deleteAfterDays?: number | null;
  /** `null` unlinks the bucket from its storage location. */
  byosBindingId?: string | null;
};

/** An object listing entry. `path` is relative to the bucket. */
export type StorageObject = {
  path: string;
  size: number;
  lastModified: string | null;
};

export type UploadOptions = {
  /** Defaults to the data's own type when it is a `Blob`. */
  contentType?: string;
  /** `false` (default) refuses to overwrite an existing path (`409 K9O_ALREADY_EXISTS`). */
  upsert?: boolean;
  /** Caller-defined string metadata: at most 10 keys and 2 KB in total (enforced by the gateway). */
  metadata?: Record<string, string>;
};

export type SignedUrlOptions = {
  /** Seconds, required: 1 to 604800 (7 days). There is deliberately no default. */
  expiresIn: number;
  /** `true` makes the download an attachment (`Content-Disposition: attachment`). */
  download?: boolean;
};

export type SignedUrl = { signedUrl: string; expiresIn: number };
export type RemovedObject = { bucket: string; path: string; deleted: boolean };
export type DeletedBucket = { name: string; deleted: true; objectsDeleted: number };

const MAX_EXPIRES_IN = 604_800;

function requireProjectSlug(config: HttpClientConfig): string {
  if (config.projectSlug === undefined || config.projectSlug.length === 0) {
    throw new KError({
      code: "K9O_MISSING_PROJECT_CONTEXT",
      message: "client.storage buckets and objects require a bound projectSlug (per-project resource)",
      context: {},
      recommendation: "Pass projectSlug when constructing the client.",
    });
  }
  return config.projectSlug;
}

const bucketsPath = (config: HttpClientConfig, suffix = ""): string =>
  projectPath(requireProjectSlug(config), `storage/buckets${suffix}`);

const bucketPath = (config: HttpClientConfig, name: string, suffix = ""): string => {
  if (name.length === 0) {
    throw new KError({
      code: "K9O_INVALID_FIELD_VALUE",
      message: "bucket name must not be empty",
      context: { field: "bucket", reason: "empty" },
      recommendation: null,
    });
  }
  // `.` and `..` survive percent-encoding and are collapsed as dot segments by the URL layer BEFORE the request leaves,
  // so a bucket named `..` would address a different route. No bucket can have that name (3 to 63 chars), so refuse it
  // here rather than send a rewritten URL.
  if (name === "." || name === "..") {
    throw new KError({
      code: "K9O_INVALID_FIELD_VALUE",
      message: "bucket name must not be a dot segment",
      context: { field: "bucket", reason: "dot_segment" },
      recommendation: null,
    });
  }
  return bucketsPath(config, `/${encodeURIComponent(name)}${suffix}`);
};

function requireObjectPath(path: string): void {
  if (path.length === 0) {
    throw new KError({
      code: "K9O_INVALID_FIELD_VALUE",
      message: "object path must not be empty",
      context: { field: "path", reason: "empty" },
      recommendation: null,
    });
  }
}

function requireExpiresIn(expiresIn: unknown): asserts expiresIn is number {
  if (typeof expiresIn !== "number" || !Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > MAX_EXPIRES_IN) {
    throw new KError({
      code: "K9O_INVALID_FIELD_VALUE",
      message: `expiresIn is required and must be an integer from 1 to ${MAX_EXPIRES_IN} seconds`,
      context: { field: "expiresIn", reason: "out_of_range" },
      recommendation: "Pass an explicit expiresIn; signed URLs have no default lifetime.",
    });
  }
}

function toBlob(data: Blob | Uint8Array | ArrayBuffer | string, contentType?: string): Blob {
  const init = contentType !== undefined ? { type: contentType } : {};
  if (data instanceof Blob) return contentType !== undefined && data.type !== contentType ? new Blob([data], init) : data;
  if (typeof data === "string") return new Blob([data], init);
  return new Blob([data as unknown as ArrayBuffer], init);
}

/** A handle on one bucket: `client.storage.from("avatars")`. */
export function makeBucketHandle(config: HttpClientConfig, bucket: string) {
  return {
    /**
     * Upload an object. `POST /@<projectSlug>/storage/buckets/<bucket>/objects` (multipart). The bytes pass through
     * the gateway; the bucket's size and MIME limits are enforced there.
     */
    async upload(path: string, data: Blob | Uint8Array | ArrayBuffer | string, options: UploadOptions = {}): Promise<Envelope<StorageObject>> {
      requireObjectPath(path);
      const form = new FormData();
      form.append("file", toBlob(data, options.contentType), path.split("/").pop() || "file");
      form.append("path", path);
      if (options.contentType !== undefined) form.append("contentType", options.contentType);
      form.append("upsert", options.upsert === true ? "true" : "false");
      if (options.metadata !== undefined) form.append("metadata", JSON.stringify(options.metadata));
      return request<StorageObject>(config, { method: "POST", path: bucketPath(config, bucket, "/objects"), body: form });
    },

    /**
     * A pre-authenticated GET URL for one object. `POST …/objects/sign`. `expiresIn` is required.
     * (A signed PUT is not offered: the gateway has no route for it yet.)
     */
    async createSignedUrl(path: string, options: SignedUrlOptions): Promise<Envelope<SignedUrl>> {
      requireObjectPath(path);
      requireExpiresIn(options?.expiresIn);
      return request<SignedUrl>(config, {
        method: "POST",
        path: bucketPath(config, bucket, "/objects/sign"),
        body: { path, expiresIn: options.expiresIn, ...(options.download !== undefined ? { download: options.download } : {}) },
      });
    },

    /** List objects, optionally under a prefix. `GET …/objects?prefix=`. */
    async list(options: { prefix?: string } = {}): Promise<Envelope<ReadonlyArray<StorageObject>>> {
      return request<ReadonlyArray<StorageObject>>(config, {
        method: "GET",
        path: bucketPath(config, bucket, "/objects"),
        ...(options.prefix !== undefined ? { query: { prefix: options.prefix } } : {}),
      });
    },

    /** Delete one object. `DELETE …/objects?path=`. */
    async remove(path: string): Promise<Envelope<RemovedObject>> {
      requireObjectPath(path);
      return request<RemovedObject>(config, { method: "DELETE", path: bucketPath(config, bucket, "/objects"), query: { path } });
    },
  };
}

/** Bucket operations; merged into `client.storage` next to `locations`. */
export function makeBucketOperations(config: HttpClientConfig) {
  return {
    /** List the project's buckets. `GET /@<projectSlug>/storage/buckets`. */
    async listBuckets(): Promise<Envelope<ReadonlyArray<StorageBucket>>> {
      return request<ReadonlyArray<StorageBucket>>(config, { method: "GET", path: bucketsPath(config) });
    },

    /** Read one bucket. `GET …/buckets/<name>`. */
    async getBucket(name: string): Promise<Envelope<StorageBucket>> {
      return request<StorageBucket>(config, { method: "GET", path: bucketPath(config, name) });
    },

    /**
     * Create a bucket. `POST …/buckets`. A name outside 3 to 63 lowercase letters, digits and hyphens is refused
     * (`INVALID_BUCKET_NAME`).
     */
    async createBucket(name: string, options: CreateBucketOptions = {}): Promise<Envelope<StorageBucket>> {
      return request<StorageBucket>(config, { method: "POST", path: bucketsPath(config), body: { name, ...options } });
    },

    /** Change a bucket. `PATCH …/buckets/<name>`. */
    async updateBucket(name: string, options: UpdateBucketOptions): Promise<Envelope<StorageBucket>> {
      return request<StorageBucket>(config, { method: "PATCH", path: bucketPath(config, name), body: options });
    },

    /**
     * Delete a bucket. `DELETE …/buckets/<name>`. A non-empty bucket is refused unless `empty: true`, which purges
     * its objects first.
     */
    async deleteBucket(name: string, options: { empty?: boolean } = {}): Promise<Envelope<DeletedBucket>> {
      return request<DeletedBucket>(config, {
        method: "DELETE",
        path: bucketPath(config, name),
        ...(options.empty === true ? { query: { empty: "true" } } : {}),
      });
    },

    /** A handle on one bucket for object operations: `from("avatars").upload(...)`. */
    from(bucket: string) {
      return makeBucketHandle(config, bucket);
    },
  };
}
