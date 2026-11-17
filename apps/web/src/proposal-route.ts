import { apiBaseUrl } from "./load-workspace";

/**
 * The one call the page's proposal routes make of the API (docs/design-workpaper.md,
 * section 3.11): with the person's session, answered as the routes answer, as JSON with
 * the API's status (any 2xx said as 200; 0 where the API could not be reached, 502 where
 * a 2xx came without its JSON), the API's own sentence for a refusal, and the proposal
 * the API answered (null where none stands). The session and the text are never logged;
 * nothing is redirected.
 */
export async function proposalCall(
  session: string | undefined,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; detail: string; proposal: unknown }> {
  let status = 0;
  let detail = "";
  let proposal: unknown = null;
  try {
    const headers = new Headers();
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    if (body !== undefined) {
      headers.set("content-type", "application/json");
    }
    const response = await fetch(`${apiBaseUrl()}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    status = response.ok ? 200 : response.status;
    const answer = (await response.json()) as unknown;
    if (typeof answer === "object" && answer !== null) {
      const fields = answer as { detail?: unknown; proposal?: unknown };
      if (status === 200) {
        proposal = fields.proposal ?? null;
      } else if (typeof fields.detail === "string") {
        detail = fields.detail.slice(0, 300);
      }
    }
  } catch {
    // The API did not answer, or not in JSON: never a 200 without its answer.
    status = status === 200 ? 502 : status;
    proposal = null;
  }
  return { status, detail, proposal };
}
