import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  annotationReadPath,
  annotationWrite,
} from "../../../src/evidence-annotations-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

/** One call to the API with the person's session, answered as JSON: the API's status, its
 * sentence when it refuses, and the file's annotations as it then lists them. */
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
      signal: AbortSignal.timeout(30000),
    });
    // Any 2xx is the API's confirmation (a new annotation may answer 201).
    status = response.ok ? 200 : response.status;
    const body = (await response.json()) as unknown;
    if (status === 200) {
      result = body;
    } else if (typeof body === "object" && body !== null && "detail" in body) {
      const value = (body as { detail?: unknown }).detail;
      detail = typeof value === "string" ? value : "";
    }
  } catch {
    status = status === 0 ? 0 : status;
  }
  return NextResponse.json({ status, detail, result });
}

/** The annotations of one file on one D&I request (docs/evidence-annotations.md, section
 * 5): read when its preview opens. The API decides who may read them. */
export async function GET(request: Request) {
  const path = annotationReadPath(new URL(request.url).searchParams);
  if (path === null) {
    return NextResponse.json({ status: 422, detail: "", result: null });
  }
  return forward(path, { method: "GET" });
}

/** A person's review of an annotation: confirm, confirm all, edit, remove, or add one of
 * their own. Called in the background; the API decides who may, records the decision, and
 * answers with the list as it then stands, which is what the preview shows. */
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
  const write = annotationWrite(fields);
  if ("error" in write) {
    return NextResponse.json({ status: 422, detail: "", result: null });
  }
  return forward(write.path, { method: "POST", body: write.body });
}
