/**
 * Studio Workflows SDK — `client.studio.workflows.*`.
 *
 * Workflows substrate. Mirrors
 * `_sys.workflows` + `_sys.workflow_runs` row shapes.
 *
 * Wire mapping (project-plane):
 *   - list()                       → GET    /@<slug>/workflows
 *   - create(workflow)             → POST   /@<slug>/workflows
 *   - read(id)                     → GET    /@<slug>/workflows/<wfl-id>
 *   - update(id, updates)          → PATCH  /@<slug>/workflows/<wfl-id>
 *   - delete(id)                   → DELETE /@<slug>/workflows/<wfl-id>
 *   - trigger(id, triggerContext)  → POST   /@<slug>/workflows/<wfl-id>/runs
 *   - runs.list(id)                → GET    /@<slug>/workflows/<wfl-id>/runs
 *   - runs.read(id, runId)         → GET    /@<slug>/workflows/<wfl-id>/runs/<wfr-id>
 *   - runs.cancel(id, runId)       → POST   /@<slug>/workflows/<wfl-id>/runs/<wfr-id>/cancel
 *
 * RBAC: create/update/delete/trigger/cancel require
 * PROJECT_AUTHOR; list/read/runs read against all cohort roles subject
 * to RLS. Surfaces 6 K9O_WORKFLOW_* error codes (see
 * `WORKFLOW_ERROR_CODES`); callers narrow on `error.code`.
 */

import { request, type HttpClientConfig } from "../http.ts";
import { projectPath } from "../url-grammar.ts";
import type { Envelope } from "../envelope.ts";

// ----------------------------------------------------------------------
// Enums (closed set)
// ----------------------------------------------------------------------

/** 5-trigger catalogue. */
export type WorkflowTriggerType =
  | "view_row_event"
  | "form_submission"
  | "scheduled"
  | "manual"
  | "webhook";

/** 9-action catalogue. */
export type WorkflowActionType =
  | "write_collection"
  | "read_collection"
  | "invoke_function"
  | "invoke_extension"
  | "llm_inference"
  | "send_notification"
  | "http_request"
  | "approval_step"
  | "branch";

export type WorkflowStatus = "active" | "archived" | "draft";

export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

/** A single step in the `actions` chain. */
export type WorkflowAction = {
  index: number;
  action_type: WorkflowActionType;
  config: Record<string, unknown>;
  retry?: { maxAttempts: number; backoffStrategy?: string };
  condition?: Record<string, unknown>;
  /** Sibling steps with parallel:true execute concurrently. */
  parallel?: boolean;
};

// ----------------------------------------------------------------------
// Resource shapes (mirror _sys.workflows + _sys.workflow_runs rows)
// ----------------------------------------------------------------------

/** Workflow record. */
export type Workflow = {
  /** `wfl_<base62>`. */
  id: string;
  projectId: string;
  name: string;
  description: string;
  status: WorkflowStatus;
  triggerType: WorkflowTriggerType;
  /** Shape varies per triggerType. */
  triggerConfig: Record<string, unknown>;
  /** Chain definition. */
  actions: ReadonlyArray<WorkflowAction>;
  /** Approver-step participant resolution. */
  rbacBinding: Record<string, unknown>;
  authoredBy: string;
  authoredAt: string;
  updatedBy: string;
  updatedAt: string;
};

/** Per-step status entry in a run `per_step_status`. */
export type WorkflowRunStep = {
  stepIndex: number;
  actionType: WorkflowActionType;
  status: "running" | "succeeded" | "failed" | "awaiting_approval";
  startedAt: string;
  completedAt?: string | null;
  error?: Record<string, unknown> | null;
  outputSummary?: unknown;
  costSubtotal?: number;
};

/** Workflow run record. */
export type WorkflowRun = {
  /** `wfr_<base62>`. */
  id: string;
  workflowId: string;
  projectId: string;
  status: WorkflowRunStatus;
  triggerContext: Record<string, unknown>;
  perStepStatus: ReadonlyArray<WorkflowRunStep>;
  costAccountingTotal: number;
  errorContext?: Record<string, unknown> | null;
  startedAt: string;
  completedAt: string | null;
  firedBy: string;
};

/** Create input — omits server-assigned fields. */
export type CreateWorkflowInput = {
  name: string;
  description?: string;
  status?: WorkflowStatus;
  triggerType: WorkflowTriggerType;
  triggerConfig: Record<string, unknown>;
  actions: ReadonlyArray<WorkflowAction>;
  rbacBinding?: Record<string, unknown>;
};

export type UpdateWorkflowInput = Partial<
  Pick<
    CreateWorkflowInput,
    "name" | "description" | "status" | "triggerType" | "triggerConfig" | "actions" | "rbacBinding"
  >
>;

export type WorkflowListFilters = {
  limit?: number;
  cursor?: string;
  status?: WorkflowStatus;
  triggerType?: WorkflowTriggerType;
};

