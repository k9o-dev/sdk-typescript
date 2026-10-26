/**
 * BYOS (Bring-Your-Own-Store) credential-reference wire format — the client-side counterpart of the
 * gateway's B2 seal-plane gate (mirrors `services/gateway/src/analytics/
 * byos-credential-ref.ts` + `byos-credential-resolver.ts`) plus the 5-provider envelope shapes from the
 * provisioning spec — each provider's long-lived cred is
 * revealed CORE-side via an already-wired scheme that reads one exact field shape.
 *
 * The customer PRE-CREATES their cloud credential as a vault secret under their OWN auth, then binds
 * only a `kibo://byos-creds/<secId>` reference — the gateway never handles the raw long-lived cloud
 * credential at bind time (`byos-cred create`, `packages/cli/src/commands/byos-cred.ts`).
 */

import { KError } from "./kerror.ts";
import { assertProviderRegion } from "./provider-region.ts";

/** The reference scheme the gateway's `assertByosCredentialRef` accepts at bind time. */
export const BYOS_CRED_REF_PREFIX = "kibo://byos-creds/";

/**
 * The reserved vault SECRET-NAME namespace `byos-cred create` always stores under (distinct from
 * {@link BYOS_CRED_REF_PREFIX}, the `kibo://` reference scheme formed from the resulting secret id).
 * `SecretRecord` has no class/purpose column — `name` is the only vault-stored,
 * non-caller-asserted field the reveal endpoint's class gate can check authoritatively to tell "this
 * is a BYOS credential" and refuse revealing an install-scoped secret through the BYOS reveal path
 * (closing a receipt-bypass). `byos-cred create` enforces this prefix unconditionally —
 * it is not a convention callers opt into.
 */
export const BYOS_CRED_VAULT_NAME_PREFIX = "byos-creds/";

/** The allowed charset for the caller-given part of a BYOS vault secret name (after stripping
 *  {@link BYOS_CRED_VAULT_NAME_PREFIX} if present) — hygiene, not a security boundary (the seal is
 *  customer-plane-scoped and the reveal resolves by vault-generated secId, never by name), but an
 *  unvalidated name could otherwise land a secret at an odd vault path. */
const VAULT_NAME_SEGMENT = /^[a-z0-9._-]+(?:\/[a-z0-9._-]+)*$/;

/** Prefix a caller-given secret name with {@link BYOS_CRED_VAULT_NAME_PREFIX} if it isn't already
 *  under it. Idempotent so re-running with an already-prefixed name doesn't double-nest.
 *  Two independent checks, not one: a literal `..` substring is rejected
 *  outright (traversal), separately from {@link VAULT_NAME_SEGMENT} restricting the charset to
 *  `[a-z0-9._/-]` (hygiene) — the charset still permits a lone `.`, which is not itself a traversal
 *  token and is not what blocks `..`. */
export function byosCredVaultName(name: string): string {
  const suffix = name.startsWith(BYOS_CRED_VAULT_NAME_PREFIX) ? name.slice(BYOS_CRED_VAULT_NAME_PREFIX.length) : name;
  if (suffix.length === 0 || suffix.includes("..") || !VAULT_NAME_SEGMENT.test(suffix)) {
    throw new KError({
      code: "K9O_INVALID_FIELD_VALUE",
      message: "a BYOS credential name must be non-empty, lowercase alphanumeric/._- per path segment, and must not contain '..'",
      context: { field: "name" },
      recommendation: "Use a name like 's3-prod' or 'team/s3-prod' — no '..', no uppercase, no other punctuation.",
    });
  }
  return `${BYOS_CRED_VAULT_NAME_PREFIX}${suffix}`;
}

/** The sealed BYOS credential format version (pin `v`, fail-closed on
 *  an unrecognised version so a future cred shape never silently mis-parses as v1). */
export const BYOS_CRED_FORMAT_VERSION = 1;

/** The CORE-mintable providers — each maps to exactly one wired reveal scheme.
 *  `azure_blob` has no envelope shape yet (not in the provisioning spec). */
export type ByosCredProvider = "s3" | "s3_compatible" | "minio" | "gcs" | "b2" | "r2";

/** provider → WIRED reveal scheme — informational; not itself sent on the wire (the
 *  scheme name IS part of each envelope below). */
export const BYOS_PROVIDER_SCHEME: Record<ByosCredProvider, string> = {
  s3: "aws_sigv4",
  s3_compatible: "aws_sigv4",
  minio: "aws_sigv4",
  gcs: "gcp_workload_identity",
  b2: "http_basic",
  r2: "bearer",
};

