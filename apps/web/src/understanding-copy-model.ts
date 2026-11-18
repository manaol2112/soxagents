/**
 * Bringing forward another control's answers (decided by the product owner on 28 October
 * 2026, from the "Bring forward prior answers" reference): what the API offers
 * (control_design.copy_sources), and which answers are ticked to start. An answer that
 * may not hold for this system (it names the source's system, or is itself a system) and
 * one that would replace an answer already given wait for a person to tick them; one that
 * is already the same is not copied. Nothing here saves anything.
 */

export type CopyAnswer = {
  key: string;
  label: string;
  kind: string;
  question: string;
  value: string;
  filledBy: string | null;
};

export type CopySource = {
  controlId: string;
  controlRef: string;
  title: string;
  system: string;
  sameControl: boolean;
  answers: CopyAnswer[];
};

export type CopyTarget = {
  controlRef: string;
  title: string;
  system: string;
  values: Record<string, string>;
};

export type CopyOffer = { target: CopyTarget; sources: CopySource[] };

/** What a row is: a prior answer to take, one to check for this system, one that would
 * replace this control's answer, or one this control already gives. */
export type RowState = "prior" | "check" | "replaces" | "same";

export type CopyRow = CopyAnswer & {
  state: RowState;
  /** This control's answer now, when it has one. */
  current: string;
};

const str = (value: unknown) => (typeof value === "string" ? value : "");

export function parseOffer(value: unknown): CopyOffer | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const v = value as Record<string, unknown>;
  const target = v.target as Record<string, unknown> | undefined;
  if (
    typeof target !== "object" ||
    target === null ||
    !Array.isArray(v.sources)
  ) {
    return null;
  }
  const values: Record<string, string> = {};
  if (typeof target.values === "object" && target.values !== null) {
    for (const [key, item] of Object.entries(target.values)) {
      if (typeof item === "string" && item.trim() !== "") {
        values[key] = item;
      }
    }
  }
  return {
    target: {
      controlRef: str(target.control_ref),
      title: str(target.title),
      system: str(target.system),
      values,
    },
    sources: v.sources
      .filter(
        (s): s is Record<string, unknown> =>
          typeof s === "object" && s !== null,
      )
      .map((s) => ({
        controlId: str(s.control_id),
        controlRef: str(s.control_ref),
        title: str(s.title),
        system: str(s.system),
        sameControl: s.same_control === true,
        answers: (Array.isArray(s.answers) ? s.answers : [])
          .filter(
            (a): a is Record<string, unknown> =>
              typeof a === "object" && a !== null,
          )
          .map((a) => ({
            key: str(a.key),
            label: str(a.label),
            kind: str(a.kind),
            question: str(a.question),
            value: str(a.value),
            filledBy: typeof a.filled_by === "string" ? a.filled_by : null,
          }))
          .filter((a) => a.key !== "" && a.value.trim() !== ""),
      }))
      .filter((s) => s.controlId !== "" && s.answers.length > 0),
  };
}

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** Each of the source's answers as a row for this control. */
export function rowsFor(source: CopySource, target: CopyTarget): CopyRow[] {
  const system = source.system.trim().toLowerCase();
  return source.answers.map((answer) => {
    const current = target.values[answer.key] ?? "";
    const state: RowState =
      current !== "" && same(current, answer.value)
        ? "same"
        : current !== ""
          ? "replaces"
          : answer.kind === "SYSTEM" ||
              (system.length > 2 && answer.value.toLowerCase().includes(system))
            ? "check"
            : "prior";
    return { ...answer, state, current };
  });
}

/** The rows ticked to start: the prior answers only. */
export function initialSelection(rows: readonly CopyRow[]): Set<string> {
  return new Set(
    rows.filter((row) => row.state === "prior").map((row) => row.key),
  );
}

/** The rows that can be ticked: all but those already the same. */
export function selectable(rows: readonly CopyRow[]): string[] {
  return rows.filter((row) => row.state !== "same").map((row) => row.key);
}

/** How a control reads in the pickers: "SAP S/4HANA · ITGC-AC-01". */
export function controlLabel(item: {
  system: string;
  controlRef: string;
  title: string;
}): string {
  return [item.system || item.title, item.controlRef]
    .filter(Boolean)
    .join(" · ");
}

/** The source to offer first: the same control on another system with the most answers
 * (the API ranks them so), else none. */
export function suggestedSource(offer: CopyOffer | null): CopySource | null {
  return offer?.sources.find((source) => source.sameControl) ?? null;
}

/** "Copy 3 answers", "Copy 1 answer". */
export function copyLabel(count: number): string {
  return `Copy ${count} answer${count === 1 ? "" : "s"}`;
}
