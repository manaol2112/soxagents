import { cookies } from "next/headers";
import { parseAnalyses, parseReviews } from "./analysis-model";
import { parseContext } from "./control-context-model";
import { parseActivity } from "./control-workspace-model";
import type { ControlFiles } from "./engagement-model";
import {
  EMPTY_ENGAGEMENT,
  type EngagementState,
  parseControls,
  parseDashboard,
  parseDeficiencies,
  parseEngagementNotice,
  parsePlan,
  QUEUES,
} from "./engagement-model";
import { parseChangeNotice } from "./evidence-change-model";
import { parseRegister } from "./evidence-model";
import { parsePlan as parseEvidencePlan } from "./evidence-plan-model";
import { parseAutomation } from "./execution-model";
import { parseNextSteps } from "./home-model";
import { parseImpact } from "./impact-model";
import { apiGet, sessionToken } from "./load-workspace";
import { parseRequestDetails } from "./request-details-model";
import {
  parseReviews as parseControlReviews,
  parseReviewNotice,
  reviewFor,
} from "./review-model";
import { parseRounds } from "./round-model";
import { parseSheetNotice, parseSheets, sheetFor } from "./sheet-model";
import type { ShellModel } from "./shell-model";
import { parseSignoffs, receipts } from "./signoff-model";
import { parseTestBasis } from "./test-basis-model";
import { parseTestNotice, parseTests } from "./testing-model";
import {
  parseWorkpaperNotice,
  parseWorkpapers,
  type Workpaper,
} from "./workpaper-model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGE = /^[A-Z_]{1,30}$/;
const SORTS = [
  "control",
  "stage",
  "attention",
  "owner",
  "application",
  "due",
] as const;

/** Load only what the engagement page being shown needs. */
/** A filter's values from the address: names, or "" for "none"; at most twenty. */
function list(value: readonly string[] | null | undefined): string[] {
  return [...new Set((value ?? []).map((item) => item.slice(0, 120)))].slice(
    0,
    20,
  );
}

