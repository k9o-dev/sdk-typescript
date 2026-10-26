/**
 * The provider's own name for a bucket's location (`providerRegion`), as opposed to the platform region (a short code
 * such as `de01`). It goes into hostnames (`s3.<r>.amazonaws.com`, `sts.<r>.amazonaws.com`, `s3.<r>.backblazeb2.com`),
 * so a value like `x.attacker.net#` would aim a SigV4-signed request at a host the caller chose. The gateway checks the
 * same closed grammar on write and again where each endpoint is built; checking it here first means a bad value is
 * refused before any request is sent and before a credential envelope is sealed.
 *
 * Grammars (the Step 0 ruling for the BYOS split):
 *   - `s3` (AWS):      `^[a-z]{2}(-gov)?-[a-z]+-\d$`        e.g. `us-east-1`, `us-gov-west-1`
 *   - `b2`:            `^[a-z]{2}-[a-z]+-\d{3}$`            e.g. `eu-central-003`
 *   - `r2`:            `auto` only
 *   - `gcs`, `azure_blob`: lower-case letters, digits and `-`, 1 to 32 characters, first and last alphanumeric (the gateway's bound)
 *   - `s3_compatible`, `minio`: the same closed charset as GCS and Azure. The ruling gives the AWS grammar only for an
 *     S3-compatible store that uses an AWS endpoint; every other region name is accepted only if it cannot reshape a host.
 */

import { KError } from "./kerror.ts";

export type ProviderRegionProvider = "s3" | "s3_compatible" | "gcs" | "azure_blob" | "minio" | "r2" | "b2";

const CHARSET = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const GRAMMAR: Record<ProviderRegionProvider, (v: string) => boolean> = {
  s3: (v) => /^[a-z]{2}(-gov)?-[a-z]+-\d$/.test(v),
  b2: (v) => /^[a-z]{2}-[a-z]+-\d{3}$/.test(v),
  r2: (v) => v === "auto",
  gcs: (v) => CHARSET.test(v),
  azure_blob: (v) => CHARSET.test(v),
  s3_compatible: (v) => CHARSET.test(v),
  minio: (v) => CHARSET.test(v),
};

/** True if `value` is a well-formed provider region for `provider`; with no provider, the closed charset only. */
export function isProviderRegion(value: unknown, provider?: ProviderRegionProvider): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  return provider === undefined ? CHARSET.test(value) : GRAMMAR[provider](value);
}

/**
 * Throw `K9O_INVALID_FIELD_VALUE` (`reason: "provider_region_invalid"`, the gateway's own reason) unless `value` is a
 * well-formed provider region. The value is never echoed.
 */
export function assertProviderRegion(value: unknown, provider?: ProviderRegionProvider): void {
  if (isProviderRegion(value, provider)) return;
  throw new KError({
    code: "K9O_INVALID_FIELD_VALUE",
    message:
      provider === undefined
        ? "providerRegion must be lower-case letters, digits and '-' (at most 32 characters)"
        : `providerRegion is not a valid ${provider} region`,
    context: { field: "providerRegion", reason: "provider_region_invalid", ...(provider !== undefined ? { provider } : {}) },
    recommendation:
      provider === "r2" ? "Use `auto` for R2." : "Pass the provider's own region name (for example `us-east-1`), not the platform region (`de01`).",
  });
}
