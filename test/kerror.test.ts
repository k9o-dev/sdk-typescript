/**
 * Unit tests for `KError` + `kerrorFromWire`.
 */

import { describe, expect, it } from "bun:test";
import { KError, kerrorFromWire, type KErrorWire } from "../src/kerror.ts";

describe("KError construct shape", () => {
  it("constructs with required fields + sets defaults for optional", () => {
    const e = new KError({ code: "K9O_INVALID_FIELD_VALUE", message: "bad" });
    expect(e.code).toBe("K9O_INVALID_FIELD_VALUE");
    expect(e.message).toBe("bad");
    expect(e.context).toEqual({});
    expect(e.recommendation).toBeNull();
    expect(e.status).toBeNull();
    expect(e.requestId).toBeNull();
    expect(e.name).toBe("KError");
    expect(e).toBeInstanceOf(Error);
  });

  it("freezes context to prevent caller mutation", () => {
    const e = new KError({
      code: "K9O_TIER_CAP_HIT",
      message: "cap",
      context: { dimension: "mau", limit: 1000 },
    });
    expect(Object.isFrozen(e.context)).toBe(true);
    expect(() => {
      (e.context as Record<string, unknown>)["dimension"] = "x";
    }).toThrow();
  });
});

describe("kerrorFromWire rehydration", () => {
  it("rehydrates wire payload into typed KError + preserves all fields", () => {
    const wire: KErrorWire = {
      code: "K9O_PROJECT_NOT_FOUND",
      message: "no such project",
      context: { projectSlug: "ghost" },
      recommendation: "create the project first",
      requestId: "req_abc123",
    };
    const e = kerrorFromWire(wire, 404);
    expect(e.code).toBe("K9O_PROJECT_NOT_FOUND");
    expect(e.message).toBe("no such project");
    expect(e.context).toEqual({ projectSlug: "ghost" });
    expect(e.recommendation).toBe("create the project first");
    expect(e.status).toBe(404);
    expect(e.requestId).toBe("req_abc123");
  });

  it("passes through unknown codes (no allowlist; open code-space)", () => {
    const wire: KErrorWire = {
      code: "K9O_NEW_CODE_NOT_YET_KNOWN",
      message: "novel",
    };
    const e = kerrorFromWire(wire, 422);
    expect(e.code).toBe("K9O_NEW_CODE_NOT_YET_KNOWN");
    expect(e.status).toBe(422);
  });

  it("tolerates missing optional fields", () => {
    const e = kerrorFromWire({ code: "X", message: "y" }, 500);
    expect(e.context).toEqual({});
    expect(e.recommendation).toBeNull();
    expect(e.requestId).toBeNull();
  });
});
