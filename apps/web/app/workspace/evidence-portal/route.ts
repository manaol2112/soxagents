import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { browserUrl } from "../../../src/browser-url";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";
import { portalWrite } from "../../../src/portal-model";

/** Revoke an owner's upload links, or open a local preview link (test mailbox only). */
export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const back = browserUrl("/", request);
  back.searchParams.set("organization", fields.organization_id ?? "");
  back.searchParams.set("project", fields.project_id ?? "");
  back.searchParams.set("section", "evidence");
  back.searchParams.set("tab", "requests");
  const write = portalWrite(fields);
  if ("error" in write) {
    back.searchParams.set("notice", "invalid");
    return NextResponse.redirect(back, 303);
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let url = "";
  try {
    const headers = new Headers({ "content-type": "application/json" });
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(`${apiBaseUrl()}${write.path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(write.body),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    status = response.status;
    const payload = (await response.json().catch(() => null)) as {
      url?: unknown;
    } | null;
    url = typeof payload?.url === "string" ? payload.url : "";
  } catch {
    status = 0;
  }
  if (
    write.intent === "preview" &&
    status === 200 &&
    /^https?:\/\//.test(url)
  ) {
    return NextResponse.redirect(url, 303);
  }
  back.searchParams.set(
    "notice",
    status === 200
      ? "links-revoked"
      : status === 403
        ? "denied"
        : write.intent === "preview"
          ? "preview-unavailable"
          : "unavailable",
  );
  return NextResponse.redirect(back, 303);
}
