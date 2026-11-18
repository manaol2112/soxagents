import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { browserUrl } from "../../../src/browser-url";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A person confirms a round's testing basis after the plan changed (plain form), back
 * to the control's Test step. The API checks the role and the round's state again. */
export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  const roundId = fields.round_id ?? "";
  const reason = (fields.reason ?? "").trim().slice(0, 500);
  const version = Number(fields.version ?? "");
  // The workspace's generic notices: saved, denied, changed (the round is closed),
  // unavailable, invalid.
  let notice = "invalid";
  if (
    UUID.test(organizationId) &&
    UUID.test(projectId) &&
    UUID.test(roundId) &&
    Number.isInteger(version) &&
    version >= 1
  ) {
    const session = sessionToken((await cookies()).get("aw_session")?.value);
    let status = 0;
    try {
      const headers = new Headers({ "content-type": "application/json" });
      if (session !== undefined) {
        headers.set("cookie", `aw_session=${session}`);
      }
      const response = await fetch(
        `${apiBaseUrl()}/organizations/${organizationId}/projects/${projectId}/test-rounds/${roundId}/basis`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ version, reason }),
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        },
      );
      status = response.status;
    } catch {
      status = 0;
    }
    notice =
      status === 200
        ? "saved"
        : status === 403 || status === 404
          ? "denied"
          : status === 409
            ? "changed"
            : "unavailable";
  }
  const destination = browserUrl("/", request);
  destination.searchParams.set("section", "controls");
  if (UUID.test(organizationId)) {
    destination.searchParams.set("organization", organizationId);
  }
  if (UUID.test(projectId)) {
    destination.searchParams.set("project", projectId);
  }
  if (UUID.test(fields.control_id ?? "")) {
    destination.searchParams.set("control", fields.control_id ?? "");
  }
  destination.searchParams.set("step", "test");
  destination.searchParams.set("notice", notice);
  return NextResponse.redirect(destination, 303);
}
