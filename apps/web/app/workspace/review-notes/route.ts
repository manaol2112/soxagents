import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";
import {
  notesReadPath,
  reviewNoteWrite,
} from "../../../src/review-notes-model";

type Forwarded = { status: number; detail: string; result: unknown };

/** One call to the API with the person's session: its status (any 2xx is 200), its
 * sentence when it refuses (a validation list is not one), and its answer when it
 * confirms. Nothing of it is logged. */
async function forward(
  path: string,
  init: { method: "GET" } | { method: "POST"; body: Record<string, unknown> },
): Promise<Forwarded> {
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let detail = "";
  let result: unknown = null;
  try {
    const headers = new Headers({ "content-type": "application/json" });
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(`${apiBaseUrl()}${path}`, {
      method: init.method,
      headers,
      body: init.method === "POST" ? JSON.stringify(init.body) : null,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
    status = response.ok ? 200 : response.status;
    const body = (await response.json().catch(() => null)) as unknown;
    if (status === 200) {
      result = body;
    } else if (typeof body === "object" && body !== null && "detail" in body) {
      const value = (body as { detail?: unknown }).detail;
      detail =
        typeof value === "string"
          ? value.replace(/\s+/g, " ").trim().slice(0, 300)
          : "";
    }
  } catch {
    status = 0;
    result = null;
  }
  return { status, detail, result };
}

/** A workpaper's review notes (docs/workpaper-review.md, section 5), with who the session
 * is, so the page can offer "Mine". The API decides who may read them. */
export async function GET(request: Request) {
  const path = notesReadPath(new URL(request.url).searchParams);
  if (path === null) {
    return NextResponse.json({
      status: 422,
      detail: "",
      result: null,
      viewer_id: null,
    });
  }
  const [notes, me] = await Promise.all([
    forward(path, { method: "GET" }),
    forward("/auth/me", { method: "GET" }),
  ]);
  const viewer =
    me.status === 200 &&
    typeof me.result === "object" &&
    me.result !== null &&
    "id" in me.result &&
    typeof me.result.id === "string"
      ? me.result.id
      : null;
  return NextResponse.json({ ...notes, viewer_id: viewer });
}

/** A person's write to a note: raise, reply (or respond), clear, reopen, dismiss, change
 * the criticality or the owner. Called in the background and answered as JSON, never a
 * redirect; the API decides who may, and answers with the note as it then stands, which
 * is the only thing the page shows as done. */
export async function POST(request: Request) {
  let fields: Record<string, unknown> = {};
  try {
    const body = (await request.json()) as unknown;
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      fields = body as Record<string, unknown>;
    }
  } catch {
    fields = {};
  }
  const write = reviewNoteWrite(fields);
  if ("error" in write) {
    return NextResponse.json({ status: 422, detail: "", result: null });
  }
  return NextResponse.json(
    await forward(write.path, { method: "POST", body: write.body }),
  );
}
