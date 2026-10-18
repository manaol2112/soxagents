import { answer, forward } from "../../../src/portal-api";
import { validToken } from "../../../src/portal-model";

/** Ask for a one-time code for the link; it is emailed to the link's address. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
  } | null;
  const token = typeof body?.token === "string" ? body.token : "";
  if (!validToken(token)) {
    return answer({ status: 404, body: null });
  }
  return answer(await forward(`/links/${token}/code`, { method: "POST" }));
}
