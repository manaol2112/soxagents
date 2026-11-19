import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  historyApiPath,
  parseFileHistory,
} from "../../../../../src/evidence-impact-model";
import { apiBaseUrl, sessionToken } from "../../../../../src/load-workspace";

/** A file's history, read-only (E1: its versions, withdrawals, restorations and links,
 * oldest first), for the viewer's History section once a person opens it. Answered as
 * `{ status, history }`; the API decides who may read it. */
export async function GET(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await context.params;
  const path = historyApiPath(fileId, new URL(request.url).searchParams);
  const answer = (status: number, history: unknown = null) =>
    NextResponse.json(
      { status, history },
      { headers: { "cache-control": "private, no-store" } },
    );
  if (path === null) {
    return answer(422);
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  try {
    const headers = new Headers();
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(`${apiBaseUrl()}${path}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (response.status !== 200) {
      return answer(response.status);
    }
    // Passed on as the API wrote it, once it reads as a history; the browser shapes it.
    const body = (await response.json()) as unknown;
    return parseFileHistory(body) === null ? answer(502) : answer(200, body);
  } catch {
    return answer(503);
  }
}
