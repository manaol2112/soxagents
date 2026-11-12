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
      method: "GET" | "POST" | "PUT";
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
    case "walkthrough-answers": {
      // The walkthrough's answers, a topic's at once (11 November 2026). Each key, value and
      // flag is checked here; the API checks each answer against its question again.
      const answers = walkthroughAnswersBody(fields.answers);
      return answers === null
        ? { error: "invalid" }
        : {
            method: "PUT",
            path: `/organizations/${org}/projects/${project}/controls/${control}/walkthrough-answers`,
            body: { answers },
          };
    }
    case "targets":
      return { method: "GET", path: `${base}/copy-targets`, body: null };
    case "review": {
      // Which other system's answers to start from (11 November 2026): a control id, or
      // "none"; left to the server when not given.
      const from = text("from");
      if (from !== "" && from !== "none" && !UUID.test(from)) {
        return { error: "invalid" };
      }
      return {
        method: "GET",
        path:
          from === ""
            ? `${base}/review`
            : `${base}/review?${new URLSearchParams({ from }).toString()}`,
        body: null,
      };
    }
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

/** A walkthrough question's key, as the API names it. */
const WALKTHROUGH_KEY = /^wt-[a-z0-9-]{2,60}$/;
/** The most answers one save carries: a topic's questions, with room for follow-ups. */
const WALKTHROUGH_MAX = 40;
export const WALKTHROUGH_TEXT_MAX = 1000;

export type WalkthroughAnswer = { value: string; not_applicable: boolean };

/** The answers of one walkthrough save, checked: every key a walkthrough question's, every
 * value an answer of 1 to 1,000 characters, or "" with the question marked not applicable.
 * null when anything is off, so nothing half-checked is sent. */
function walkthroughAnswersBody(
  raw: unknown,
): Record<string, WalkthroughAnswer> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0 || entries.length > WALKTHROUGH_MAX) {
    return null;
  }
  const answers: Record<string, WalkthroughAnswer> = {};
  for (const [key, entry] of entries) {
    if (
      !WALKTHROUGH_KEY.test(key) ||
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry)
    ) {
      return null;
    }
    const held = entry as Record<string, unknown>;
    if (
      typeof held.value !== "string" ||
      typeof held.not_applicable !== "boolean"
    ) {
      return null;
    }
    const value = held.value.trim();
    if (held.not_applicable) {
      if (value !== "") {
        return null;
      }
    } else if (value === "" || value.length > WALKTHROUGH_TEXT_MAX) {
      return null;
    }
    answers[key] = { value, not_applicable: held.not_applicable };
  }
  return answers;
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
  | "AUTH"
  | "WALKTHROUGH";
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
    | "SYSTEM"
    | "OTHER_SYSTEM"
    | "USUAL"
    | "AGENT"
    | "NONE";
  neededFor: NeededFor[];
  proposalId: string | null;
  /** Where a proposal comes from, in the server's words, when its source alone does not say
   * (SYSTEM: "Used on 5 other controls on SAP S/4HANA"; OTHER_SYSTEM: "From ITGC-AC-01 on
   * Active Directory"); "" or absent otherwise. */
  sourceDetail?: string;
  required: boolean;
  /** A walkthrough question's own facts (kind WALKTHROUGH only). */
  walkthrough?: Walkthrough;
};

/** A walkthrough topic, as the API names it (SCOPE, APPROVAL, ...). The order topics are
 * asked in is the server's, read from the order its questions arrive (product owner, 11
 * November 2026: "not even organized in a chronological manner"); the client keeps no list
 * of its own to sort by. */
export type WalkthroughTopic = string;
const TOPIC_NAME = /^[A-Z][A-Z0-9_]{0,39}$/;

/** A topic's name when the API gives none; a topic outside this map needs the API's. */
export const TOPIC_LABELS: Readonly<Record<string, string>> = {
  SCOPE: "What the control covers",
  INITIATION: "How it starts",
  APPROVAL: "Approval",
  EXECUTION: "Performing the control",
  SEGREGATION: "Segregation of duties",
  RECORDS: "Records and system data",
  EXCEPTIONS: "Exceptions and monitoring",
  POPULATION: "Population for testing",
  CHANGES: "Changes in the period",
  SERVICE_ORG: "Service organizations",
  VOLUME: "Volume",
};

/** A topic's label: the API's, else the client's fallback; "" when neither is known. */
function topicLabel(topic: string, given: unknown): string {
  const label = typeof given === "string" ? given.trim() : "";
  return label !== "" ? label : (TOPIC_LABELS[topic] ?? "");
}

export type AnswerKind = "CHOICE" | "MULTI" | "YES_NO" | "TEXT";
/** What a walkthrough answer changes downstream. */
export type Drive =
  | "EVIDENCE"
  | "ATTRIBUTES"
  | "CRITERIA"
  | "SAMPLING"
  | "SCOPE";

export type Walkthrough = {
  topic: WalkthroughTopic;
  topicLabel: string;
  answerKind: AnswerKind;
  drives: Drive[];
  /** For a proposed answer, the words of the source it rests on; "" otherwise. */
  quote: string;
  /** Whether the question also takes an answer in the person's own words, "Other: ..."
   * (product owner, 11 November 2026). CHOICE and MULTI only; false when the API leaves it
   * out. */
  allowsOther: boolean;
  /** A follow-up's parent question and the answer that opens it (12 November 2026, review
   * M1): "" for both when the question is not a follow-up. A MULTI parent opens it when one
   * of its parts is `whenValue`; any other parent when its answer is `whenValue`. */
  whenKey: string;
  whenValue: string;
};

/** The walkthrough as it reads from the answers on record (11 November 2026): one short
 * paragraph per topic, in the server's order. A part with a key is a confirmed answer,
 * linked to its question; the rest is the sentence around it. */
export type NarrativeTopic = {
  topic: WalkthroughTopic;
  label: string;
  parts: Array<{ text: string; key: string | null }>;
};

/** The same control on another system whose answers the review can start from (product
 * owner, 11 November 2026), and how many of this control's open questions it answers. */
export type StartFromOption = {
  controlId: string;
  system: string;
  answers: number;
};

/** Which other system's answers are proposed in the review (`chosen`, a control id; null
 * when none is), and the systems it can start from. */
export type StartFrom = {
  chosen: string | null;
  options: StartFromOption[];
};

export type Review = {
  controlRef: string;
  system: string;
  otherSystems: string[];
  statement: Array<{ text: string; key: string | null }>;
  /** The walkthrough's narrative; [] when nothing is confirmed yet. */
  narrative: NarrativeTopic[];
  needs: Need[];
  evidence: { ready: boolean; missing: string[] };
  attributes: { ready: boolean; missing: string[] };
  attributesApproved: number;
  attributesProposed: number;
  /** Whether the attributes are settled, as the D&I release reads them (11 November 2026),
   * and what they still wait for when they are not. */
  attributesSettled: boolean;
  attributesWaiting: string;
  /** The other systems the answers can start from; nothing chosen and none offered when the
   * API leaves it out. */
  startFrom: StartFrom;
};

