import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  consoleNoticeFor,
  consoleWrite,
  parseThread,
} from "../../../../src/console-model";
import { apiBaseUrl, sessionToken } from "../../../../src/load-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function headers(json: boolean): Promise<Headers> {
  const result = new Headers();
  if (json) {
    result.set("content-type", "application/json");
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  if (session !== undefined) {
    result.set("cookie", `aw_session=${session}`);
  }
  return result;
}

/** The conversation, for the live chat to poll while an agent works. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const organization = url.searchParams.get("organization") ?? "";
  const project = url.searchParams.get("project") ?? "";
  const thread = url.searchParams.get("thread") ?? "";
  if (!UUID.test(organization) || !UUID.test(project)) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const query = UUID.test(thread) ? `?thread_id=${thread}` : "";
  try {
    const response = await fetch(
      `${apiBaseUrl()}/organizations/${organization}/projects/${project}/console${query}`,
      {
        headers: await headers(false),
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (response.status !== 200) {
      return NextResponse.json(
        { error: "unavailable" },
        { status: response.status },
      );
    }
    const body = parseThread(await response.json());
    return NextResponse.json({ thread: body });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

/** One action from the live chat: ask, confirm, cancel, or start a conversation. */
export async function POST(request: Request) {
  const raw = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const write = consoleWrite(fields);
  if ("error" in write) {
    return NextResponse.json({ notice: "invalid" }, { status: 400 });
  }
  let status = 0;
  let thread = null;
  try {
    const response = await fetch(`${apiBaseUrl()}${write.path}`, {
      method: "POST",
      headers: await headers(true),
      body: write.body === null ? null : JSON.stringify(write.body),
      cache: "no-store",
      // Confirming several steps can take a while: each runs through its own checks.
      signal: AbortSignal.timeout(90000),
    });
    status = response.status;
    if (status === 200) {
      thread = parseThread(await response.json());
    }
  } catch {
    status = 0;
  }
  return NextResponse.json(
    { notice: consoleNoticeFor(write.intent, status), thread },
    { status: status === 200 ? 200 : status === 0 ? 503 : status },
  );
}
