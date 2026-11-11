/**
 * Control Understanding as a conversation (product owner, 9 November 2026;
 * docs/control-understanding-conversation.md). Pure: what the engagement planner says, the
 * conversation so far, the offer to copy the answers to other systems, and the requests the
 * page sends. The answers themselves are the setup's (control-setup-model): the same
 * questions, the same draft, the same saves; only the way they are asked changes.
 */

import type { Draft, Prefill, Screen } from "./control-setup-model.ts";
import { ONE_SCREEN } from "./control-setup-model.ts";

export const AGENT_NAME = "Engagement planner";

export type GreetingFacts = {
  /** The person's first name, or "" when it cannot be read from their address. */
  firstName: string;
  /** The control as the panel names it: reference and system. */
  control: string;
  /** Points proposed from last year's file. */
  priorYear: number;
  /** Documents on file for the control. */
  documents: number;
  /** Points still to confirm, and of those the agents' own questions. */
  open: number;
  agentQuestions: number;
  /** Points already on record. */
  answered: number;
};

/** The planner's opening: who it is, what it drafted from, and what is left. */
export function greeting(facts: GreetingFacts): string[] {
  const hello = facts.firstName === "" ? "Hello." : `Hello ${facts.firstName}.`;
  const sources = [
    "the RCM",
    ...(facts.priorYear > 0 ? ["last year's file"] : []),
    ...(facts.documents > 0 ? ["the documents on file"] : []),
  ];
  const from =
    sources.length === 1
      ? sources[0]
      : `${sources.slice(0, -1).join(", ")} and ${sources[sources.length - 1]}`;
  const lines = [
    `${hello} I'm the engagement planner. I drafted the understanding of ${facts.control} from ${from}.`,
  ];
  if (facts.open === 0) {
    lines.push(
      facts.answered === 0
        ? "Nothing needs your answer here."
        : `All ${facts.answered} ${plural(facts.answered, "point")} ${facts.answered === 1 ? "is" : "are"} on record. You can review them below.`,
    );
    return lines;
  }
  const raised =
    facts.agentQuestions > 0
      ? `, ${facts.agentQuestions} of them raised by the agents from the records`
      : "";
  lines.push(
    `${facts.open} ${plural(facts.open, "point")} need${facts.open === 1 ? "s" : ""} you${raised}. Each has a suggested answer: pick one, or tell me in your own words.`,
  );
  return lines;
}

export type Turn = {
  key: string;
  /** The question's own key, to change its answer. */
  row: string;
  question: string;
  /** What the person answered, as it will be recorded. */
  answer: string;
};

/** The points answered in this conversation before the one now asked, in order. */
export function answeredTurns(
  rows: readonly Prefill[],
  screens: readonly Screen[],
  draft: Draft,
  position: number,
): Turn[] {
  const turns: Turn[] = [];
  for (const screen of screens.slice(0, Math.max(0, position))) {
    const row = rows[screen.row];
    if (row === undefined) {
      continue;
    }
    const step = row.steps?.find((item) => item.key === screen.step);
    const question = step?.question ?? row.question;
    if (draft.dismissed.includes(row.key)) {
      turns.push({
        key: `${row.key}:${screen.step}`,
        row: row.key,
        question,
        answer: row.issue?.conflict ? "Dismissed" : "Not applicable",
      });
      continue;
    }
    const pick = draft.picks[row.key]?.[screen.step || ONE_SCREEN];
    const answer =
      pick === undefined
        ? row.source === "RECORDED"
          ? row.value
          : ""
        : "label" in pick
          ? pick.label
          : pick.other.trim();
    if (answer !== "") {
      turns.push({
        key: `${row.key}:${screen.step}`,
        row: row.key,
        question,
        answer,
      });
    }
  }
  return turns;
}

export type CopyTarget = {
  controlId: string;
  system: string;
  fills: string[];
  differs: string[];
};

export type CopyTargets = {
  controlRef: string;
  system: string;
  targets: CopyTarget[];
};

