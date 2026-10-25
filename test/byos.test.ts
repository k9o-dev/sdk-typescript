/**
 * Unit tests for the BYOS credential-envelope wire format (`byos.ts`) — round-trips against the
 * CORE mint's per-provider reveal schemes.
 */

import { describe, expect, it } from "bun:test";
import { KError } from "../src/kerror.ts";
import {
  BYOS_CRED_REF_PREFIX,
  BYOS_CRED_FORMAT_VERSION,
  BYOS_CRED_VAULT_NAME_PREFIX,
  encodeByosCredential,
  byosCredentialRef,
  byosCredVaultName,
} from "../src/byos.ts";

describe("encodeByosCredential — aws_sigv4 (s3/s3_compatible/minio)", () => {
  it("encodes the aws_sigv4/sts envelope the CORE mint reads", () => {
    const value = encodeByosCredential({ provider: "s3", accessKeyId: "AKIA123", secretAccessKey: "shh", providerRegion: "us-east-1" });
    expect(JSON.parse(value)).toEqual({
      v: BYOS_CRED_FORMAT_VERSION,
      scheme: "aws_sigv4",
      service: "sts",
      providerRegion: "us-east-1",
      accessKeyId: "AKIA123",
      secretAccessKey: "shh",
    });
  });

  it("minio and s3_compatible seal the identical shape", () => {
    const minio = JSON.parse(encodeByosCredential({ provider: "minio", accessKeyId: "a", secretAccessKey: "b", providerRegion: "r" }));
    const compat = JSON.parse(encodeByosCredential({ provider: "s3_compatible", accessKeyId: "a", secretAccessKey: "b", providerRegion: "r" }));
    expect(minio).toEqual(compat);
    expect(minio.scheme).toBe("aws_sigv4");
    expect(minio.service).toBe("sts");
  });

  it("rejects a sessionToken (temporary credential) — a sealed cred must be long-lived", () => {
    expect(() =>
      encodeByosCredential({ provider: "s3", accessKeyId: "AKIA123", secretAccessKey: "shh", providerRegion: "us-east-1", sessionToken: "temp" }),
    ).toThrow(KError);
  });

  it("does not emit a sessionToken field even when absent/empty", () => {
    const value = encodeByosCredential({ provider: "s3", accessKeyId: "AKIA123", secretAccessKey: "shh", providerRegion: "us-east-1", sessionToken: "" });
    expect(JSON.parse(value)).not.toHaveProperty("sessionToken");
  });
});

describe("encodeByosCredential — gcs (gcp_workload_identity)", () => {
  it("encodes the gcp_workload_identity envelope", () => {
    const value = encodeByosCredential({ provider: "gcs", privateKeyPem: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----", clientId: "sa@project.iam.gserviceaccount.com" });
    expect(JSON.parse(value)).toEqual({
      v: BYOS_CRED_FORMAT_VERSION,
      scheme: "gcp_workload_identity",
      privateKeyPem: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      clientId: "sa@project.iam.gserviceaccount.com",
    });
  });
});

describe("encodeByosCredential — b2 (http_basic)", () => {
  it("maps keyId -> username, appKey -> password (RFC 7617 field names, not B2's native ones)", () => {
    const value = encodeByosCredential({ provider: "b2", keyId: "0012345", appKey: "K001abcdef" });
    expect(JSON.parse(value)).toEqual({
      v: BYOS_CRED_FORMAT_VERSION,
      scheme: "http_basic",
      username: "0012345",
      password: "K001abcdef",
    });
  });

  it("rejects a keyId containing ':' — RFC 7617 forbids it in the username", () => {
    expect(() => encodeByosCredential({ provider: "b2", keyId: "has:colon", appKey: "x" })).toThrow(KError);
  });
});

describe("encodeByosCredential — r2 (bearer)", () => {
  it("encodes the bearer envelope", () => {
    const value = encodeByosCredential({ provider: "r2", apiToken: "cf-token-abc" });
    expect(JSON.parse(value)).toEqual({ v: BYOS_CRED_FORMAT_VERSION, scheme: "bearer", token: "cf-token-abc" });
  });
});

describe("byosCredentialRef", () => {
  it("prefixes the secId with the kibo://byos-creds/ scheme", () => {
    expect(byosCredentialRef("sec_abc123")).toBe(`${BYOS_CRED_REF_PREFIX}sec_abc123`);
  });
});

describe("byosCredVaultName", () => {
  it("prefixes a bare name with the reserved byos-creds/ vault namespace", () => {
    expect(byosCredVaultName("s3-prod")).toBe(`${BYOS_CRED_VAULT_NAME_PREFIX}s3-prod`);
  });

  it("is idempotent — an already-prefixed name is not double-nested", () => {
    expect(byosCredVaultName("byos-creds/s3-prod")).toBe("byos-creds/s3-prod");
  });

  it("rejects a name containing '..'", () => {
    expect(() => byosCredVaultName("../etc")).toThrow(KError);
    expect(() => byosCredVaultName("byos-creds/../etc")).toThrow(KError);
  });

  it("rejects a name with characters outside [a-z0-9._/-]", () => {
    expect(() => byosCredVaultName("S3 Prod!")).toThrow(KError);
  });

  it("rejects an empty name (bare or after stripping the prefix)", () => {
    expect(() => byosCredVaultName("")).toThrow(KError);
    expect(() => byosCredVaultName("byos-creds/")).toThrow(KError);
  });
});
