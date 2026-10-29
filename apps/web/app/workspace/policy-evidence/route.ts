import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

const ID = /^[0-9a-f-]{36}$/i;

async function session(): Promise<string | undefined> {
  return sessionToken((await cookies()).get("aw_session")?.value);
}

/** The policies on file proposed for a control's items (policy_evidence.py). Reading also
 * asks the agent to read what is new, in the background. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const [organization, project, control] = [
    params.get("organization") ?? "",
    params.get("project") ?? "",
    params.get("control") ?? "",
  ];
  const token = await session();
  if (![organization, project, control].every((v) => ID.test(v)) || !token) {
    return NextResponse.json({ status: 422, result: null });
  }
  try {
    const response = await fetch(
      `${apiBaseUrl()}/organizations/${organization}/projects/${project}/controls/${control}/policy-evidence`,
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

/** A person's decision on a proposal: use it as evidence, or dismiss it. The API decides
 * who may; its own reason for a refusal is passed on. */
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
  const {
    organization_id,
    project_id,
    proposal_id,
    control_id,
    item_id,
    document_id,
    decision,
  } = fields;
  const token = await session();
  const ok = (values: unknown[]) =>
    values.every((value) => typeof value === "string" && ID.test(value));
  // A proposal used or dismissed, or a policy on file a person chooses for an item.
  const target =
    (decision === "accept" || decision === "dismiss") &&
    ok([organization_id, project_id, proposal_id])
      ? {
          path: `policy-evidence/${proposal_id}/${decision}`,
          body: null,
        }
      : decision === "choose" &&
          ok([organization_id, project_id, control_id, item_id, document_id])
        ? {
            path: `controls/${control_id}/items/${item_id}/policy-evidence`,
            body: JSON.stringify({ document_id }),
          }
        : null;
  if (target === null || !token) {
    return NextResponse.json({ status: 422, detail: "" });
  }
  try {
    const response = await fetch(
      `${apiBaseUrl()}/organizations/${organization_id}/projects/${project_id}/${target.path}`,
      {
        method: "POST",
        headers: {
          cookie: `aw_session=${token}`,
          ...(target.body === null
            ? {}
            : { "content-type": "application/json" }),
        },
        body: target.body,
        cache: "no-store",
        signal: AbortSignal.timeout(60000),
      },
    );
    const answer = (await response.json().catch(() => ({}))) as {
      detail?: unknown;
    };
    return NextResponse.json({
      status: response.status,
      detail:
        response.status === 409 && typeof answer.detail === "string"
          ? answer.detail.slice(0, 300)
          : "",
    });
  } catch {
    return NextResponse.json({ status: 503, detail: "" });
  }
}
