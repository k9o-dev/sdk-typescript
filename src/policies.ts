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
 * Only authoring roles write policy and only custodian roles publish.
 * `validate` is read-only and any role with policy-read can lint a
 * candidate document.
 */

import { request, type HttpClientConfig } from "./http.ts";
import { projectPath } from "./url-grammar.ts";
import type { Envelope } from "./envelope.ts";

export type PolicyBundle = {
  /** `pol_<base62>`. */
  id: string;
  projectId: string;
  status: "draft" | "published" | "superseded";
  /** The policy document. */
  policy: PolicyDocument;
  /** The rules catalogue, when the bundle carries one. */
  rules?: unknown;
  createdBy: string;
  createdAt: string;
  publishedAt: string | null;
  supersededAt: string | null;
  supersededBy: string | null;
  source: "rest" | "migration" | "cli";
  editorMode: "visual" | "json" | "unspecified";
  supersededReason: string | null;
  /** Id of a queued publish awaiting a second approver, else `null`. */
  pendingChangeId: string | null;
};

/** Answer of `publish`: the publish is queued for approval (HTTP 202). */
export type PolicyPublishResult = {
  pendingChangeId: string;
  bundleId: string;
  status: "pending_approval";
};

/**
 * The policy document: sections keyed by resource kind (`collections`,
 * `storage`, `tools`, `functions`, `secrets`, `streams`, `analytics`);
 * other keys are allowed.
 */
export type PolicyDocument = Record<string, unknown>;

export type CreatePolicyInput = {
  policy: PolicyDocument;
  rules?: unknown;
  editorMode?: "visual" | "json" | "unspecified" | undefined;
};

export type UpdatePolicyInput = {
  policy: PolicyDocument;
  rules?: unknown;
  editorMode?: "visual" | "json" | "unspecified" | undefined;
};

export type ValidatePolicyInput = {
  policy: PolicyDocument;
  rules?: unknown;
};

/** Validation failures are errors, so a successful validate always answers `{ valid: true }`. */
export type ValidatePolicyResult = {
  valid: true;
};

/** Optional publish controls; property names are the gateway's. */
export type PublishPolicyOptions = {
  acknowledgeSelfLockout?: boolean | undefined;
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

    /** List all policy bundles (draft + published + superseded). */
    async list(opts?: { status?: PolicyBundle["status"] | undefined }): Promise<Envelope<ReadonlyArray<PolicyBundle>>> {
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

    /** Lint a candidate policy document without persisting. */
    async validate(input: ValidatePolicyInput): Promise<Envelope<ValidatePolicyResult>> {
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

    /** Replace a draft bundle's policy document. Cannot patch published bundles (publish→republish flow). */
    async update(bundleId: string, patch: UpdatePolicyInput): Promise<Envelope<PolicyBundle>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "PATCH",
        path: projectPath(slug, `policies/${encodeURIComponent(bundleId)}`),
        body: patch,
      });
    },

    /** Delete a draft bundle. Cannot delete published bundles. The gateway answers 204 with no body. */
    async delete(bundleId: string): Promise<Envelope<undefined>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "DELETE",
        path: projectPath(slug, `policies/${encodeURIComponent(bundleId)}`),
      });
    },

    /**
     * Publish a draft bundle. The gateway answers 202 with `{ pendingChangeId, bundleId }`: the publish waits for
     * approval, then the bundle becomes active. Pass `acknowledgeSelfLockout: true` to proceed when the bundle
     * would remove your own read access to a collection.
     */
    async publish(bundleId: string, options?: PublishPolicyOptions): Promise<Envelope<PolicyPublishResult>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "POST",
        path: projectPath(slug, `policies/${encodeURIComponent(bundleId)}/publish`),
        ...(options !== undefined ? { body: options } : {}),
      });
    },
  };
}
