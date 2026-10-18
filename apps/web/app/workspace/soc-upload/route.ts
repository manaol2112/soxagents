import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";
import { socUploadTarget } from "../../../src/onboarding-model";

/** A vendor's SOC report for one system. The API reads its text for the agent and keeps
 * the text, not the file. */
export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const file = form.get("content");
  const target = socUploadTarget(
    fields,
    file instanceof File ? { name: file.name, size: file.size } : null,
  );
  if (target === null || !(file instanceof File)) {
    return NextResponse.json({
      status: file instanceof File && file.size > 0 ? 413 : 422,
      detail: "",
    });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let detail = "";
  try {
    const headers = new Headers({
      "content-type": file.type || "application/octet-stream",
    });
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(`${apiBaseUrl()}${target.path}`, {
      method: "POST",
      headers,
      body: new Uint8Array(await file.arrayBuffer()),
      cache: "no-store",
      signal: AbortSignal.timeout(120000),
    });
    status = response.status;
    if (status !== 200) {
      const body = (await response.json()) as { detail?: unknown };
      detail = typeof body.detail === "string" ? body.detail : "";
    }
  } catch {
    status = status === 0 ? 0 : status;
  }
  return NextResponse.json({ status, detail });
}