export type WorkflowRunListFilters = {
  limit?: number;
  cursor?: string;
  status?: WorkflowRunStatus;
};

/**
 * 6 K9O_WORKFLOW_* error codes. KError code-space is
 * open; these constants document the well-known codes for narrowing
 * (`if (e.code === WORKFLOW_ERROR_CODES.RUN_NOT_CANCELLABLE)`).
 */
export const WORKFLOW_ERROR_CODES = {
  NOT_FOUND: "K9O_WORKFLOW_NOT_FOUND",
  TRIGGER_INVALID: "K9O_WORKFLOW_TRIGGER_INVALID",
  ACTION_INVALID: "K9O_WORKFLOW_ACTION_INVALID",
  RUN_NOT_FOUND: "K9O_WORKFLOW_RUN_NOT_FOUND",
  RUN_NOT_CANCELLABLE: "K9O_WORKFLOW_RUN_NOT_CANCELLABLE",
  WEBHOOK_SIGNATURE_INVALID: "K9O_WORKFLOW_WEBHOOK_SIGNATURE_INVALID",
} as const;

function requireProjectSlug(config: HttpClientConfig): string {
  if (typeof config.projectSlug !== "string" || config.projectSlug.length === 0) {
    throw new Error("studio.workflows operations require projectSlug bound on the client");
  }
  return config.projectSlug;
}

function makeRunsNamespace(config: HttpClientConfig) {
  return {
    /** GET /@<slug>/workflows/<wfl-id>/runs — cursor-paginated runs list. */
    async list(workflowId: string, filters?: WorkflowRunListFilters): Promise<Envelope<ReadonlyArray<WorkflowRun>>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "GET",
        path: projectPath(slug, `workflows/${encodeURIComponent(workflowId)}/runs`),
        query: filters,
      });
    },

    /** GET /@<slug>/workflows/<wfl-id>/runs/<wfr-id> — run detail (per-step + cost). */
    async read(workflowId: string, runId: string): Promise<Envelope<WorkflowRun>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "GET",
        path: projectPath(slug, `workflows/${encodeURIComponent(workflowId)}/runs/${encodeURIComponent(runId)}`),
      });
    },

    /** POST /@<slug>/workflows/<wfl-id>/runs/<wfr-id>/cancel — cancel pending or running run. */
    async cancel(workflowId: string, runId: string): Promise<Envelope<WorkflowRun>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "POST",
        path: projectPath(slug, `workflows/${encodeURIComponent(workflowId)}/runs/${encodeURIComponent(runId)}/cancel`),
      });
    },
  };
}

export function makeWorkflowsNamespace(config: HttpClientConfig) {
  return {
    /** GET /@<slug>/workflows — list workflows (cursor pagination). */
    async list(filters?: WorkflowListFilters): Promise<Envelope<ReadonlyArray<Workflow>>> {
      const slug = requireProjectSlug(config);
      return request(config, { method: "GET", path: projectPath(slug, "workflows"), query: filters });
    },

    /** POST /@<slug>/workflows — create a workflow. Requires PROJECT_AUTHOR. */
    async create(workflow: CreateWorkflowInput): Promise<Envelope<Workflow>> {
      const slug = requireProjectSlug(config);
      return request(config, { method: "POST", path: projectPath(slug, "workflows"), body: workflow });
    },

    /** GET /@<slug>/workflows/<wfl-id> — read a workflow. */
    async read(workflowId: string): Promise<Envelope<Workflow>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "GET",
        path: projectPath(slug, `workflows/${encodeURIComponent(workflowId)}`),
      });
    },

    /** PATCH /@<slug>/workflows/<wfl-id> — update a workflow. Requires PROJECT_AUTHOR. */
    async update(workflowId: string, updates: UpdateWorkflowInput): Promise<Envelope<Workflow>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "PATCH",
        path: projectPath(slug, `workflows/${encodeURIComponent(workflowId)}`),
        body: updates,
      });
    },

    /** DELETE /@<slug>/workflows/<wfl-id> — delete a workflow. Requires PROJECT_AUTHOR. */
    async delete(workflowId: string): Promise<Envelope<{ deleted: boolean }>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "DELETE",
        path: projectPath(slug, `workflows/${encodeURIComponent(workflowId)}`),
      });
    },

    /**
     * POST /@<slug>/workflows/<wfl-id>/runs — manual-trigger a run.
     * Valid only for `triggerType: 'manual'` workflows.
     * Requires PROJECT_AUTHOR. The argument is sent as `{ triggerContext }`. Returns the materialised WorkflowRun.
     */
    async trigger(workflowId: string, triggerContext: Record<string, unknown> = {}): Promise<Envelope<WorkflowRun>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "POST",
        path: projectPath(slug, `workflows/${encodeURIComponent(workflowId)}/runs`),
        body: { triggerContext },
      });
    },

    /** Run sub-namespace — list / read / cancel runs of a workflow. */
    runs: makeRunsNamespace(config),
  };
}
