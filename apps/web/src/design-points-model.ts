/**
 * The points of the D&I workpaper (docs/design-workpaper.md, section 3.9; product owner,
 * 16 November 2026: "Okay proceed" to the prototype brief-proto/place.png, and "Considered,
 * with reason"). There is no "Matters for the reviewer" section any more: each item that
 * waits on a person is a point the server assembles on each read, shown at its place in
 * the document (an attribute's row, a report's row or a file's line, or the head of
 * section 4), to the preparer only, and settled there: by its own action (it is then no
 * longer assembled) or by a consideration with a reason. A considered point is part of
 * the workpaper and everyone sees it. The agent's observations become the draft of the
 * message sent with the review request, never part of the workpaper.
 *
 * Pure: the body's parsing, where a point is shown, the counts and their words, the draft
 * message, and the two writes the page's route validates. The server decides: it refuses
 * the preparer's sign-off while a point is not settled, and a consideration that does not
 * match the point it read.
 */

import { CREDENTIAL } from "./workpaper-model.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A point's key: the SHA-256 of its kind and what it is about, cut to 32 hex. */
export const POINT_KEY = /^[0-9a-f]{32}$/;
/** An attribute's id, as the review notes' field keys accept it. */
const ATTRIBUTE_ID = /^[A-Za-z0-9-]{1,80}$/;

export const POINT_KINDS = [
  "STALE",
  "FINDING",
  "NOT_CONCLUDED",
  "NOT_RELIED",
  "CONFLICT",
  "HELD",
  "COMPLETENESS",
  "FOLLOW_UP",
] as const;
export type PointKind = (typeof POINT_KINDS)[number] | "OTHER";

export const SETTLE_ACTIONS = [
  "RELIABILITY",
  "TICKMARK",
  "RERUN",
  "FINDING",
  "CONSIDER",
] as const;
export type SettleAction = (typeof SETTLE_ACTIONS)[number];

export type PointPlace =
  | { at: "ATTRIBUTE"; attributeId: string }
  | { at: "FILE"; fileId: string }
  | { at: "REQUEST"; requirementId: string | null };

export type Consideration = {
  id: string;
  by: { id: string; name: string };
  at: string;
  reason: string;
};

export type Point = {
  key: string;
  kind: PointKind;
  text: string;
  refs: string[];
  place: PointPlace;
  /** The existing actions that settle it, CONSIDER always last. */
  settle: SettleAction[];
  considered: Consideration | null;
};

export type Observation = { text: string; refs: string[] };

/** The most this page reads: well above what the server assembles. */
export const POINT_LIMITS = {
  points: 120,
  observations: 20,
} as const;

/** A reason: 10 to 1,000 characters, the person's own. */
export const REASON_MIN = 10;
export const REASON_MAX = 1000;
/** The review request's message (section 3.8): what the draft fits in. */
export const DRAFT_MAX = 1000;

type Raw = Record<string, unknown>;

const isRaw = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const raws = (value: unknown): Raw[] =>
  Array.isArray(value) ? value.filter(isRaw) : [];

const line = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** A row's references: the ones the evidence index has, once each, in the row's order. */
function refsOf(value: unknown, known: ReadonlySet<string>): string[] {
  const found: string[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (typeof item === "string" && known.has(item) && !found.includes(item)) {
      found.push(item);
    }
  }
  return found;
}

/** Where the server says a point is. A place this page cannot read is the head of
 * section 4: an unsettled point is never left where nobody sees it. */
function placeOf(value: unknown): PointPlace {
  const place = isRaw(value) ? value : {};
  const attributeId = line(place.attribute_id, 80);
  const fileId = line(place.file_id, 40);
  const requirementId = line(place.requirement_id, 40);
  if (place.at === "ATTRIBUTE" && ATTRIBUTE_ID.test(attributeId)) {
    return { at: "ATTRIBUTE", attributeId };
  }
  if (place.at === "FILE" && UUID.test(fileId)) {
    return { at: "FILE", fileId };
  }
  return {
    at: "REQUEST",
    requirementId: UUID.test(requirementId) ? requirementId : null,
  };
}

