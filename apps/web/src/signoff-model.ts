/**
 * Sign-off history (migration 0091): every sign-off of a test sheet or an independent
 * review as it was made, and whether it was opened again afterwards. The workspace shows
 * them as receipts: who, what, which version, when; nothing is ever rewritten.
 */
export type Signoff = {
  id: string;
  kind: "TESTING" | "REVIEW";
  roundKind: "ROLLFORWARD" | "RETEST" | null;
  version: number;
  /** The sheet's conclusion, or "" for a review. */
  conclusion: string;
  signedBy: string | null;
  signedAt: string;
  note: string;
  planRevision: number | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
  reopenReason: string;
  reopenedFrom: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const maybe = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

function parseOne(
  item: Record<string, unknown>,
  kind: Signoff["kind"],
): Signoff | null {
  if (typeof item.id !== "string" || typeof item.signed_at !== "string") {
    return null;
  }
  const version = kind === "TESTING" ? item.sheet_version : item.review_version;
  return {
    id: item.id,
    kind,
    roundKind:
      item.round_kind === "ROLLFORWARD" || item.round_kind === "RETEST"
        ? item.round_kind
        : null,
    version: typeof version === "number" ? version : 0,
    conclusion: kind === "TESTING" ? str(item.conclusion) : "",
    signedBy: maybe(item.signed_by),
    signedAt: item.signed_at,
    note: str(item.signoff_note),
    planRevision:
      typeof item.plan_revision === "number" ? item.plan_revision : null,
    reopenedAt: maybe(item.reopened_at),
    reopenedBy: maybe(item.reopened_by),
    reopenReason: str(item.reopen_reason),
    reopenedFrom: maybe(item.reopened_from),
  };
}

export function parseSignoffs(
  value: unknown,
  kind: Signoff["kind"],
): Signoff[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value
    .filter(isRecord)
    .map((item) => parseOne(item, kind))
    .filter((item): item is Signoff => item !== null);
}

/** Testing and review sign-offs together, oldest first. */
export function receipts(
  testing: readonly Signoff[] | null,
  review: readonly Signoff[] | null,
): Signoff[] {
  return [...(testing ?? []), ...(review ?? [])].sort((a, b) =>
    a.signedAt < b.signedAt ? -1 : a.signedAt > b.signedAt ? 1 : 0,
  );
}

const CONCLUSION_WORDS: Record<string, string> = {
  EFFECTIVE: "effective",
  NOT_EFFECTIVE: "not effective",
};
const SOURCE_WORDS: Record<string, string> = {
  REVIEW_NOTE: "a review note",
  IMPACT_ASSESSMENT: "an impact assessment",
  PERSON: "a person",
  LATER_WORK: "later work",
};

/** One receipt in words: what was signed, by whom, at which version and plan revision. */
export function receiptText(item: Signoff): string {
  const what =
    item.kind === "REVIEW"
      ? `Review${item.roundKind !== null ? ` of the ${item.roundKind === "RETEST" ? "retest" : "roll-forward"} round` : ""} signed off`
      : `${item.roundKind === "RETEST" ? "Retest" : item.roundKind === "ROLLFORWARD" ? "Roll-forward" : "Interim testing"} signed off ${CONCLUSION_WORDS[item.conclusion] ?? item.conclusion.toLowerCase()}`;
  const by = item.signedBy !== null ? ` by ${item.signedBy}` : "";
  const version = ` (version ${item.version}${item.planRevision !== null ? `, plan revision ${item.planRevision}` : ""})`;
  return `${what}${by}${version}`;
}

/** Why and by what a sign-off was reopened, or "" while it stands. */
export function reopenText(item: Signoff): string {
  if (item.reopenedAt === null) {
    return "";
  }
  const source = SOURCE_WORDS[item.reopenedFrom ?? ""] ?? "later work";
  return `Reopened by ${source}${item.reopenReason !== "" ? `: ${item.reopenReason}` : ""}`;
}
