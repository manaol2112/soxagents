import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  impactApiPath,
  parseFileImpact,
} from "../../../../../src/evidence-impact-model";
import { apiBaseUrl, sessionToken } from "../../../../../src/load-workspace";

/** What a change to an evidence file would do, read-only (E1: the API's impact read
 * model), for a confirm form or a menu that holds an action the server would refuse.
 * Answered as `{ status, impact }`; the API decides who may read it. */
export async function GET(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await context.params;
  const path = impactApiPath(fileId, new URL(request.url).searchParams);
  const answer = (status: number, impact: unknown = null) =>
    NextResponse.json(
      { status, impact },
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
    // Passed on as the API wrote it, once it reads as an impact; the browser shapes it.
    const body = (await response.json()) as unknown;
    return parseFileImpact(body) === null ? answer(502) : answer(200, body);
  } catch {
    return answer(503);
  }
}
