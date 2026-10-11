import { cookies } from "next/headers";

import {
  type ConsoleState,
  EMPTY_CONSOLE,
  parseConsoleNotice,
  parseInbox,
  parseThread,
  parseThreads,
} from "./console-model";
import { apiGet, sessionToken } from "./load-workspace";
import type { ShellModel } from "./shell-model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The person's conversations with the agents, and what waits on them. */
export async function loadConsole(
  model: ShellModel,
  notice: string | null,
  threadId: string | null = null,
): Promise<ConsoleState> {
  if (
    model.status !== "ready" ||
    model.section !== "console" ||
    model.selectedProject === null
  ) {
    return EMPTY_CONSOLE;
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  const base = `/organizations/${model.organization.id}/projects/${model.selectedProject.id}/console`;
  const chosen =
    threadId !== null && UUID.test(threadId) ? `?thread_id=${threadId}` : "";
  const [thread, threads, inbox] = await Promise.all([
    apiGet(`${base}${chosen}`, session),
    apiGet(`${base}/threads`, session),
    apiGet(`${base}/inbox`, session),
  ]);
  return {
    thread: thread.status === 200 ? parseThread(thread.body) : null,
    threads: threads.status === 200 ? parseThreads(threads.body) : [],
    inbox: inbox.status === 200 ? parseInbox(inbox.body) : null,
    notice: parseConsoleNotice(notice),
  };
}