const KINDS: readonly NeedKind[] = [
  "RCM",
  "ANSWER",
  "DOCUMENT",
  "QUESTION",
  "PROCESS",
  "AUTH",
  "WALKTHROUGH",
];
const ANSWER_KINDS: readonly AnswerKind[] = [
  "CHOICE",
  "MULTI",
  "YES_NO",
  "TEXT",
];
const DRIVES: readonly Drive[] = [
  "EVIDENCE",
  "ATTRIBUTES",
  "CRITERIA",
  "SAMPLING",
  "SCOPE",
];
const FOR: readonly NeededFor[] = ["EVIDENCE", "ATTRIBUTES", "TESTING"];
const STATUSES = ["CONFIRMED", "PROPOSED", "MISSING"] as const;
const SOURCES = [
  "RCM",
  "PERSON",
  "RECORDS",
  "PRIOR_YEAR",
  "SYSTEM",
  "OTHER_SYSTEM",
  "USUAL",
  "AGENT",
  "NONE",
] as const;

/** The other system the review's answers start from; null when none is chosen. */
export function chosenStart(review: Review): StartFromOption | null {
  const { chosen, options } = review.startFrom;
  return options.find((option) => option.controlId === chosen) ?? null;
}

/** The quiet line at the top of the review about where its answers start from (product
 * owner, 11 November 2026). A system that answers none of this control's open questions is
 * not offered. With more than one system, a compact select of them and None; with exactly
 * one, a quiet link: "Don't use these", or, once none is chosen, "Use answers from <system>".
 * `text` is the banner's sentence while a system is chosen, "" otherwise. null when there is
 * nothing to offer. */
export type StartFromBanner = {
  text: string;
  choose:
    | {
        kind: "select";
        value: string;
        options: Array<{ value: string; label: string }>;
      }
    | { kind: "link"; value: string; label: string };
};

/** The choice of no other system's answers, as the review's request names it. */
export const START_NONE = "none";

export function startFromBanner(review: Review): StartFromBanner | null {
  const offered = review.startFrom.options.filter(
    (option) => option.answers > 0,
  );
  if (offered.length === 0) {
    return null;
  }
  const name = (option: StartFromOption) =>
    option.system !== "" ? option.system : "another system";
  const chosen =
    offered.find((option) => option.controlId === review.startFrom.chosen) ??
    null;
  const text =
    chosen === null
      ? ""
      : `Answers from ${review.controlRef} on ${name(chosen)} are proposed below — confirm or change each.`;
  const only = offered.length === 1 ? offered[0] : undefined;
  if (only !== undefined) {
    return {
      text,
      choose:
        chosen === null
          ? {
              kind: "link",
              value: only.controlId,
              label: `Use answers from ${name(only)}`,
            }
          : { kind: "link", value: START_NONE, label: "Don't use these" },
    };
  }
  return {
    text,
    choose: {
      kind: "select",
      value: chosen?.controlId ?? START_NONE,
      options: [
        ...offered.map((option) => ({
          value: option.controlId,
          label: `${option.system !== "" ? option.system : "Another system"} (${option.answers})`,
        })),
        { value: START_NONE, label: "None" },
      ],
    },
  };
}

/** The review's request fields for where its answers start from: the person's choice for
 * this control (a control id or "none"), or nothing to leave it to the server. A choice made
 * on another control does not carry over. */
export function startFromField(
  choice: { control: string; from: string } | null,
  controlId: string,
): { from?: string } {
  return choice !== null &&
    choice.control === controlId &&
    (choice.from === START_NONE || UUID.test(choice.from))
    ? { from: choice.from }
    : {};
}

/** How a proposed walkthrough answer says where it came from, under its question: last
 * year's workpaper and the same control on another system by their source (the standard
 * checks' mark); the agents' and the rest as proposed (the agent's mark). Never the words of
 * an answer on record. */
export function proposalMark(need: Need): { text: string; agent: boolean } {
  if (need.source === "PRIOR_YEAR") {
    return { text: "From last year's workpaper", agent: false };
  }
  if (need.source === "OTHER_SYSTEM") {
    return { text: otherSystemLabel(need), agent: false };
  }
  return {
    text: need.source === "AGENT" ? "Proposed by the agents" : "Proposed",
    agent: true,
  };
}

/** Whether confirming a proposal accepts its proposal record: last year's, this system's and
 * the agents' carry one; an answer from another system is saved as the statement's value
 * (the existing save; nothing new). */
export function confirmsByProposal(need: Need): boolean {
  return need.proposalId !== null && need.source !== "OTHER_SYSTEM";
}

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
    const walkthrough =
      kind === "WALKTHROUGH" ? readWalkthrough(need) : undefined;
    if (kind === "WALKTHROUGH" && walkthrough === undefined) {
      // A question with no topic cannot be placed in the walkthrough.
      continue;
    }
    needs.push({
      key: need.key,
      kind,
      label: text(need.label) || (walkthrough?.topicLabel ?? ""),
      question: text(need.question),
      value: text(need.value),
      options:
        walkthrough === undefined
          ? strings(need.options)
          : walkthroughOptions(
              walkthrough.answerKind,
              strings(need.options),
              walkthrough.allowsOther,
            ),
      why: text(need.why),
      status,
      source,
      neededFor: strings(need.needed_for).filter((each): each is NeededFor =>
        FOR.some((one) => one === each),
      ),
      proposalId:
        typeof need.proposal_id === "string" ? need.proposal_id : null,
      sourceDetail: text(need.source_detail).trim(),
      required: need.required !== false,
      ...(walkthrough === undefined ? {} : { walkthrough }),
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
    narrative: readNarrative(item.narrative),
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
    attributesSettled: item.attributes_settled === true,
    attributesWaiting: text(item.attributes_waiting),
    startFrom: readStartFrom(item.start_from),
  };
}

/** The systems the review can start from, checked: each a control id and a system, with a
 * whole number of answers (0 or more); one given twice is kept once. `chosen` stands only
 * when it names one of them. Nothing chosen and none offered when absent or unreadable. */
function readStartFrom(raw: unknown): StartFrom {
  const none: StartFrom = { chosen: null, options: [] };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return none;
  }
  const item = raw as Record<string, unknown>;
  if (!Array.isArray(item.options)) {
    return none;
  }
  const options: StartFromOption[] = [];
  for (const each of item.options as unknown[]) {
    if (typeof each !== "object" || each === null) {
      continue;
    }
    const option = each as Record<string, unknown>;
    if (
      typeof option.control_id !== "string" ||
      !UUID.test(option.control_id) ||
      typeof option.system !== "string" ||
      typeof option.answers !== "number" ||
      !Number.isInteger(option.answers) ||
      option.answers < 0 ||
      options.some((held) => held.controlId === option.control_id)
    ) {
      continue;
    }
    options.push({
      controlId: option.control_id,
      system: option.system.trim(),
      answers: option.answers,
    });
  }
  const chosen =
    typeof item.chosen === "string" &&
    options.some((option) => option.controlId === item.chosen)
      ? item.chosen
      : null;
  return { chosen, options };
}

