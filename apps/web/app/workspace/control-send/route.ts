import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

const ID = /^[0-9a-f-]{36}$/i;

/** Approve and send a control's drafts to its owner (control_send.py): a check first,
 * then the send. Called in the background; answers as JSON. The API decides who may. */
export async function POST(request: Request) {
  let fields: Record<string, unknown> = {};
  try {
    const body = (await request.json()) as unknown;
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      fields = body as Record<string, unknown>;
    }
  } catch {
    fields = {};
  }
  const { organization_id, project_id, control_id, ...rest } = fields;
  if (
    ![organization_id, project_id, control_id].every(
      (value) => typeof value === "string" && ID.test(value),
    )
  ) {
    return NextResponse.json({ status: 422, detail: "", result: null });
  }
  const send: Record<string, unknown> = { preview: rest.preview !== false };
  if (typeof rest.owner_name === "string") send.owner_name = rest.owner_name;
  if (typeof rest.owner_email === "string") send.owner_email = rest.owner_email;
  // The review's changes to who each request goes to; the API checks each address.
  if (Array.isArray(rest.routing)) {
    send.routing = rest.routing
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      )
      .slice(0, 50)
      .map((item) => ({
        id: String(item.id ?? ""),
        recipient: String(item.recipient ?? ""),
        cc: Array.isArray(item.cc)
          ? item.cc
              .filter((a): a is string => typeof a === "string")
              .slice(0, 10)
          : [],
      }));
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  try {
    const headers = new Headers({ "content-type": "application/json" });
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(
      `${apiBaseUrl()}/organizations/${organization_id}/projects/${project_id}/controls/${control_id}/evidence-requests/approve-send`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(send),
        cache: "no-store",
        signal: AbortSignal.timeout(60000),
      },
    );
    const payload = (await response.json().catch(() => null)) as unknown;
    return NextResponse.json({
      status: response.status,
      detail:
        response.status !== 200 &&
        typeof payload === "object" &&
        payload !== null &&
        typeof (payload as { detail?: unknown }).detail === "string"
          ? (payload as { detail: string }).detail
          : "",
      result: response.status === 200 ? payload : null,
    });
  } catch {
    return NextResponse.json({ status: 0, detail: "", result: null });
  }
}
