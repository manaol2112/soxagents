import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { browserUrl } from "../../../src/browser-url";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";
import {
  returnAnchor,
  setupNoticeFor,
  setupWrite,
} from "../../../src/onboarding-model";

export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  const multi: Record<string, string[]> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string") {
      continue;
    }
    fields[key] = value;
    multi[key] = [...(multi[key] ?? []), value];
  }
  const write = setupWrite(fields, multi);
  if ("error" in write) {
    return redirect(request, fields, fields.step ?? "scope", "setup-invalid");
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let detail = "";
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
      signal: AbortSignal.timeout(
        // Launching writes every control's evidence plan and its tasks: it can take
        // a while for a large scope.
        write.intent === "launch" || write.intent === "approve"
          ? 60000
          : write.intent.startsWith("rcm-") ||
              // Invitations and firm domains wait on a mail-domain lookup.
              write.intent === "invite-member" ||
              write.intent === "add-domain"
            ? 15000
            : 5000,
      ),
    });
    status = response.status;
    if (status !== 200) {
      const payload = (await response.json().catch(() => null)) as {
        detail?: unknown;
      } | null;
      if (payload !== null && typeof payload.detail === "string") {
        detail = payload.detail;
      }
    }
  } catch (error) {
    // Out of time is not a failure: the API may finish the work after the wait ends.
    status = error instanceof Error && error.name === "TimeoutError" ? -1 : 0;
  }
  return redirect(
    request,
    fields,
    write.step,
    setupNoticeFor(write.intent, status, detail),
  );
}

function redirect(
  request: Request,
  fields: Record<string, string>,
  step: string,
  notice: string,
) {
  // A form saved in the background (setup-form.tsx) gets the outcome, not a new page.
  if (request.headers.get("x-setup-fetch") === "1") {
    return NextResponse.json({ notice });
  }
  const destination = browserUrl("/", request);
  destination.searchParams.set("section", "setup");
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  if (organizationId !== "") {
    destination.searchParams.set("organization", organizationId);
  }
  if (projectId !== "") {
    destination.searchParams.set("project", projectId);
  }
  destination.searchParams.set("step", step);
  const control = fields.return_control ?? "";
  if (notice !== "setup-saved" && control !== "") {
    destination.searchParams.set("control", control);
  }
  // The tab open in the Controls step stays open after its forms post.
  const category = fields.return_category ?? "";
  if (category === "it" || category === "business" || category === "reports") {
    destination.searchParams.set("category", category);
  }
  // The system open in the Controls step stays open after its forms post.
  const system = fields.return_system ?? "";
  if (/^[0-9a-f-]{36}$/i.test(system)) {
    destination.searchParams.set("system", system);
  }
  destination.searchParams.set("notice", notice);
  const anchor = returnAnchor(fields.return_anchor);
  if (anchor !== null) {
    destination.hash = anchor;
  }
  return NextResponse.redirect(destination, 303);
}
