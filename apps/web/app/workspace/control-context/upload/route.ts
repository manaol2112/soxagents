import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { documentUploadTarget } from "../../../../src/control-context-model";
import { apiBaseUrl, sessionToken } from "../../../../src/load-workspace";

/** A supporting document for one or more controls. The file is read for its text by the
 * API and not kept; the text is stored and linked to the controls. */
export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  const controls: string[] = [];
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string") {
      continue;
    }
    if (key === "control_id") {
      controls.push(value);
    } else {
      fields[key] = value;
    }
  }
  const file = form.get("content");
  const target = documentUploadTarget(
    fields,
    controls,
    file instanceof File ? { name: file.name, size: file.size } : null,
  );
  if (target === null || !(file instanceof File)) {
    return NextResponse.json({
      status: file instanceof File && file.size > 0 ? 413 : 422,
      upload: null,
    });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let upload: unknown = null;
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
      signal: AbortSignal.timeout(30000),
    });
    status = response.status;
    if (status === 200) {
      upload = await response.json();
    }
  } catch {
    status = 0;
  }
  return NextResponse.json({ status, upload });
}