/** The actions, each known one once, in the server's order, and CONSIDER always last
 * (it is always offered). */
function settleOf(value: unknown): SettleAction[] {
  const found: SettleAction[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    const action = SETTLE_ACTIONS.find((known) => known === item);
    if (
      action !== undefined &&
      action !== "CONSIDER" &&
      !found.includes(action)
    ) {
      found.push(action);
    }
  }
  return [...found, "CONSIDER"];
}

/** A standing consideration, or null. One that is not whole (no id, no person, no
 * reason) is not read as settling anything: the point is then shown as not settled, and
 * the server refuses a second one as changed. */
export function considerationOf(value: unknown): Consideration | null {
  if (!isRaw(value) || !isRaw(value.by)) {
    return null;
  }
  const id = line(value.id, 40);
  const byId = line(value.by.id, 40);
  const reason = line(value.reason, REASON_MAX);
  if (!UUID.test(id) || !UUID.test(byId) || reason === "") {
    return null;
  }
  return {
    id,
    by: { id: byId, name: line(value.by.name, 200) || "a team member" },
    at: line(value.at, 40),
    reason,
  };
}

/** The body's points: each with a key, a sentence and a place; once each by key. */
export function pointsOf(value: unknown, known: ReadonlySet<string>): Point[] {
  const points: Point[] = [];
  for (const item of raws(value)) {
    const key = line(item.key, 32);
    const text = line(item.text, 2000);
    if (
      !POINT_KEY.test(key) ||
      text === "" ||
      points.some((point) => point.key === key)
    ) {
      continue;
    }
    points.push({
      key,
      kind: POINT_KINDS.find((kind) => kind === item.kind) ?? "OTHER",
      text,
      refs: refsOf(item.refs, known),
      place: placeOf(item.place),
      settle: settleOf(item.settle),
      considered: considerationOf(item.considered),
    });
    if (points.length === POINT_LIMITS.points) {
      break;
    }
  }
  return points;
}

/** The agent's observations: in order, once each by their words, at most 20. */
export function observationsOf(
  value: unknown,
  known: ReadonlySet<string>,
): Observation[] {
  const found: Observation[] = [];
  for (const item of raws(value)) {
    const text = line(item.text, 2000);
    if (text === "" || found.some((each) => each.text === text)) {
      continue;
    }
    found.push({ text, refs: refsOf(item.refs, known) });
    if (found.length === POINT_LIMITS.observations) {
      break;
    }
  }
  return found;
}

/* Settled or not, and who sees it ------------------------------------------------------- */

/** The points not settled: no consideration stands for them. */
export function unsettled(points: readonly Point[]): Point[] {
  return points.filter((point) => point.considered === null);
}

export type PointFacts = {
  canSettle: boolean;
  /** The design workpaper's status as the views read it. */
  status: "DRAFT" | "PREPARED" | "OTHER" | null;
};

/**
 * How a point is shown (section 3.9, "In the page"):
 * - `considered`: a consideration stands. Everyone sees it, and the print.
 * - `decide`: not settled, and the viewer may settle it now (the preparer, on the draft):
 *   "Your decision." with the actions.
 * - `raised`: not settled, on a prepared workpaper (it appeared after the preparer signed,
 *   when the evidence or a check changed): everyone sees it as "Raised since the preparer
 *   signed", and the reviewer's sign-off says to return it.
 * - `hidden`: otherwise, and never on the printed copy.
 */
export function pointShown(
  point: Pick<Point, "considered">,
  facts: PointFacts,
  printed: boolean,
): "considered" | "decide" | "raised" | "hidden" {
  if (point.considered !== null) {
    return "considered";
  }
  if (printed) {
    return "hidden";
  }
  if (facts.canSettle) {
    return "decide";
  }
  return facts.status === "PREPARED" ? "raised" : "hidden";
}

