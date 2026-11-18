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
import {
  type Families,
  parseFamilies,
  parseScopeUnits,
  type ScopeUnit,
} from "./shared-plans-model";
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
  /** By control (the shared plans, by exception; the default on Test plans), plans (the
   * review queue, plan by plan), or phases (release by phase). */
  view: "controls" | "plans" | "phases";
  /** Each control's implementations and review group; null when not read or not loaded. */
  families: Families | null;
  /** The engagement's legal entities, locations, and other units controls operate in. */
  units: ScopeUnit[];
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
 * Read on the Test plans page and on the Testing destination's Plans and Phases views
 * (M2b); the Results and Review views read nothing here. */
export async function loadPlanning(
  model: ShellModel,
  query: PlanningQuery,
): Promise<PlanningPageState | null> {
  if (
    model.status !== "ready" ||
    (model.section !== "planning" && model.section !== "testing") ||
    model.selectedProject === null
  ) {
    return null;
  }
  // Testing and Review read nothing here; nor does Planning's Prior year tab.
  if (
    (model.section === "testing" ||
      (model.section === "planning" && query.view === "prior-year")) &&
    query.control === null
  ) {
    return null;
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  const base = `/organizations/${model.organization.id}/projects/${model.selectedProject.id}`;
  const controlId =
    query.control !== null && UUID.test(query.control) ? query.control : null;
  // The plans open by control (shared plans); "each" is every plan on its own.
  const view: PlanningPageState["view"] =
    query.view === "phases"
      ? "phases"
      : query.view === "each"
        ? "plans"
        : "controls";
  const byControl = view === "controls" && controlId === null;
  const [queue, plan, phases, families, units] = await Promise.all([
    apiGet(`${base}/planning-review`, session),
    controlId === null
      ? null
      : apiGet(`${base}/controls/${controlId}/master-plan`, session),
    apiGet(`${base}/phase-progress`, session),
    byControl ? apiGet(`${base}/planning-review/families`, session) : null,
    byControl ? apiGet(`${base}/scope-units`, session) : null,
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
    view,
    phases: phases.status === 200 ? parsePhaseProgress(phases.body) : null,
    families:
      families !== null && families.status === 200
        ? parseFamilies(families.body)
        : null,
    units:
      units !== null && units.status === 200 ? parseScopeUnits(units.body) : [],
  };
}
