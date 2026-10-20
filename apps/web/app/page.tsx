import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { parseDirectoryQuery } from "../src/directory";
import { parseEngagementsView } from "../src/engagements-model";
import { parseCenterQuery } from "../src/evidence-center-model";
import { parseEvidenceView } from "../src/evidence-model";
import { loadConsole } from "../src/load-console";
import { loadEngagement } from "../src/load-engagement";
import { loadEvidenceCenter } from "../src/load-evidence-center";
import { loadLibrary } from "../src/load-library";
import { loadOnboarding } from "../src/load-onboarding";
import { loadPlanning } from "../src/load-planning";
import { loadWorkflow } from "../src/load-workflow";
import { loadWorkspace } from "../src/load-workspace";
import { resolveRoute } from "../src/shell-model";
import { parseTestingView } from "../src/testing-hub-model";
import { WorkspaceView } from "../src/workspace-view";

export const dynamic = "force-dynamic";

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  // The six destinations (M2c): an older section's address redirects to where it now
  // lives, with its record kept; a destination's tab names the page the loaders read.
  const route = resolveRoute(params);
  if (route.redirect !== null) {
    redirect(route.redirect);
  }
  const loaded = await loadWorkspace({
    organizationId: firstParam(params.organization),
    projectId: firstParam(params.project),
    agentId: firstParam(params.agent),
    taskId: firstParam(params.task),
    section: route.page,
    notice: firstParam(params.notice),
  });
  // The loaders read by the page; the shell renders the destination.
  const model =
    loaded.status === "ready" ? { ...loaded, section: route.section } : loaded;
  // A visitor with no session sees the landing page; a signed-in member who is
  // denied still sees the workspace's own message.
  if (
    model.status === "denied" &&
    (await cookies()).get("aw_session")?.value === undefined
  ) {
    redirect("/welcome");
  }
  const centerQuery = parseCenterQuery((name) => firstParam(params[name]));
  const [
    workflow,
    setup,
    engagement,
    consoleState,
    evidenceCenter,
    planning,
    library,
  ] = await Promise.all([
    loadWorkflow(loaded, firstParam(params.notice)),
    loadOnboarding(loaded, {
      step: firstParam(params.step),
      category: firstParam(params.category),
      control: firstParam(params.control),
      sample: firstParam(params.sample),
      template: firstParam(params.template),
      notice: firstParam(params.notice),
      system: firstParam(params.system),
      edit: firstParam(params.edit),
    }),
    loadEngagement(loaded, {
      category: firstParam(params.category),
      stage: listParam(params.stage),
      q: firstParam(params.q),
      control: firstParam(params.control),
      deficiency: firstParam(params.deficiency),
      notice: firstParam(params.notice),
      queue: firstParam(params.queue),
      tab: firstParam(params.tab),
      step: firstParam(params.step),
      group: firstParam(params.group),
      sort: firstParam(params.sort),
      layout: firstParam(params.layout),
      app: listParam(params.app),
      area: listParam(params.area),
      owner: listParam(params.owner),
      key: firstParam(params.key),
      workpaper: firstParam(params.wp),
      workpaperVersion: firstParam(params.wpversion),
      ev: firstParam(params.ev),
      request: firstParam(params.request),
      filter: firstParam(params.filter),
    }),
    loadConsole(loaded, firstParam(params.notice), firstParam(params.thread)),
    loadEvidenceCenter(loaded, centerQuery, firstParam(params.tab)),
    loadPlanning(loaded, {
      control: firstParam(params.control),
      tab: firstParam(params.tab),
      filter: firstParam(params.filter),
      view: firstParam(params.view),
    }),
    loadLibrary(loaded, {
      control: firstParam(params.control),
      tab: firstParam(params.tab),
      category: firstParam(params.category),
      status: firstParam(params.status),
      q: firstParam(params.q),
    }),
  ]);
  return (
    <WorkspaceView
      model={model}
      page={route.page}
      tab={route.tab}
      workflow={workflow}
      directory={parseDirectoryQuery(params)}
      now={Date.now()}
      creatingAgent={firstParam(params.agent) === "new"}
      creatingEngagement={firstParam(params.create) === "engagement"}
      editingEngagement={firstParam(params.edit) === "engagement"}
      managingEngagement={firstParam(params.manage) === "engagement"}
      engagementsView={parseEngagementsView(firstParam(params.view))}
      setup={setup}
      engagement={engagement}
      logFor={logFor(firstParam(params.new))}
      consoleState={consoleState}
      evidenceCenter={evidenceCenter}
      planning={planning}
      testingView={parseTestingView(firstParam(params.view))}
      testingFilter={firstParam(params.filter) ?? null}
      library={library}
      evidenceView={parseEvidenceView({
        tab: firstParam(params.tab),
        queue: firstParam(params.queue),
        q: firstParam(params.q),
        group: firstParam(params.group),
        file: firstParam(params.file),
      })}
    />
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function logFor(value: string | null): string | null {
  return value !== null && UUID.test(value) ? value : null;
}

/** Every value of a repeated parameter, such as stage=PLANNED&stage=TESTING. */
function listParam(value: string | string[] | undefined): string[] {
  if (typeof value === "string") {
    return [value];
  }
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string" && value !== "") {
    return value;
  }
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" && first !== "" ? first : null;
  }
  return null;
}
