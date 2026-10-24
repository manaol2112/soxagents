/**
 * Shared control plans (Unified planning, Release 1; docs/unified-planning-r1.md): each
 * control's implementations (per system, or per unit it operates in), grouped for review
 * by exception, read from GET …/planning-review/families; and the engagement's scope
 * units (legal entities, locations, departments, shared-service centres, processes).
 *
 * Nothing here decides anything: which implementations share a plan, and which are ready
 * to approve together, is the API's (shared_plans.py), and a group decision is checked
 * there again against what was shown.
 */

export type Applicability =
  | "SAME_PLAN"
  | "DIFFERENT_PLAN"
  | "NEEDS_INFORMATION";
/** Where a control's shared plan comes from (shared_plans.reference_of): the approved
 * plan, the plan the largest group shares (a proposal for the reviewer), the only plan, or
 * none (a tie, or nothing to compare), when each plan is reviewed on its own. */
export type ReferenceBasis =
  | "APPROVED"
  | "LARGEST_GROUP"
  | "ONLY_PLAN"
  | "NONE";
const REFERENCE_BASES: readonly ReferenceBasis[] = [
  "APPROVED",
  "LARGEST_GROUP",
  "ONLY_PLAN",
  "NONE",
];
export type FamilyGroup = "TOGETHER" | "SEPARATE" | "WAITING" | "DONE";
export const FAMILY_GROUPS: readonly FamilyGroup[] = [
  "TOGETHER",
  "SEPARATE",
  "WAITING",
  "DONE",
];

export const GROUP_TITLES: Record<
  FamilyGroup,
  { title: string; line: string }
> = {
  TOGETHER: {
    title: "Ready to approve",
    line: "One decision covers every system or entity whose plan is the same.",
  },
  SEPARATE: {
    title: "Review separately",
    line: "A plan differs from its control's shared plan, so it is reviewed on its own.",
  },
  WAITING: {
    title: "Waiting for information",
    line: "Not planned yet, still planning, or something holds the approval.",
  },
  DONE: { title: "Approved", line: "Every plan for the control is approved." },
};

export const CLASSIFICATION_LABELS: Record<string, string> = {
  ITGC: "ITGC",
  AUTOMATED_APPLICATION: "Automated",
  IT_DEPENDENT_MANUAL: "IT-dependent manual",
  BUSINESS_PROCESS: "Business process",
  ENTITY_LEVEL: "Entity level",
  KEY_REPORT: "Key report",
  MANAGEMENT_REVIEW: "Management review",
};

export type Scope = {
  application: string | null;
  operates: string[];
  covers: string[];
};

export type Difference = {
  section: string;
  sectionLabel: string;
  item: string;
  change: "ADDED" | "REMOVED" | "CHANGED";
  fields: string[];
  shared: string;
  current: string;
};

export type Implementation = {
  controlId: string;
  label: string;
  scope: Scope;
  lead: boolean;
  applicability: Applicability;
  applicabilityLabel: string;
  reason: string;
  stateLabel: string;
  approved: boolean;
  version: number;
  differences: Difference[];
};

export type SharedItem = { code: string; text: string };

export type Family = {
  controlRef: string;
  title: string;
  area: string;
  classifications: string[];
  group: FamilyGroup;
  implementations: Implementation[];
  referenceBasis: ReferenceBasis;
  referenceNote: string;
  ready: string[];
  presentedHash: string;
  shared: {
    procedures: SharedItem[];
    attributes: SharedItem[];
    evidence: SharedItem[];
  } | null;
  lastGroupDecisionBy: string | null;
  lastGroupDecisionAt: string | null;
};

export type Families = {
  families: Family[];
  counts: Record<FamilyGroup, number>;
  decisions: number;
  plans: number;
  viewerCanDecide: boolean;
};

export type UnitKind =
  | "ENTITY"
  | "LOCATION"
  | "DEPARTMENT"
  | "SERVICE_CENTER"
  | "PROCESS";
