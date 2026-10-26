/**
 * `client.storage.locations.*` — storage locations: the customer's own object stores (Bring-Your-Own-Store),
 * registered once per project and then linked to buckets and Datasets. Per-project CRUD against
 * `/@<projectSlug>/storage/locations`; it replaces the withdrawn purpose-based `client.byos.*` /
 * `/@<projectSlug>/byos` (hard cutover: the old routes answer 404).
 *
 * Deliberately independent of `byos.ts` (the credential pre-create/reference helpers) and of
 * `client.kibo.vault.secrets` — a location's `credentialRef` is just a string here. The caller pre-creates the
 * credential separately (`k9o byos-cred create` / `client.kibo.vault.secrets.create`) and passes the resulting
 * `kibo://byos-creds/<secId>` reference in; this namespace never creates, reads or returns a credential.
 *
 * A location carries no "purpose": which bucket or Dataset uses it is decided at link time, not here.
 */

import { request, type HttpClientConfig } from "./http.ts";
import { projectPath } from "./url-grammar.ts";
import { KError } from "./kerror.ts";
import type { Envelope } from "./envelope.ts";
import { makeBucketOperations } from "./storage-buckets.ts";
import { assertProviderRegion } from "./provider-region.ts";

/** Storage provider. */
export type StorageLocationProvider = "s3" | "s3_compatible" | "gcs" | "azure_blob" | "minio" | "r2" | "b2";
/** Key-custody mode. */
export type StorageLocationCustodyMode = "PLATFORM_MANAGED" | "BYOK" | "HYOK";

/**
 * Non-secret, provider-specific configuration. Keys the platform reads: `accountId` and `parentAccessKeyId`
 * (`r2`), `bucketId` (`b2`). The gateway stores them as given and the credential mint fails closed when a
 * required one is missing, so set them when you create the location.
 */
export type StorageLocationProviderParams = Record<string, string>;

/** A storage location. */
export type StorageLocation = {
  id: string;
  projectId: string;
  provider: StorageLocationProvider;
  bucketName: string;
  /** The platform region (a 4-character short code such as `de01`), checked against the project's residency set. */
  region: string;
  /** The provider's own name for the bucket's location (`us-east-1`, `auto` for R2, the GCS or Azure location). Never residency-checked. */
  providerRegion: string;
  endpointOverride: string | null;
  /** The `kibo://byos-creds/<secId>` reference. The credential itself is never returned. */
  credentialRef: string;
  custodyMode: StorageLocationCustodyMode;
  providerParams: StorageLocationProviderParams;
  createdAt: string;
  /** `null` while the location is live. */
  retiredAt: string | null;
};

/** Input to register a location from a pre-created credential reference. */
export type CreateStorageLocationInput = {
  provider: StorageLocationProvider;
  bucketName: string;
  /** The platform region (short code), checked against the project's residency set. */
  region: string;
  /** The provider's own name for the bucket's location. Required; `auto` for R2. */
  providerRegion: string;
  endpointOverride?: string;
  credentialRef: string;
  custodyMode?: StorageLocationCustodyMode;
  providerParams?: StorageLocationProviderParams;
};

/**
 * Fields you may change on a live location. `provider` cannot change. Moving a location that is in use (its
 * bucket, region, providerRegion, endpoint, `providerParams` or `custodyMode`) is refused with `409 location_in_use`; rotating
 * the credential is allowed. A `custodyMode` change counts as a move because it re-states the custody claim for
 * data already stored there. `providerParams`, when given, REPLACES the whole map (send every key you want to keep).
 */
export type UpdateStorageLocationInput = {
  bucketName?: string;
  region?: string;
  providerRegion?: string;
  /** `null` clears a previously set override. */
  endpointOverride?: string | null;
  credentialRef?: string;
  custodyMode?: StorageLocationCustodyMode;
  providerParams?: StorageLocationProviderParams;
};

/** Result of retiring a location. */
export type RetiredStorageLocation = { id: string; status: "retired" };

/**
 * Result of `test`. Today this is a dry run that echoes the location's coordinates; the live probe is not
 * built yet (`dependencyOn` names what it waits for).
 */
export type StorageLocationTestResult = {
  dryRun: boolean;
  locationId: string;
  provider: StorageLocationProvider;
  bucketName: string;
  region: string;
  providerRegion: string;
  endpointOverride: string | null;
  dependencyOn: string;
};

function requireProjectSlug(config: HttpClientConfig): string {
  if (config.projectSlug === undefined || config.projectSlug.length === 0) {
    throw new KError({
      code: "K9O_MISSING_PROJECT_CONTEXT",
      message: "client.storage.locations requires a bound projectSlug (per-project resource)",
      context: {},
      recommendation: "Pass projectSlug when constructing the client.",
    });
  }
  return config.projectSlug;
}

const locationsPath = (config: HttpClientConfig, suffix = ""): string =>
  projectPath(requireProjectSlug(config), `storage/locations${suffix}`);

export function makeStorageNamespace(config: HttpClientConfig) {
  return {
    // Buckets and objects (storage-buckets.ts): createBucket, listBuckets, from(bucket).upload, ...
    ...makeBucketOperations(config),
    locations: {
      /** List the live storage locations of the bound project. `GET /@<projectSlug>/storage/locations`. */
      async list(): Promise<Envelope<ReadonlyArray<StorageLocation>>> {
        return request<ReadonlyArray<StorageLocation>>(config, { method: "GET", path: locationsPath(config) });
      },

      /**
       * Register a location. `POST /@<projectSlug>/storage/locations`. The region must be inside the project's
       * residency set (`400`, reason `region_outside_residency`).
       */
      async create(input: CreateStorageLocationInput): Promise<Envelope<StorageLocation>> {
        assertProviderRegion(input.providerRegion, input.provider);
        return request<StorageLocation>(config, { method: "POST", path: locationsPath(config), body: input });
      },

      /** Read one location. `GET /@<projectSlug>/storage/locations/<locationId>`. */
      async get(locationId: string): Promise<Envelope<StorageLocation>> {
        return request<StorageLocation>(config, {
          method: "GET",
          path: locationsPath(config, `/${encodeURIComponent(locationId)}`),
        });
      },

      /** Update a live location. `PATCH /@<projectSlug>/storage/locations/<locationId>`. */
      async update(locationId: string, patch: UpdateStorageLocationInput): Promise<Envelope<StorageLocation>> {
        // The provider of an existing location cannot change and is not in the patch, so only the closed charset is
        // checked here; the gateway applies the provider's own grammar.
        if (patch.providerRegion !== undefined) assertProviderRegion(patch.providerRegion);
        return request<StorageLocation>(config, {
          method: "PATCH",
          path: locationsPath(config, `/${encodeURIComponent(locationId)}`),
          body: patch,
        });
      },

      /**
       * Retire a location. `DELETE /@<projectSlug>/storage/locations/<locationId>`. Refused with
       * `409 location_in_use` while a bucket or any Dataset (retired ones included) still uses it.
       */
      async retire(locationId: string): Promise<Envelope<RetiredStorageLocation>> {
        return request<RetiredStorageLocation>(config, {
          method: "DELETE",
          path: locationsPath(config, `/${encodeURIComponent(locationId)}`),
        });
      },

      /** Dry-run check of a location. `POST /@<projectSlug>/storage/locations/<locationId>/test`. */
      async test(locationId: string): Promise<Envelope<StorageLocationTestResult>> {
        return request<StorageLocationTestResult>(config, {
          method: "POST",
          path: locationsPath(config, `/${encodeURIComponent(locationId)}/test`),
        });
      },
    },
  };
}
