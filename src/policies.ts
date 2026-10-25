/**
 * Policy bundle lifecycle SDK — `client.policies.*`.
 *
 * Backed by the gateway policies routes.
 *
 * Wire mapping:
 *   - `current()`                         → GET    /@<slug>/policy           (active policy)
 *   - `list()`                            → GET    /@<slug>/policies         (all bundles)
 *   - `create({...})`                     → POST   /@<slug>/policies         (draft bundle)
 *   - `validate({...})`                   → POST   /@<slug>/policies/validate (lint without persist)
 *   - `get(bundleId)`                     → GET    /@<slug>/policies/<id>
 *   - `update(bundleId, patch)`           → PATCH  /@<slug>/policies/<id>
 *   - `delete(bundleId)`                  → DELETE /@<slug>/policies/<id>
 *   - `publish(bundleId)`                 → POST   /@<slug>/policies/<id>/publish
 *
 * Per: only Pathmaker-class roles author policy; only
 * Custodian-class roles publish. `validate` is read-only and any role
 * with policy-read can lint a candidate bundle.
 */

import { request, type HttpClientConfig } from "./http.ts";
import { projectPath } from "./url-grammar.ts";
import type { Envelope } from "./envelope.ts";

export type PolicyBundle = {
  /** `pol_<base62>`. */
  id: string;
  name: string;
  version: number;
  status: "draft" | "published" | "deactivated";
  rules: Record<string, unknown>;
  createdAt: string;
  publishedAt: string | null;
  createdBy: string;
};

export type CreatePolicyInput = {
  name: string;
  rules: Record<string, unknown>;
};

export type UpdatePolicyInput = {
  name?: string;
  rules?: Record<string, unknown>;
};

export type ValidatePolicyResult = {
  valid: boolean;
  errors: ReadonlyArray<{ rule: string; message: string }>;
  warnings: ReadonlyArray<{ rule: string; message: string }>;
};

function requireProjectSlug(config: HttpClientConfig): string {
  if (typeof config.projectSlug !== "string" || config.projectSlug.length === 0) {
    throw new Error("policies operations require projectSlug bound on the client");
  }
  return config.projectSlug;
}

export function makePoliciesNamespace(config: HttpClientConfig) {
  return {
    /** Return the currently-active policy for the project. */
    async current(): Promise<Envelope<PolicyBundle | null>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "GET",
        path: projectPath(slug, "policy"),
      });
    },

    /** List all policy bundles (draft + published + deactivated). */
    async list(opts?: { status?: PolicyBundle["status"] | undefined; limit?: number | undefined; cursor?: string | undefined }): Promise<Envelope<ReadonlyArray<PolicyBundle>>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "GET",
        path: projectPath(slug, "policies"),
        query: opts,
      });
    },

    /** Create a draft policy bundle. */
    async create(input: CreatePolicyInput): Promise<Envelope<PolicyBundle>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "POST",
        path: projectPath(slug, "policies"),
        body: input,
      });
    },

    /** Lint a candidate rule set without persisting. */
    async validate(input: { rules: Record<string, unknown> }): Promise<Envelope<ValidatePolicyResult>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "POST",
        path: projectPath(slug, "policies/validate"),
        body: input,
      });
    },

    /** Get a single bundle by id. */
    async get(bundleId: string): Promise<Envelope<PolicyBundle>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "GET",
        path: projectPath(slug, `policies/${encodeURIComponent(bundleId)}`),
      });
    },

    /** Patch a draft bundle. Cannot patch published bundles (publish→republish flow). */
    async update(bundleId: string, patch: UpdatePolicyInput): Promise<Envelope<PolicyBundle>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "PATCH",
        path: projectPath(slug, `policies/${encodeURIComponent(bundleId)}`),
        body: patch,
      });
    },

    /** Delete a draft bundle. Cannot delete published bundles. */
    async delete(bundleId: string): Promise<Envelope<{ deleted: boolean }>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "DELETE",
        path: projectPath(slug, `policies/${encodeURIComponent(bundleId)}`),
      });
    },

    /** Publish a draft bundle — transitions to `published` + becomes active for the project. */
    async publish(bundleId: string): Promise<Envelope<PolicyBundle>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "POST",
        path: projectPath(slug, `policies/${encodeURIComponent(bundleId)}/publish`),
      });
    },
  };
}
