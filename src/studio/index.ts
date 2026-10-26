/**
 * Studio namespace — `client.studio.*`.
 *
 * Groups the Pathmaker-authored Studio surfaces: dashboards and workflows.
 */

import type { HttpClientConfig } from "../http.ts";
import { makeWorkflowsNamespace } from "./workflows.ts";
import { makeDashboardsNamespace } from "./dashboards.ts";

export function makeStudioNamespace(config: HttpClientConfig) {
  return {
    /** Workflow lifecycle + runs — `client.studio.workflows.*`. */
    workflows: makeWorkflowsNamespace(config),
    /** Dashboard lifecycle + widget data — `client.studio.dashboards.*`. */
    dashboards: makeDashboardsNamespace(config),
  };
}
