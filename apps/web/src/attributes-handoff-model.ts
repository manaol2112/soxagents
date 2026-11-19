/**
 * The Attributes step once every attribute is settled (product owner, 17 November 2026: "I
 * accepted all the attributes but the user is not given an option to do what's next here";
 * prototype approved the same day). In place of "Nothing is needed from you here": what was
 * settled, by whom and when, then the next step of each branch as a card with its live
 * state, the one with the person's work in it first. Pure: the panel renders what this says.
 */

import type { Tone, WorkflowStep } from "./control-workflow-model.ts";
import {
  coverageComplete,
  type RequestsView,
} from "./design-requests-model.ts";
import { dayWords } from "./understanding-once-model.ts";

/** An approved attribute, as far as the handoff reads it. */
export type SettledAttribute = {
  criteria: { acceptedBy: string; acceptedAt: string };
};

export type HandoffRequest = {
  id: string;
  title: string;
  line: string;
  letters: string[];
  /** What a screen reader hears for the letters. */
  addresses: string;
};

export type HandoffCard = {
  key: "designevidence" | "testdesign";
  /** "D&I branch", "OE branch". */
  branch: string;
  title: string;
  number: number;
  pill: { label: string; tone: Tone; working: boolean };
  text: string;
  /** The D&I requests the planner prepared, up to three, and how many more. */
  requests: HandoffRequest[];
  more: number;
  /** "5 of 5 attributes addressed", and whether every attribute is addressed. */
  coverage: { line: string; complete: boolean } | null;
  /** Said once, on the OE card while the D&I sign-off is still to come. */
  order: string;
  action: string;
  /** The card with the person's work in it: its action is the primary one. */
  primary: boolean;
};

export type Handoff = {
  /** "Attributes set" (approved prototype, 19 November 2026). */
  title: string;
  /** "5 accepted. D&I Evidence and Scope & Sampling can start." (setLine). */
  line: string;
  /** What follows the counts: both branches can start, or what comes next. */
  follows: string;
  /** The one way on: the step with the person's work in it. */
  next: { key: HandoffCard["key"]; label: string };
  /** An attribute no D&I request addresses: the one exception said here; "" otherwise. */
  gap: string;
  cards: HandoffCard[];
};

export const ORDER_LINE =
  "OE evidence is requested only after an effective D&I sign-off. Planning can start now.";

const SHOWN_REQUESTS = 3;

/** The Attributes step's card once nothing is left to review (product owner, 19 November
 * 2026, approved prototype; before, "All N attributes are settled"). */
export const SET_TITLE = "Attributes set";

/** "5 accepted, 1 removed. D&I Evidence and Scope & Sampling can start.": the attributes that
 * stand, those removed in this visit, then what follows. */
export function setLine(
  accepted: number,
  removed: number,
  nextWords: string,
): string {
  const counts = `${accepted} accepted${removed > 0 ? `, ${removed} removed` : ""}.`;
  return nextWords === "" ? counts : `${counts} ${nextWords}`;
}