/** The points not settled on a prepared workpaper: those the reviewer's sign-off waits on. */
export function raisedSinceSigned(
  points: readonly Point[],
  status: PointFacts["status"],
): number {
  return status === "PREPARED" ? unsettled(points).length : 0;
}

/* Where a point is shown --------------------------------------------------------------- */

/** The document's rows a point can be placed under, as the views read them. */
export type PlaceFacts = {
  attributes: ReadonlyArray<{ id: string }>;
  reports: ReadonlyArray<{ ref: string }>;
  evidence: ReadonlyArray<{ ref: string; fileId: string }>;
};

export type Shown =
  | { where: "attribute"; attributeId: string }
  | { where: "report"; index: number }
  | { where: "evidence"; ref: string }
  | { where: "head" };

/**
 * Where the document shows a point: an `ATTRIBUTE` point under its row in section 4; a
 * `FILE` point under the first section 5 row naming the file, else under its line in
 * "Tickmarks and evidence"; a `REQUEST` point at the head of section 4. A row this read
 * does not have puts it at the head of section 4, so it is never lost.
 */
export function shownAt(point: Pick<Point, "place">, paper: PlaceFacts): Shown {
  const { place } = point;
  if (place.at === "ATTRIBUTE") {
    return paper.attributes.some((item) => item.id === place.attributeId)
      ? { where: "attribute", attributeId: place.attributeId }
      : { where: "head" };
  }
  if (place.at === "FILE") {
    const entry = paper.evidence.find((item) => item.fileId === place.fileId);
    if (entry === undefined) {
      return { where: "head" };
    }
    const index = paper.reports.findIndex((item) => item.ref === entry.ref);
    return index >= 0
      ? { where: "report", index }
      : { where: "evidence", ref: entry.ref };
  }
  return { where: "head" };
}

/** The points shown at one place, in the server's order. */
export function pointsAt(
  points: readonly Point[],
  paper: PlaceFacts,
  wanted: Shown,
): Point[] {
  return points.filter((point) => {
    const at = shownAt(point, paper);
    if (at.where !== wanted.where) {
      return false;
    }
    switch (at.where) {
      case "attribute":
        return (
          wanted.where === "attribute" && wanted.attributeId === at.attributeId
        );
      case "report":
        return wanted.where === "report" && wanted.index === at.index;
      case "evidence":
        return wanted.where === "evidence" && wanted.ref === at.ref;
      default:
        return true;
    }
  });
}

/** The name of the place, for the sign-off's list: "Section 4", "Section 5", or
 * "Tickmarks and evidence". */
export function placeName(shown: Shown): string {
  return shown.where === "report"
    ? "Section 5"
    : shown.where === "evidence"
      ? "Tickmarks and evidence"
      : "Section 4";
}

/** The review notes' section of the place (docs/workpaper-review.md, section 3): 4, 5,
 * or 7 for the unnumbered "Tickmarks and evidence" after the Conclusion. */
export function placeSection(shown: Shown): number {
  return shown.where === "report" ? 5 : shown.where === "evidence" ? 7 : 4;
}

/** The page's anchor of a point at its place. */
export function pointAnchor(key: string): string {
  return `dw-point-${key}`;
}

/** The review notes' field of a considered point. */
export function pointField(key: string): string {
  return `points.${key}`;
}

/* Words ----------------------------------------------------------------------------- */

export const YOUR_DECISION = "Your decision.";
export const RAISED_SINCE = "Raised since the preparer signed.";
export const CONSIDERED = "Considered…";
export const CONSIDER_LABEL = "Why it is settled without another action";
export const RECORD = "Record";
export const WITHDRAW = "Withdraw";
export const RECORDED_READING = "Recorded. Reading the workpaper again…";
export const WITHDRAWN_READING = "Withdrawn. Reading the workpaper again…";
export const THE_POINT = "The point";
export const DRAFTED_LABEL =
  "Drafted from the agent's observations · edit before sending";
