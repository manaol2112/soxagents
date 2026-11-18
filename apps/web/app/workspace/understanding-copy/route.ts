import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

const ID = /^[0-9a-f-]{36}$/i;
const KEY = /^[a-z][a-z0-9-]{1,40}$/;

async function session(): Promise<string | undefined> {
  return sessionToken((await cookies()).get("aw_session")?.value);
}

/** The engagement's controls whose answers this control could take (control_design). */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const ids = ["organization", "project", "control"].map(
    (k) => params.get(k) ?? "",
  );
  const token = await session();
  if (!ids.every((v) => ID.test(v)) || !token) {
    return NextResponse.json({ status: 422, result: null });
  }
  const [organization, project, control] = ids;
  try {
    const response = await fetch(
      `${apiBaseUrl()}/organizations/${organization}/projects/${project}/controls/${control}/understanding/sources`,
      {
        headers: { cookie: `aw_session=${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      },
    );
    return NextResponse.json({
      status: response.status,
      result: response.ok ? ((await response.json()) as unknown) : null,
    });
  } catch {
    return NextResponse.json({ status: 503, result: null });
  }
}

/** Copies the chosen answers from another control; the API reads them from the source. */
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
  const { organization_id, project_id, control_id, source_control_id, keys } =
    fields;
  const token = await session();
  const chosen = Array.isArray(keys)
    ? keys
        .filter((k): k is string => typeof k === "string" && KEY.test(k))
        .slice(0, 40)
    : [];
  if (
    ![organization_id, project_id, control_id, source_control_id].every(
      (v) => typeof v === "string" && ID.test(v),
    ) ||
    chosen.length === 0 ||
    !token
  ) {
    return NextResponse.json({ status: 422, detail: "" });
  }
  try {
    const response = await fetch(
      `${apiBaseUrl()}/organizations/${organization_id}/projects/${project_id}/controls/${control_id}/understanding/copy`,
      {
        method: "POST",
        headers: {
          cookie: `aw_session=${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ source_control_id, keys: chosen }),
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      },
    );
    const answer = (await response.json().catch(() => ({}))) as {
      detail?: unknown;
    };
    return NextResponse.json({
      status: response.status,
      detail:
        response.status === 409 && typeof answer.detail === "string"
          ? answer.detail.slice(0, 200)
          : "",
    });
  } catch {
    return NextResponse.json({ status: 503, detail: "" });
  }
}
