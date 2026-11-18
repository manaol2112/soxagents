import { type NextRequest, NextResponse } from "next/server";
import {
  allowedOrigins,
  ORIGIN_REFUSED,
  originRefusal,
} from "./src/origin-guard";
import { resolveRoute } from "./src/routes";

/** Every request passes here first (Next.js Proxy). Two jobs:
 *
 * 1. A state-changing request from another origin is refused (src/origin-guard.ts,
 *    governance finding S3, 18 November 2026).
 * 2. The older sections' addresses answer with a redirect to the destination that now
 *    holds their page, with every other parameter kept (Milestone 2c): a stored link in an
 *    email, a portal message or an audit event lands on its record. The table is
 *    src/routes.ts; the page applies it again should a request bypass the proxy. */
export default function proxy(request: NextRequest) {
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
  if (route.redirect === null) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL(route.redirect, request.url), 307);
}

// Every route but the build's static files and images, which are only ever read.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
