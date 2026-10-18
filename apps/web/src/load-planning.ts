import { cookies } from "next/headers";

import { apiGet, sessionToken } from "./load-workspace";
import {
  type MasterPlan,
  type PhaseProgress,
  PLANNING_STATES,
  type PlanningState,
  parseMasterPlan,
  parsePhaseProgress,
  parseQueue,
  parseTab,
  type Queue,
  type Tab,
} from "./planning-model";
import type { ShellModel } from "./shell-model";

export type PlanningPageState = {
  /** Null when it could not be loaded. */
  queue: Queue | null;
  /** The control open for review, when one is chosen. */
  plan: MasterPlan | null;
  controlId: string | null;
  tab: Tab;
  /** The states the queue is filtered to (none: every control). */
  filter: PlanningState[];
  /** Plans (the review queue) or phases (release by phase). */
  view: "plans" | "phases";
  /** Each control's phases and their release; null when it could not be loaded. */
  phases: PhaseProgress | null;
};

export type PlanningQuery = {
  control: string | null;
  tab: string | null;
  filter: string | null;
  view: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The engagement's planning review queue and, when a control is chosen, its test plan.
 * Read only on the Test plans page. */
export async function loadPlanning(
  model: ShellModel,
  query: PlanningQuery,
): Promise<PlanningPageState | null> {
  if (
    model.status !== "ready" ||
    model.section !== "planning" ||
    model.selectedProject === null
  ) {
    return null;
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  const base = `/organizations/${model.organization.id}/projects/${model.selectedProject.id}`;
  const controlId =
    query.control !== null && UUID.test(query.control) ? query.control : null;
  const [queue, plan, phases] = await Promise.all([
    apiGet(`${base}/planning-review`, session),
    controlId === null
      ? null
      : apiGet(`${base}/controls/${controlId}/master-plan`, session),
    apiGet(`${base}/phase-progress`, session),
  ]);
  const filter = (query.filter ?? "")
    .split(",")
    .filter((item): item is PlanningState =>
      (PLANNING_STATES as readonly string[]).includes(item),
    );
  return {
    queue: queue.status === 200 ? parseQueue(queue.body) : null,
    plan:
      plan !== null && plan.status === 200 ? parseMasterPlan(plan.body) : null,
    controlId,
    tab: parseTab(query.tab),
    filter,
    view: query.view === "phases" ? "phases" : "plans",
    phases: phases.status === 200 ? parsePhaseProgress(phases.body) : null,
  };
}
