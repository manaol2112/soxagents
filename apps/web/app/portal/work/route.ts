import { answer, forward, portalSession } from "../../../src/portal-api";
import { workspaceWrite } from "../../../src/portal-model";

const INTENTS = new Set(["answers", "messages", "submit"]);

/** The owner's writes on one request: answers, a message, or submitting. */
export async function POST(request: Request) {
  const session = await portalSession();
  if (session === undefined) {
    return answer({ status: 401, body: null });
  }
  const fields = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const intent = fields?.intent;
  const requestId = fields?.request_id;
  if (
    fields === null ||
    typeof intent !== "string" ||
    !INTENTS.has(intent) ||
    typeof requestId !== "string"
  ) {
    return answer({ status: 422, body: { detail: "invalid" } });
  }
  const write = workspaceWrite(
    intent as "answers" | "messages" | "submit",
    requestId,
    fields,
  );
  if ("error" in write) {
    return answer({ status: 422, body: { detail: write.error } });
  }
  return answer(
    await forward(write.path, {
      method: "POST",
      session,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(write.body),
    }),
  );
}
