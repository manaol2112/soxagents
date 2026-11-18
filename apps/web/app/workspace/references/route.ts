import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILE = 5 * 1024 * 1024;

/**
 * Policies and procedures, and prior-year references, on the Systems & Processes page
 * (governing_documents.py, prior_year.py). Answers as JSON with the API's status, so the
 * page updates the part that changed. The API decides who may read or change what.
 */

type Forward = {
  method: "GET" | "POST" | "PUT";
  path: string;
  json?: unknown;
  bytes?: Uint8Array<ArrayBuffer>;
  contentType?: string;
};

async function forward(target: Forward) {
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let answer: unknown = null;
  let detail = "";
  try {
    const headers = new Headers();
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    let body: BodyInit | null = null;
    if (target.bytes !== undefined) {
      headers.set(
        "content-type",
        target.contentType || "application/octet-stream",
      );
      body = target.bytes;
    } else if (target.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(target.json);
    }
    const response = await fetch(`${apiBaseUrl()}${target.path}`, {
      method: target.method,
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    status = response.status;
    const parsed = (await response.json().catch(() => null)) as unknown;
    if (status >= 200 && status < 300) {
      answer = parsed;
    } else if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { detail?: unknown }).detail === "string"
    ) {
      detail = (parsed as { detail: string }).detail;
    }
  } catch {
    status = 0;
  }
  return NextResponse.json({ status, answer, detail });
}

const refused = () =>
  NextResponse.json({ status: 422, answer: null, detail: "" });

function project(fields: Record<string, unknown>): string | null {
  const organization = fields.organization_id;
  const engagement = fields.project_id;
  if (
    typeof organization !== "string" ||
    typeof engagement !== "string" ||
    !UUID.test(organization) ||
    !UUID.test(engagement)
  ) {
    return null;
  }
  return `/organizations/${organization}/projects/${engagement}`;
}

const id = (value: unknown): string | null =>
  typeof value === "string" && UUID.test(value) ? value : null;

const ids = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => id(item) !== null)
    ? (value as string[])
    : null;

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const base = project({
    organization_id: query.get("organization_id"),
    project_id: query.get("project_id"),
  });
  if (base === null) {
    return refused();
  }
  const intent = query.get("intent");
  if (intent === "policies") {
    return forward({ method: "GET", path: `${base}/policies` });
  }
  if (intent === "prior-year") {
    return forward({ method: "GET", path: `${base}/prior-year` });
  }
  const control = id(query.get("control_id"));
  if (intent === "control-prior-year" && control !== null) {
    return forward({
      method: "GET",
      path: `${base}/controls/${control}/prior-year`,
    });
  }
  // A control's client context and documents, read when its row opens on Controls.
  if (intent === "control-context" && control !== null) {
    return forward({
      method: "GET",
      path: `${base}/controls/${control}/context`,
    });
  }
  return refused();
}

export async function POST(request: Request) {
  if (
    (request.headers.get("content-type") ?? "").startsWith(
      "multipart/form-data",
    )
  ) {
    return upload(request);
  }
  let fields: Record<string, unknown> = {};
  try {
    const body = (await request.json()) as unknown;
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      fields = body as Record<string, unknown>;
    }
  } catch {
    fields = {};
  }
  const base = project(fields);
  if (base === null) {
    return refused();
  }
  const document = id(fields.document_id);
  const match = id(fields.match_id);
  const version = typeof fields.version === "number" ? fields.version : 0;
  switch (fields.intent) {
    case "policy-scope": {
      const systems = ids(fields.system_ids);
      const processes = ids(fields.process_ids);
      if (document === null || systems === null || processes === null) {
        return refused();
      }
      return forward({
        method: "PUT",
        path: `${base}/policies/${document}/scope`,
        json: { system_ids: systems, process_ids: processes },
      });
    }
    case "matches": {
      const confirm = ids(fields.confirm ?? []);
      const reject = ids(fields.reject ?? []);
      if (document === null || confirm === null || reject === null) {
        return refused();
      }
      return forward({
        method: "POST",
        path: `${base}/prior-year/${document}/matches`,
        json: { confirm, reject },
      });
    }
    case "assign": {
      const control = id(fields.control_id);
      if (document === null || match === null || control === null) {
        return refused();
      }
      return forward({
        method: "POST",
        path: `${base}/prior-year/${document}/items/${match}/assign`,
        json: { control_id: control, version },
      });
    }
    case "set-aside":
      if (document === null || match === null) {
        return refused();
      }
      return forward({
        method: "POST",
        path: `${base}/prior-year/${document}/items/${match}/set-aside`,
        json: { version },
      });
    case "policy-remove":
      if (document === null) {
        return refused();
      }
      return forward({
        method: "POST",
        path: `${base}/policies/${document}/remove`,
      });
    case "prior-remove":
      if (document === null) {
        return refused();
      }
      return forward({
        method: "POST",
        path: `${base}/prior-year/${document}/remove`,
      });
    // The client's controls and the firm's standards (standard_adoption.py).
    case "standard-matches":
      return forward({ method: "GET", path: `${base}/standards/matches` });
    case "standard-match":
      return forward({ method: "POST", path: `${base}/standards/match` });
    case "standard-adopt": {
      const controls = ids(fields.control_ids);
      if (controls === null || controls.length === 0) {
        return refused();
      }
      return forward({
        method: "POST",
        path: `${base}/standards/adopt`,
        json: { control_ids: controls },
      });
    }
    case "run":
      if (document === null) {
        return refused();
      }
      return forward({
        method: "POST",
        path: `${base}/prior-year/${document}/run`,
      });
    case "proposals": {
      const accept = ids(fields.accept ?? []);
      const dismiss = ids(fields.dismiss ?? []);
      if (accept === null || dismiss === null) {
        return refused();
      }
      return forward({
        method: "POST",
        path: `${base}/prior-year/proposals`,
        json: { accept, dismiss },
      });
    }
    default:
      return refused();
  }
}

async function upload(request: Request) {
  const form = await request.formData();
  const text = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" ? value : "";
  };
  const base = project({
    organization_id: text("organization_id"),
    project_id: text("project_id"),
  });
  const file = form.get("content");
  if (
    base === null ||
    !(file instanceof File) ||
    file.size === 0 ||
    file.size > MAX_FILE
  ) {
    return refused();
  }
  const query = new URLSearchParams({
    title: text("title").slice(0, 200),
    file_name: file.name.slice(0, 200),
  });
  const intent = text("intent");
  if (intent === "policy-upload") {
    const kind = text("kind");
    if (!["POLICY", "PROCEDURE", "NARRATIVE", "FLOWCHART"].includes(kind)) {
      return refused();
    }
    query.set("kind", kind);
    for (const [key, name] of [
      ["system_id", "system_id"],
      ["process_id", "process_id"],
    ] as const) {
      for (const value of form.getAll(key)) {
        if (typeof value !== "string" || id(value) === null) {
          return refused();
        }
        query.append(name, value);
      }
    }
    return forward({
      method: "POST",
      path: `${base}/policies/upload?${query.toString()}`,
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type,
    });
  }
  if (intent === "policy-replace") {
    const document = id(text("document_id"));
    if (document === null) {
      return refused();
    }
    return forward({
      method: "POST",
      path: `${base}/policies/${document}/replace?${query.toString()}`,
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type,
    });
  }
  if (intent === "prior-upload") {
    return forward({
      method: "POST",
      path: `${base}/prior-year/upload?${query.toString()}`,
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type,
    });
  }
  return refused();
}
