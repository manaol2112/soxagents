const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DraftItem = {
  kind: string;
  title: string;
  detail: string;
  period: string;
  format: string;
  fields: string[];
  parameters: string;
  completeness: string;
};

/** The evidence coordinator's draft of one PBC request. */
export type RequestDraft = {
  id: string;
  requestId: string;
  status: "PENDING" | "DRAFTING" | "DRAFTED" | "FAILED" | "SKIPPED";
  /** FALLBACK: the model failed and the rules drafted the request instead. */
  source: "MODEL" | "RULES" | "FALLBACK" | null;
  summary: string;
  items: DraftItem[];
  questions: string[];
  assumptions: string[];
  note: string;
};

const STATUSES: ReadonlyArray<RequestDraft["status"]> = [
  "PENDING",
  "DRAFTING",
  "DRAFTED",
  "FAILED",
  "SKIPPED",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function parseDrafts(value: unknown): Map<string, RequestDraft> {
  const drafts = new Map<string, RequestDraft>();
  if (!Array.isArray(value)) {
    return drafts;
  }
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.pbc_request_id !== "string"
    ) {
      continue;
    }
    const status = STATUSES.find((entry) => entry === item.status);
    if (status === undefined) {
      continue;
    }
    const content = isRecord(item.content) ? item.content : null;
    drafts.set(item.pbc_request_id, {
      id: item.id,
      requestId: item.pbc_request_id,
      status,
      source:
        item.source === "MODEL" ||
        item.source === "RULES" ||
        item.source === "FALLBACK"
          ? item.source
          : null,
      summary: str(content?.summary),
      items: (Array.isArray(content?.items) ? content.items : [])
        .filter(isRecord)
        .map((entry) => ({
          kind: str(entry.kind),
          title: str(entry.title),
          detail: str(entry.detail),
          period: str(entry.period),
          format: str(entry.format),
          fields: strings(entry.fields),
          parameters: str(entry.parameters),
          completeness: str(entry.completeness),
        })),
      questions: strings(content?.questions),
      assumptions: strings(content?.assumptions),
      note: str(item.note),
    });
  }
  return drafts;
}

/** A short status for the request row. */
export function draftLabel(
  draft: RequestDraft | undefined,
): { label: string; tone: "info" | "success" | "warning" | "neutral" } | null {
  if (draft === undefined || draft.status === "SKIPPED") {
    return null;
  }
  if (draft.status === "PENDING" || draft.status === "DRAFTING") {
    return { label: "Evidence coordinator is drafting", tone: "info" };
  }
  if (draft.status === "FAILED") {
    return { label: "Drafting did not finish", tone: "warning" };
  }
  if (draft.source === "FALLBACK") {
    return {
      label: "Drafted from the RCM; the model did not answer",
      tone: "warning",
    };
  }
  return draft.source === "MODEL"
    ? { label: "Drafted by an agent", tone: "success" }
    : { label: "Drafted from the RCM", tone: "neutral" };
}

export const DRAFT_KIND_LABELS: Record<string, string> = {
  population: "Population",
  walkthrough: "Walkthrough",
  design: "Design",
  configuration: "Configuration",
  change_history: "Change history",
  report: "Key report",
  policy: "Policy",
  other: "Other",
};

/** A request's one-line title: the draft's summary, or the first line of the text. */
export function requestTitle(
  description: string,
  draft: RequestDraft | undefined,
): string {
  const text =
    draft !== undefined && draft.status === "DRAFTED" && draft.summary !== ""
      ? draft.summary
      : (description.split("\n").find((line) => line.trim() !== "") ?? "");
  const line = text.trim().replace(/^- /, "");
  return line.length > 160 ? `${line.slice(0, 157).trimEnd()}...` : line;
}

export function redraftTarget(
  fields: Record<string, string>,
): { path: string } | null {
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  const requestId = fields.request_id ?? "";
  if (
    !UUID.test(organizationId) ||
    !UUID.test(projectId) ||
    !UUID.test(requestId)
  ) {
    return null;
  }
  return {
    path: `/organizations/${organizationId}/projects/${projectId}/pbc-requests/${requestId}/redraft`,
  };
}

export function redraftNoticeFor(
  status: number,
): "redrafting" | "redraft-failed" | "denied" {
  if (status === 200) {
    return "redrafting";
  }
  if (status === 401 || status === 403) {
    return "denied";
  }
  return "redraft-failed";
}
