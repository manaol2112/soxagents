/**
 * What a change to a running engagement's scope or team affects, said before it is made.
 * Read from the API's impact endpoints; the confirm dialog shows it and, where work is on
 * record, asks why.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SetupImpact = {
  /** One line per thing affected, in plain words. Empty: nothing on record. */
  lines: string[];
  /** Work is on record: the change needs a reason, which goes in the audit trail. */
  material: boolean;
  /** The change is refused as it stands, with why. */
  blocked: string | null;
};

export type ImpactTarget =
  | { kind: "control"; id: string }
  | { kind: "application"; id: string }
  | { kind: "member"; id: string };

/** The API path for an impact query, or null when the target is not well formed. */
export function impactPath(
  organizationId: string,
  projectId: string,
  target: ImpactTarget,
): string | null {
  if (
    !UUID.test(organizationId) ||
    !UUID.test(projectId) ||
    !UUID.test(target.id)
  ) {
    return null;
  }
  const base = `/organizations/${organizationId}/projects/${projectId}/onboarding`;
  return target.kind === "member"
    ? `${base}/team/${target.id}/impact`
    : target.kind === "control"
      ? `${base}/scope-impact?control_id=${target.id}`
      : `${base}/scope-impact?application_id=${target.id}`;
}

/** The page's own route for an impact query. */
export function impactHref(
  organizationId: string,
  projectId: string,
  target: ImpactTarget,
): string {
  const params = new URLSearchParams({
    organization: organizationId,
    project: projectId,
    kind: target.kind,
    id: target.id,
  });
  return `/workspace/setup-impact?${params.toString()}`;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The API's scope impact, in plain words. */
export function scopeImpact(value: unknown): SetupImpact | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const body = value as Record<string, unknown>;
  if (typeof body.material !== "boolean") {
    return null;
  }
  const lines: string[] = [];
  const tasks = count(body.open_tasks);
  const unsent = count(body.unsent_requests);
  const sent = count(body.sent_requests);
  const tested = count(body.tested);
  const papers = count(body.workpapers);
  const reviews = count(body.reviews);
  const findings = count(body.deficiencies);
  if (tasks > 0) {
    lines.push(`${plural(tasks, "open task is", "open tasks are")} cancelled.`);
  }
  if (unsent > 0) {
    lines.push(
      `${plural(unsent, "unsent evidence request is", "unsent evidence requests are")} withdrawn.`,
    );
  }
  if (sent > 0) {
    lines.push(
      `${plural(sent, "request has", "requests have")} already been sent to the client and ${sent === 1 ? "remains" : "remain"} on record. Inform the client if the evidence is no longer required.`,
    );
  }
  if (tested > 0) {
    lines.push(
      `${plural(tested, "control has", "controls have")} testing on record, which is retained.`,
    );
  }
  if (papers > 0) {
    lines.push(
      `${plural(papers, "workpaper has", "workpapers have")} content, which is retained.`,
    );
  }
  if (reviews > 0) {
    lines.push(
      `${plural(reviews, "review is", "reviews are")} on record and retained.`,
    );
  }
  if (findings > 0) {
    lines.push(
      `${plural(findings, "deficiency is", "deficiencies are")} on record and retained.`,
    );
  }
  return { lines, material: body.material, blocked: null };
}

/** The API's team impact, in plain words. */
export function teamImpact(value: unknown): SetupImpact | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const body = value as Record<string, unknown>;
  if (typeof body.last_reviewer !== "boolean") {
    return null;
  }
  const tasks = count(body.assigned_tasks);
  return {
    lines:
      tasks > 0
        ? [
            `${plural(tasks, "open task assigned to this person is", "open tasks assigned to this person are")} returned to the team unassigned.`,
          ]
        : [],
    material: false,
    blocked: body.last_reviewer
      ? "This person is the only independent reviewer. Assign another reviewer first."
      : null,
  };
}
