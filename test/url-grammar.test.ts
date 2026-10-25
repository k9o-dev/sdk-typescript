/**
 * Unit tests for URL grammar validation + path builders.
 */

import { describe, expect, it } from "bun:test";
import {
  validateBaseUrl,
  resolveBaseUrl,
  validateSlug,
  projectPath,
  orgPath,
  platformPath,
} from "../src/url-grammar.ts";
import { KError } from "../src/kerror.ts";

describe("validateBaseUrl — accepted forms", () => {
  it("accepts https host-only", () => {
    expect(validateBaseUrl("https://api.k9o.io")).toBe("https://api.k9o.io");
  });
  it("accepts https with subdomain (org)", () => {
    expect(validateBaseUrl("https://acme.api.k9o.io")).toBe("https://acme.api.k9o.io");
  });
  it("accepts http localhost with port", () => {
    expect(validateBaseUrl("http://localhost:8080")).toBe("http://localhost:8080");
  });
  it("accepts https with explicit standard port", () => {
    // URL parser drops the default port
    expect(validateBaseUrl("https://api.k9o.io:443")).toBe("https://api.k9o.io");
  });
  it("normalises trailing slash", () => {
    expect(validateBaseUrl("https://api.k9o.io/")).toBe("https://api.k9o.io");
  });
});

describe("validateBaseUrl — rejected forms (K9O_INVALID_BASE_URL)", () => {
  it("rejects path segment", () => {
    expect(() => validateBaseUrl("https://api.k9o.io/v2")).toThrow(KError);
    try {
      validateBaseUrl("https://api.k9o.io/v2");
    } catch (e) {
      expect(e).toBeInstanceOf(KError);
      expect((e as KError).code).toBe("K9O_INVALID_BASE_URL");
    }
  });
  it("rejects missing scheme", () => {
    expect(() => validateBaseUrl("api.k9o.io")).toThrow(KError);
  });
  it("rejects websocket scheme", () => {
    expect(() => validateBaseUrl("wss://api.k9o.io")).toThrow(KError);
  });
  it("rejects query string", () => {
    expect(() => validateBaseUrl("https://api.k9o.io?x=1")).toThrow(KError);
  });
  it("rejects fragment", () => {
    expect(() => validateBaseUrl("https://api.k9o.io#frag")).toThrow(KError);
  });
});

describe("validateSlug", () => {
  it("accepts canonical slugs", () => {
    expect(() => validateSlug("acme", "org")).not.toThrow();
    expect(() => validateSlug("member-portal", "project")).not.toThrow();
    expect(() => validateSlug("a1", "org")).not.toThrow();
    expect(() => validateSlug("a-1-z", "project")).not.toThrow();
  });
  it("rejects uppercase", () => {
    expect(() => validateSlug("Acme", "org")).toThrow(KError);
  });
  it("rejects leading digit", () => {
    expect(() => validateSlug("1acme", "org")).toThrow(KError);
  });
  it("rejects leading hyphen", () => {
    expect(() => validateSlug("-acme", "org")).toThrow(KError);
  });
  it("rejects trailing hyphen", () => {
    expect(() => validateSlug("acme-", "org")).toThrow(KError);
  });
  it("rejects single-char (too short)", () => {
    expect(() => validateSlug("a", "org")).toThrow(KError);
  });
  it("rejects oversize (>63)", () => {
    expect(() => validateSlug("a" + "b".repeat(63), "org")).toThrow(KError);
  });
});

describe("path builders", () => {
  it("projectPath composes /@<slug>/<resource>", () => {
    expect(projectPath("member-portal", "collections/posts/documents")).toBe(
      "/@member-portal/collections/posts/documents",
    );
  });
  it("projectPath tolerates leading slash on resource", () => {
    expect(projectPath("acme", "/project")).toBe("/@acme/project");
  });
  it("orgPath composes /<resource>", () => {
    expect(orgPath("projects")).toBe("/projects");
  });
  it("platformPath composes /<resource>", () => {
    expect(platformPath("discovery/projects")).toBe("/discovery/projects");
  });
});

describe("resolveBaseUrl — optional baseUrl + orgSlug-derived subdomain ", () => {
  it("omitted baseUrl + orgSlug derives the canonical org subdomain", () => {
    expect(resolveBaseUrl(undefined, "acme")).toBe("https://acme.api.k9o.io");
  });
  it("bare apex baseUrl + orgSlug derives the subdomain", () => {
    expect(resolveBaseUrl("https://api.k9o.io", "acme")).toBe("https://acme.api.k9o.io");
  });
  it("explicit org subdomain passes through unchanged", () => {
    expect(resolveBaseUrl("https://acme.api.k9o.io", "acme")).toBe("https://acme.api.k9o.io");
  });
  it("self-hosted / Sovereign host passes through unchanged", () => {
    expect(resolveBaseUrl("https://platform.acme.internal", "acme")).toBe("https://platform.acme.internal");
  });
  it("dev host passes through unchanged", () => {
    expect(resolveBaseUrl("http://localhost:8080", "acme")).toBe("http://localhost:8080");
  });
  it("omitted baseUrl with no orgSlug stays at the bare apex", () => {
    expect(resolveBaseUrl(undefined, undefined)).toBe("https://api.k9o.io");
  });
  it("rejects a malformed orgSlug when deriving", () => {
    expect(() => resolveBaseUrl("https://api.k9o.io", "Bad_Slug")).toThrow(KError);
  });

  // Fixed 2026-08-30 (SDK-2): the staging apex used to silently ignore
  // orgSlug because only the literal "api.k9o.io" string was checked.
  it("staging apex baseUrl + orgSlug derives the staging org subdomain (was silently ignored before the fix)", () => {
    expect(resolveBaseUrl("https://api-staging.k9o.io", "acme")).toBe("https://acme.api-staging.k9o.io");
  });
  it("explicit staging org subdomain passes through unchanged", () => {
    expect(resolveBaseUrl("https://acme.api-staging.k9o.io", "acme")).toBe("https://acme.api-staging.k9o.io");
  });
  it("staging apex with no orgSlug stays at the bare staging apex", () => {
    expect(resolveBaseUrl("https://api-staging.k9o.io", undefined)).toBe("https://api-staging.k9o.io");
  });
  it("rejects a malformed orgSlug when deriving on the staging apex too", () => {
    expect(() => resolveBaseUrl("https://api-staging.k9o.io", "Bad_Slug")).toThrow(KError);
  });
  // Self-hosted/custom-host passthrough (the case above at line 114-116)
  // remains unchanged and deliberate — only these two confirmed apexes
  // derive an org subdomain; nothing else is inferred from hostname shape.
});
