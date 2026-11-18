import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../../src/load-workspace";
import { copiesPath, copyWrite } from "../../../../src/working-copy-model";

/** A person's working copies of a workpaper's sections (docs/design-workpaper.md, section
 * 3.4): read (GET), kept or discarded (POST, intent "keep" or "discard"), each one call
 * of the API with the person's session, answered as JSON with the API's status (any 2xx
 * said as 200; 0 where it could not be reached) and never a redirect. A working copy is
 * not the workpaper: nothing here adds a version. The API decides who may keep one and
 * returns only the caller's own; copiesPath and copyWrite refuse here what is not well
 * formed. The session and the text are never logged. */

async function session(): Promise<Headers> {
  const headers = new Headers();
  const token = sessionToken((await cookies()).get("aw_session")?.value);
  if (token !== undefined) {
    headers.set("cookie", `aw_session=${token}`);
  }
  return headers;
}

async function refusal(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as unknown;
    if (typeof body === "object" && body !== null && "detail" in body) {
      const value = (body as { detail?: unknown }).detail;
      return typeof value === "string" ? value.slice(0, 300) : "";
    }
  } catch {
    // Not JSON: the status says what happened.
  }
  return "";
}

export async function GET(request: Request) {
  const path = copiesPath(new URL(request.url).searchParams);
  if (path === null) {
    return NextResponse.json({ status: 422, detail: "", result: null });
  }
  let status = 0;
  let detail = "";
  let result: unknown = null;
  try {
    const response = await fetch(`${apiBaseUrl()}${path}`, {
      method: "GET",
      headers: await session(),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    status = response.ok ? 200 : response.status;
    if (status === 200) {
      result = (await response.json()) as unknown;
    } else {
      detail = await refusal(response);
    }
  } catch {
    // The API did not answer, or not in JSON: never a 200 without its answer.
    status = status === 200 ? 502 : status;
    result = null;
  }
  return NextResponse.json({ status, detail, result });
}

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
  const write = copyWrite(fields);
  if ("error" in write) {
    return NextResponse.json({ status: 422, detail: "", updated_at: null });
  }
  let status = 0;
  let detail = "";
  let updatedAt: string | null = null;
  try {
    const headers = await session();
    if (write.method === "PUT") {
      headers.set("content-type", "application/json");
    }
    const response = await fetch(`${apiBaseUrl()}${write.path}`, {
      method: write.method,
      headers,
      ...(write.method === "PUT" ? { body: JSON.stringify(write.body) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    status = response.ok ? 200 : response.status;
    if (status !== 200) {
      detail = await refusal(response);
    } else if (write.method === "PUT") {
      const body = (await response.json()) as unknown;
      if (typeof body === "object" && body !== null && "updated_at" in body) {
        const value = (body as { updated_at?: unknown }).updated_at;
        updatedAt = typeof value === "string" ? value : null;
      }
    }
  } catch {
    // The API was not reached, or its answer was not JSON: a kept copy without its time
    // is still kept (status 200); anything else is the status it has.
  }
  return NextResponse.json({ status, detail, updated_at: updatedAt });
}