/** What the planner offers once the answers are in: the systems running the same control
 * that would take at least one answer. null when none would. */
export function copyOffer(found: CopyTargets | null): {
  text: string;
  systems: CopyTarget[];
} | null {
  const systems = (found?.targets ?? []).filter(
    (item) => item.fills.length > 0,
  );
  if (found === null || systems.length === 0) {
    return null;
  }
  const names = systems.map((item) => item.system || "another system");
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const kept = systems.some((item) => item.differs.length > 0)
    ? " Answers a system already has are kept as they are."
    : "";
  return {
    text: `${found.controlRef} also runs on ${list}. Do you want me to use these answers there too? Only the questions ${systems.length === 1 ? "it has" : "they have"} not answered are filled.${kept}`,
    systems,
  };
}

/** The systems offered for the copy (product owner, 10 November 2026: "if the other systems
 * already have been filled out... that option is only available if those are not yet filled
 * out"): a system that would take at least one answer, and any the person has ticked or
 * unticked here, so a system does not vanish once it is filled. A system holding every answer
 * already is not offered: a copy never overwrites, so it would do nothing. */
export function copyChoices(
  found: CopyTargets | null,
  chosen: Readonly<Record<string, boolean>>,
): CopyTarget[] {
  return (found?.targets ?? []).filter(
    (target) => target.fills.length > 0 || target.controlId in chosen,
  );
}

/** What copying the answers does on one system, beside its checkbox (product owner,
 * 10 November 2026: choose the systems one by one). Read from the server's own list,
 * refreshed after every save and every copy. `chosen` is the person's tick: true, false
 * once unticked, or undefined while untouched. */
export function copyTargetLine(target: CopyTarget, chosen?: boolean): string {
  const fills = target.fills.length;
  const differs = target.differs.length;
  const kept = differs > 0 ? `keeps ${differs} it answers differently` : "";
  if (fills > 0) {
    return `Fills ${fills} ${fills === 1 ? "answer" : "answers"} it does not have${kept !== "" ? `; ${kept}` : ""}.`;
  }
  if (chosen === true) {
    return differs > 0
      ? `Up to date; keeps ${differs} it answers differently. New answers are copied as they are saved.`
      : "Up to date. New answers are copied as they are saved.";
  }
  if (chosen === false) {
    return "Not copied to from now on. Answers already copied stay.";
  }
  return differs > 0
    ? "Has its own answers; nothing to fill now."
    : "Nothing to fill yet.";
}

