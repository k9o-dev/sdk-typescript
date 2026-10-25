/**
 * `client.storage` buckets and objects: URL, verb and body of each operation against
 * `/@<projectSlug>/storage/buckets…`, the multipart upload, the required `expiresIn`, and the bound-project guard.
 */

import { describe, expect, it } from "bun:test";
import { createClient } from "../src/index.ts";
import { KError } from "../src/kerror.ts";

type Captured = { url: string; method: string; body?: unknown; headers?: Record<string, string> };

function captureFetch(cap: Captured, response: unknown = { data: null, meta: {} }, status = 200): typeof globalThis.fetch {
  return ((async (input: RequestInfo | URL, init?: RequestInit) => {
    cap.url = typeof input === "string" ? input : input.toString();
    cap.method = init?.method as string;
    cap.headers = init?.headers as Record<string, string>;
    if (init?.body !== undefined) cap.body = init.body;
    return new Response(JSON.stringify(response), { status, headers: { "content-type": "application/json" } });
  }) as unknown) as typeof globalThis.fetch;
}

const ROOT = "https://acme.api.k9o.io/@member-portal/storage/buckets";
const mk = (cap: Captured, response?: unknown, status?: number) =>
  createClient({ baseUrl: "https://acme.api.k9o.io", projectSlug: "member-portal", fetch: captureFetch(cap, response, status) });
const blank = (): Captured => ({ url: "", method: "" });

describe("client.storage buckets", () => {
  it("listBuckets GETs /storage/buckets", async () => {
    const cap = blank();
    await mk(cap, { data: [], meta: {} }).storage.listBuckets();
    expect([cap.method, cap.url]).toEqual(["GET", ROOT]);
  });

  it("getBucket GETs the named bucket, percent-encoding the name", async () => {
    const cap = blank();
    await mk(cap).storage.getBucket("avatars");
    expect([cap.method, cap.url]).toEqual(["GET", `${ROOT}/avatars`]);
    await mk(cap).storage.getBucket("a/b");
    expect(cap.url).toBe(`${ROOT}/a%2Fb`);
  });

  it("createBucket POSTs { name, ...options } as JSON", async () => {
    const cap = blank();
    await mk(cap).storage.createBucket("avatars", { public: false, fileSizeLimit: 10_485_760, allowedMimeTypes: ["image/png"], versioning: true });
    expect([cap.method, cap.url]).toEqual(["POST", ROOT]);
    expect(JSON.parse(cap.body as string)).toEqual({ name: "avatars", public: false, fileSizeLimit: 10_485_760, allowedMimeTypes: ["image/png"], versioning: true });
    expect(cap.headers?.["content-type"]).toBe("application/json");
  });

  it("updateBucket PATCHes only what is given, and null clears a limit", async () => {
    const cap = blank();
    await mk(cap).storage.updateBucket("avatars", { fileSizeLimit: null, deleteAfterDays: 30 });
    expect([cap.method, cap.url]).toEqual(["PATCH", `${ROOT}/avatars`]);
    expect(JSON.parse(cap.body as string)).toEqual({ fileSizeLimit: null, deleteAfterDays: 30 });
  });

  it("deleteBucket DELETEs, and sends ?empty=true only when asked to purge", async () => {
    const cap = blank();
    await mk(cap).storage.deleteBucket("avatars");
    expect([cap.method, cap.url]).toEqual(["DELETE", `${ROOT}/avatars`]);
    await mk(cap).storage.deleteBucket("avatars", { empty: true });
    expect(cap.url).toBe(`${ROOT}/avatars?empty=true`);
    await mk(cap).storage.deleteBucket("avatars", { empty: false });
    expect(cap.url).toBe(`${ROOT}/avatars`);
  });

  it("the locations namespace is still there beside the bucket operations", async () => {
    const cap = blank();
    await mk(cap, { data: [], meta: {} }).storage.locations.list();
    expect(cap.url).toBe("https://acme.api.k9o.io/@member-portal/storage/locations");
  });
});