type SigV4Input = {
  provider: "s3" | "s3_compatible" | "minio";
  accessKeyId: string;
  secretAccessKey: string;
  /** The provider's STS-signing region the CORE mint signs its STS request against (`us-east-1`), NOT a platform region. */
  providerRegion: string;
  /** Present only to be rejected — a sealed cred must be long-lived. */
  sessionToken?: string | undefined;
};

type GcsInput = {
  provider: "gcs";
  /** The service account's PKCS8 private key, PEM-encoded. */
  privateKeyPem: string;
  /** The service account's email — the mint's `clientId`. */
  clientId: string;
};

type B2Input = {
  provider: "b2";
  /** The B2 master key's `keyId` — sealed as `username` (RFC 7617; must not contain `:`). */
  keyId: string;
  /** The B2 master key's `appKey` — sealed as `password`. */
  appKey: string;
};

type R2Input = {
  provider: "r2";
  /** The Cloudflare API token — sealed as `token`. */
  apiToken: string;
};

/** Discriminated input to {@link encodeByosCredential} — one shape per CORE-mintable provider. */
export type ByosCredInput = SigV4Input | GcsInput | B2Input | R2Input;

function rejectTempCred(sessionToken: string | undefined): void {
  if (typeof sessionToken === "string" && sessionToken.length > 0) {
    throw new KError({
      code: "K9O_INVALID_FIELD_VALUE",
      message:
        "cannot seal a temporary BYOS credential (a sessionToken expires and would invalidate the credentialRef once sealed); supply a long-lived access key",
      context: { field: "sessionToken" },
      recommendation: "Create a bucket-scoped, long-lived IAM access key for this credential instead of a temporary/STS one.",
    });
  }
}

/**
 * Encode a customer cloud credential to the exact versioned JSON string the vault secret's `value`
 * must carry, per provider:
 *
 *   - s3 / s3_compatible / minio: `{v:1, scheme:"aws_sigv4", service:"sts", providerRegion, accessKeyId, secretAccessKey}`
 *     🔴 `service` MUST be `"sts"` — the long-lived cred signs ONLY the STS mint; the CORE
 *     mint fail-closes on `service !== "sts"`. Not caller-configurable.
 *   - gcs: `{v:1, scheme:"gcp_workload_identity", privateKeyPem, clientId}`
 *   - b2: `{v:1, scheme:"http_basic", username, password}` — 🔴 the B2 master's `keyId` seals as
 *     `username`, `appKey` as `password` (RFC 7617 field names, not B2's native ones); throws if
 *     `keyId` contains `:` (RFC 7617 forbids it in `username`).
 *   - r2: `{v:1, scheme:"bearer", token}`
 *
 * 🔴 Rejects a temporary/session credential on the `aws_sigv4` path —
 * a `sessionToken` expires and would silently invalidate the `credentialRef` once sealed, so this
 * refuses to encode one rather than deferring to the gateway's own reveal-time rejection. The other
 * three schemes have no analogous temporary-credential field in this envelope shape.
 */
export function encodeByosCredential(input: ByosCredInput): string {
  switch (input.provider) {
    case "s3":
    case "s3_compatible":
    case "minio": {
      rejectTempCred(input.sessionToken);
      // Sealed into the envelope and later put into hostnames by the mint: refuse a malformed one before it is sealed.
      assertProviderRegion(input.providerRegion, input.provider);
      return JSON.stringify({
        v: BYOS_CRED_FORMAT_VERSION,
        scheme: "aws_sigv4",
        service: "sts",
        providerRegion: input.providerRegion,
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
      });
    }
    case "gcs":
      return JSON.stringify({
        v: BYOS_CRED_FORMAT_VERSION,
        scheme: "gcp_workload_identity",
        privateKeyPem: input.privateKeyPem,
        clientId: input.clientId,
      });
    case "b2": {
      if (input.keyId.includes(":")) {
        throw new KError({
          code: "K9O_INVALID_FIELD_VALUE",
          message: "a B2 master keyId sealed as the http_basic username must not contain ':' (RFC 7617)",
          context: { field: "keyId" },
          recommendation: null,
        });
      }
      return JSON.stringify({
        v: BYOS_CRED_FORMAT_VERSION,
        scheme: "http_basic",
        username: input.keyId,
        password: input.appKey,
      });
    }
    case "r2":
      return JSON.stringify({
        v: BYOS_CRED_FORMAT_VERSION,
        scheme: "bearer",
        token: input.apiToken,
      });
  }
}

/** Form the `kibo://byos-creds/<secId>` reference from a vault secret id — the inverse of the
 *  gateway's `byosCredentialSecId`. */
export function byosCredentialRef(secId: string): string {
  return `${BYOS_CRED_REF_PREFIX}${secId}`;
}
