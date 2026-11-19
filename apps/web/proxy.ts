import { type NextRequest, NextResponse } from "next/server";
import { workspacePath } from "./src/last-page-model";
import { apiGet, sessionToken } from "./src/load-workspace";
import {
  allowedOrigins,
  ORIGIN_REFUSED,
  originRefusal,
} from "./src/origin-guard";
import { resolveRoute } from "./src/routes";
import { signedOutRedirect } from "./src/sign-in-model";

/** Every request passes here first (Next.js Proxy). Three jobs:
 *
 * 1. A state-changing request from another origin is refused (src/origin-guard.ts,
 *    governance finding S3, 18 November 2026).
 * 2. The older sections' addresses answer with a redirect to the destination that now
 *    holds their page, with every other parameter kept (Milestone 2c): a stored link in an
 *    email, a portal message or an audit event lands on its record. The table is
 *    src/routes.ts; the page applies it again should a request bypass the proxy.
 * 3. A signed-out visitor at a workspace address goes to sign in and comes back to it
 *    afterwards (src/sign-in-model.ts, signedOutRedirect; 19 November 2026), answered
 *    here as a real redirect, before the page streams the workspace's loading frame. The
 *    page applies the same rule to a navigation inside the app. */
export default async function proxy(request: NextRequest) {
  const refused = originRefusal({
    method: request.method,
    origin: request.headers.get("origin"),
    fetchSite: request.headers.get("sec-fetch-site"),
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    allowed: allowedOrigins(process.env.WEB_ALLOWED_ORIGINS),
  });
  if (refused !== null) {
    return NextResponse.json(
      { error: "forbidden", detail: ORIGIN_REFUSED },
      { status: 403 },
    );
  }
  const { pathname, searchParams } = request.nextUrl;
  if (pathname !== "/") {
    return NextResponse.next();
  }
  const params: Record<string, string | string[]> = {};
  for (const key of new Set(searchParams.keys())) {
    const all = searchParams.getAll(key);
    params[key] = all.length === 1 ? (all[0] ?? "") : all;
  }
  const route = resolveRoute(params);
  if (route.redirect !== null) {
    return NextResponse.redirect(new URL(route.redirect, request.url), 307);
  }
  if (request.method === "GET" && (await signedOut(request))) {
    const away = signedOutRedirect({
      signedOut: true,
      hasSession: request.cookies.get("aw_session")?.value !== undefined,
      path: workspacePath(params),
    });
    if (away !== null) {
      return NextResponse.redirect(new URL(away, request.url), 307);
    }
  }
  return NextResponse.next();
}

/** Whether the visitor is signed out: no session cookie, or, when a page is loaded whole,
 * one the API answers 401 for (expired or revoked). A navigation inside the app is left to
 * the page, which reads the session anyway; an API that cannot be reached is not a
 * sign-out, and the page says the workspace is unavailable. */
async function signedOut(request: NextRequest): Promise<boolean> {
  const raw = request.cookies.get("aw_session")?.value;
  if (raw === undefined) {
    return true;
  }
  // The app's own requests (its page data, prefetches) are fetches, not documents.
  if (request.headers.get("sec-fetch-dest") === "empty") {
    return false;
  }
  return (await apiGet("/auth/me", sessionToken(raw))).status === 401;
}

// Every route but the build's static files and images, which are only ever read.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