export async function loadEngagement(
  model: ShellModel,
  query: {
    category: string | null;
    stage: string[] | null;
    app?: string[] | null;
    area?: string[] | null;
    owner?: string[] | null;
    key?: string | null;
    q: string | null;
    control: string | null;
    deficiency: string | null;
    notice: string | null;
    queue?: string | null;
    tab?: string | null;
    /** The guided workspace's step (?step=), when a link names one. */
    step?: string | null;
    group?: string | null;
    sort?: string | null;
    layout?: string | null;
    workpaper?: string | null;
    workpaperVersion?: string | null;
    ev?: string | null;
    request?: string | null;
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
  // An open control shows its evidence files and what the agents made of them.
  const open = section === "controls" && query.control !== null;
  const viewing =
    query.workpaper != null &&
    UUID.test(query.workpaper) &&
    query.workpaperVersion != null &&
    /^\d{1,5}$/.test(query.workpaperVersion)
      ? { id: query.workpaper, version: Number(query.workpaperVersion) }
      : null;
  const [
    dashboard,
    nextSteps,
    impact,
    automation,
    controls,
    plan,
    deficiencies,
    tests,
    sheets,
    rounds,
    register,
    analyses,
    reviews,
    papers,
    shownPaper,
    controlReviews,
    context,
    evidencePlan,
    activity,
    testBasis,
  ] = await Promise.all([
    wanted.dashboard ? apiGet(`${base}/workspace/dashboard`, session) : null,
    wanted.dashboard ? apiGet(`${base}/next-steps`, session) : null,
    open ? apiGet(`${base}/impact`, session) : null,
    section === "controls"
      ? apiGet(`${base}/workspace/automation`, session)
      : null,
    wanted.controls ? apiGet(`${base}/workspace/controls`, session) : null,
    wanted.plan ? apiGet(`${base}/workspace/plan`, session) : null,
    wanted.deficiencies ? apiGet(`${base}/deficiencies`, session) : null,
    section === "controls" ? apiGet(`${base}/control-tests`, session) : null,
    section === "controls" ? apiGet(`${base}/test-sheets`, session) : null,
    section === "controls" ? apiGet(`${base}/test-rounds`, session) : null,
    open ? apiGet(`${base}/evidence-register`, session) : null,
    open ? apiGet(`${base}/evidence-analyses`, session) : null,
    open ? apiGet(`${base}/evidence-reviews`, session) : null,
    open
      ? apiGet(`${base}/workpapers?control_id=${query.control}`, session)
      : null,
    open && viewing !== null
      ? apiGet(
          `${base}/workpapers/${viewing.id}/versions/${viewing.version}`,
          session,
        )
      : null,
    section === "controls" ? apiGet(`${base}/reviews`, session) : null,
    open ? apiGet(`${base}/controls/${query.control}/context`, session) : null,
    open
      ? apiGet(`${base}/controls/${query.control}/evidence-plan`, session)
      : null,
    open ? apiGet(`${base}/controls/${query.control}/activity`, session) : null,
    open
      ? apiGet(`${base}/controls/${query.control}/test-basis`, session)
      : null,
  ]);
  // The request opened on the control's Evidence tab, with its details for review.
  const focus =
    open && query.request != null && UUID.test(query.request)
      ? query.request
      : null;
  const focused =
    focus !== null
      ? await apiGet(`${base}/pbc-requests/${focus}/details`, session)
      : null;
  const ok = (result: { status: number; body: unknown } | null) =>
    result !== null && result.status === 200 ? result.body : undefined;
  const parsedSheets =
    ok(sheets) === undefined ? null : parseSheets(ok(sheets));
  const parsedReviews =
    ok(controlReviews) === undefined
      ? null
      : parseControlReviews(ok(controlReviews));
  // The open control's sign-offs on record (its interim sheet's and its own review's):
  // the receipts the guided workspace shows.
  const openSheet =
    open && query.control !== null
      ? sheetFor(parsedSheets, query.control)
      : null;
  const openReview =
    open && query.control !== null
      ? reviewFor(parsedReviews, query.control)
      : null;
  const [sheetSignoffs, reviewSignoffs] = await Promise.all([
    openSheet !== null
      ? apiGet(`${base}/test-sheets/${openSheet.id}/signoffs`, session)
      : null,
    openReview !== null
      ? apiGet(`${base}/reviews/${openReview.id}/signoffs`, session)
      : null,
  ]);
  return {
    focusRequest:
      ok(focused) === undefined ? null : parseRequestDetails(ok(focused)),
    tests: ok(tests) === undefined ? null : parseTests(ok(tests)),
    testNotice: section === "controls" ? parseTestNotice(query.notice) : null,
    sheets: parsedSheets,
    signoffs: open
      ? receipts(
          parseSignoffs(ok(sheetSignoffs) ?? [], "TESTING"),
          parseSignoffs(ok(reviewSignoffs) ?? [], "REVIEW"),
        )
      : null,
    rounds: ok(rounds) === undefined ? null : parseRounds(ok(rounds)),
    sheetNotice: section === "controls" ? parseSheetNotice(query.notice) : null,
    workpapers: withVersion(ok(papers), ok(shownPaper)),
    workpaperNotice: open ? parseWorkpaperNotice(query.notice) : null,
    workpaperViewing: viewing,
    reviews: parsedReviews,
    reviewNotice:
      section === "controls" ? parseReviewNotice(query.notice) : null,
    context: ok(context) === undefined ? null : parseContext(ok(context)),
    evidencePlan:
      ok(evidencePlan) === undefined
        ? null
        : parseEvidencePlan(ok(evidencePlan)),
    files: controlFiles(ok(register), ok(analyses), ok(reviews), query.control),
    activity: ok(activity) === undefined ? null : parseActivity(ok(activity)),
    testBasis:
      ok(testBasis) === undefined ? null : parseTestBasis(ok(testBasis)),
    changeNotice: open ? parseChangeNotice(query.notice) : null,
    dashboard:
      ok(dashboard) === undefined ? null : parseDashboard(ok(dashboard)),
    impact: ok(impact) === undefined ? null : parseImpact(ok(impact)),
    automation:
      ok(automation) === undefined ? null : parseAutomation(ok(automation)),
    nextSteps:
      ok(nextSteps) === undefined ? null : parseNextSteps(ok(nextSteps)),
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
      stage: list(query.stage).filter((value) => STAGE.test(value)),
      application: list(query.app),
      area: list(query.area),
      owner: list(query.owner),
      keyOnly: query.key === "1",
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
      // The tab as asked; detailTab() maps the names older links used.
      tab:
        query.tab !== null &&
        query.tab !== undefined &&
        /^[a-z]{1,20}$/.test(query.tab)
          ? query.tab
          : null,
      step:
        query.step !== null &&
        query.step !== undefined &&
        /^[a-z]{1,10}$/.test(query.step)
          ? query.step
          : null,
      evidenceView:
        query.ev != null && /^[a-z]{1,20}$/.test(query.ev) ? query.ev : null,
      request: focus,
      group: query.group === "area" ? "area" : "application",
      sort: SORTS.find((sort) => sort === query.sort) ?? "control",
      layout: query.layout === "table" ? "table" : "applications",
    },
  };
}

function controlFiles(
  register: unknown,
  analyses: unknown,
  reviews: unknown,
  control: string | null,
): ControlFiles | null {
  const parsed = register === undefined ? null : parseRegister(register);
  if (parsed === null || control === null) {
    return null;
  }
  const mine = parsed.controls.find((item) => item.id === control);
  return {
    // The instance's own files, and those a sibling instance of the same control
    // shares with it: tagged for every application, or for this one.
    files: parsed.files.filter(
      (file) =>
        file.control !== null &&
        (file.control.id === control ||
          (mine !== undefined &&
            file.control.controlRef === mine.controlRef &&
            (file.applicationScope === "ALL" ||
              (file.applicationScope === "ONE" &&
                mine.application !== "" &&
                file.application?.name === mine.application)))),
    ),
    applications: mine?.applications ?? [],
    analyses: analyses === undefined ? [] : (parseAnalyses(analyses) ?? []),
    reviews: reviews === undefined ? [] : (parseReviews(reviews) ?? []),
  };
}

/** The workpapers, with the one a person chose shown at the version they chose. */
function withVersion(papers: unknown, shown: unknown): Workpaper[] | null {
  const parsed = papers === undefined ? null : parseWorkpapers(papers);
  if (parsed === null || shown === undefined) {
    return parsed;
  }
  const [older] = parseWorkpapers([shown]) ?? [];
  return older === undefined
    ? parsed
    : parsed.map((paper) => (paper.id === older.id ? older : paper));
}