export const CLEAR_DRAFT = "Clear the note";

/** Where those actions are done, for a screen reader: the step's name spelled out. */
export const SETTLE_WHERE = "in the design and implementation evidence step";

/** The words of each existing action, where it is done (D&I Evidence: the request's
 * check, its files and its findings). */
export const SETTLE_WORDS: Readonly<
  Record<Exclude<SettleAction, "CONSIDER">, string>
> = {
  RELIABILITY: "Decide the file's reliability",
  TICKMARK: "Record a tickmark",
  RERUN: "Check the request again",
  FINDING: "Decide the finding",
};

/** "2 decisions before you sign."; "" for none. */
export function decisionsWords(count: number): string {
  return count <= 0
    ? ""
    : `${count} ${count === 1 ? "decision" : "decisions"} before you sign.`;
}

/** The reviewer's sign-off while points stand on a prepared workpaper. */
export function raisedWords(count: number): string {
  return count <= 0
    ? ""
    : count === 1
      ? "1 point was raised since the preparer signed: return it to the preparer."
      : `${count} points were raised since the preparer signed: return it to the preparer.`;
}

/** The first words of a sentence, cut at a word, with an ellipsis where cut. */
export function shortWords(text: string, most = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= most) {
    return flat;
  }
  const cut = flat.slice(0, most);
  const space = cut.lastIndexOf(" ");
  return `${(space > most / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}…`;
}

const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

/** "16 Nov", in the viewer's own time; as sent where it is not a date. */
export function dayMonth(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : DAY.format(time);
}

/** "Considered by Dana Lee, Nov 16: <reason>" (the sign-off's own date style). */
export function consideredLine(considered: Consideration): string {
  const when = considered.at === "" ? "" : `, ${dayMonth(considered.at)}`;
  return `Considered by ${considered.by.name}${when}: ${considered.reason}`;
}

/** The sign-off's list: each point not settled, short, with where it is. */
export function decisionsList(
  points: readonly Point[],
  paper: PlaceFacts,
): Array<{ key: string; words: string; place: string; anchor: string }> {
  return unsettled(points).map((point) => ({
    key: point.key,
    words: shortWords(point.text),
    place: placeName(shownAt(point, paper)),
    anchor: pointAnchor(point.key),
  }));
}

/** A reason's problem before the press, or null where it may be sent. */
export function reasonProblem(text: string): string | null {
  const said = text.trim();
  if (said.length < REASON_MIN) {
    return `Say why, in at least ${REASON_MIN} characters.`;
  }
  if (said.length > REASON_MAX) {
    return `At most ${REASON_MAX} characters.`;
  }
  return CREDENTIAL.test(said) ? "It reads as a credential." : null;
}

/* The message drafted from the agent's observations ------------------------------------- */

/**
 * The draft of the message to the reviewer (section 3.9): the agent's observations, one
 * per line, within the message's 1,000 characters, cut at a whole line (a line that does
 * not fit is left out, with those after it). Where the first alone does not fit, it is
 * cut at a word. "" where there is none.
 */
export function draftMessage(
  observations: readonly Pick<Observation, "text">[],
  most = DRAFT_MAX,
): string {
  const lines = observations
    .map((item) => item.text.replace(/\s+/g, " ").trim())
    .filter((text) => text !== "");
  const kept: string[] = [];
  let length = 0;
  for (const text of lines) {
    const added = kept.length === 0 ? text.length : length + 1 + text.length;
    if (added > most) {
      break;
    }
    kept.push(text);
    length = added;
  }
  if (kept.length === 0 && lines[0] !== undefined) {
    return shortWords(lines[0], most - 1);
  }
  return kept.join("\n");
}

/* The writes ------------------------------------------------------------------------- */

type Ids = { organizationId: string; projectId: string; controlId: string };

export type PointIntent = "consider" | "withdraw";

export const POINT_ROUTES: Readonly<Record<PointIntent, string>> = {
  consider: "/workspace/design-conclusions/points/consider",
  withdraw: "/workspace/design-conclusions/points/withdraw",
};