/** "Attribute F", "Attributes D and F", "Attributes B, D and F". */
function listLetters(letters: readonly string[]): string {
  const named =
    letters.length <= 1
      ? (letters[0] ?? "")
      : `${letters.slice(0, -1).join(", ")} and ${letters[letters.length - 1]}`;
  return `Attribute${letters.length === 1 ? "" : "s"} ${named}`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Who accepted the attributes' criteria, and when the last of them was accepted. The
 * standard's attributes the library approved at launch have no one on record: then no one
 * is named. */
export function acceptedLine(
  approved: readonly SettledAttribute[],
  timeZone?: string,
): string {
  const accepted = approved.filter(
    (item) =>
      item.criteria.acceptedBy !== "" && item.criteria.acceptedAt !== "",
  );
  if (accepted.length === 0) {
    return "";
  }
  const people = [...new Set(accepted.map((item) => item.criteria.acceptedBy))];
  const last = accepted
    .map((item) => item.criteria.acceptedAt)
    .reduce((latest, each) =>
      Date.parse(each) > Date.parse(latest) ? each : latest,
    );
  const who =
    people.length === 1
      ? people[0]
      : `${people[0]} and ${plural(people.length - 1, "other")}`;
  const when = dayWords(last, timeZone);
  return `Accepted by ${who}${when === "" ? "" : ` on ${when}`}`;
}

/** A step the person can take up now: something to decide, or not started. */
function forThePerson(tone: Tone): boolean {
  return tone === "attention" || tone === "idle";
}

function designCard(
  step: WorkflowStep,
  requests: RequestsView,
): Omit<HandoffCard, "primary"> {
  const base = {
    key: "designevidence" as const,
    branch: "D&I branch",
    title: step.title,
    number: step.number,
    requests: [] as HandoffRequest[],
    more: 0,
    coverage: null,
    order: "",
  };
  if (requests.mode === "drafting") {
    return {
      ...base,
      pill: { label: "Being drafted", tone: "active", working: true },
      text: "The requests are being drafted for the control owner. This page updates when they are ready.",
      action: `Open ${step.title}`,
    };
  }
  // The planner at work: the list's own words ("Being planned", "Being updated"), never
  // "being drafted" while the D&I step says the requests are being planned (17 November
  // 2026: "drafted" names the message to the owner only).
  if (requests.mode === "list" && requests.working) {
    return {
      ...base,
      pill: { label: requests.header.status, tone: "active", working: true },
      text: "The planner is preparing the D&I evidence requests from these attributes. This page updates when they are ready.",
      action: `Open ${step.title}`,
    };
  }
  if (requests.mode === "list") {
    const rows = requests.rows.map((row) => ({
      id: row.id,
      title: row.title,
      line: row.line,
      letters: row.letters,
      addresses: row.addresses,
    }));
    const toAccept = requests.accept.length;
    const gaps = requests.coverage
      .filter((item) => item.state === "UNCOVERED")
      .map((item) => item.letter);
    return {
      ...base,
      pill: {
        label: requests.header.status,
        tone: requests.header.tone,
        working: false,
      },
      text:
        toAccept > 0
          ? "The planner prepared the D&I evidence requests from these attributes. Review and accept them to request the evidence."
          : requests.header.line ||
            "Every request is accepted. The requests are drafted for the control owner next.",
      requests: rows.slice(0, SHOWN_REQUESTS),
      more: Math.max(0, rows.length - SHOWN_REQUESTS),
      // A gap is the exception the person needs: named, not counted (design review, 17
      // November 2026: "5 of 6 attributes addressed" in grey said neither which nor what).
      coverage:
        requests.attributes.length === 0
          ? null
          : coverageComplete(requests)
            ? { line: requests.coverageLine, complete: true }
            : {
                // Read from the chips, so an empty list is never "complete" (17 November
                // 2026: a check beside "0 of 3 attributes addressed").
                line: `${listLetters(gaps)} ${gaps.length === 1 ? "is" : "are"} not addressed by a D&I request. Add a request on ${step.title}, or record why it is not evidenced at D&I.`,
                complete: false,
              },
      action: toAccept > 0 ? "Review the requests" : `Open ${step.title}`,
    };
  }
  // The requests are drafted: the step's own list says where it stands.
  return {
    ...base,
    pill: { label: step.status, tone: step.tone, working: step.agent },
    text:
      step.note ||
      (step.tone === "attention"
        ? "Evidence has come back to review."
        : step.tone === "done"
          ? "The D&I evidence is in and reviewed."
          : "The requests are with the control owner. Nothing is needed from you until evidence comes back."),
    action:
      step.tone === "attention" ? "Review the evidence" : `Open ${step.title}`,
  };
}

function scopeCard(
  step: WorkflowStep,
  signedOff: boolean,
): Omit<HandoffCard, "primary"> {
  return {
    key: "testdesign",
    branch: "OE branch",
    title: step.title,
    number: step.number,
    pill: {
      label: step.tone === "idle" ? "Can start now" : step.status,
      tone: step.tone,
      working: step.agent,
    },
    text: "Set the population, the period and the sample size for operating effectiveness.",
    requests: [],
    more: 0,
    coverage: null,
    order: signedOff ? "" : ORDER_LINE,
    action:
      step.tone === "attention"
        ? "Review the plan"
        : step.tone === "idle"
          ? `Plan ${step.title.toLowerCase()}`
          : `Open ${step.title}`,
  };
}

/**
 * The handoff, or null where the Attributes step is not settled (something still waits on a
 * person, or the agents are at work): the step's own decision row stands then.
 */
export function handoff(input: {
  steps: readonly WorkflowStep[];
  approved: readonly SettledAttribute[];
  requests: RequestsView;
  timeZone?: string;
}): Handoff | null {
  const find = (key: string) => input.steps.find((step) => step.key === key);
  const attributes = find("attributes");
  const design = find("designevidence");
  const scope = find("testdesign");
  const assessment = find("designassessment");
  if (
    attributes === undefined ||
    attributes.tone !== "done" ||
    attributes.agent ||
    design === undefined ||
    scope === undefined ||
    input.approved.length === 0
  ) {
    return null;
  }
  const designWork = designCard(design, input.requests);
  const scopeWork = scopeCard(scope, assessment?.tone === "done");
  const cards = [designWork, scopeWork];
  // An accepted list at rest asks nothing of the person (the server releases it): never
  // "Next: D&I Evidence" over a step whose panel says nothing is needed (17 November 2026).
  const settledList = input.requests.mode === "list" && input.requests.settled;
  const waitsOnPerson = (card: Omit<HandoffCard, "primary">) =>
    forThePerson(card.pill.tone) &&
    !card.pill.working &&
    !(card.key === "designevidence" && settledList);
  // The person's work first: the D&I card while it asks something of them, else the OE
  // card when it does, else the D&I card while it is not done.
  const primaryKey = waitsOnPerson(designWork)
    ? "designevidence"
    : waitsOnPerson(scopeWork)
      ? "testdesign"
      : designWork.pill.tone !== "done"
        ? "designevidence"
        : "testdesign";
  const primary = primaryKey === "designevidence" ? designWork : scopeWork;
  const toAccept =
    input.requests.mode === "list" && !input.requests.working
      ? input.requests.accept.length
      : 0;
  // What comes next, in a few words: the requests that wait, or the step and where it stands.
  const nextWords =
    primaryKey === "designevidence" && toAccept > 0
      ? `${toAccept} D&I request${toAccept === 1 ? "" : "s"} to accept`
      : `${primary.title}, ${primary.pill.label.charAt(0).toLowerCase()}${primary.pill.label.slice(1)}`;
  // Both branches open on the person's work, or not started: they can start (approved
  // prototype, 19 November 2026); otherwise what comes next, in the branch's own words.
  const bothStart = cards.every(
    (card) => forThePerson(card.pill.tone) && !card.pill.working,
  );
  const follows = bothStart
    ? `${designWork.title} and ${scopeWork.title} can start.`
    : `Next: ${nextWords}.`;
  return {
    title: SET_TITLE,
    line: setLine(input.approved.length, 0, follows),
    follows,
    next: { key: primaryKey, label: `Continue to ${primary.title}` },
    gap:
      designWork.coverage !== null && !designWork.coverage.complete
        ? designWork.coverage.line
        : "",
    cards: cards.map((card) => ({ ...card, primary: card.key === primaryKey })),
  };
}