/** The narrative from the API's answer, checked: each topic named and labelled (a topic the
 * client does not know needs the API's label), each part with its text and a key that is a
 * string or null. A part that is off is left out, a topic with no part left is too, and a
 * topic given twice keeps one paragraph. [] when absent or not a list. */
function readNarrative(raw: unknown): NarrativeTopic[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const topics: NarrativeTopic[] = [];
  for (const each of raw as unknown[]) {
    if (typeof each !== "object" || each === null) {
      continue;
    }
    const item = each as Record<string, unknown>;
    const topic = typeof item.topic === "string" ? item.topic : "";
    const label = topicLabel(topic, item.label);
    if (!TOPIC_NAME.test(topic) || label === "" || !Array.isArray(item.parts)) {
      continue;
    }
    const parts: NarrativeTopic["parts"] = [];
    for (const one of item.parts as unknown[]) {
      if (typeof one !== "object" || one === null) {
        continue;
      }
      const part = one as Record<string, unknown>;
      const key =
        part.key === null || part.key === undefined
          ? null
          : typeof part.key === "string" && part.key !== ""
            ? part.key
            : undefined;
      if (
        typeof part.text !== "string" ||
        part.text === "" ||
        key === undefined
      ) {
        continue;
      }
      parts.push({ text: part.text, key });
    }
    if (parts.length === 0) {
      continue;
    }
    const known = topics.find((held) => held.topic === topic);
    if (known !== undefined) {
      known.parts.push({ text: " ", key: null }, ...parts);
    } else {
      topics.push({ topic, label, parts });
    }
  }
  return topics;
}

/** A walkthrough question's facts, with defaults for what the API leaves out: the topic's
 * own name, CHOICE when there are options to choose from and TEXT otherwise. undefined when
 * the topic is not named, or has no label from the API and none the client knows. */
function readWalkthrough(
  need: Record<string, unknown>,
): Walkthrough | undefined {
  const topic = typeof need.topic === "string" ? need.topic : "";
  const topicName = topicLabel(topic, need.topic_label);
  if (!TOPIC_NAME.test(topic) || topicName === "") {
    return undefined;
  }
  const options = Array.isArray(need.options)
    ? need.options.filter(
        (each): each is string => typeof each === "string" && each !== "",
      )
    : [];
  const given = ANSWER_KINDS.find((each) => each === need.answer_kind);
  const answerKind: AnswerKind =
    given === "YES_NO"
      ? "YES_NO"
      : given === undefined
        ? options.length > 0
          ? "CHOICE"
          : "TEXT"
        : given !== "TEXT" && options.length === 0
          ? // Nothing to choose from: asked in the person's own words.
            "TEXT"
          : given;
  return {
    topic,
    topicLabel: topicName,
    answerKind,
    drives: Array.isArray(need.drives)
      ? DRIVES.filter((each) => (need.drives as unknown[]).includes(each))
      : [],
    quote: typeof need.quote === "string" ? need.quote.trim() : "",
    allowsOther:
      need.allows_other === true &&
      (answerKind === "CHOICE" || answerKind === "MULTI"),
    ...followUpOf(need),
  };
}

/** A question's parent and the answer that opens it, from when_key and when_value; "" for
 * both when either is missing, not a string or blank, or the question names itself. */
function followUpOf(need: Record<string, unknown>): {
  whenKey: string;
  whenValue: string;
} {
  const key = typeof need.when_key === "string" ? need.when_key.trim() : "";
  const value =
    typeof need.when_value === "string" ? need.when_value.trim() : "";
  return key === "" || value === "" || key === need.key
    ? { whenKey: "", whenValue: "" }
    : { whenKey: key, whenValue: value };
}

/** An option the client's own "Other" chip stands for, left out of the list when the
 * question takes an Other answer, so it is never offered twice. */
const OTHER_OPTION = /^other(\s*\(describe\))?$/i;

function walkthroughOptions(
  kind: AnswerKind,
  given: string[],
  allowsOther: boolean,
): string[] {
  if (kind === "YES_NO") {
    return ["Yes", "No"];
  }
  return kind === "TEXT"
    ? []
    : [
        ...new Set(
          given.filter(
            (each) =>
              each !== "" &&
              !(
                allowsOther &&
                (OTHER_OPTION.test(each.trim()) || each.startsWith(OTHER_PART))
              ),
          ),
        ),
      ];
}

export type ReviewGroups = {
  /** What only the person can settle: missing answers, usual-practice suggestions (a
   * guess, never confirmed in bulk), the agents' questions, the process, a document. */
  needsYou: Need[];
  /** Last year's answers for this client, with their source: confirmed together. */
  lastYear: Need[];
  /** The answers given to the same questions on this system's other controls (product
   * owner, 11 November 2026: "should be the same by default but user can still update
   * it"): a person's answers already, so confirmed together with last year's. */
  sameSystem: Need[];
  /** The answers given for the same control on another system the person starts from
   * (product owner, 11 November 2026): proposals until confirmed, together with the rest
   * already known. */
  otherSystem: Need[];
  /** On record already. */
  confirmed: Need[];
  /** What the RCM says, which the evidence planner reads. */
  rcm: Need[];
  /** The walkthrough's questions, asked by topic after the points (11 November 2026), in
   * the server's order: the order the control runs in, a follow-up right after its parent. */
  walkthrough: Need[];
};

/** The sources of answers already known, confirmed together on the carried step: last
 * year's, this system's other controls', and the same control's on another system. */
const CARRIED_SOURCES: ReadonlySet<Need["source"]> = new Set([
  "PRIOR_YEAR",
  "SYSTEM",
  "OTHER_SYSTEM",
]);

/** The needs grouped by what the person has to do; within a group, testing's first. */
export function reviewGroups(review: Review): ReviewGroups {
  const first = (a: Need, b: Need) =>
    Number(b.neededFor.includes("TESTING")) -
    Number(a.neededFor.includes("TESTING"));
  const rcm = review.needs.filter((need) => need.kind === "RCM");
  const rest = review.needs.filter(
    (need) => need.kind !== "RCM" && need.kind !== "WALKTHROUGH",
  );
  return {
    needsYou: rest
      .filter(
        (need) =>
          need.status === "MISSING" ||
          (need.status === "PROPOSED" && !CARRIED_SOURCES.has(need.source)),
      )
      .sort(first),
    lastYear: rest.filter(
      (need) => need.status === "PROPOSED" && need.source === "PRIOR_YEAR",
    ),
    sameSystem: rest.filter(
      (need) => need.status === "PROPOSED" && need.source === "SYSTEM",
    ),
    otherSystem: rest.filter(
      (need) => need.status === "PROPOSED" && need.source === "OTHER_SYSTEM",
    ),
    confirmed: rest.filter((need) => need.status === "CONFIRMED"),
    rcm,
    walkthrough: review.needs.filter((need) => need.kind === "WALKTHROUGH"),
  };
}

/** The one status line above the draft (product owner, 9 November 2026: "super confusing
 * and not simple"): what the gates still wait for, in a sentence. It reads the gates' own
 * verdicts, never a count of its own. */
