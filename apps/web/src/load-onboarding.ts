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
import type { ShellModel } from "./shell-model";

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
  },
): Promise<SetupState> {
  if (
    model.status !== "ready" ||
    model.selectedProject === null ||
    (model.section !== "setup" && model.section !== "overview")
  ) {
    return EMPTY_SETUP;
  }
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
  const [loaded, previewed, context] = await Promise.all([
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
  ]);
  const onboarding =
    loaded.status === 200 ? parseOnboarding(loaded.body) : null;
  const step = landingStep(query.step, onboarding?.started === true);
  const importId = onboarding?.openImportId ?? null;
  const opened =
    model.section === "setup" && step === "controls" && importId !== null
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
    notice: model.section === "setup" ? parseSetupNotice(query.notice) : null,
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
  };
}
