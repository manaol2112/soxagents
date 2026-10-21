import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { browserUrl } from "../../../src/browser-url";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(["test-sheet", "review", "analysis", "workpaper"]);

/**
 * Cancel a queued or running agent job (Milestone 3a): the form on the control's agent
 * roster posts here, the API decides (the member must be allowed to update the
 * engagement), and the person lands back on the control with the outcome in the query.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const field = (name: string): string => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  const organizationId = field("organization_id");
  const projectId = field("project_id");
  const kind = field("kind");
  const recordId = field("record_id");
  const back = field("back");
  if (
    !UUID.test(organizationId) ||
    !UUID.test(projectId) ||
    !UUID.test(recordId) ||
    !KINDS.has(kind)
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
      `${apiBaseUrl()}/organizations/${organizationId}/projects/${projectId}/agent-runs/${kind}/${recordId}/cancel`,
      {
        method: "POST",
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      },
    );
    if (response.status === 200) {
      const payload = (await response.json().catch(() => null)) as {
        state?: unknown;
      } | null;
      outcome = payload?.state === "CANCELLED" ? "cancelled" : "requested";
    } else if (response.status === 403) {
      outcome = "not-allowed";
    } else if (response.status === 409) {
      outcome = "nothing-running";
    }
  } catch {
    outcome = "failed";
  }
  return redirect(request, back, outcome);
}

/** Back to the page the form came from (a path on this app only), with the outcome. */
function redirect(request: Request, back: string, outcome: string) {
  const safe = back.startsWith("/") && !back.startsWith("//") ? back : "/";
  const destination = browserUrl(safe, request);
  destination.searchParams.set("cancel", outcome);
  return NextResponse.redirect(destination, 303);
}