export function statusLine(review: Review): { done: boolean; text: string } {
  if (review.evidence.ready && review.attributes.ready) {
    // Understood: the attributes come next, and the D&I evidence is requested against them
    // (product owner, 11 November 2026).
    return {
      done: true,
      text: review.attributesSettled
        ? "Understood, and the attributes are settled. The D&I evidence can be released."
        : "Understood. Next, finalize the attributes: the D&I evidence is requested against them.",
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

/** What the understanding leads to, in order (11 November 2026): the attributes first, then
 * the D&I evidence requested against them. Each line reads the gates' own verdicts. */
export function readyLines(review: Review): Array<{
  key: "attributes" | "evidence";
  text: string;
  ready: boolean;
  note: string;
}> {
  const understood = review.evidence.ready && review.attributes.ready;
  const left = (missing: readonly string[]) =>
    missing.length > 0 ? `${missing.length} left` : "Not yet";
  return [
    {
      key: "attributes",
      text: review.attributesSettled
        ? "Attributes settled"
        : "Attributes can be finalized",
      ready: review.attributes.ready,
      note: review.attributesSettled
        ? "Done"
        : review.attributes.ready
          ? review.attributesProposed > 0
            ? `${review.attributesProposed} to decide`
            : "Ready"
          : left(review.attributes.missing),
    },
    {
      key: "evidence",
      text: "D&I evidence can be requested",
      ready: review.evidence.ready && review.attributesSettled,
      note: !review.evidence.ready
        ? left(review.evidence.missing)
        : review.attributesSettled
          ? "Ready"
          : understood
            ? "After the attributes"
            : "Not yet",
    },
  ];
}

/** Where the understanding's done step leads: the attributes until they are settled, then
 * the D&I evidence. */
export function nextAfterUnderstanding(
  review: Review,
): "attributes" | "evidence" {
  return review.attributesSettled ? "evidence" : "attributes";
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
            sourceDetail: "",
          }
        : need,
    ),
  };
}

// The guided review (product owner, 9 November 2026: "does not feel premium"; mock-up approved
// the same day): the understanding as a document beside one point at a time.

/** The step that confirms the answers already known together, ahead of the points: last
 * year's, those used on this system's other controls, and those given for the same control
 * on the other system the person starts from (11 November 2026). */
export const CARRIED = "@carried";

/** Where a carried answer came from, kept from the first read so the step keeps saying so
 * once its answers are confirmed. */
export type CarriedFrom = "PRIOR_YEAR" | "SYSTEM" | "OTHER_SYSTEM";

/** The guided review's course: the steps in the order asked, and the known answers the
 * carried step shows, with where each came from. All are fixed at the first read, so a
 * confirmed point keeps its place and Back returns to it; a point a later read raises is
 * added at the end. */
export type Interview = {
  plan: string[];
  carried: string[];
  carriedFrom: Record<string, CarriedFrom>;
  /** The other system the answers start from, by name ("" when unnamed), kept from the
   * read the course was set at; absent when none is. */
  otherSystem?: string;
};

/** Whether a point still needs the person: a point the review no longer lists is settled. */
function isOpen(review: Review, key: string): boolean {
  const need = review.needs.find((each) => each.key === key);
  return need !== undefined && need.status !== "CONFIRMED";
}

/** The course at the first read: last year's answers first, as one step, then the points
 * that need the person, in the review's own order, then the walkthrough, one step per topic
 * with a question still open (11 November 2026), in the order the server first asks each
 * topic. */
export function startInterview(review: Review): Interview {
  const groups = reviewGroups(review);
  const known = [
    ...groups.lastYear,
    ...groups.sameSystem,
    ...groups.otherSystem,
  ];
  const carried = known.map((need) => need.key);
  const carriedFrom: Record<string, CarriedFrom> = {};
  for (const need of known) {
    carriedFrom[need.key] =
      need.source === "SYSTEM" || need.source === "OTHER_SYSTEM"
        ? need.source
        : "PRIOR_YEAR";
  }
  const other = chosenStart(review);
  return {
    ...(other === null ? {} : { otherSystem: other.system }),
    plan: [
      ...(carried.length > 0 ? [CARRIED] : []),
      ...groups.needsYou.map((need) => need.key),
      ...walkthroughTopics(review)
        .filter((topic) => topicOpen(review, topic))
        .map(topicStep),
    ],
    carried,
    carriedFrom,
  };
}

/** The course again after the person changed which system the answers start from: the
 * proposals are the new read's, so the course is set afresh from it (nothing was written).
 * The person stays on the step they were on when the new course still asks it, else goes to
 * its first step still open. */
export function restartInterview(
  review: Review,
  before: Interview | null,
  at: number,
): { interview: Interview; at: number } {
  const interview = startInterview(review);
  const step = before?.plan[at];
  const kept = step === undefined ? -1 : interview.plan.indexOf(step);
  return {
    interview,
    at:
      kept >= 0 && stepOpen(review, interview, step ?? "")
        ? kept
        : nextOpen(review, interview, -1),
  };
}

/** The course with any point a later read raises added at the end. A walkthrough topic a
 * later read opens (a follow-up of an answer) takes its place in the server's topic order,
 * but never at or before `after`, the step the person is on, so the steps already walked
 * keep their places. */
export function extendInterview(
  review: Review,
  interview: Interview,
  after: number = interview.plan.length - 1,
): Interview {
  const groups = reviewGroups(review);
  const known = new Set([...interview.plan, ...interview.carried]);
  const raised = [
    ...groups.needsYou,
    ...groups.lastYear,
    ...groups.sameSystem,
    ...groups.otherSystem,
  ]
    .map((need) => need.key)
    .filter((key) => !known.has(key));
  let plan = [...interview.plan, ...raised];
  let changed = raised.length > 0;
  const order = walkthroughTopics(review);
  const rankOf = (topic: WalkthroughTopic) => {
    const rank = order.indexOf(topic);
    return rank < 0 ? order.length : rank;
  };
  for (const topic of order) {
    const step = topicStep(topic);
    if (plan.includes(step) || !topicOpen(review, topic)) {
      continue;
    }
    const rank = rankOf(topic);
    let place = plan.length;
    for (let index = Math.max(0, after + 1); index < plan.length; index += 1) {
      const other = stepTopic(plan[index] ?? "");
      if (other !== null && rankOf(other) > rank) {
        place = index;
        break;
      }
    }
    plan = [...plan.slice(0, place), step, ...plan.slice(place)];
    changed = true;
  }
  return changed ? { ...interview, plan } : interview;
}

/** Known answers the person chose not to confirm together, asked one by one straight after
 * the carried step. */
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
    ...interview,
    plan: [
      ...interview.plan.slice(0, at + 1),
      ...moving,
      ...interview.plan.slice(at + 1),
    ],
    carried: interview.carried.filter((key) => !moving.includes(key)),
  };
}

/** What a same-system proposal says of itself (11 November 2026): the server's words ("Used
 * on 5 other controls on SAP S/4HANA"), or a plain line when it gives none; "" for any other
 * source. */
export const SAME_SYSTEM_FALLBACK = "Used on other controls on this system";

