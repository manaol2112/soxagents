import { answer, forward, portalSession } from "../../../src/portal-api";
import {
  MAX_UPLOAD,
  uploadItem,
  validRequestId,
} from "../../../src/portal-model";

/** One file on one of the owner's open requests, for one of its items when named. */
export async function POST(request: Request) {
  const session = await portalSession();
  if (session === undefined) {
    return answer({ status: 401, body: null });
  }
  const form = await request.formData().catch(() => null);
  const requestId = form?.get("request_id");
  const file = form?.get("file");
  const item = uploadItem(form?.get("item"));
  if (
    typeof requestId !== "string" ||
    !validRequestId(requestId) ||
    item === "invalid" ||
    !(file instanceof File) ||
    file.size === 0 ||
    file.size > MAX_UPLOAD
  ) {
    return answer({
      status: 422,
      body: { detail: "the file is empty or larger than 25 MB" },
    });
  }
  const params = new URLSearchParams({ name: file.name.slice(0, 200) });
  if (item !== null) {
    params.set("item", String(item));
  }
  return answer(
    await forward(`/session/requests/${requestId}/files?${params.toString()}`, {
      method: "POST",
      session,
      headers: { "content-type": file.type || "application/octet-stream" },
      body: new Uint8Array(await file.arrayBuffer()),
      timeout: 120_000,
    }),
  );
}