describe("client.storage.from(bucket) objects", () => {
  it("upload POSTs multipart with file, path, contentType, upsert and metadata, and does not JSON-encode it", async () => {
    const cap = blank();
    await mk(cap, { data: { path: "user/a.jpg", size: 3, lastModified: null }, meta: {} })
      .storage.from("avatars")
      .upload("user/a.jpg", new Uint8Array([1, 2, 3]), { contentType: "image/jpeg", upsert: true, metadata: { userId: "u1" } });
    expect([cap.method, cap.url]).toEqual(["POST", `${ROOT}/avatars/objects`]);
    expect(cap.body).toBeInstanceOf(FormData);
    const f = cap.body as FormData;
    expect(f.get("path")).toBe("user/a.jpg");
    expect(f.get("contentType")).toBe("image/jpeg");
    expect(f.get("upsert")).toBe("true");
    expect(JSON.parse(f.get("metadata") as string)).toEqual({ userId: "u1" });
    const file = f.get("file") as File;
    expect(file.size).toBe(3);
    expect(file.type).toBe("image/jpeg");
    expect(cap.headers?.["content-type"], "the runtime must set the multipart boundary itself").toBeUndefined();
  });

  it("upload defaults to upsert=false and accepts a string", async () => {
    const cap = blank();
    await mk(cap).storage.from("docs").upload("a.txt", "hello");
    const f = cap.body as FormData;
    expect(f.get("upsert")).toBe("false");
    expect(f.get("contentType")).toBeNull();
    expect((f.get("file") as File).size).toBe(5);
  });

  it("createSignedUrl POSTs { path, expiresIn, download } and refuses a missing or out-of-range expiresIn", async () => {
    const cap = blank();
    await mk(cap, { data: { signedUrl: "https://x", expiresIn: 300 }, meta: {} }).storage.from("avatars").createSignedUrl("a.jpg", { expiresIn: 300, download: true });
    expect([cap.method, cap.url]).toEqual(["POST", `${ROOT}/avatars/objects/sign`]);
    expect(JSON.parse(cap.body as string)).toEqual({ path: "a.jpg", expiresIn: 300, download: true });

    const h = mk(blank()).storage.from("avatars");
    for (const bad of [undefined, 0, -1, 1.5, 604_801, Number.NaN, "300"]) {
      const err = await h.createSignedUrl("a.jpg", { expiresIn: bad as unknown as number }).catch((e) => e as KError);
      expect(err, String(bad)).toBeInstanceOf(KError);
      expect((err as KError).code).toBe("K9O_INVALID_FIELD_VALUE");
    }
    // an explicit boundary value is fine
    await mk(cap).storage.from("avatars").createSignedUrl("a.jpg", { expiresIn: 604_800 });
    expect(JSON.parse(cap.body as string).expiresIn).toBe(604_800);
  });

  it("list GETs /objects with ?prefix= only when given", async () => {
    const cap = blank();
    await mk(cap, { data: [], meta: {} }).storage.from("avatars").list();
    expect(cap.url).toBe(`${ROOT}/avatars/objects`);
    await mk(cap, { data: [], meta: {} }).storage.from("avatars").list({ prefix: "user/" });
    expect(cap.url).toBe(`${ROOT}/avatars/objects?prefix=user%2F`);
  });

  it("remove DELETEs /objects?path=", async () => {
    const cap = blank();
    await mk(cap, { data: { bucket: "avatars", path: "a b.jpg", deleted: true }, meta: {} }).storage.from("avatars").remove("a b.jpg");
    expect([cap.method, cap.url]).toEqual(["DELETE", `${ROOT}/avatars/objects?path=a+b.jpg`]);
  });

  it("an empty path or bucket name is refused before any request", async () => {
    const cap = blank();
    const c = mk(cap);
    for (const call of [
      () => c.storage.from("avatars").upload("", "x"),
      () => c.storage.from("avatars").remove(""),
      () => c.storage.from("avatars").createSignedUrl("", { expiresIn: 60 }),
      () => c.storage.getBucket(""),
    ]) {
      const err = await call().catch((e: unknown) => e as KError);
      expect((err as KError).code).toBe("K9O_INVALID_FIELD_VALUE");
    }
    expect(cap.url, "no request was made").toBe("");
  });

  it("a client without a bound project is refused with K9O_MISSING_PROJECT_CONTEXT", async () => {
    const c = createClient({ baseUrl: "https://acme.api.k9o.io", fetch: captureFetch(blank()) });
    for (const call of [() => c.storage.listBuckets(), () => c.storage.from("a").list()]) {
      const err = await call().catch((e: unknown) => e as KError);
      expect((err as KError).code).toBe("K9O_MISSING_PROJECT_CONTEXT");
    }
  });

  it("gateway errors surface as KError (409 already exists)", async () => {
    const cap = blank();
    const err = await mk(cap, { code: "K9O_ALREADY_EXISTS", message: "exists", context: {}, recommendation: null }, 409)
      .storage.from("avatars").upload("a.jpg", "x").catch((e) => e as KError);
    expect(err).toBeInstanceOf(KError);
    expect((err as KError).code).toBe("K9O_ALREADY_EXISTS");
  });
});

describe("bucket names that a URL layer would rewrite", () => {
  it("`.` and `..` are refused before any request, on the bucket and on the from() handle", async () => {
    let calls = 0;
    const client = createClient({
      baseUrl: "https://api.example.com", // never probed
      projectSlug: "member-portal",
      fetch: (async () => { calls++; return new Response(JSON.stringify({ data: null, meta: {} }), { status: 200 }); }) as unknown as typeof globalThis.fetch,
    });
    for (const name of [".", ".."]) {
      await expect(client.storage.getBucket(name)).rejects.toMatchObject({ code: "K9O_INVALID_FIELD_VALUE", context: { reason: "dot_segment" } });
      await expect(client.storage.from(name).list()).rejects.toMatchObject({ code: "K9O_INVALID_FIELD_VALUE" });
      await expect(client.storage.deleteBucket(name)).rejects.toMatchObject({ code: "K9O_INVALID_FIELD_VALUE" });
    }
    expect(calls).toBe(0);
    // POSITIVE CONTROL: an ordinary name still goes out.
    await client.storage.getBucket("avatars");
    expect(calls).toBe(1);
  });
});
