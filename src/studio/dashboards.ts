/**
 * Studio Dashboards SDK — `client.studio.dashboards.*`.
 *
 * Dashboards persisted authoring substrate.
 * Mirrors `_sys.dashboards` row shape.
 *
 * Wire mapping (project-plane;):
 *   - list()                  → GET    /@<slug>/dashboards
 *   - create(dashboard)       → POST   /@<slug>/dashboards
 *   - read(id)                → GET    /@<slug>/dashboards/<dsh-id>
 *   - update(id, updates)     → PATCH  /@<slug>/dashboards/<dsh-id>
 *   - delete(id)              → DELETE /@<slug>/dashboards/<dsh-id>
 *   - pin(id)                 → POST   /@<slug>/dashboards/<dsh-id>/pin
 *   - unpin(id)               → POST   /@<slug>/dashboards/<dsh-id>/unpin
 *
 * Per RBAC: create/update/delete/pin/unpin require
 * PROJECT_AUTHOR; list/read read against all cohort roles subject
 * to RLS. Per, surfaces 2 K9O_DASHBOARD_* codes.
 */

import { request, type HttpClientConfig } from "../http.ts";
import { projectPath } from "../url-grammar.ts";
import type { Envelope } from "../envelope.ts";

// ----------------------------------------------------------------------
// Enums (closed at v2 launch +)
// ----------------------------------------------------------------------

/** 9-widget catalogue. */
export type WidgetType =
  | "kpi_card"
  | "bar_chart"
  | "line_chart"
  | "pie_chart"
  | "data_table"
  | "filter_dropdown"
  | "filter_date_range"
  | "text_panel"
  | "workflow_status";

/** Widget data source modes. */
export type WidgetDataSourceMode = "view" | "query" | "workflow" | "rollup" | "form";

export type DashboardStatus = "active" | "archived" | "draft";

/** A widget config entry in the `widgets` array. */
export type Widget = {
  id: string;
  widgetType: WidgetType;
  title?: string;
  dataSource: {
    mode: WidgetDataSourceMode;
    /** Resolved per mode: viewId / queryId / workflowId / rollupSlug / formId. */
    config: Record<string, unknown>;
  };
  /** Widget-local config (display options, thresholds, etc.). */
  config?: Record<string, unknown>;
};

// ----------------------------------------------------------------------
// Resource shapes (mirror _sys.dashboards row)
// ----------------------------------------------------------------------

/** Dashboard record `_sys.dashboards` row. */
export type Dashboard = {
  /** `dsh_<base62>`. */
  id: string;
  projectId: string;
  name: string;
  description: string;
  status: DashboardStatus;
  /** Widget positions + sizes per output-03 layout schema. */
  layoutGrid: Record<string, unknown>;
  widgets: ReadonlyArray<Widget>;
  /** Dashboard-level filter widgets cascade to per-widget data sources. */
  filterConfig: Record<string, unknown>;
  /** Pathmaker org-pin per output-03; surfaces in Workspace sidebar. */
  pinnedToWorkspace: boolean;
  rbacBinding: Record<string, unknown>;
  authoredBy: string;
  authoredAt: string;
  updatedBy: string;
  updatedAt: string;
};

export type CreateDashboardInput = {
  name: string;
  description?: string;
  status?: DashboardStatus;
  layoutGrid?: Record<string, unknown>;
  widgets?: ReadonlyArray<Widget>;
  filterConfig?: Record<string, unknown>;
  rbacBinding?: Record<string, unknown>;
};

export type UpdateDashboardInput = Partial<CreateDashboardInput>;

export type DashboardListFilters = {
  limit?: number;
  cursor?: string;
  status?: DashboardStatus;
  pinnedToWorkspace?: boolean;
};

/** 2 K9O_DASHBOARD_* error codes. */
export const DASHBOARD_ERROR_CODES = {
  NOT_FOUND: "K9O_DASHBOARD_NOT_FOUND",
  WIDGET_INVALID: "K9O_DASHBOARD_WIDGET_INVALID",
} as const;

function requireProjectSlug(config: HttpClientConfig): string {
  if (typeof config.projectSlug !== "string" || config.projectSlug.length === 0) {
    throw new Error("studio.dashboards operations require projectSlug bound on the client");
  }
  return config.projectSlug;
}

export function makeDashboardsNamespace(config: HttpClientConfig) {
  return {
    /** GET /@<slug>/dashboards — list dashboards (cursor pagination). */
    async list(filters?: DashboardListFilters): Promise<Envelope<ReadonlyArray<Dashboard>>> {
      const slug = requireProjectSlug(config);
      return request(config, { method: "GET", path: projectPath(slug, "dashboards"), query: filters });
    },

    /** POST /@<slug>/dashboards — create a dashboard. Requires PROJECT_AUTHOR. */
    async create(dashboard: CreateDashboardInput): Promise<Envelope<Dashboard>> {
      const slug = requireProjectSlug(config);
      return request(config, { method: "POST", path: projectPath(slug, "dashboards"), body: dashboard });
    },

    /** GET /@<slug>/dashboards/<dsh-id> — read a dashboard. */
    async read(dashboardId: string): Promise<Envelope<Dashboard>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "GET",
        path: projectPath(slug, `dashboards/${encodeURIComponent(dashboardId)}`),
      });
    },

    /** PATCH /@<slug>/dashboards/<dsh-id> — update a dashboard. Requires PROJECT_AUTHOR. */
    async update(dashboardId: string, updates: UpdateDashboardInput): Promise<Envelope<Dashboard>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "PATCH",
        path: projectPath(slug, `dashboards/${encodeURIComponent(dashboardId)}`),
        body: updates,
      });
    },

    /** DELETE /@<slug>/dashboards/<dsh-id> — delete a dashboard. Requires PROJECT_AUTHOR. */
    async delete(dashboardId: string): Promise<Envelope<{ deleted: boolean }>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "DELETE",
        path: projectPath(slug, `dashboards/${encodeURIComponent(dashboardId)}`),
      });
    },

    /** POST /@<slug>/dashboards/<dsh-id>/pin — pin to Workspace sidebar. Requires PROJECT_AUTHOR. */
    async pin(dashboardId: string): Promise<Envelope<Dashboard>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "POST",
        path: projectPath(slug, `dashboards/${encodeURIComponent(dashboardId)}/pin`),
      });
    },

    /** POST /@<slug>/dashboards/<dsh-id>/unpin — unpin. Requires PROJECT_AUTHOR. */
    async unpin(dashboardId: string): Promise<Envelope<Dashboard>> {
      const slug = requireProjectSlug(config);
      return request(config, {
        method: "POST",
        path: projectPath(slug, `dashboards/${encodeURIComponent(dashboardId)}/unpin`),
      });
    },
  };
}
