import {
  CONSOLE_NOTICES,
  type ConsoleState,
  waitingHref,
} from "./console-model";
import { ConsoleShell } from "./console-panel";
import type { ShellModel } from "./shell-model";

type Ready = Extract<ShellModel, { status: "ready" }>;

function href(model: Ready, section: string): string {
  const params = new URLSearchParams({
    organization: model.organization.id,
    section,
  });
  if (model.selectedProject !== null) {
    params.set("project", model.selectedProject.id);
  }
  return `/?${params.toString()}`;
}

export function ConsoleMain({
  model,
  console: state,
}: {
  model: Ready;
  console: ConsoleState;
}) {
  const project = model.selectedProject;
  if (project === null) {
    return null;
  }
  const base = href(model, "console");
  return (
    <ConsoleShell
      organizationId={model.organization.id}
      projectId={project.id}
      engagement={
        project.clientName.trim() !== ""
          ? `${project.clientName.trim()} · ${project.name}`
          : project.name
      }
      initial={state.thread}
      alert={
        state.notice !== null && CONSOLE_NOTICES[state.notice] !== ""
          ? CONSOLE_NOTICES[state.notice]
          : null
      }
      threads={state.threads.map((item) => ({
        ...item,
        href: `${base}&thread=${item.id}`,
      }))}
      threadId={state.thread?.id ?? null}
      waiting={(state.inbox?.waiting ?? []).map((item) => ({
        ...item,
        href: waitingHref(item, model.organization.id, project.id),
      }))}
      activity={state.inbox?.activity ?? []}
      consoleHref={base}
    />
  );
}
