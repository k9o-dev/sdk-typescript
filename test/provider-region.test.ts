/**
 * `providerRegion` is put into hostnames by the mint, so it is a closed grammar per provider:
 * refused before any request is sent and before a credential is sealed.
 */
import { describe, expect, it } from "bun:test";
import { createClient } from "../src/index.ts";
import { assertProviderRegion, isProviderRegion } from "../src/provider-region.ts";
import { encodeByosCredential } from "../src/byos.ts";

const HOSTILE = ["x.attacker.net#", "us-east-1.evil", "..", "", "US-EAST-1", "us-east-1/", "us east 1", "us-east-1\n"];

describe("provider region grammar", () => {
  it("accepts the provider's own names", () => {
    expect(isProviderRegion("us-east-1", "s3")).toBe(true);
    expect(isProviderRegion("us-gov-west-1", "s3")).toBe(true);
    expect(isProviderRegion("eu-central-003", "b2")).toBe(true);
    expect(isProviderRegion("auto", "r2")).toBe(true);
    expect(isProviderRegion("europe-west3", "gcs")).toBe(true);
    expect(isProviderRegion("germanywestcentral", "azure_blob")).toBe(true);
    expect(isProviderRegion("us-east-1", "minio")).toBe(true);
    expect(isProviderRegion("us-east-1", "s3_compatible")).toBe(true);
  });

  it("refuses each hostile value for every provider", () => {
    for (const provider of ["s3", "b2", "r2", "gcs", "azure_blob", "minio", "s3_compatible"] as const) {
      for (const v of HOSTILE) expect(isProviderRegion(v, provider), `${provider} ${JSON.stringify(v)}`).toBe(false);
    }
  });

  it("is per provider: a platform short code is not an AWS region, and only `auto` is an R2 region", () => {
    expect(isProviderRegion("de01", "s3")).toBe(false);
    expect(isProviderRegion("us-east-1", "r2")).toBe(false);
    expect(isProviderRegion("us-east-1", "b2")).toBe(false);
    expect(isProviderRegion("eu-central-003", "s3")).toBe(false);
    expect(isProviderRegion("a".repeat(33), "gcs")).toBe(false);
    for (const provider of ["gcs", "azure_blob", "minio", "s3_compatible"] as const) {
      expect(isProviderRegion("-nyc3", provider), provider).toBe(false);
      expect(isProviderRegion("nyc3-", provider), provider).toBe(false);
      expect(isProviderRegion("a", provider), provider).toBe(true);
      expect(isProviderRegion("nyc3", provider), provider).toBe(true);
    }
  });

  it("assertProviderRegion throws the gateway's own reason and never echoes the value", () => {
    let caught: unknown;
    try { assertProviderRegion("x.attacker.net#", "s3"); } catch (e) { caught = e; }
    expect(caught).toMatchObject({ code: "K9O_INVALID_FIELD_VALUE", context: { field: "providerRegion", reason: "provider_region_invalid", provider: "s3" } });
    expect(JSON.stringify(caught)).not.toContain("attacker");
  });
});

describe("where it is enforced", () => {
  let calls = 0;
  const client = createClient({
    baseUrl: "https://api.example.com", // never probed
    projectSlug: "member-portal",
    fetch: (async () => { calls++; return new Response(JSON.stringify({ data: {}, meta: {} }), { status: 200 }); }) as unknown as typeof globalThis.fetch,
  });
  const base = { bucketName: "b", region: "de01", credentialRef: "kibo://byos-creds/sec_x" } as const;

  it("storage.locations.create refuses a bad providerRegion before any request, and sends a good one", async () => {
    for (const v of HOSTILE) {
      await expect(client.storage.locations.create({ ...base, provider: "s3", providerRegion: v })).rejects.toMatchObject({ code: "K9O_INVALID_FIELD_VALUE" });
    }
    await expect(client.storage.locations.create({ ...base, provider: "r2", providerRegion: "us-east-1" })).rejects.toMatchObject({ code: "K9O_INVALID_FIELD_VALUE" });
    expect(calls).toBe(0);
    await client.storage.locations.create({ ...base, provider: "s3", providerRegion: "us-east-1" });
    expect(calls).toBe(1);
  });

  it("storage.locations.update checks the charset when providerRegion is in the patch, and not otherwise", async () => {
    calls = 0;
    await expect(client.storage.locations.update("byos_1", { providerRegion: "x.attacker.net#" })).rejects.toMatchObject({ code: "K9O_INVALID_FIELD_VALUE" });
    expect(calls).toBe(0);
    await client.storage.locations.update("byos_1", { providerRegion: "eu-west-1" });
    await client.storage.locations.update("byos_1", { bucketName: "other" });
    expect(calls).toBe(2);
  });

  it("encodeByosCredential refuses to seal a malformed signing region", () => {
    for (const v of HOSTILE) {
      expect(() => encodeByosCredential({ provider: "s3", accessKeyId: "AKIA1", secretAccessKey: "shh", providerRegion: v }), JSON.stringify(v)).toThrow();
    }
    expect(JSON.parse(encodeByosCredential({ provider: "s3", accessKeyId: "AKIA1", secretAccessKey: "shh", providerRegion: "us-east-1" })).providerRegion).toBe("us-east-1");
  });
});
