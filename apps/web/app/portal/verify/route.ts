import { NextResponse } from "next/server";

import { forward, setSession } from "../../../src/portal-api";
import { validToken } from "../../../src/portal-model";

const CODE = /^[0-9]{6}$/;

/** Exchange the code for a session, kept in an httpOnly cookie for two hours. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
    code?: unknown;
  } | null;
  const token = typeof body?.token === "string" ? body.token : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!validToken(token) || !CODE.test(code)) {
    return NextResponse.json({
      status: 422,
      detail: "enter the six-digit code from the email",
    });
  }
  const result = await forward(`/links/${token}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const session =
    typeof result.body === "object" &&
    result.body !== null &&
    "session_token" in result.body &&
    typeof (result.body as { session_token: unknown }).session_token ===
      "string"
      ? (result.body as { session_token: string }).session_token
      : "";
  const detail =
    typeof result.body === "object" &&
    result.body !== null &&
    "detail" in result.body &&
    typeof (result.body as { detail: unknown }).detail === "string"
      ? (result.body as { detail: string }).detail
      : "";
  const response = NextResponse.json(
    { status: result.status, detail },
    { headers: { "cache-control": "no-store" } },
  );
  if (result.status === 200 && validToken(session)) {
    setSession(response, session, 2 * 60 * 60);
  }
  return response;
}
