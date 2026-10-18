import { answer, forward, portalSession } from "../../../src/portal-api";

/** The owner's open requests, for the verified session in the cookie. */
export async function GET() {
  const session = await portalSession();
  if (session === undefined) {
    return answer({ status: 401, body: null });
  }
  return answer(await forward("/session", { method: "GET", session }));
}