/** After a copy: what the planner says it did. */
export function copiedNote(names: readonly string[]): string {
  if (names.length === 0) {
    return "Nothing was copied.";
  }
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Done. The answers are on ${list} now, each recorded with where it came from.`;
}

export type Reading = {
  intent: "ANSWER" | "EXPLAIN" | "SKIP" | "COPY" | "UNCLEAR";
  value: string;
  reply: string;
};

/** The planner's reading of a reply, from the API's answer; null when it cannot be read. */
export function parseReading(body: unknown): Reading | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const item = body as Record<string, unknown>;
  const intents = ["ANSWER", "EXPLAIN", "SKIP", "COPY", "UNCLEAR"] as const;
  const intent = intents.find((each) => each === item.intent);
  if (
    intent === undefined ||
    typeof item.value !== "string" ||
    typeof item.reply !== "string"
  ) {
    return null;
  }
  if (intent === "ANSWER" && item.value.trim() === "") {
    return null;
  }
  return { intent, value: item.value, reply: item.reply };
}

/** The same control on other systems, from the API's answer; null when unreadable. */
export function parseTargets(body: unknown): CopyTargets | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const item = body as Record<string, unknown>;
  if (
    typeof item.control_ref !== "string" ||
    typeof item.system !== "string" ||
    !Array.isArray(item.targets)
  ) {
    return null;
  }
  const strings = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((each): each is string => typeof each === "string")
      : [];
  const targets: CopyTarget[] = [];
  for (const raw of item.targets as unknown[]) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const target = raw as Record<string, unknown>;
    if (
      typeof target.control_id !== "string" ||
      typeof target.system !== "string"
    ) {
      continue;
    }
    targets.push({
      controlId: target.control_id,
      system: target.system,
      fills: strings(target.fills),
      differs: strings(target.differs),
    });
  }
  return { controlRef: item.control_ref, system: item.system, targets };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_.:-]{1,64}$/;

export type ChatRequest =
  | { error: "invalid" }
  | {
      method: "GET" | "POST";
      path: string;
      body: Record<string, unknown> | null;
    };

/** The API call for one of the conversation's requests, checked before it is sent. */
export function chatRequest(fields: Record<string, unknown>): ChatRequest {
  const text = (name: string) =>
    typeof fields[name] === "string" ? (fields[name] as string) : "";
  const org = text("organization_id");
  const project = text("project_id");
  const control = text("control_id");
  if (!UUID.test(org) || !UUID.test(project) || !UUID.test(control)) {
    return { error: "invalid" };
  }
  const base = `/organizations/${org}/projects/${project}/controls/${control}/understanding`;
  switch (text("intent")) {
    case "targets":
      return { method: "GET", path: `${base}/copy-targets`, body: null };
    case "review":
      return { method: "GET", path: `${base}/review`, body: null };
    case "notes": {
      const notes = text("text").trim();
      if (notes.length < 20 || notes.length > 20000) {
        return { error: "invalid" };
      }
      return { method: "POST", path: `${base}/notes`, body: { text: notes } };
    }
    case "interpret": {
      const key = text("key");
      const step = text("step");
      const said = text("text").trim();
      if (
        !KEY.test(key) ||
        (step !== "" && !KEY.test(step)) ||
        said === "" ||
        said.length > 600
      ) {
        return { error: "invalid" };
      }
      return {
        method: "POST",
        path: `${base}/interpret`,
        body: { key, step, text: said },
      };
    }
    case "copy-out": {
      const targets = Array.isArray(fields.targets)
        ? fields.targets.filter(
            (item): item is string =>
              typeof item === "string" && UUID.test(item),
          )
        : [];
      if (targets.length === 0 || targets.length > 50) {
        return { error: "invalid" };
      }
      return {
        method: "POST",
        path: `${base}/copy-out`,
        body: { targets: [...new Set(targets)] },
      };
    }
    default:
      return { error: "invalid" };
  }
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

// The understanding as a draft to review (product owner, 9 November 2026): everything the
// control needs before its evidence is drafted and its attributes finalized, grouped by what
// the person has to do (understanding_chat.understanding_review).

/** AUTH: the authentication control's settings, asked by how users sign in (10 November
 * 2026; authentication-model). */
export type NeedKind =
  | "RCM"
  | "ANSWER"
  | "DOCUMENT"
  | "QUESTION"
  | "PROCESS"
  | "AUTH";
export type NeededFor = "EVIDENCE" | "ATTRIBUTES" | "TESTING";

export type Need = {
  key: string;
  kind: NeedKind;
  label: string;
  question: string;
  value: string;
  options: string[];
  why: string;
  status: "CONFIRMED" | "PROPOSED" | "MISSING";
  source:
    | "RCM"
    | "PERSON"
    | "RECORDS"
    | "PRIOR_YEAR"
    | "USUAL"
    | "AGENT"
    | "NONE";
  neededFor: NeededFor[];
  proposalId: string | null;
  required: boolean;
};

export type Review = {
  controlRef: string;
  system: string;
  otherSystems: string[];
  statement: Array<{ text: string; key: string | null }>;
  needs: Need[];
  evidence: { ready: boolean; missing: string[] };
  attributes: { ready: boolean; missing: string[] };
  attributesApproved: number;
  attributesProposed: number;
};

const KINDS: readonly NeedKind[] = [
  "RCM",
  "ANSWER",
  "DOCUMENT",
  "QUESTION",
  "PROCESS",
  "AUTH",
];
const FOR: readonly NeededFor[] = ["EVIDENCE", "ATTRIBUTES", "TESTING"];
const STATUSES = ["CONFIRMED", "PROPOSED", "MISSING"] as const;
const SOURCES = [
  "RCM",
  "PERSON",
  "RECORDS",
  "PRIOR_YEAR",
  "USUAL",
  "AGENT",
  "NONE",
] as const;

/** The review from the API's answer; null when it cannot be read. */
export function parseReview(body: unknown): Review | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const item = body as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const strings = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((each): each is string => typeof each === "string")
      : [];
  const ready = (value: unknown) => {
    const held =
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : {};
    return { ready: held.ready === true, missing: strings(held.missing) };
  };
  if (
    typeof item.control_ref !== "string" ||
    !Array.isArray(item.needs) ||
    !Array.isArray(item.statement)
  ) {
    return null;
  }
  const needs: Need[] = [];
  for (const raw of item.needs as unknown[]) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const need = raw as Record<string, unknown>;
    const kind = KINDS.find((each) => each === need.kind);
    const status = STATUSES.find((each) => each === need.status);
    const source = SOURCES.find((each) => each === need.source);
    if (
      kind === undefined ||
      status === undefined ||
      source === undefined ||
      typeof need.key !== "string"
    ) {
      continue;
    }
    needs.push({
      key: need.key,
      kind,
      label: text(need.label),
      question: text(need.question),
      value: text(need.value),
      options: strings(need.options),
      why: text(need.why),
      status,
      source,
      neededFor: strings(need.needed_for).filter((each): each is NeededFor =>
        FOR.some((one) => one === each),
      ),
      proposalId:
        typeof need.proposal_id === "string" ? need.proposal_id : null,
      required: need.required !== false,
    });
  }
  const statement: Review["statement"] = [];
  for (const raw of item.statement as unknown[]) {
    if (typeof raw === "object" && raw !== null) {
      const part = raw as Record<string, unknown>;
      statement.push({
        text: text(part.text),
        key: typeof part.key === "string" ? part.key : null,
      });
    }
  }
  return {
    controlRef: item.control_ref,
    system: text(item.system),
    otherSystems: strings(item.other_systems),
    statement,
    needs,
    evidence: ready(item.evidence),
    attributes: ready(item.attributes),
    attributesApproved:
      typeof item.attributes_approved === "number"
        ? item.attributes_approved
        : 0,
    attributesProposed:
      typeof item.attributes_proposed === "number"
        ? item.attributes_proposed
        : 0,
  };
}

export type ReviewGroups = {
  /** What only the person can settle: missing answers, usual-practice suggestions (a
   * guess, never confirmed in bulk), the agents' questions, the process, a document. */
  needsYou: Need[];
  /** Last year's answers for this client, with their source: confirmed together. */
  lastYear: Need[];
  /** On record already. */
  confirmed: Need[];
  /** What the RCM says, which the evidence planner reads. */
  rcm: Need[];
};

/** The needs grouped by what the person has to do; within a group, testing's first. */
export function reviewGroups(review: Review): ReviewGroups {
  const first = (a: Need, b: Need) =>
    Number(b.neededFor.includes("TESTING")) -
    Number(a.neededFor.includes("TESTING"));
  const rcm = review.needs.filter((need) => need.kind === "RCM");
  const rest = review.needs.filter((need) => need.kind !== "RCM");
  return {
    needsYou: rest
      .filter(
        (need) =>
          need.status === "MISSING" ||
          (need.status === "PROPOSED" && need.source !== "PRIOR_YEAR"),
      )
      .sort(first),
    lastYear: rest.filter(
      (need) => need.status === "PROPOSED" && need.source === "PRIOR_YEAR",
    ),
    confirmed: rest.filter((need) => need.status === "CONFIRMED"),
    rcm,
  };
}

/** The one status line above the draft (product owner, 9 November 2026: "super confusing
 * and not simple"): what the gates still wait for, in a sentence. It reads the gates' own
 * verdicts, never a count of its own. */
export function statusLine(review: Review): { done: boolean; text: string } {
  if (review.evidence.ready && review.attributes.ready) {
    return {
      done: true,
      text: "Understood. The evidence can be requested and the attributes finalized.",
    };
  }
  const plural = (count: number) => (count === 1 ? "point" : "points");
  if (!review.evidence.ready) {
    const left = review.evidence.missing.length;
    return {
      done: false,
      text:
        left > 0
          ? `${left} ${plural(left)} left before the evidence can be requested.`
          : "Waiting for the understanding to be confirmed.",
    };
  }
  const left = review.attributes.missing.length;
  return {
    done: false,
    text: `${left} ${plural(left)} left before the attributes can be finalized.`,
  };
}

/** A statement part as the draft shows it: a label that starts a sentence is capitalized
 * (the library's labels are written mid-sentence); a client's own answer is shown as given. */
export function draftText(
  text: string,
  previous: string,
  isLabel: boolean,
): string {
  const starts = previous.trim() === "" || /[.!?]\s*$/.test(previous);
  return isLabel && starts && text !== ""
    ? `${text.charAt(0).toUpperCase()}${text.slice(1)}`
    : text;
}

/** The review with answers the server has just confirmed shown as on record, so the screen
 * agrees with the confirmation before the next read arrives. Readiness is left to that
 * read: it is the gates' own. */
export function withConfirmed(
  review: Review,
  saved: Readonly<Record<string, string>>,
): Review {
  return {
    ...review,
    needs: review.needs.map((need) =>
      need.key in saved
        ? {
            ...need,
            value: saved[need.key] ?? need.value,
            status: "CONFIRMED" as const,
            source: "PERSON" as const,
            proposalId: null,
          }
        : need,
    ),
  };
}

// The guided review (product owner, 9 November 2026: "does not feel premium"; mock-up approved
// the same day): the understanding as a document beside one point at a time.

/** The step that confirms last year's answers together, ahead of the points. */
export const CARRIED = "@carried";

/** The guided review's course: the steps in the order asked, and last year's answers the
 * carried step shows. Both are fixed at the first read, so a confirmed point keeps its place
 * and Back returns to it; a point a later read raises is added at the end. */
export type Interview = { plan: string[]; carried: string[] };

/** Whether a point still needs the person: a point the review no longer lists is settled. */
function isOpen(review: Review, key: string): boolean {
  const need = review.needs.find((each) => each.key === key);
  return need !== undefined && need.status !== "CONFIRMED";
}

/** The course at the first read: last year's answers first, as one step, then the points
 * that need the person, in the review's own order. */
export function startInterview(review: Review): Interview {
  const groups = reviewGroups(review);
  const carried = groups.lastYear.map((need) => need.key);
  return {
    plan: [
      ...(carried.length > 0 ? [CARRIED] : []),
      ...groups.needsYou.map((need) => need.key),
    ],
    carried,
  };
}

/** The course with any point a later read raises added at the end. */
export function extendInterview(
  review: Review,
  interview: Interview,
): Interview {
  const groups = reviewGroups(review);
  const known = new Set([...interview.plan, ...interview.carried]);
  const raised = [...groups.needsYou, ...groups.lastYear]
    .map((need) => need.key)
    .filter((key) => !known.has(key));
  return raised.length === 0
    ? interview
    : { ...interview, plan: [...interview.plan, ...raised] };
}

/** Last year's answers the person chose not to confirm together, asked one by one straight
 * after the carried step. */
export function askSeparately(
  interview: Interview,
  keys: readonly string[],
): Interview {
  const moving = keys.filter(
    (key) => interview.carried.includes(key) && !interview.plan.includes(key),
  );
  if (moving.length === 0) {
    return interview;
  }
  const at = interview.plan.indexOf(CARRIED);
  return {
    plan: [
      ...interview.plan.slice(0, at + 1),
      ...moving,
      ...interview.plan.slice(at + 1),
    ],
    carried: interview.carried.filter((key) => !moving.includes(key)),
  };
}

/** Whether a step of the course still needs the person. */
export function stepOpen(
  review: Review,
  interview: Interview,
  step: string,
): boolean {
  return step === CARRIED
    ? interview.carried.some((key) => isOpen(review, key))
    : isOpen(review, step);
}

/** The next step still open after `from`; the plan's length (the end) when none is. */
export function nextOpen(
  review: Review,
  interview: Interview,
  from: number,
): number {
  for (let at = Math.max(0, from + 1); at < interview.plan.length; at += 1) {
    const step = interview.plan[at];
    if (step !== undefined && stepOpen(review, interview, step)) {
      return at;
    }
  }
  return interview.plan.length;
}

/** The header's progress: every required point the course asks about, last year's
 * included; an optional document is not counted. A point is done once the server holds it
 * on record. */
export function interviewProgress(
  review: Review,
  interview: Interview,
): { done: number; total: number; marks: boolean[] } {
  const points = [
    ...interview.carried,
    ...interview.plan.filter((step) => step !== CARRIED),
  ].filter((key) => {
    const need = review.needs.find((each) => each.key === key);
    return need === undefined || need.required;
  });
  const marks = points.map((key) => !isOpen(review, key));
  return {
    done: marks.filter(Boolean).length,
    total: points.length,
    marks,
  };
}

/** The words that say what a point is needed for. */
export function neededForLine(need: Need): string {
  const words = need.neededFor.map((each) =>
    each === "EVIDENCE"
      ? "D&I evidence"
      : each === "ATTRIBUTES"
        ? "attributes"
        : "testing",
  );
  return words.length === 0 ? "" : `Needed for ${words.join(" · ")}`;
}

// Walkthrough notes (product owner, 9 November 2026): the planner's answers from pasted notes,
// each with the words of the notes it rests on, for the person to choose from.

export type NoteAnswer = {
  key: string;
  question: string;
  value: string;
  quote: string;
  /** The answer on record now, which this would replace; "" when there is none. */
  current: string;
};

export type NotesResult = {
  answers: NoteAnswer[];
  asked: number;
  source: "MODEL" | "RULES";
};

/** The planner's answers from the notes; null when the answer cannot be read. */
export function parseNotes(body: unknown): NotesResult | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const item = body as Record<string, unknown>;
  if (!Array.isArray(item.answers)) {
    return null;
  }
  const answers: NoteAnswer[] = [];
  for (const raw of item.answers as unknown[]) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const one = raw as Record<string, unknown>;
    if (
      typeof one.key !== "string" ||
      typeof one.value !== "string" ||
      typeof one.quote !== "string" ||
      one.value.trim() === ""
    ) {
      continue;
    }
    answers.push({
      key: one.key,
      question: typeof one.question === "string" ? one.question : one.key,
      value: one.value,
      quote: one.quote,
      current: typeof one.current === "string" ? one.current : "",
    });
  }
  return {
    answers,
    asked: typeof item.asked === "number" ? item.asked : 0,
    source: item.source === "MODEL" ? "MODEL" : "RULES",
  };
}

/** Which answers start chosen: a new answer is; one that would replace an answer on record is
 * not, so nothing a person recorded changes unless they choose it. */
export function notesChosen(
  answers: readonly NoteAnswer[],
): Record<string, boolean> {
  return Object.fromEntries(
    answers.map((answer) => [answer.key, answer.current.trim() === ""]),
  );
}

/** What the planner says about what it found. */
export function notesSummary(
  result: NotesResult,
  /** What was read: the pasted notes, or the governing policy (10 November 2026). */
  read: "notes" | "policy" = "notes",
): string {
  const found = result.answers.length;
  if (found === 0) {
    return `The ${read} ${read === "notes" ? "give" : "gives"} no answer that is not already on record. Nothing is changed.`;
  }
  const replacing = result.answers.filter(
    (a) => a.current.trim() !== "",
  ).length;
  return `The planner found ${found} ${found === 1 ? "answer" : "answers"} in the ${read}${
    replacing > 0
      ? `, ${replacing} of them different from an answer on record (left unticked)`
      : ""
  }. Each shows the words it rests on. Choose the ones to use.`;
}
