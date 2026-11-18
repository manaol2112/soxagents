import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { browserUrl } from "../../../src/browser-url";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Renaming one of the firm's clients (Milestone 8.18), from the Engagements page. */
export async function POST(request: Request) {
  const form = await request.formData();
  const field = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" ? value : "";
  };
  const organizationId = field("organization_id");
  const clientId = field("client_id");
  const version = field("version");
  const name = field("name").trim().split(/\s+/).join(" ");
  if (
    field("intent") !== "rename" ||
    !UUID.test(organizationId) ||
    !UUID.test(clientId) ||
    !/^[1-9]\d*$/.test(version) ||
    name === "" ||
    name.length > 200
  ) {
    return back(request, organizationId, "invalid");
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let detail = "";
  try {
    const headers = new Headers({ "content-type": "application/json" });
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(
      `${apiBaseUrl()}/organizations/${organizationId}/clients/${clientId}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ name, version: Number(version) }),
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      },
    );
    status = response.status;
    if (status !== 200) {
      const payload = (await response.json().catch(() => null)) as {
        detail?: unknown;
      } | null;
      detail = typeof payload?.detail === "string" ? payload.detail : "";
    }
  } catch {
    status = 0;
  }
  const notice =
    status === 200
      ? "client-renamed"
      : status === 409 && detail === "client exists"
        ? "client-exists"
        : status === 409
          ? "client-changed"
          : status === 403 || status === 404
            ? "denied"
            : status === 422
              ? "invalid"
              : "unavailable";
  return back(request, organizationId, notice);
}

function back(request: Request, organizationId: string, notice: string) {
  const destination = browserUrl("/", request);
  destination.searchParams.set("section", "projects");
  // Back to the clients table the rename was made from.
  destination.searchParams.set("view", "clients");
  if (UUID.test(organizationId)) {
    destination.searchParams.set("organization", organizationId);
  }
  destination.searchParams.set("notice", notice);
  return NextResponse.redirect(destination, 303);
}
