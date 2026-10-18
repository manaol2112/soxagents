import { statusAfter } from "./engagement-lifecycle.ts";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ENGAGEMENT_TYPES = new Set(["SOX_ITGC", "SOX_FULL", "IT_AUDIT"]);

/**
 * A slug from the engagement's name, for the form that does not ask for one. With the
 * client's name in front: two clients can each have an engagement called "SOX FY 2027".
 */
export function slugFor(name: string, clientName = ""): string {
  name = `${clientName.trim()} ${name}`;
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

export type ProjectWrite =
  | { error: "invalid" }
  | {
      organizationId: string;
      projectId: string | null;
      method: "POST" | "PATCH";
      path: string;
      body: Record<string, string | number | null>;
    };

/** The engagement's own close-out actions (Milestone 8.14), each its own API action. */
const CLOSE_OUT = new Set(["complete", "reopen", "delete"]);

function closeOutWrite(fields: Record<string, string>): ProjectWrite {
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  const version = fields.version ?? "";
  const intent = fields.intent ?? "";
  if (
    !UUID.test(organizationId) ||
    !UUID.test(projectId) ||
    !/^[1-9]\d*$/.test(version)
  ) {
    return { error: "invalid" };
  }
  const body: Record<string, string | number | null> = {
    version: Number(version),
  };
  if (intent === "reopen") {
    const reason = (fields.reason ?? "").trim().split(/\s+/).join(" ");
    if (reason.length < 3 || reason.length > 500) {
      return { error: "invalid" };
    }
    body.reason = reason;
  }
  if (intent === "delete") {
    const name = (fields.confirm_name ?? "").trim();
    if (name === "" || name.length > 200) {
      return { error: "invalid" };
    }
    body.name = name;
  }
  return {
    organizationId,
    projectId,
    method: "POST",
    path: `/organizations/${organizationId}/projects/${projectId}/${intent}`,
    body,
  };
}

/** The engagement form saving an existing engagement (Milestone 8.15). */
function detailsWrite(fields: Record<string, string>): ProjectWrite {
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  const version = fields.version ?? "";
  const name = (fields.name ?? "").trim();
  const clientName = (fields.client_name ?? "").trim();
  const clientId = fields.client_id ?? "";
  const ownerUserId = fields.owner_user_id ?? "";
  const periodEnd = optionalDate(fields.period_end ?? "");
  const startsOn = optionalDate(fields.starts_on ?? "");
  const endsOn = optionalDate(fields.ends_on ?? "");
  if (
    !UUID.test(organizationId) ||
    !UUID.test(projectId) ||
    !UUID.test(ownerUserId) ||
    !/^[1-9]\d*$/.test(version) ||
    (clientId !== "" && !UUID.test(clientId)) ||
    name === "" ||
    name.length > 200 ||
    clientName.length > 200 ||
    periodEnd === "invalid" ||
    startsOn === "invalid" ||
    endsOn === "invalid" ||
    (startsOn !== null && endsOn !== null && endsOn < startsOn)
  ) {
    return { error: "invalid" };
  }
  return {
    organizationId,
    projectId,
    method: "PATCH",
    path: `/organizations/${organizationId}/projects/${projectId}/details`,
    body: {
      version: Number(version),
      name,
      owner_user_id: ownerUserId,
      client_id: clientId === "" ? null : clientId,
      client_name: clientName,
      period_end: periodEnd,
      starts_on: startsOn,
      ends_on: endsOn,
    },
  };
}

export function projectWrite(fields: Record<string, string>): ProjectWrite {
  if (CLOSE_OUT.has(fields.intent ?? "")) {
    return closeOutWrite(fields);
  }
  if (fields.intent === "details") {
    return detailsWrite(fields);
  }
  const organizationId = fields.organization_id ?? "";
  const name = (fields.name ?? "").trim();
  const slug = (fields.slug ?? "").trim() || slugFor(name);
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
    // A new engagement is a draft; it becomes active only by launching it from setup.
    const status = "DRAFT";
    if (
      fields.status !== undefined &&
      fields.status !== "" &&
      fields.status !== status
    ) {
      return { error: "invalid" };
    }
    const clientName = (fields.client_name ?? "").trim();
    // One of the firm's clients, or a new one by name; and an earlier engagement of the
    // client to start from (Milestone 8.18).
    const clientId = fields.client_id ?? "";
    const rollforward = fields.rollforward_from ?? "";
    if (
      (clientId !== "" && !UUID.test(clientId)) ||
      (rollforward !== "" && (!UUID.test(rollforward) || clientId === ""))
    ) {
      return { error: "invalid" };
    }
    // A new engagement covers IT and business process unless the form says otherwise.
    const engagementType = fields.engagement_type ?? "SOX_FULL";
    const periodEnd = optionalDate(fields.period_end ?? "");
    // The identifier is the client and the engagement together, so the same engagement
    // name for another client is not a duplicate.
    const guidedSlug =
      (fields.slug ?? "").trim() === "" ? slugFor(name, clientName) : slug;
    if (
      clientName.length > 200 ||
      !ENGAGEMENT_TYPES.has(engagementType) ||
      periodEnd === "invalid" ||
      !SLUG.test(guidedSlug)
    ) {
      return { error: "invalid" };
    }
    return {
      organizationId,
      projectId: null,
      method: "POST",
      path: `/organizations/${organizationId}/projects`,
      body: {
        ...body,
        slug: guidedSlug,
        status,
        client_name: clientName,
        client_id: clientId === "" ? null : clientId,
        rollforward_from: rollforward === "" ? null : rollforward,
        engagement_type: engagementType,
        period_end: periodEnd,
      },
    };
  }
  const projectId = fields.project_id ?? "";
  const version = fields.version ?? "";
  if (!UUID.test(projectId) || !/^[1-9]\d*$/.test(version)) {
    return { error: "invalid" };
  }
  // The form carries the status it was shown with; the action decides the next one.
  const status = statusAfter(intent, fields.status ?? "");
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

function optionalDate(value: string): string | null | "invalid" {
  if (value === "") {
    return null;
  }
  if (!DATE.test(value)) {
    return "invalid";
  }
  return value;
}

// The API's stable reasons for refusing a close-out action, as notices.
const CLOSE_OUT_REFUSALS: Record<string, ProjectNoticeCode> = {
  "work is still open": "open-work",
  "only a running engagement is completed": "status",
  "only a completed engagement is reopened": "status",
  "a launched engagement is not deleted": "launched",
  "setup work is still running": "setup-running",
  "engagement has work on record": "work-on-record",
  "the engagement is completed; reopen it to change it": "completed",
  "engagement is not active: it is completed and read-only": "completed",
  "engagement is not active: it is archived and read-only": "archived",
  "client and period end are locked after launch": "locked",
};

export type ProjectNoticeCode =
  | "saved"
  | "completed-done"
  | "reopened"
  | "deleted"
  | "invalid"
  | "conflict"
  | "slug"
  | "status"
  | "launch"
  | "archived"
  | "completed"
  | "open-work"
  | "launched"
  | "setup-running"
  | "work-on-record"
  | "reason"
  | "delete-name"
  | "locked"
  | "rollforward"
  | "client-renamed"
  | "client-exists"
  | "client-changed"
  | "denied"
  | "unavailable";

export function noticeForStatus(
  status: number,
  detail: string,
  intent = "",
): ProjectNoticeCode {
  if (status === 200 || status === 201) {
    return intent === "complete"
      ? "completed-done"
      : intent === "reopen"
        ? "reopened"
        : intent === "delete"
          ? "deleted"
          : "saved";
  }
  const refused = CLOSE_OUT_REFUSALS[detail];
  if (status === 409 && refused !== undefined) {
    return refused;
  }
  if (
    status === 422 &&
    detail === "an engagement rolls forward from its own client's"
  ) {
    return "rollforward";
  }
  if (status === 422 && intent === "reopen") {
    return "reason";
  }
  if (status === 422 && intent === "delete") {
    return "delete-name";
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
  if (
    status === 409 &&
    detail === "launch the engagement from setup to make it active"
  ) {
    return "launch";
  }
  if (
    status === 409 &&
    detail === "the engagement is archived and cannot change"
  ) {
    return "archived";
  }
  if (status === 409) {
    return "conflict";
  }
  if (status === 422) {
    return "invalid";
  }
  return "unavailable";
}
