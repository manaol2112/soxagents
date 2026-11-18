import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  batchReadPath,
  placementWrite,
} from "../../../src/evidence-wizard-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

/** Passes one call to the API and answers as JSON: the API's status, its plain
 * sentence on a refusal, and its body when it answered 200. */
async function forward(
  path: string,
  init: { method: "GET" } | { method: "POST"; body: Record<string, unknown> },
) {
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
      signal: AbortSignal.timeout(20000),
    });
    status = response.status;
    const body = (await response.json().catch(() => null)) as unknown;
    if (status === 200) {
      result = body;
    } else if (typeof body === "object" && body !== null && "detail" in body) {
      const value = (body as { detail?: unknown }).detail;
      detail = typeof value === "string" ? value.slice(0, 300) : "";
    }
  } catch {
    status = status === 0 ? 0 : status;
  }
  return NextResponse.json({ status, detail, result });
}

/** The D&I evidence wizard's session (docs/evidence-wizard.md, 2.4), read every few
 * seconds while it works: one batch's state with `batch`, the control's recent sessions
 * without it. The API decides who may read it. */
export async function GET(request: Request) {
  const path = batchReadPath(new URL(request.url).searchParams);
  if (path === null) {
    return NextResponse.json({ status: 422, detail: "", result: null });
  }
  return forward(path, { method: "GET" });
}

/** A person places a file (on items, or out of D&I) at the version they saw; answers
 * with the file's entry. A stale version or a refusal is the API's own sentence. */
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
  const write = placementWrite(fields);
  if ("error" in write) {
    return NextResponse.json({ status: 422, detail: "", result: null });
  }
  return forward(write.path, { method: "POST", body: write.body });
}
