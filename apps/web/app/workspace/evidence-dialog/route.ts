import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { dialogWrite, tablePath } from "../../../src/evidence-dialog-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

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
    status = response.status;
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

/** A page of a population's rows, for the evidence dialog's Data view (31 October 2026). */
export async function GET(request: Request) {
  const path = tablePath(new URL(request.url).searchParams);
  if (path === null) {
    return NextResponse.json({ status: 422, detail: "", result: null });
  }
  return forward(path, { method: "GET" });
}

/** One of the evidence dialog's actions: confirming a file's type, proposing or approving
 * samples, or picking a walkthrough instance. Called in the background; answers as JSON. */
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
  const write = dialogWrite(fields);
  if (!write.ok) {
    return NextResponse.json({ status: 422, detail: "", result: null });
  }
  return forward(write.path, { method: "POST", body: write.body });
}
