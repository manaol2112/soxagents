import { type NextRequest, NextResponse } from "next/server";
import { resolveRoute } from "./src/routes";

/** The older sections' addresses answer with a redirect to the destination that now
 * holds their page, with every other parameter kept (Milestone 2c): a stored link in an
 * email, a portal message or an audit event lands on its record. The table is
 * src/routes.ts; the page applies it again should a request bypass the proxy. */
export default function proxy(request: NextRequest) {
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

export const config = { matcher: ["/"] };
