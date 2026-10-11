import { cookies } from "next/headers";

import {
  DETAIL_TABS,
  EMPTY_ENGAGEMENT,
  type EngagementState,
  parseControls,
  parseDashboard,
  parseDeficiencies,
  parseEngagementNotice,
  parsePlan,
  QUEUES,
} from "./engagement-model";
import { apiGet, sessionToken } from "./load-workspace";
import type { ShellModel } from "./shell-model";
import { parseTestNotice, parseTests } from "./testing-model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGE = /^[A-Z_]{1,30}$/;

/** Load only what the engagement page being shown needs. */
export async function loadEngagement(
  model: ShellModel,
  query: {
    category: string | null;
    stage: string | null;
    q: string | null;
    control: string | null;
    deficiency: string | null;
    notice: string | null;
    queue?: string | null;
    tab?: string | null;
    group?: string | null;
  },
): Promise<EngagementState> {
  if (model.status !== "ready" || model.selectedProject === null) {
    return EMPTY_ENGAGEMENT;
  }
  const section = model.section;
  const wanted = {
    dashboard: section === "overview",
    controls: section === "controls" || section === "deficiencies",
    plan:
      section === "plan" ||
      section === "timeline" ||
      (section === "controls" && query.control !== null),
    deficiencies: section === "deficiencies" || section === "controls",
  };
  if (!Object.values(wanted).some(Boolean)) {
    return EMPTY_ENGAGEMENT;
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  const base = `/organizations/${model.organization.id}/projects/${model.selectedProject.id}`;
  const [dashboard, controls, plan, deficiencies, tests] = await Promise.all([
    wanted.dashboard ? apiGet(`${base}/workspace/dashboard`, session) : null,
    wanted.controls ? apiGet(`${base}/workspace/controls`, session) : null,
    wanted.plan ? apiGet(`${base}/workspace/plan`, session) : null,
    wanted.deficiencies ? apiGet(`${base}/deficiencies`, session) : null,
    section === "controls" ? apiGet(`${base}/control-tests`, session) : null,
  ]);
  const ok = (result: { status: number; body: unknown } | null) =>
    result !== null && result.status === 200 ? result.body : undefined;
  return {
    tests: ok(tests) === undefined ? null : parseTests(ok(tests)),
    testNotice: section === "controls" ? parseTestNotice(query.notice) : null,
    dashboard:
      ok(dashboard) === undefined ? null : parseDashboard(ok(dashboard)),
    controls: ok(controls) === undefined ? null : parseControls(ok(controls)),
    plan: ok(plan) === undefined ? null : parsePlan(ok(plan)),
    deficiencies:
      ok(deficiencies) === undefined
        ? null
        : parseDeficiencies(ok(deficiencies)),
    notice: parseEngagementNotice(query.notice),
    filters: {
      category:
        query.category === "it" ||
        query.category === "business" ||
        query.category === "reports"
          ? query.category
          : null,
      stage:
        query.stage !== null && STAGE.test(query.stage) ? query.stage : null,
      query: (query.q ?? "").slice(0, 80),
      control:
        query.control !== null && UUID.test(query.control)
          ? query.control
          : null,
      deficiency:
        query.deficiency !== null && UUID.test(query.deficiency)
          ? query.deficiency
          : null,
      queue: QUEUES.find((queue) => queue === query.queue) ?? null,
      tab: DETAIL_TABS.find((tab) => tab === query.tab) ?? null,
      group: query.group === "application" ? "application" : "area",
    },
  };
}
