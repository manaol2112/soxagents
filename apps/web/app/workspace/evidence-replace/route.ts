import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  changeNoticeFor,
  replaceTarget,
} from "../../../src/evidence-change-model";
import { MAX_UPLOAD_BYTES } from "../../../src/evidence-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

/** The corrected file for an evidence file, passed to the API as its raw bytes. */
export async function POST(request: Request) {
  const target = replaceTarget(new URL(request.url).searchParams);
  if ("error" in target) {
    return NextResponse.json({ notice: "invalid" }, { status: 400 });
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ notice: "invalid" }, { status: 413 });
  }
  const content = await request.arrayBuffer();
  if (content.byteLength === 0 || content.byteLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ notice: "invalid" }, { status: 422 });
  }
  const headers = new Headers({
    "content-type":
      request.headers.get("content-type") ?? "application/octet-stream",
  });
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  if (session !== undefined) {
    headers.set("cookie", `aw_session=${session}`);
  }
  try {
    const response = await fetch(
      `${apiBaseUrl()}${target.path}?${target.query}`,
      {
        method: "POST",
        headers,
        body: content,
        cache: "no-store",
        signal: AbortSignal.timeout(60000),
      },
    );
    let detail = "";
    let fileId: string | null = null;
    try {
      const body = (await response.json()) as Record<string, unknown>;
      detail = typeof body.detail === "string" ? body.detail : "";
      fileId = typeof body.file_id === "string" ? body.file_id : null;
    } catch {
      detail = "";
    }
    const notice = changeNoticeFor("replace", response.status, detail);
    return NextResponse.json(
      { notice, file_id: response.status === 200 ? fileId : null },
      { status: response.status === 200 ? 200 : response.status },
    );
  } catch {
    return NextResponse.json({ notice: "unavailable" }, { status: 503 });
  }
}
