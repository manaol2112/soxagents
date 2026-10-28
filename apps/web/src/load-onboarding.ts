import { cookies } from "next/headers";
import { parseContext } from "./control-context-model";
import { apiGet, sessionToken } from "./load-workspace";
import {
  EMPTY_SETUP,
  landingStep,
  parseImport,
  parseOnboarding,
  parsePreview,
  parseSetupNotice,
  type SetupState,
} from "./onboarding-model";
import { parsePolicies, parseReferences } from "./references-model";
import type { ShellModel } from "./shell-model";
import { parseStandardMatches } from "./standard-matches-model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEMPLATE = /^[a-z][a-z0-9-]{0,40}$/;

export async function loadOnboarding(
  model: ShellModel,
  query: {
    step: string | null;
    category: string | null;
    control: string | null;
    sample: string | null;
    template: string | null;
    notice: string | null;
    system?: string | null;
    edit?: string | null;
    pane?: string | null;
    controlsFor?: string | null;
  },
): Promise<SetupState> {
  if (
    model.status !== "ready" ||
    model.selectedProject === null ||
    (model.section !== "setup" &&
      model.section !== "overview" &&
      !(model.section === "controls" && query.control === null) &&
      model.section !== "register")
  ) {
    return EMPTY_SETUP;
  }
  // Setup's own page, or Systems & Processes (the controls section with no control
  // open): both open an uploaded RCM's matching and say how the last action went.
  const setupPage =
    model.section === "setup" ||
    model.section === "controls" ||
    model.section === "register";
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  const base = `/organizations/${model.organization.id}/projects/${model.selectedProject.id}/onboarding`;
  const control =
    query.control !== null && UUID.test(query.control) ? query.control : null;
  const sample =
    query.sample !== null && UUID.test(query.sample) ? query.sample : null;
  const template =
    query.template !== null && TEMPLATE.test(query.template)
      ? query.template
      : null;
  const project = `/organizations/${model.organization.id}/projects/${model.selectedProject.id}`;
  // Systems & Processes lists the governing policies and procedures.
  const scopePage = model.section === "controls";
  const register = model.section === "register";
  const [loaded, previewed, context, policies, matches, priorYear] =
    await Promise.all([
      apiGet(base, session),
      model.section === "setup" && sample !== null && template !== null
        ? apiGet(
            `${base}/workpaper-preview?template=${encodeURIComponent(template)}&control_id=${sample}`,
            session,
          )
        : null,
      // The open control's statement, for its client values (8.9).
      model.section === "setup" && control !== null
        ? apiGet(`${project}/controls/${control}/context`, session)
        : null,
      scopePage ? apiGet(`${project}/policies`, session) : null,
      register ? apiGet(`${project}/standards/matches`, session) : null,
      scopePage ? apiGet(`${project}/prior-year`, session) : null,
    ]);
  const onboarding =
    loaded.status === 200 ? parseOnboarding(loaded.body) : null;
  const step = landingStep(query.step, onboarding?.started === true);
  const importId = onboarding?.openImportId ?? null;
  const opened =
    setupPage && step === "controls" && importId !== null
      ? await apiGet(`${base}/rcm/uploads/${importId}`, session)
      : null;
  return {
    onboarding,
    step,
    category: query.category,
    control,
    sample,
    template,
    preview:
      previewed !== null && previewed.status === 200
        ? parsePreview(previewed.body)
        : null,
    rcmImport:
      opened !== null && opened.status === 200
        ? parseImport(opened.body)
        : null,
    notice: setupPage ? parseSetupNotice(query.notice) : null,
    design:
      context !== null && context.status === 200
        ? (parseContext(context.body)?.design ?? null)
        : null,
    edit:
      query.edit !== undefined && query.edit !== null && UUID.test(query.edit)
        ? query.edit
        : null,
    system:
      query.system !== undefined &&
      query.system !== null &&
      UUID.test(query.system)
        ? query.system
        : null,
    pane: query.pane ?? null,
    controlsFor: query.controlsFor ?? null,
    policies:
      policies !== null && policies.status === 200
        ? parsePolicies(policies.body)
        : [],
    priorYear:
      priorYear !== null && priorYear.status === 200
        ? parseReferences(priorYear.body)
        : [],
    standardMatches:
      matches !== null && matches.status === 200
        ? parseStandardMatches(matches.body)
        : null,
  };
}
