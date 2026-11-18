import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";
import { traceReadPath, traceWrite } from "../../../src/sample-trace-model";

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

/** A design item's sample trace (31 October 2026): read when its card opens. */
export async function GET(request: Request) {
  const path = traceReadPath(new URL(request.url).searchParams);
  if (path === null) {
    return NextResponse.json({ status: 422, detail: "", result: null });
  }
  return forward(path, { method: "GET" });
}

/** The sample a person confirms or picks; answers with the trace as it then stands. */
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
  const write = traceWrite(fields);
  if (!write.ok) {
    return NextResponse.json({ status: 422, detail: "", result: null });
  }
  return forward(write.path, { method: "POST", body: write.body });
}