export function considerRequest(
  ids: Ids,
  key: string,
  reason: string,
  workpaperVersion: number,
): Record<string, unknown> {
  return {
    organization_id: ids.organizationId,
    project_id: ids.projectId,
    control_id: ids.controlId,
    key,
    reason,
    workpaper_version: workpaperVersion,
  };
}

export function withdrawRequest(
  ids: Ids,
  key: string,
  considerationId: string,
  workpaperVersion: number,
): Record<string, unknown> {
  return {
    organization_id: ids.organizationId,
    project_id: ids.projectId,
    control_id: ids.controlId,
    key,
    consideration_id: considerationId,
    workpaper_version: workpaperVersion,
  };
}

export type PointWrite =
  | { error: "invalid" }
  | { intent: PointIntent; path: string; body: Record<string, unknown> };

/**
 * The route's side of each write: three ids, the point's key, a workpaper version that is
 * a whole number of at least 1, and a reason of 10 to 1,000 characters that does not
 * read as a credential (consider) or the consideration's id (withdraw). Anything else is
 * refused before the API sees it; the API decides who may and whether the point is still
 * the one read.
 */
export function pointWrite(
  intent: PointIntent,
  fields: Record<string, unknown>,
): PointWrite {
  const { organization_id, project_id, control_id, key } = fields;
  const version = fields.workpaper_version;
  if (
    typeof organization_id !== "string" ||
    typeof project_id !== "string" ||
    typeof control_id !== "string" ||
    typeof key !== "string" ||
    !UUID.test(organization_id) ||
    !UUID.test(project_id) ||
    !UUID.test(control_id) ||
    !POINT_KEY.test(key) ||
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    return { error: "invalid" };
  }
  const base = `/organizations/${organization_id}/projects/${project_id}/design-conclusions/${control_id}/points/${key}`;
  if (intent === "consider") {
    const reason = fields.reason;
    if (typeof reason !== "string" || reasonProblem(reason) !== null) {
      return { error: "invalid" };
    }
    return {
      intent,
      path: `${base}/consider`,
      body: { reason: reason.trim(), workpaper_version: version },
    };
  }
  const id = fields.consideration_id;
  if (typeof id !== "string" || !UUID.test(id)) {
    return { error: "invalid" };
  }
  return {
    intent,
    path: `${base}/withdraw`,
    body: { consideration_id: id, workpaper_version: version },
  };
}

/** Whether an answer leaves the page's reading in doubt, so it is read again. */
export function pointRereads(status: number): boolean {
  return status === 409 || status === 0 || status >= 500;
}

const LEADS: Readonly<Record<PointIntent, string>> = {
  consider: "Not recorded",
  withdraw: "Not withdrawn",
};

/** Why a write was not taken, in one sentence, in the server's own words where it gives
 * them; "" where the server confirmed. */
export function pointRefusal(
  intent: PointIntent,
  status: number,
  detail: string,
): string {
  if (status === 200) {
    return "";
  }
  const said = detail
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/, "");
  const lead = LEADS[intent];
  if (status === 0 || status >= 500) {
    return `${intent === "consider" ? "The consideration may not have been recorded" : "The consideration may not have been withdrawn"}: the server's answer did not come back. Reading the workpaper again, to show what it holds.`;
  }
  if ((status === 409 || status === 403) && said !== "") {
    return `${lead}: ${said}.`;
  }
  if (status === 409) {
    return `${lead}: this point changed; read the workpaper again.`;
  }
  if (status === 401) {
    return `${lead}: your session has ended. Sign in again, then try again.`;
  }
  if (status === 403 || status === 404) {
    return `${lead}: you may not do this on this workpaper.`;
  }
  if (status === 422) {
    return `${lead}: say why, in ${REASON_MIN} to ${REASON_MAX} characters.`;
  }
  return `${lead}: the server did not take it. Try again.`;
}