export const UNIT_KINDS: readonly UnitKind[] = [
  "ENTITY",
  "LOCATION",
  "DEPARTMENT",
  "SERVICE_CENTER",
  "PROCESS",
];
export const UNIT_KIND_LABELS: Record<UnitKind, string> = {
  ENTITY: "Legal entity",
  LOCATION: "Location",
  DEPARTMENT: "Department or operating unit",
  SERVICE_CENTER: "Shared-service centre",
  PROCESS: "Process or sub-process",
};

export type ScopeUnit = { id: string; kind: UnitKind; name: string };

type Json = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
const records = (value: unknown): Json[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];
const oneOf = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

function parseScope(value: unknown): Scope {
  const raw = isRecord(value) ? value : {};
  return {
    application:
      typeof raw.application === "string" && raw.application !== ""
        ? raw.application
        : null,
    operates: strings(raw.operates),
    covers: strings(raw.covers),
  };
}

function parseItems(value: unknown): SharedItem[] {
  return records(value).map((item) => ({
    code: str(item.code),
    text: str(item.text),
  }));
}

export function parseFamilies(value: unknown): Families | null {
  if (!isRecord(value) || !Array.isArray(value.families)) {
    return null;
  }
  const families = records(value.families)
    .filter((raw) => str(raw.control_ref) !== "")
    .map((raw): Family => {
      const shared = isRecord(raw.shared) ? raw.shared : null;
      return {
        controlRef: str(raw.control_ref),
        title: str(raw.title),
        area: str(raw.area),
        classifications: strings(raw.classifications),
        group: oneOf(raw.group, FAMILY_GROUPS, "WAITING"),
        implementations: records(raw.implementations)
          .filter((row) => UUID.test(str(row.control_id)))
          .map((row) => ({
            controlId: str(row.control_id),
            label: str(row.label),
            scope: parseScope(row.scope),
            lead: row.lead === true,
            applicability: oneOf(
              row.applicability,
              ["SAME_PLAN", "DIFFERENT_PLAN", "NEEDS_INFORMATION"] as const,
              "NEEDS_INFORMATION",
            ),
            applicabilityLabel: str(row.applicability_label),
            reason: str(row.reason),
            stateLabel: str(row.state_label),
            approved: row.approved === true,
            version: num(row.version),
            differences: records(row.differences).map((item) => ({
              section: str(item.section),
              sectionLabel: str(item.section_label),
              item: str(item.item),
              change: oneOf(
                item.change,
                ["ADDED", "REMOVED", "CHANGED"] as const,
                "CHANGED",
              ),
              fields: strings(item.fields),
              shared: str(item.shared),
              current: str(item.this),
            })),
          })),
        referenceBasis: oneOf(raw.reference_basis, REFERENCE_BASES, "NONE"),
        referenceNote: str(raw.reference_note),
        ready: strings(raw.ready).filter((id) => UUID.test(id)),
        presentedHash: HASH.test(str(raw.presented_hash))
          ? str(raw.presented_hash)
          : "",
        shared:
          shared === null
            ? null
            : {
                procedures: parseItems(shared.procedures),
                attributes: parseItems(shared.attributes),
                evidence: parseItems(shared.evidence),
              },
        lastGroupDecisionBy:
          typeof raw.last_group_decision_by === "string"
            ? raw.last_group_decision_by
            : null,
        lastGroupDecisionAt:
          typeof raw.last_group_decision_at === "string"
            ? raw.last_group_decision_at
            : null,
      };
    });
  const counts = Object.fromEntries(
    FAMILY_GROUPS.map((group) => [
      group,
      isRecord(value.counts) ? num(value.counts[group]) : 0,
    ]),
  ) as Record<FamilyGroup, number>;
  return {
    families,
    counts,
    decisions: num(value.decisions),
    plans: num(value.plans),
    viewerCanDecide: value.viewer_can_decide === true,
  };
}