export function sameSystemLabel(need: Need): string {
  if (need.source !== "SYSTEM") {
    return "";
  }
  const detail = need.sourceDetail?.trim() ?? "";
  return detail !== "" ? detail : SAME_SYSTEM_FALLBACK;
}

/** The other system's name in a sentence: its own, or a plain one when it has none. */
function otherSystemName(interview: Interview): string {
  const name = interview.otherSystem?.trim() ?? "";
  return name !== "" ? name : "the other system";
}

/** The carried step's words, by where its answers came from: last year's workpaper, this
 * system's other controls, the same control on another system, or more than one of them.
 * `waiting` is how many still wait for the person. */
export function carriedCopy(
  interview: Interview,
  waiting: number,
): {
  chip: string;
  title: string;
  hint: string;
  step: string;
  confirmed: (done: number) => string;
} {
  const from = new Set(
    interview.carried.map((key) => interview.carriedFrom[key] ?? "PRIOR_YEAR"),
  );
  const answers = (count: number) => (count === 1 ? "answer" : "answers");
  const other = otherSystemName(interview);
  if (from.size > 1) {
    // Where they come from, in the order the sources are named everywhere else.
    const words = [
      from.has("PRIOR_YEAR") ? "last year's workpaper" : "",
      from.has("SYSTEM") ? "this system's other controls" : "",
      from.has("OTHER_SYSTEM") ? `the same control on ${other}` : "",
    ].filter((part) => part !== "");
    return {
      chip: "Already known",
      title: "Confirm the answers already known",
      hint:
        waiting === 0
          ? "The answers already known are confirmed."
          : `${waiting} ${answers(waiting)} ${waiting === 1 ? "comes" : "come"} from ${listOf(words, "or")}. Untick any that differ for this control; it is asked on its own.`,
      step: "Answers already known",
      confirmed: (done) => `${done} known ${answers(done)} confirmed.`,
    };
  }
  if (from.has("OTHER_SYSTEM")) {
    const name = interview.otherSystem?.trim() ?? "";
    const where = name !== "" ? name : "another system";
    return {
      chip: `From ${where}`,
      title: `Confirm the answers from ${where}`,
      hint:
        waiting === 0
          ? `The answers from ${where} are confirmed.`
          : `${waiting} ${answers(waiting)} ${waiting === 1 ? "was" : "were"} given for the same control on ${where}. Untick any that differ for this control; it is asked on its own.`,
      step: `Answers from ${where}`,
      confirmed: (done) => `${done} ${answers(done)} from ${where} confirmed.`,
    };
  }
  if (from.has("SYSTEM")) {
    return {
      chip: "Used on this system",
      title: "Confirm the answers used on this system",
      hint:
        waiting === 0
          ? "The answers used on this system are confirmed."
          : `${waiting} ${answers(waiting)} ${waiting === 1 ? "was" : "were"} given for this system's other controls. Untick any that differ for this control; it is asked on its own.`,
      step: "Answers used on this system",
      confirmed: (done) =>
        `${done} ${answers(done)} used on this system confirmed.`,
    };
  }
  return {
    chip: "From last year's workpaper",
    title: "Confirm last year's answers",
    hint:
      waiting === 0
        ? "Last year's answers are confirmed."
        : `${waiting} ${waiting === 1 ? "answer was" : "answers were"} given by the client last year. Untick any that changed; it is asked on its own.`,
    step: "Last year's answers",
    confirmed: (done) => `${done} ${answers(done)} from last year confirmed.`,
  };
}

