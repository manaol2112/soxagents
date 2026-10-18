import { NextResponse } from "next/server";
import { browserUrl } from "../../../src/browser-url";
import { apiBaseUrl } from "../../../src/load-workspace";
import { demoWrite, welcomeNoticeFor } from "../../../src/welcome-model";

/** The landing page's demo request, forwarded to the API's public endpoint. */
export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const write = demoWrite(fields);
  if ("error" in write) {
    return redirect(request, "invalid");
  }
  let status = 0;
  try {
    const response = await fetch(`${apiBaseUrl()}/public/demo-requests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": request.headers.get("user-agent") ?? "",
      },
      body: JSON.stringify(write.body),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    status = response.status;
  } catch {
    status = 0;
  }
  return redirect(request, welcomeNoticeFor(status));
}

function redirect(request: Request, notice: string) {
  const destination = browserUrl("/welcome", request);
  destination.searchParams.set("notice", notice);
  destination.hash = "demo";
  return NextResponse.redirect(destination, 303);
}
