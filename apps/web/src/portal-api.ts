import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl } from "./load-workspace";
import { PORTAL_COOKIE, validToken } from "./portal-model";

/** The owner's verified session, from its httpOnly cookie; the browser's scripts never
 * see it. */
export async function portalSession(): Promise<string | undefined> {
  const value = (await cookies()).get(PORTAL_COOKIE)?.value;
  return value !== undefined && validToken(value) ? value : undefined;
}

/** Forward to the API's public portal routes and answer with its status and body. */
export async function forward(
  path: string,
  init: RequestInit & { session?: string; timeout?: number },
): Promise<{ status: number; body: unknown }> {
  const headers = new Headers(init.headers);
  if (init.session !== undefined) {
    headers.set("x-portal-session", init.session);
  }
  try {
    const response = await fetch(
      `${apiBaseUrl()}/public/evidence-portal${path}`,
      {
        ...init,
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(init.timeout ?? 8000),
      },
    );
    const body =
      response.status === 204 ? null : await response.json().catch(() => null);
    return { status: response.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

export function answer(result: {
  status: number;
  body: unknown;
}): NextResponse {
  const detail =
    typeof result.body === "object" &&
    result.body !== null &&
    "detail" in result.body &&
    typeof (result.body as { detail: unknown }).detail === "string"
      ? (result.body as { detail: string }).detail
      : "";
  return NextResponse.json(
    {
      status: result.status,
      detail,
      body: result.status === 200 ? result.body : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export function setSession(
  response: NextResponse,
  token: string,
  maxAge: number,
): void {
  response.cookies.set(PORTAL_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}
