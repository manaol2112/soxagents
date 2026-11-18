import { NextResponse } from "next/server";
import { browserUrl } from "../../../src/browser-url";
import { apiBaseUrl } from "../../../src/load-workspace";
import {
  demoWrite,
  visitorAddress,
  welcomeNoticeFor,
} from "../../../src/welcome-model";

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
  // The visitor's address, so the API's limit is per visitor and not one for everyone
  // (the API sees this server's address otherwise; security review, 17 November 2026).
  const headers = new Headers({
    "content-type": "application/json",
    "user-agent": request.headers.get("user-agent") ?? "",
  });
  const visitor = visitorAddress(request.headers.get("x-forwarded-for"));
  if (visitor !== null) {
    headers.set("x-forwarded-for", visitor);
  }
  let status = 0;
  try {
    const response = await fetch(`${apiBaseUrl()}/public/demo-requests`, {
      method: "POST",
      headers,
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
