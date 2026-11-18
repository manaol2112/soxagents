import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiGet, sessionToken } from "../../../src/load-workspace";
import {
  type ImpactTarget,
  impactPath,
  scopeImpact,
  teamImpact,
} from "../../../src/setup-impact-model";

/** What a scope or team change would affect, for the confirm dialog to show first. */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const kind = query.get("kind");
  const id = query.get("id") ?? "";
  if (kind !== "control" && kind !== "application" && kind !== "member") {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const target: ImpactTarget = { kind, id };
  const path = impactPath(
    query.get("organization") ?? "",
    query.get("project") ?? "",
    target,
  );
  if (path === null) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  const answer = await apiGet(path, session);
  if (answer.status !== 200) {
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
  const impact =
    kind === "member" ? teamImpact(answer.body) : scopeImpact(answer.body);
  return impact === null
    ? NextResponse.json({ error: "unavailable" }, { status: 502 })
    : NextResponse.json(impact, { headers: { "cache-control": "no-store" } });
}
