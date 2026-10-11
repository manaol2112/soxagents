import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../src/load-workspace";

export async function POST(request: Request) {
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  if (session !== undefined) {
    try {
      const response = await fetch(`${apiBaseUrl()}/auth/logout`, {
        method: "POST",
        headers: { cookie: `aw_session=${session}` },
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      });
      if (response.status !== 204) {
        return new NextResponse("Sign out could not be completed.", {
          status: 503,
        });
      }
    } catch {
      return new NextResponse("Sign out could not be completed.", {
        status: 503,
      });
    }
  }
  const redirect = NextResponse.redirect(new URL("/", request.url), 303);
  redirect.cookies.set("aw_session", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return redirect;
}
