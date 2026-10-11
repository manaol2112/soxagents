import { parseDirectoryQuery } from "../src/directory";
import { loadConsole } from "../src/load-console";
import { loadEngagement } from "../src/load-engagement";
import { loadOnboarding } from "../src/load-onboarding";
import { loadWorkflow } from "../src/load-workflow";
import { loadWorkspace } from "../src/load-workspace";
import { WorkspaceView } from "../src/workspace-view";

export const dynamic = "force-dynamic";

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const model = await loadWorkspace({
    organizationId: firstParam(params.organization),
    projectId: firstParam(params.project),
    agentId: firstParam(params.agent),
    taskId: firstParam(params.task),
    section: firstParam(params.section),
    notice: firstParam(params.notice),
  });
  const [workflow, setup, engagement, consoleState] = await Promise.all([
    loadWorkflow(model, firstParam(params.notice)),
    loadOnboarding(model, {
      step: firstParam(params.step),
      category: firstParam(params.category),
      control: firstParam(params.control),
      template: firstParam(params.template),
      notice: firstParam(params.notice),
    }),
    loadEngagement(model, {
      category: firstParam(params.category),
      stage: firstParam(params.stage),
      q: firstParam(params.q),
      control: firstParam(params.control),
      deficiency: firstParam(params.deficiency),
      notice: firstParam(params.notice),
      queue: firstParam(params.queue),
      tab: firstParam(params.tab),
      group: firstParam(params.group),
    }),
    loadConsole(model, firstParam(params.notice), firstParam(params.thread)),
  ]);
  return (
    <WorkspaceView
      model={model}
      workflow={workflow}
      directory={parseDirectoryQuery(params)}
      now={Date.now()}
      creatingAgent={firstParam(params.agent) === "new"}
      setup={setup}
      engagement={engagement}
      logFor={logFor(firstParam(params.new))}
      consoleState={consoleState}
    />
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function logFor(value: string | null): string | null {
  return value !== null && UUID.test(value) ? value : null;
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
