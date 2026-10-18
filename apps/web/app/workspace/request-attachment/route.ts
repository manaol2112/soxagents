import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";
import {
  attachmentTarget,
  MAX_REFERENCE_BYTES,
  parseAttachment,
  parseSources,
} from "../../../src/request-details-model";

async function forwarded(): Promise<Headers> {
  const headers = new Headers();
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  if (session !== undefined) {
    headers.set("cookie", `aw_session=${session}`);
  }
  return headers;
}

/** A reference material's content or preview, or what can be attached to the request.
 * The API decides who may read each. */
export async function GET(request: Request) {
  const target = attachmentTarget(new URL(request.url).searchParams, "GET");
  if ("error" in target) {
    return new NextResponse(null, { status: 404 });
  }
  try {
    const response = await fetch(`${apiBaseUrl()}${target.path}`, {
      headers: await forwarded(),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (target.mode === "sources") {
      const sources =
        response.status === 200 ? parseSources(await response.json()) : null;
      return NextResponse.json(sources ?? { files: [], workpapers: [] }, {
        status: sources === null ? response.status || 503 : 200,
      });
    }
    if (!response.ok) {
      return new NextResponse(null, { status: response.status });
    }
    const headers: Record<string, string> = {
      "content-type":
        response.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition":
        response.headers.get("content-disposition") ??
        'attachment; filename="reference"',
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    };
    if (target.mode === "preview") {
      // Shown, never run: no scripts, forms, or requests from the file.
      headers["content-security-policy"] =
        "sandbox; default-src 'none'; img-src data:";
    }
    return new NextResponse(await response.arrayBuffer(), { headers });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}

/** One reference file uploaded to the request, passed to the API as its raw bytes. It
 * is internal to the audit team until someone who may approve requests shares it. */
export async function POST(request: Request) {
  const target = attachmentTarget(new URL(request.url).searchParams, "POST");
  if ("error" in target) {
    return NextResponse.json({ status: 422, detail: "" });
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_REFERENCE_BYTES) {
    return NextResponse.json({ status: 413, detail: "" });
  }
  const content = await request.arrayBuffer();
  if (content.byteLength === 0 || content.byteLength > MAX_REFERENCE_BYTES) {
    return NextResponse.json({ status: 422, detail: "" });
  }
  const headers = await forwarded();
  headers.set(
    "content-type",
    request.headers.get("content-type") || "application/octet-stream",
  );
  try {
    const response = await fetch(`${apiBaseUrl()}${target.path}`, {
      method: "POST",
      headers,
      body: content,
      cache: "no-store",
      signal: AbortSignal.timeout(60000),
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    if (response.status !== 200) {
      const detail =
        typeof payload === "object" &&
        payload !== null &&
        typeof (payload as { detail?: unknown }).detail === "string"
          ? (payload as { detail: string }).detail
          : "";
      return NextResponse.json({ status: response.status, detail });
    }
    return NextResponse.json({
      status: 200,
      detail: "",
      attachment: parseAttachment(payload),
    });
  } catch {
    return NextResponse.json({ status: 503, detail: "" });
  }
}
