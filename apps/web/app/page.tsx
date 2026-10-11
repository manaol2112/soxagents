import { parseDirectoryQuery } from "../src/directory";
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
  const workflow = await loadWorkflow(model, firstParam(params.notice));
  return (
    <WorkspaceView
      model={model}
      workflow={workflow}
      directory={parseDirectoryQuery(params)}
      now={Date.now()}
    />
  );
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
