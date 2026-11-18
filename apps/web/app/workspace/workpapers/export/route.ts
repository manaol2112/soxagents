import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../../src/load-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A workpaper record, one control's workbook, or the engagement's binder, as .xlsx. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const organization = url.searchParams.get("organization") ?? "";
  const project = url.searchParams.get("project") ?? "";
  const workpaper = url.searchParams.get("workpaper") ?? "";
  const control = url.searchParams.get("control") ?? "";
  if (
    !UUID.test(organization) ||
    !UUID.test(project) ||
    (workpaper !== "" && !UUID.test(workpaper)) ||
    (control !== "" && !UUID.test(control))
  ) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const base = `${apiBaseUrl()}/organizations/${organization}/projects/${project}/workpapers`;
  const target =
    workpaper !== ""
      ? `${base}/${workpaper}/export.xlsx`
      : control !== ""
        ? `${base}/export.xlsx?control_id=${control}`
        : `${base}/export.xlsx`;
  const headers = new Headers();
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  if (session !== undefined) {
    headers.set("cookie", `aw_session=${session}`);
  }
  try {
    const response = await fetch(target, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(60000),
    });
    if (response.status !== 200) {
      return NextResponse.json(
        { error: "unavailable" },
        { status: response.status },
      );
    }
    return new NextResponse(await response.arrayBuffer(), {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition":
          response.headers.get("content-disposition") ??
          'attachment; filename="workpapers.xlsx"',
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
