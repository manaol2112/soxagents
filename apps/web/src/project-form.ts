const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ProjectWrite =
  | { error: "invalid" }
  | {
      organizationId: string;
      projectId: string | null;
      method: "POST" | "PATCH";
      path: string;
      body: Record<string, string | number | null>;
    };

export function projectWrite(fields: Record<string, string>): ProjectWrite {
  const organizationId = fields.organization_id ?? "";
  const name = (fields.name ?? "").trim();
  const slug = (fields.slug ?? "").trim();
  const scope = (fields.scope ?? "").trim();
  const ownerUserId = fields.owner_user_id ?? "";
  const startsOn = optionalDate(fields.starts_on ?? "");
  const endsOn = optionalDate(fields.ends_on ?? "");
  if (
    !UUID.test(organizationId) ||
    !UUID.test(ownerUserId) ||
    name === "" ||
    name.length > 200 ||
    !SLUG.test(slug) ||
    slug.length > 80 ||
    scope.length > 4000 ||
    startsOn === "invalid" ||
    endsOn === "invalid" ||
    (startsOn !== null && endsOn !== null && endsOn < startsOn)
  ) {
    return { error: "invalid" };
  }
  const intent = fields.intent ?? "";
  const body = {
    name,
    slug,
    scope,
    owner_user_id: ownerUserId,
    starts_on: startsOn,
    ends_on: endsOn,
  };
  if (intent === "create") {
    const status = fields.status === "ACTIVE" ? "ACTIVE" : "DRAFT";
    if (
      fields.status !== undefined &&
      fields.status !== "" &&
      fields.status !== status
    ) {
      return { error: "invalid" };
    }
    return {
      organizationId,
      projectId: null,
      method: "POST",
      path: `/organizations/${organizationId}/projects`,
      body: { ...body, status },
    };
  }
  const projectId = fields.project_id ?? "";
  const version = fields.version ?? "";
  if (!UUID.test(projectId) || !/^[1-9]\d*$/.test(version)) {
    return { error: "invalid" };
  }
  const status = statusForIntent(intent, fields.status ?? "");
  if (status === null) {
    return { error: "invalid" };
  }
  return {
    organizationId,
    projectId,
    method: "PATCH",
    path: `/organizations/${organizationId}/projects/${projectId}`,
    body: { ...body, status, version: Number(version) },
  };
}

function statusForIntent(intent: string, selected: string): string | null {
  if (intent === "pause") {
    return "PAUSED";
  }
  if (intent === "resume" || intent === "start") {
    return "ACTIVE";
  }
  if (intent === "archive") {
    return "ARCHIVED";
  }
  if (intent === "update") {
    if (
      selected === "DRAFT" ||
      selected === "ACTIVE" ||
      selected === "PAUSED" ||
      selected === "ARCHIVED"
    ) {
      return selected;
    }
  }
  return null;
}

function optionalDate(value: string): string | null | "invalid" {
  if (value === "") {
    return null;
  }
  if (!DATE.test(value)) {
    return "invalid";
  }
  return value;
}

export function noticeForStatus(
  status: number,
  detail: string,
):
  | "saved"
  | "invalid"
  | "conflict"
  | "slug"
  | "status"
  | "denied"
  | "unavailable" {
  if (status === 200 || status === 201) {
    return "saved";
  }
  if (status === 403 || status === 404) {
    return "denied";
  }
  if (status === 409 && detail === "project slug is already in use") {
    return "slug";
  }
  if (status === 409 && detail === "project status cannot change that way") {
    return "status";
  }
  if (status === 409) {
    return "conflict";
  }
  if (status === 422) {
    return "invalid";
  }
  return "unavailable";
}
