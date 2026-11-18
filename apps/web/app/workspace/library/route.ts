import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { libraryWrite } from "../../../src/library-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

/** The Library page's decisions: a standard control's methodology status, a proposed
 * change to the library, and the decision on one. Called in the background; answers as
 * JSON. Nothing here edits the library's definitions. */
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
  const write = libraryWrite(fields);
  if ("error" in write) {
    return NextResponse.json({ status: 422, detail: "", body: null });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let detail = "";
  let answer: unknown = null;
  try {
    const headers = new Headers({ "content-type": "application/json" });
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(`${apiBaseUrl()}${write.path}`, {
      method: write.method,
      headers,
      body: JSON.stringify(write.body),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    status = response.status;
    const body = (await response.json()) as unknown;
    if (status === 200 || status === 201) {
      answer = body;
    } else if (typeof body === "object" && body !== null && "detail" in body) {
      const value = (body as { detail?: unknown }).detail;
      detail = typeof value === "string" ? value : "";
    }
  } catch {
    status = status === 0 ? 0 : status;
  }
  return NextResponse.json({ status, detail, body: answer });
}