/** Words joined as a sentence lists them: "a", "a or b", "a, b or c". */
function listOf(words: readonly string[], last: "and" | "or"): string {
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} ${last} ${words[words.length - 1]}`;
}

/** What the draft was prepared from, in a sentence: the RCM, and last year's workpaper, this
 * system's other controls and the same control on another system when any gave an answer
 * (at the first read, or since). */
export function draftedFrom(
  groups: ReviewGroups,
  interview: Interview,
): string {
  const from = Object.values(interview.carriedFrom);
  const parts = [
    groups.lastYear.length > 0 || from.includes("PRIOR_YEAR")
      ? "last year's workpaper"
      : "",
    groups.sameSystem.length > 0 || from.includes("SYSTEM")
      ? "this system's other controls"
      : "",
    groups.otherSystem.length > 0 || from.includes("OTHER_SYSTEM")
      ? `the same control on ${otherSystemName(interview)}`
      : "",
  ].filter((part) => part !== "");
  return parts.length === 0
    ? "Drafted from the RCM"
    : parts.length === 1
      ? `Drafted from the RCM and ${parts[0]}`
      : `Drafted from the RCM, ${listOf(parts, "and")}`;
}

/** What an answer from the same control on another system says of itself: the server's words
 * ("From ITGC-AC-01 on Active Directory"), or a plain line when it gives none; "" for any
 * other source. */
export const OTHER_SYSTEM_FALLBACK = "From the same control on another system";

export function otherSystemLabel(need: Need): string {
  if (need.source !== "OTHER_SYSTEM") {
    return "";
  }
  const detail = need.sourceDetail?.trim() ?? "";
  return detail !== "" ? detail : OTHER_SYSTEM_FALLBACK;
}

/** Where one carried answer came from, shown beside it while it waits: the same-system line
 * always (how many controls use it); last year's and the other system's only when the step
 * mixes sources (alone, the step's title already says where they came from). */
export function carriedSource(interview: Interview, need: Need): string {
  if (need.source === "SYSTEM") {
    return sameSystemLabel(need);
  }
  const mixed =
    new Set(
      interview.carried.map(
        (key) => interview.carriedFrom[key] ?? "PRIOR_YEAR",
      ),
    ).size > 1;
  if (!mixed) {
    return "";
  }
  return need.source === "PRIOR_YEAR"
    ? "Last year's workpaper"
    : otherSystemLabel(need);
}

/** Whether a step of the course still needs the person. A walkthrough topic does while any
 * of its questions is unanswered, an optional one included: it is asked, and can be left. */
export function stepOpen(
  review: Review,
  interview: Interview,
  step: string,
): boolean {
  const topic = stepTopic(step);
  if (topic !== null) {
    return topicOpen(review, topic);
  }
  return step === CARRIED
    ? interview.carried.some((key) => isOpen(review, key))
    : isOpen(review, step);
}

/** Whether a step still holds the understanding back: a walkthrough topic only while one of
 * its required questions is unanswered; any other step while it is open. */
export function stepRequired(
  review: Review,
  interview: Interview,
  step: string,
): boolean {
  const topic = stepTopic(step);
  return topic !== null
    ? !topicDone(review, topic)
    : stepOpen(review, interview, step);
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
 * included, and every required walkthrough question of the topics it asks; an optional
 * document or question is not counted. A point is done once the server holds it on
 * record. */
export function interviewProgress(
  review: Review,
  interview: Interview,
): { done: number; total: number; marks: boolean[] } {
  // A walkthrough topic counts each of its required questions on its own (11 November 2026).
  const points = [
    ...interview.carried,
    ...interview.plan.flatMap((step) => {
      const topic = stepTopic(step);
      return step === CARRIED
        ? []
        : topic === null
          ? [step]
          : topicQuestions(review, topic).map((need) => need.key);
    }),
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
  /** Walkthrough answers the planner proposed from the notes (11 November 2026): stored on
   * the server as proposals, shown pre-selected in their topic for a person to confirm. */
  walkthroughProposed?: number;
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
    walkthroughProposed:
      typeof item.walkthrough_proposed === "number" &&
      Number.isInteger(item.walkthrough_proposed) &&
      item.walkthrough_proposed > 0
        ? item.walkthrough_proposed
        : 0,
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
  const proposed = result.walkthroughProposed ?? 0;
  const walkthrough =
    proposed > 0
      ? ` ${proposed} walkthrough ${proposed === 1 ? "answer is" : "answers are"} proposed in ${proposed === 1 ? "its topic" : "their topics"}, for you to confirm.`
      : "";
  if (found === 0) {
    return proposed > 0
      ? `The planner proposed ${proposed} walkthrough ${proposed === 1 ? "answer" : "answers"} from the ${read}, each with the words it rests on; confirm ${proposed === 1 ? "it" : "them"} in ${proposed === 1 ? "its topic" : "their topics"}.`
      : `The ${read} ${read === "notes" ? "give" : "gives"} no answer that is not already on record. Nothing is changed.`;
  }
  const replacing = result.answers.filter(
    (a) => a.current.trim() !== "",
  ).length;
  return `The planner found ${found} ${found === 1 ? "answer" : "answers"} in the ${read}${
    replacing > 0
      ? `, ${replacing} of them different from an answer on record (left unticked)`
      : ""
  }. Each shows the words it rests on. Choose the ones to use.${walkthrough}`;
}

// The walkthrough (product owner, 11 November 2026): the questions a senior IT auditor asks
// in a walkthrough, one step per topic after the points. Only the questions that apply now
// are listed; a follow-up appears once its parent is answered, so the review is read again
// after each save. Only required questions hold the control's understanding back.

const TOPIC_STEP = "wt:";

/** A topic's step in the course. */
export function topicStep(topic: WalkthroughTopic): string {
  return `${TOPIC_STEP}${topic}`;
}

/** The topic a step asks; null for any other step. */
export function stepTopic(step: string): WalkthroughTopic | null {
  if (!step.startsWith(TOPIC_STEP)) {
    return null;
  }
  const name = step.slice(TOPIC_STEP.length);
  return TOPIC_NAME.test(name) ? name : null;
}

/** The walkthrough's topics in the order the server first asks each one: never sorted here. */
export function walkthroughTopics(review: Review): WalkthroughTopic[] {
  const topics: WalkthroughTopic[] = [];
  for (const need of review.needs) {
    const topic = need.walkthrough?.topic;
    if (
      need.kind === "WALKTHROUGH" &&
      topic !== undefined &&
      !topics.includes(topic)
    ) {
      topics.push(topic);
    }
  }
  return topics;
}

/** A topic's label: its questions' (the API's), else the client's fallback, else its name. */
export function topicName(review: Review, topic: WalkthroughTopic): string {
  return (
    topicQuestions(review, topic)[0]?.walkthrough?.topicLabel ??
    TOPIC_LABELS[topic] ??
    topic
  );
}

/** A topic's questions, in the review's own order. */
export function topicQuestions(
  review: Review,
  topic: WalkthroughTopic,
): Need[] {
  return review.needs.filter(
    (need) => need.kind === "WALKTHROUGH" && need.walkthrough?.topic === topic,
  );
}

/** Whether any of a topic's questions is still unanswered, an optional one included. */
export function topicOpen(review: Review, topic: WalkthroughTopic): boolean {
  return topicQuestions(review, topic).some(
    (need) => need.status !== "CONFIRMED",
  );
}

/** Whether every required question of a topic is on record: the topic no longer holds the
 * understanding back. Optional ones can be left. */
export function topicDone(review: Review, topic: WalkthroughTopic): boolean {
  return topicQuestions(review, topic).every(
    (need) => !need.required || need.status === "CONFIRMED",
  );
}

/** The questions a topic's step shows, in the server's order (an optional question stays
 * where the server put it): those not on record, and any on record the person chose to
 * change (`reopened`). An answer on record is never asked again unless the person asks to
 * change it. */
export function topicAsks(
  review: Review,
  topic: WalkthroughTopic,
  reopened: readonly string[] = [],
): Need[] {
  return topicQuestions(review, topic).filter(
    (need) => need.status !== "CONFIRMED" || reopened.includes(need.key),
  );
}

// "Other" (product owner, 11 November 2026: "The questions in control understanding do not
// take multiple answers"): a CHOICE or MULTI question the server marks allows_other also
// takes the person's own words, as one answer part "Other: <text>" (3 to 200 characters
// after trimming, no ";"). CHOICE: one option or one Other part. MULTI: options in their
// listed order, then at most one Other part, last, joined with "; ". In a pick, the Other
// is held as one entry "Other: <text as typed>", trimmed only when the value is composed.

/** The start of an Other answer part, as the API takes it. */
export const OTHER_PART = "Other: ";
export const OTHER_MIN = 3;
export const OTHER_MAX = 200;
/** The rule for an Other answer, in words, for the field's description. */
export const OTHER_RULE = `${OTHER_MIN} to ${OTHER_MAX} characters, without ";".`;

/** What is wrong with an Other answer's words, in words; "" when they can be saved. */
export function otherProblem(text: string): string {
  const words = text.trim();
  if (words.includes(";")) {
    return 'Leave out ";": it separates answers. Use a comma instead.';
  }
  if (words.length < OTHER_MIN) {
    return `Describe it in at least ${OTHER_MIN} characters.`;
  }
  if (words.length > OTHER_MAX) {
    return `Keep it to ${OTHER_MAX} characters (${words.length} now).`;
  }
  return "";
}

/** The Other answer's words in a pick, as typed; null when Other is not chosen. */
export function otherText(pick: readonly string[]): string | null {
  const held = pick.find((each) => each.startsWith(OTHER_PART));
  return held === undefined ? null : held.slice(OTHER_PART.length);
}

/** A pick with its Other answer set to the words given (null: Other unchosen). CHOICE: Other
 * replaces the option chosen. MULTI: Other joins the options chosen, last. */
export function withOther(
  kind: AnswerKind,
  pick: readonly string[],
  text: string | null,
): string[] {
  const options =
    kind === "MULTI" ? pick.filter((each) => !each.startsWith(OTHER_PART)) : [];
  return text === null ? options : [...options, `${OTHER_PART}${text}`];
}

/** An answer value from its parts, as the API takes it: CHOICE one option or the Other part,
 * MULTI the options chosen in their listed order then the Other part. The Other words are
 * trimmed. "" when nothing valid is chosen or the Other words cannot be saved. */
export function composeAnswer(
  kind: "CHOICE" | "MULTI",
  options: readonly string[],
  chosen: readonly string[],
  other: string | null,
): string {
  if (other !== null && otherProblem(other) !== "") {
    return "";
  }
  const part = other === null ? [] : [`${OTHER_PART}${other.trim()}`];
  if (kind === "MULTI") {
    return [
      ...options.filter((option) => chosen.includes(option)),
      ...part,
    ].join("; ");
  }
  if (other !== null) {
    return chosen.length === 0 ? (part[0] ?? "") : "";
  }
  const one = chosen[0] ?? "";
  return chosen.length === 1 && options.includes(one) ? one : "";
}

/** An answer value read back into its parts: the options it names (in their listed order) and
 * its Other words (null when it has none, or the question takes none). A value off the
 * contract (a CHOICE with an unknown option, two Other parts, Other words that could not be
 * saved) reads as nothing chosen rather than half of it. */
export function parseAnswer(
  kind: "CHOICE" | "MULTI",
  options: readonly string[],
  allowsOther: boolean,
  value: string,
): { options: string[]; other: string | null } {
  const none = { options: [], other: null };
  const whole = value.trim();
  if (kind === "CHOICE") {
    if (options.includes(whole)) {
      return { options: [whole], other: null };
    }
    const words = whole.startsWith(OTHER_PART)
      ? whole.slice(OTHER_PART.length)
      : null;
    return words !== null && allowsOther && otherProblem(words) === ""
      ? { options: [], other: words.trim() }
      : none;
  }
  const parts = whole
    .split(";")
    .map((each) => each.trim())
    .filter((each) => each !== "");
  const named = options.filter((option) => parts.includes(option));
  const others = parts.filter(
    (each) => each.startsWith(OTHER_PART) && !options.includes(each),
  );
  if (others.length === 0) {
    return { options: named, other: null };
  }
  const words = others[0]?.slice(OTHER_PART.length) ?? "";
  if (
    others.length > 1 ||
    !allowsOther ||
    otherProblem(words) !== "" ||
    parts[parts.length - 1] !== others[0]
  ) {
    // Two Other parts, one the question does not take, or one not last: off the contract.
    return none;
  }
  return { options: named, other: words.trim() };
}

/** An answer as the record shows it: an Other part without its "Other: " start, and a MULTI's
 * parts joined with ", " ("HR feed, A call from HR on the day"). A TEXT or Yes/No answer as
 * given. */
export function answerDisplay(need: Need): string {
  const kind = need.walkthrough?.answerKind;
  if (kind !== "CHOICE" && kind !== "MULTI") {
    return need.value;
  }
  return need.value
    .split(";")
    .map((each) => each.trim())
    .filter((each) => each !== "")
    .map((each) =>
      each.startsWith(OTHER_PART) && !need.options.includes(each)
        ? each.slice(OTHER_PART.length).trim()
        : each,
    )
    .join(", ");
}

/** The answer a question starts with: the proposal's (the agents' or last year's) or the
 * answer on record, as the choices it stands for, its Other answer as the entry
 * "Other: <text>"; nothing for a question not answered. */
export function proposedPick(need: Need): string[] {
  if (need.status === "MISSING" || need.value.trim() === "") {
    return [];
  }
  const kind = need.walkthrough?.answerKind ?? "TEXT";
  if (kind === "TEXT") {
    return [need.value];
  }
  if (kind === "YES_NO") {
    return need.options.includes(need.value) ? [need.value] : [];
  }
  const read = parseAnswer(
    kind,
    need.options,
    need.walkthrough?.allowsOther === true,
    need.value,
  );
  if (kind === "CHOICE") {
    // One option or the Other answer. (12 November 2026: withOther drops a CHOICE's option
    // when no Other is given, so a plain option on record or proposed started on nothing.)
    return read.other === null ? read.options : [`${OTHER_PART}${read.other}`];
  }
  return withOther(kind, read.options, read.other);
}

/** The answer as the API takes it, from what the person chose: one option or the Other
 * answer, the options in their listed order joined with "; " (the Other answer last), "Yes"
 * or "No", or the words typed. "" when nothing valid is chosen. */
export function pickedValue(need: Need, pick: readonly string[]): string {
  const kind = need.walkthrough?.answerKind ?? "TEXT";
  if (kind === "TEXT") {
    const typed = (pick[0] ?? "").trim();
    return typed.length > WALKTHROUGH_TEXT_MAX ? "" : typed;
  }
  if (kind === "YES_NO") {
    const one = pick[0] ?? "";
    return pick.length === 1 && need.options.includes(one) ? one : "";
  }
  const other = need.walkthrough?.allowsOther === true ? otherText(pick) : null;
  const chosen = pick.filter((each) => !each.startsWith(OTHER_PART));
  if (kind === "CHOICE" && pick.length !== 1) {
    return "";
  }
  return composeAnswer(kind, need.options, chosen, other);
}

/** Why a question's answer cannot be saved as chosen: its Other answer is chosen with words
 * that cannot be saved. "" when nothing holds it back. */
export function pickProblem(need: Need, pick: readonly string[]): string {
  if (need.walkthrough?.allowsOther !== true) {
    return "";
  }
  const other = otherText(pick);
  return other === null ? "" : otherProblem(other);
}

// Follow-ups (12 November 2026, review M1). The server lists a follow-up only while its
// parent's answer on record opens it. In a topic's step the person may change the parent: a
// follow-up is shown only while the parent's pick there (or, when the parent is not being
// changed here, its answer on record) still opens it, and its own parent is shown. A hidden
// follow-up is never saved and never holds the save back; what was typed for it stays in
// the step's choices, in case the person switches back.

/** Whether an answer, as its parts, opens a follow-up: a MULTI's when one of its parts is
 * the value; a CHOICE's, Yes/No's or typed answer's when it is the value. */
export function opensFollowUp(
  parent: Need,
  pick: readonly string[],
  whenValue: string,
): boolean {
  const kind = parent.walkthrough?.answerKind ?? "TEXT";
  if (kind === "MULTI") {
    return pick.some((part) => part.trim() === whenValue);
  }
  return pick.length === 1 && (pick[0] ?? "").trim() === whenValue;
}

/** Whether a question is shown in a topic's step: always, unless it is a follow-up whose
 * parent is hidden or no longer opens it. The parent's answer is its pick when the step asks
 * it (the proposal or the answer on record when untouched), else its answer on record (none
 * when not on record). A parent the review does not hold leaves the server's listing as it
 * is. `needs` is where a parent outside the step is looked up (the review's questions). */
export function followUpShown(
  need: Need,
  asked: readonly Need[],
  picks: Readonly<Record<string, readonly string[]>>,
  needs: readonly Need[] = asked,
  seen: readonly string[] = [],
): boolean {
  const wt = need.walkthrough;
  if (wt === undefined || wt.whenKey === "" || seen.includes(need.key)) {
    // Not a follow-up, or a loop the server never sends: its listing stands.
    return true;
  }
  const inStep = asked.find((each) => each.key === wt.whenKey);
  const parent = inStep ?? needs.find((each) => each.key === wt.whenKey);
  if (parent === undefined) {
    return true;
  }
  const pick =
    inStep !== undefined
      ? (picks[parent.key] ?? proposedPick(parent))
      : parent.status === "CONFIRMED"
        ? proposedPick(parent)
        : [];
  return (
    opensFollowUp(parent, pick, wt.whenValue) &&
    followUpShown(parent, asked, picks, needs, [...seen, need.key])
  );
}

/** The questions a topic's step shows now, in its order: those asked, less the follow-ups
 * their parent's pick no longer opens. */
export function topicShown(
  asked: readonly Need[],
  picks: Readonly<Record<string, readonly string[]>>,
  needs: readonly Need[] = asked,
): Need[] {
  return asked.filter((need) => followUpShown(need, asked, picks, needs));
}

/** How many required questions shown in a topic's step are still unanswered there. */
export function topicLeft(
  asked: readonly Need[],
  picks: Readonly<Record<string, readonly string[]>>,
  needs: readonly Need[] = asked,
): number {
  return topicShown(asked, picks, needs).filter(
    (need) =>
      need.required &&
      need.status !== "CONFIRMED" &&
      pickedValue(need, picks[need.key] ?? proposedPick(need)) === "",
  ).length;
}

/** What holds a topic's save back: the first question shown whose Other answer cannot be
 * saved, and why; null when nothing does. A hidden follow-up never holds it back. */
export function topicBlocked(
  asked: readonly Need[],
  picks: Readonly<Record<string, readonly string[]>>,
  needs: readonly Need[] = asked,
): { key: string; problem: string } | null {
  for (const need of topicShown(asked, picks, needs)) {
    const problem = pickProblem(need, picks[need.key] ?? proposedPick(need));
    if (problem !== "") {
      return { key: need.key, problem };
    }
  }
  return null;
}

/** One topic's save: every question shown and answered, a proposal kept as it was included
 * (saving confirms it), and an answer on record left out unless it changed. A follow-up its
 * parent's pick no longer opens is left out, typed or proposed. */
export function topicSave(
  asked: readonly Need[],
  picks: Readonly<Record<string, readonly string[]>>,
  needs: readonly Need[] = asked,
): Record<string, WalkthroughAnswer> {
  const answers: Record<string, WalkthroughAnswer> = {};
  for (const need of topicShown(asked, picks, needs)) {
    const value = pickedValue(need, picks[need.key] ?? proposedPick(need));
    if (value === "" || (need.status === "CONFIRMED" && value === need.value)) {
      continue;
    }
    answers[need.key] = { value, not_applicable: false };
  }
  return answers;
}

/** After a topic's answers are saved and the review read again: whether the person stays on
 * the step (a required question is still open there: a follow-up the answers raised, or
 * one left unanswered), and what the planner says. */
export function afterTopicSave(
  shown: readonly string[],
  review: Review,
  topic: WalkthroughTopic,
): { stay: boolean; note: string } {
  const open = topicQuestions(review, topic).filter(
    (need) => need.required && need.status !== "CONFIRMED",
  );
  if (open.length === 0) {
    return { stay: false, note: "" };
  }
  const raised = open.filter((need) => !shown.includes(need.key)).length;
  return {
    stay: true,
    note:
      raised > 0
        ? `Your answers raised ${raised} follow-up ${raised === 1 ? "question" : "questions"}.`
        : `${open.length} required ${open.length === 1 ? "question here still needs" : "questions here still need"} an answer.`,
  };
}

/** The walkthrough answers on record, by topic, for the record's fold: the topics and the
 * questions within each in the server's order. */
export function walkthroughRecord(
  review: Review,
): Array<{ topic: WalkthroughTopic; label: string; needs: Need[] }> {
  return walkthroughTopics(review)
    .map((topic) => ({
      topic,
      label: topicName(review, topic),
      needs: topicQuestions(review, topic).filter(
        (need) => need.status === "CONFIRMED",
      ),
    }))
    .filter((group) => group.needs.length > 0);
}

/** What an answer changes, in words, beside why it is asked. */
export function drivesLine(drives: readonly Drive[]): string {
  const words: Record<Drive, string> = {
    EVIDENCE: "the evidence requested",
    ATTRIBUTES: "the attributes",
    CRITERIA: "the test criteria",
    SAMPLING: "the sample",
    SCOPE: "the scope",
  };
  const list = DRIVES.filter((each) => drives.includes(each)).map(
    (each) => words[each],
  );
  if (list.length === 0) {
    return "";
  }
  const joined =
    list.length === 1
      ? list[0]
      : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  return `The answer shapes ${joined}.`;
}

/** The server's answer to a walkthrough save, read: the number saved and the number of
 * follow-ups it ignored (their parent was answered in the same save with an answer that does
 * not open them: a success, 12 November 2026), or what went wrong and how to recover. */
export function walkthroughOutcome(
  status: number,
  detail: string,
  body: unknown,
): { saved: number; ignored: number } | { problem: string } {
  if (status === 200) {
    const count = (name: "saved" | "ignored"): number => {
      const value =
        typeof body === "object" && body !== null
          ? (body as Record<string, unknown>)[name]
          : undefined;
      return typeof value === "number" && Number.isInteger(value) && value > 0
        ? value
        : 0;
    };
    return { saved: count("saved"), ignored: count("ignored") };
  }
  const reason = detail.trim().replace(/\.$/, "");
  if (status === 0) {
    return {
      problem:
        "The answers were not saved: the server did not answer in time. Try again.",
    };
  }
  if (status === 401 || status === 403) {
    return {
      problem:
        "The answers were not saved: you cannot change this control's understanding. Ask the engagement lead for access.",
    };
  }
  if (status === 409) {
    return {
      problem: `The answers were not saved${reason !== "" ? `: ${reason}` : ""}. The understanding changed meanwhile; it has been read again. Check the answers and save again.`,
    };
  }
  if (reason !== "") {
    return {
      problem: `The answers were not saved: ${reason}. Correct the answer and save again.`,
    };
  }
  return {
    problem: `The answers were not saved. Check that each answer is complete and under ${WALKTHROUGH_TEXT_MAX.toLocaleString("en-US")} characters, then save again.`,
  };
}

/** The quiet note after a save in which the server left follow-ups out; "" when none. */
export function ignoredNote(ignored: number): string {
  if (ignored <= 0) {
    return "";
  }
  return ignored === 1
    ? " 1 follow-up no longer applied and was left out."
    : ` ${ignored} follow-ups no longer applied and were left out.`;
}

/** The line under a topic's title: how many questions it asks, how many are optional, and
 * that a proposal is selected but not yet anyone's answer. */
export function topicHint(asked: readonly Need[], label: string): string {
  if (asked.length === 0) {
    return `Every question on ${label.toLowerCase()} is on record.`;
  }
  const optional = asked.filter((need) => !need.required).length;
  const proposed = asked.filter(
    (need) => need.status === "PROPOSED" && need.value !== "",
  ).length;
  const count = `${asked.length} ${asked.length === 1 ? "question" : "questions"}${
    optional === 0
      ? ""
      : optional === asked.length
        ? ", all optional"
        : `, ${optional} optional`
  }.`;
  const note =
    proposed === 0
      ? ""
      : proposed === 1
        ? " A proposed answer is selected: confirm it by saving, or change it."
        : " Proposed answers are selected: confirm them by saving, or change them.";
  return `${count}${note}`;
}
