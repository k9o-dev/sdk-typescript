/**
 * The documented @k9o/core surface, one entry per method: how to call it with representative arguments. The contract
 * test sends each call through the recording client and checks the request against the gateway OpenAPI.
 *
 * `contract` is a body contract for a route whose OpenAPI entry declares no request body (the gateway owes those schemas; see
 * the SDK contract, rule 2). It is the body the gateway's own handler reads. `broken` marks a call that is known to disagree
 * with the gateway today; the contract test requires the entry to still fail and fails once the call is fixed, so the list
 * can only shrink.
 */
import type { BodySchema } from "./openapi.ts";

// biome-ignore lint/suspicious/noExplicitAny: the table exercises every namespace
export type Client = any;

export type CallEntry = {
  id: string;
  call: (c: Client) => Promise<unknown>;
  /** Body contract for a route whose OpenAPI entry declares none (taken from the gateway handler named in the comment). */
  contract?: BodySchema;
  /** The body is not JSON (a binary upload): only the route is checked. */
  raw?: boolean;
  broken?: string;
  /** Query parameters the gateway handler reads although its OpenAPI entry omits them (name the handler). */
  extraQuery?: string[];
};

import { CALLS_PROJECTS_FUNCTIONS_POLICIES_AUDIT } from "./calls-projects-functions-policies-audit.ts";
import { CALLS_ORG_ME } from "./calls-org-me.ts";
import { CALLS_COMPUTE_STUDIO_KIBO_MIGRATIONS_STORAGE } from "./calls-compute-studio-kibo-migrations-storage.ts";

export const CALLS: CallEntry[] = [...CALLS_PROJECTS_FUNCTIONS_POLICIES_AUDIT, ...CALLS_ORG_ME, ...CALLS_COMPUTE_STUDIO_KIBO_MIGRATIONS_STORAGE];
