/**
 * Client controls following the firm's standards, decided together (decided by the product
 * owner on 25 October 2026; standard_adoption.py). The rules match an imported RCM's
 * controls to the standards; a person confirms the strong matches as one decision.
 */

export type StandardMatch = {
  controlId: string;
  controlRef: string;
  title: string;
  system: string;
  libraryKey: string;
  standardRef: string;
  standardTitle: string;
  rationale: string;
};

export type StandardMatches = {
  strong: StandardMatch[];
  partial: number;
  none: number;
  /** The client's undecided controls the rules have not matched yet. */
  unmatched: number;
};

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export function parseStandardMatches(value: unknown): StandardMatches | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const body = value as Record<string, unknown>;
  const strong = Array.isArray(body.strong)
    ? body.strong
        .map((item): StandardMatch | null => {
          if (typeof item !== "object" || item === null) {
            return null;
          }
          const row = item as Record<string, unknown>;
          return str(row.control_id) === ""
            ? null
            : {
                controlId: str(row.control_id),
                controlRef: str(row.control_ref),
                title: str(row.title),
                system: str(row.system),
                libraryKey: str(row.library_key),
                standardRef: str(row.standard_ref),
                standardTitle: str(row.standard_title),
                rationale: str(row.rationale),
              };
        })
        .filter((item): item is StandardMatch => item !== null)
    : [];
  return {
    strong,
    partial: num(body.partial),
    none: num(body.none),
    unmatched: num(body.unmatched),
  };
}

/** What the card says, or null when there is nothing to decide or match. */
export function matchesSummary(matches: StandardMatches | null): {
  title: string;
  detail: string;
} | null {
  if (matches === null) {
    return null;
  }
  const plural = (count: number, one: string, many = `${one}s`) =>
    `${count} ${count === 1 ? one : many}`;
  const rest = matches.partial + matches.none;
  if (matches.strong.length > 0) {
    return {
      title: `${plural(matches.strong.length, "imported control matches", "imported controls match")} a firm standard`,
      detail:
        "Following its standard plans the control from the standard's procedures and proposes its attributes for approval." +
        (rest > 0
          ? ` ${plural(rest, "other control")} matched only partly or not at all and ${rest === 1 ? "follows" : "follow"} the client's procedures until decided on the control.`
          : ""),
    };
  }
  if (matches.unmatched > 0) {
    return {
      title: `${plural(matches.unmatched, "imported control has", "imported controls have")} not been matched to the firm's standards`,
      detail:
        "Until matched and decided, they follow the client's procedures; where the client documents none, their plans use generic steps.",
    };
  }
  return null;
}
