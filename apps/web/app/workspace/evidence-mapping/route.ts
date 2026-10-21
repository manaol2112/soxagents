import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { browserUrl } from "../../../src/browser-url";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Map a control's evidence to its approved attributes (Milestone 3b): the form on the
 * Test step posts here, the API runs the mapping as the signed-in person (who must be
 * allowed to update the engagement) and the person lands back on the control.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const field = (name: string): string => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  const organizationId = field("organization_id");
  const projectId = field("project_id");
  const controlId = field("control_id");
  const back = field("back");
  if (
    !UUID.test(organizationId) ||
    !UUID.test(projectId) ||
    !UUID.test(controlId)
  ) {
    return redirect(request, back, "invalid");
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let outcome = "failed";
  try {
    const headers = new Headers({ "content-type": "application/json" });
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(
      `${apiBaseUrl()}/organizations/${organizationId}/projects/${projectId}/controls/${controlId}/evidence-mapping`,
      {
        method: "POST",
        headers,
        cache: "no-store",
        // One model call per attribute: allow the run to finish.
        signal: AbortSignal.timeout(180000),
      },
    );
    outcome =
      response.status === 200
        ? "done"
        : response.status === 403
          ? "not-allowed"
          : response.status === 409
            ? "blocked"
            : "failed";
  } catch {
    outcome = "failed";
  }
  return redirect(request, back, outcome);
}

function redirect(request: Request, back: string, outcome: string) {
  const safe = back.startsWith("/") && !back.startsWith("//") ? back : "/";
  const destination = browserUrl(safe, request);
  destination.searchParams.set("mapping", outcome);
  return NextResponse.redirect(destination, 303);
}
