import { NextResponse } from "next/server";

import { forward, portalSession, setSession } from "../../../src/portal-api";

/** End the session here and at the API. */
export async function POST() {
  const session = await portalSession();
  if (session !== undefined) {
    await forward("/session/end", { method: "POST", session });
  }
  const response = NextResponse.json({ status: 204, detail: "" });
  setSession(response, "", 0);
  return response;
}