export function parseScopeUnits(value: unknown): ScopeUnit[] {
  return (
    records(value)
      // A kind this page does not know is left out, never shown as another kind.
      .filter(
        (raw) =>
          UUID.test(str(raw.id)) &&
          (UNIT_KINDS as readonly unknown[]).includes(raw.kind),
      )
      .map((raw) => ({
        id: str(raw.id),
        kind: oneOf(raw.kind, UNIT_KINDS, "ENTITY"),
        name: str(raw.name),
      }))
  );
}

/** Where one implementation runs, in words: its system, then the units it operates in
 * when split by them ("SAP ERP · Acme UK Ltd", "Acme UK Ltd"); "" for neither. */
export function implementationName(application: string, units: string): string {
  return [application, units].filter(Boolean).join(" · ");
}

/** Names listed to end a sentence: "A, B." — once, even when the last name ends with a
 * full stop of its own ("Northwind US Inc."). */
export function namesSentence(names: readonly string[]): string {
  const text = names.join(", ");
  return text.endsWith(".") ? text : `${text}.`;
}

/** The families in one review group, in the API's order. */
export function familiesIn(
  families: readonly Family[],
  group: FamilyGroup,
): Family[] {
  return families.filter((family) => family.group === group);
}

/** Who a control's implementations are, in words: "3 systems", "2 entities", or the one
 * name; "Whole engagement" for a control with no system or unit. */
export function implementationsLine(family: Family): string {
  const rows = family.implementations;
  if (rows.length === 1) {
    return rows[0]?.label ?? "";
  }
  const systems = rows.every(
    (row) => row.scope.application !== null && row.scope.operates.length === 0,
  );
  const units = rows.every(
    (row) => row.scope.application === null && row.scope.operates.length > 0,
  );
  const noun = systems ? "systems" : units ? "units" : "implementations";
  return `${rows.length} ${noun}`;
}

/** The heading of a control's shared plan: a proposal until a reviewer approves it. */
export function sharedPlanTitle(family: Family): string {
  return family.referenceBasis === "LARGEST_GROUP"
    ? "Proposed shared plan"
    : family.referenceBasis === "ONLY_PLAN"
      ? "The plan"
      : "The shared plan";
}

/** What one group decision does, in words: "Approve 3 plans" or "Approve the plan". */
export function approveLabel(family: Family): string {
  const count = family.ready.length;
  return count === 1 ? "Approve the plan" : `Approve ${count} plans`;
}

/** The plans a group decision approves, each at the version shown. */
export function groupItems(
  family: Family,
): Array<{ control_id: string; version: number }> {
  const byId = new Map(
    family.implementations.map((row) => [row.controlId, row]),
  );
  return family.ready.flatMap((id) => {
    const row = byId.get(id);
    return row === undefined ? [] : [{ control_id: id, version: row.version }];
  });
}

/** The API call for a group decision, checked before it is sent; null when invalid. */
export function groupApproveBody(fields: Json): {
  control_ref: string;
  items: Array<{ control_id: string; version: number }>;
  presented_hash: string;
  comment: string;
} | null {
  const ref = str(fields.control_ref).trim();
  const hash = str(fields.presented_hash);
  const comment = str(fields.comment);
  const items = records(fields.items);
  const checked = items.filter(
    (item) =>
      UUID.test(str(item.control_id)) &&
      Number.isInteger(item.version) &&
      num(item.version) >= 1,
  );
  if (
    ref === "" ||
    ref.length > 100 ||
    !HASH.test(hash) ||
    comment.length > 4000 ||
    checked.length === 0 ||
    checked.length !== items.length ||
    checked.length > 100
  ) {
    return null;
  }
  return {
    control_ref: ref,
    items: checked.map((item) => ({
      control_id: str(item.control_id),
      version: num(item.version),
    })),
    presented_hash: hash,
    comment,
  };
}
