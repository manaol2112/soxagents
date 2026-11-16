/**
 * One D&I step: the preparer sends the design workpaper for review, the reviewer signs in
 * section 7 (docs/design-workpaper.md, section 3.8; product owner, 16 November 2026). Pure:
 * how the D&I conclusion's body names the review request, the last return, the reviewers
 * who may be chosen, and the viewer's list for Home; where the sign-off stands; the words
 * of each line; and the writes the page's routes validate before the API sees them. The
 * server is the authority: it refuses what this page has not seen, and its sentence is
 * shown.
 *
 * A body from before 3.8 carries none of these fields (`reviewFlowOf` is false): the
 * preparer signs with the existing prepare and the reviewer signs without a request, as
 * before.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREDENTIAL =
  /(?:api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|password\s*[:=]|private[_-]?key)/i;

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, most: number) =>
  typeof value === "string" ? value.trim().slice(0, most) : "";
const at = (value: unknown) =>
  typeof value === "string" ? value.slice(0, 40) : "";

/** A person the server names: who a request is with, who sent it, who returned it. */
export type Person = { id: string; name: string };

/** The review request that stands for the control (`review_request`). The message is the
 * preparer's own text, shown as text. */
export type ReviewRequest = {
  id: string;
  reviewer: Person;
  sentBy: Person;
  sentAt: string;
  message: string;
  remindedAt: string | null;
  /** The prepared version it was sent at. */
  version: number | null;
};

/** The reviewer's last return of the workpaper to its preparer (`last_return`). */
export type LastReturn = { by: Person; at: string; reason: string };

/** One person the preparer may send the workpaper to (`reviewers`). Someone not offered
 * (the preparer, the person who recorded the conclusion) is shown with the reason. */
export type ReviewerOption = {
  id: string;
  name: string;
  /** The engagement role, where the server names it; "" otherwise. */
  role: string;
  /** How many D&I workpapers wait for them. */
  waiting: number;
  offered: boolean;
  whyNot: string;
};

/** A person as the server sends it; null where it has no id. A name the server does not
 * give reads "A team member", never an id. */
export function personOf(value: unknown): Person | null {
  if (!isRaw(value) || typeof value.id !== "string" || !UUID.test(value.id)) {
    return null;
  }
  return { id: value.id, name: text(value.name, 200) || "A team member" };
}

export function reviewRequestOf(value: unknown): ReviewRequest | null {
  if (!isRaw(value) || typeof value.id !== "string" || !UUID.test(value.id)) {
    return null;
  }
  const reviewer = personOf(value.reviewer);
  const sentBy = personOf(value.sent_by);
  if (reviewer === null || sentBy === null) {
    return null;
  }
  return {
    id: value.id,
    reviewer,
    sentBy,
    sentAt: at(value.sent_at),
    message: text(value.message, 1000),
    remindedAt:
      typeof value.reminded_at === "string" && value.reminded_at !== ""
        ? at(value.reminded_at)
        : null,
    version:
      typeof value.version === "number" && Number.isInteger(value.version)
        ? value.version
        : null,
  };
}

export function lastReturnOf(value: unknown): LastReturn | null {
  if (!isRaw(value)) {
    return null;
  }
  const by = personOf(value.by);
  if (by === null) {
    return null;
  }
  return { by, at: at(value.at), reason: text(value.reason, 1000) };
}

export function reviewersOf(value: unknown): ReviewerOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const out: ReviewerOption[] = [];
  for (const item of value) {
    const person = personOf(item);
    if (person === null || seen.has(person.id) || !isRaw(item)) {
      continue;
    }
    seen.add(person.id);
    const waiting =
      typeof item.waiting === "number" && Number.isInteger(item.waiting)
        ? Math.max(0, item.waiting)
        : 0;
    out.push({
      ...person,
      role: text(item.role, 60),
      waiting,
      // Offered only where the server says so: never by default.
      offered: item.offered === true,
      whyNot: text(item.why_not, 300),
    });
  }
  return out.slice(0, 200);
}

/** Whether the body follows section 3.8: it names the review request (or that none
 * stands) or the reviewers. */
export function reviewFlowOf(value: unknown): boolean {
  return isRaw(value) && ("review_request" in value || "reviewers" in value);
}

/** The reviewer the picker starts on: the server's default, where it is one of those
 * offered; else nobody (a choice is needed). */
export function startingReviewer(
  reviewers: readonly ReviewerOption[],
  defaultId: string | null,
): string | null {
  return (
    reviewers.find((item) => item.offered && item.id === defaultId)?.id ?? null
  );
}

export function defaultReviewerOf(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

/* Where the sign-off stands ------------------------------------------------------------ */

/**
 * The five states of the prototype (scratchpad send-proto/send-for-review.png), and one for
 * a workpaper prepared with no request standing (prepared before 3.8, or by the existing
 * prepare): the reviewer may still sign it, as before.
 */
export type SignOffStage =
  | "unsigned"
  | "sent"
  | "returned"
  | "prepared"
  | "signed";

export function signOffStage(facts: {
  /** The design workpaper's status, as the views read it. */
  paperStatus: "DRAFT" | "PREPARED" | "OTHER";
  signedOff: boolean;
  request: ReviewRequest | null;
  lastReturn: LastReturn | null;
}): SignOffStage {
  if (facts.signedOff) {
    return "signed";
  }
  if (facts.paperStatus === "PREPARED") {
    return facts.request !== null ? "sent" : "prepared";
  }
  return facts.lastReturn !== null && facts.request === null
    ? "returned"
    : "unsigned";
}

/** Who the viewer is to a request that stands. Only the reviewer it names signs or
 * returns it; another reviewer is told who it is with. Where the page does not know who
 * is reading, the server's `can_sign` names the reviewer. */
export type ReviewSide = "reviewer" | "other_reviewer" | "preparer" | "reader";

export function reviewSide(facts: {
  request: ReviewRequest;
  viewerId: string | null;
  viewerPrepared: boolean;
  viewerIsReviewer: boolean;
  canSign: boolean;
}): ReviewSide {
  const named =
    facts.viewerId !== null
      ? facts.viewerId === facts.request.reviewer.id
      : facts.canSign;
  if (named) {
    return "reviewer";
  }
  if (
    facts.viewerPrepared ||
    (facts.viewerId !== null && facts.viewerId === facts.request.sentBy.id)
  ) {
    return "preparer";
  }
  return facts.viewerIsReviewer ? "other_reviewer" : "reader";
}

/** What the preparer's press is in section 7: "send" (section 3.8, a reviewer is chosen),
 * "prepare" (the existing prepare, for a body that was read and is from before 3.8), or
 * "unread" where the D&I conclusion could not be read: nothing is prepared then, since a
 * prepare without a request would skip "a reviewer must be chosen to sign". */
export type PreparerPress = "send" | "prepare" | "unread";

export function preparerPressOf(
  conclusion: { reviewFlow: boolean } | null,
): PreparerPress {
  if (conclusion === null) {
    return "unread";
  }
  return conclusion.reviewFlow ? "send" : "prepare";
}

/** Whether the preparer's row offers its actions. A reviewer who did not prepare a
 * PREPARED workpaper is not offered "Reopen to change" (they return it, or reopen their
 * own sign-off). On a draft nobody has prepared it yet (`viewer_prepared` is false for
 * all), so the server's `can_edit` alone decides: a member the server counts as a
 * reviewer (every member where independence is off) may still sign and send it. */
export function preparerRowMayAct(facts: {
  preparerMayAct: boolean;
  paperStatus: "DRAFT" | "PREPARED" | "OTHER";
  reviewFlow: boolean;
  viewerIsReviewer: boolean;
  viewerPrepared: boolean;
}): boolean {
  const reviewerOnly =
    facts.reviewFlow &&
    facts.paperStatus === "PREPARED" &&
    facts.viewerIsReviewer &&
    !facts.viewerPrepared;
  return facts.preparerMayAct && !reviewerOnly;
}

/** Who is offered Change reviewer and Remind: the rule the server applies
 * (`design_review_requests.may_manage`): the person who sent the request, the
 * workpaper's preparer, or the engagement lead. The server's own `can_manage_request`
 * decides where the body carries it; otherwise the page offers them to the sender and
 * the preparer only (it cannot tell a lead), and never to a viewer who may not act. */
export function mayManageRequest(facts: {
  request: ReviewRequest;
  viewerId: string | null;
  viewerPrepared: boolean;
  canManage: boolean | null;
  canAct: boolean;
}): boolean {
  if (!facts.canAct) {
    return false;
  }
  if (facts.canManage !== null) {
    return facts.canManage;
  }
  return (
    facts.viewerPrepared ||
    (facts.viewerId !== null && facts.viewerId === facts.request.sentBy.id)
  );
}

/* The words ---------------------------------------------------------------------------- */

export const SIGN_AND_SEND = "Sign and send for review";
export const SIGN_AND_SEND_AGAIN = "Sign and send again";
export const SEND_TO = "Send for review to";
export const MESSAGE_LABEL = "Message to the reviewer (optional)";
export const CHOOSE_REVIEWER = "Choose a reviewer";
export const NEEDS_REVIEWER = "Choose who reviews it.";
export const NO_REVIEWER =
  "No one on the engagement can review it yet: a member with the reviewer role is needed.";
export const CHANGE_REVIEWER = "Change reviewer";
export const REMIND = "Remind";
export const RETURN_TO_PREPARER = "Return to preparer";
export const RETURN_LABEL = "Why it goes back to the preparer";
export const SIGNOFF_NOTE = "Sign-off note (optional)";
export const OE_CLEARED = "OE is cleared to start.";
export const OE_NOT_PERFORMED =
  "OE is not performed: the control concludes not effective on the design deficiency.";
export const URGENT_HOLD =
  "Urgent review notes hold the sign-off: clear or dismiss them first.";
export const SENT_READING = "Sent for review. Reading the workpaper again…";
export const SIGNED_OFF_READING = "Signed off. Reading the workpaper again…";
export const RETURNED_READING =
  "Returned to the preparer. Reading the workpaper again…";
export const REASSIGNED_READING =
  "Reviewer changed. Reading the workpaper again…";
export const REMINDED = "Reminder sent in the app.";

/** A message or a reason, in characters, as the server bounds it. */
export const MESSAGE_MAX = 1000;
export const RETURN_MIN = 10;
export const RETURN_MAX = 1000;

/** "Riley" of "Riley Park": how the button's hint and the returned line name them. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/** "3 workpapers waiting"; "" where none wait. */
export function waitingWords(waiting: number): string {
  if (waiting <= 0) {
    return "";
  }
  return `${waiting} ${waiting === 1 ? "workpaper" : "workpapers"} waiting`;
}

/** The second line of a person in the picker: "Reviewer · 3 workpapers waiting", or why
 * they are not offered. */
export function reviewerDetail(option: ReviewerOption): string {
  if (!option.offered) {
    return option.whyNot || "Not offered for this workpaper";
  }
  return [option.role, waitingWords(option.waiting)]
    .filter((part) => part !== "")
    .join(" · ");
}

/** The words of the conclusion beside a date, for "· when". Never an empty part. */
const joined = (parts: readonly string[]) =>
  parts.filter((part) => part.trim() !== "").join(" · ");

/** "with Riley Park · sent Nov 16, 2:10 PM". */
export function inReviewLine(
  request: ReviewRequest,
  when: (at: string) => string,
): string {
  return joined([
    `with ${request.reviewer.name}`,
    request.sentAt === "" ? "" : `sent ${when(request.sentAt)}`,
  ]);
}

/** "sent to you Nov 16", for the reviewer; "sent to you Nov 16 · Reminded Nov 17" once
 * the preparer reminded them (section 3.8: Remind is an in-app notice to the reviewer). */
export function sentToYouLine(
  request: ReviewRequest,
  when: (at: string) => string,
): string {
  return joined([
    request.sentAt === ""
      ? "sent to you"
      : `sent to you ${when(request.sentAt)}`,
    reminderWords(request.remindedAt, when),
  ]);
}

/** "Reminded Nov 17", what the reviewer reads of the last reminder; "" where none. */
export function reminderWords(
  remindedAt: string | null,
  when: (at: string) => string,
): string {
  return remindedAt === null || remindedAt === ""
    ? ""
    : `Reminded ${when(remindedAt)}`;
}

/** "returned by Riley Park · Nov 17". */
export function returnedLine(
  back: LastReturn,
  when: (at: string) => string,
): string {
  return joined([
    `returned by ${back.by.name}`,
    back.at === "" ? "" : when(back.at),
  ]);
}

/** Under the returned reason: what the preparer does, and who reviews it next. */
export function returnedNext(reviewer: string | null): string {
  return reviewer === null || reviewer === ""
    ? "The workpaper is a draft again. Fix it, then sign and send again."
    : `The workpaper is a draft again. Fix it, then sign and send again; ${firstName(reviewer)} stays the reviewer.`;
}

/** Under "Sign and send for review": where it goes. */
export function sendHint(reviewer: string | null): string {
  return reviewer === null || reviewer === ""
    ? "Choose who reviews it"
    : `${firstName(reviewer)} gets it in their review list`;
}

/** "2 open · 1 urgent"; "none" where no note is open. */
export function notesWords(open: number, urgent: number): string {
  return open <= 0 ? "none" : `${open} open · ${urgent} urgent`;
}

/** "none", or "1 logged", "2 logged". */
export function countWords(count: number, word = "logged"): string {
  return count <= 0 ? "none" : `${count} ${word}`;
}

/** At most one reminder an hour (section 3.8): how many minutes until the next may be
 * sent; 0 where it may be sent now. The clock is given by the caller. */
export const REMIND_EVERY_MS = 60 * 60 * 1000;
export function remindWaitMinutes(request: ReviewRequest, now: number): number {
  if (request.remindedAt === null) {
    return 0;
  }
  const last = Date.parse(request.remindedAt);
  if (Number.isNaN(last)) {
    return 0;
  }
  const left = last + REMIND_EVERY_MS - now;
  return left <= 0 ? 0 : Math.ceil(left / 60000);
}

/** "Reminded Nov 16 · the next in 40 minutes". */
export function remindedLine(
  request: ReviewRequest,
  now: number,
  when: (at: string) => string,
): string {
  if (request.remindedAt === null) {
    return "";
  }
  const wait = remindWaitMinutes(request, now);
  return joined([
    `Reminded ${when(request.remindedAt)}`,
    wait > 0 ? `the next in ${wait} ${wait === 1 ? "minute" : "minutes"}` : "",
  ]);
}

/* The D&I step's status on the workflow (section 3.8) --------------------------------- */

export const STEP_DRAFT = "Draft";
export const STEP_RETURNED = "Returned to the preparer";
export const STEP_OUT_OF_DATE = "Sign-off out of date";

export function inReviewStatus(reviewer: string): string {
  return `Prepared, in review with ${reviewer.trim() || "a reviewer"}`;
}

export function signedOffStatus(conclusion: string): string {
  return `Signed off: ${conclusion}`;
}

/* The writes --------------------------------------------------------------------------- */

export type ReviewIntent = "send" | "reviewer" | "remind" | "return";

type Ids = { organizationId: string; projectId: string; controlId: string };

/** The JSON the page posts to its route for each write (`/workspace/design-conclusions/…`). */
export const REVIEW_ROUTES: Readonly<Record<ReviewIntent, string>> = {
  send: "/workspace/design-conclusions/send-for-review",
  reviewer: "/workspace/design-conclusions/review-request/reviewer",
  remind: "/workspace/design-conclusions/review-request/remind",
  return: "/workspace/design-conclusions/return",
};

export function sendRequest(
  ids: Ids,
  workpaperVersion: number,
  reviewerId: string,
  message: string,
  prepareNote = "",
): Record<string, unknown> {
  return {
    organization_id: ids.organizationId,
    project_id: ids.projectId,
    control_id: ids.controlId,
    workpaper_version: workpaperVersion,
    reviewer_id: reviewerId,
    message,
    prepare_note: prepareNote,
  };
}

export function reviewerRequest(
  ids: Ids,
  requestId: string,
  reviewerId: string,
): Record<string, unknown> {
  return {
    organization_id: ids.organizationId,
    project_id: ids.projectId,
    control_id: ids.controlId,
    request_id: requestId,
    reviewer_id: reviewerId,
  };
}

export function remindRequest(
  ids: Ids,
  requestId: string,
): Record<string, unknown> {
  return {
    organization_id: ids.organizationId,
    project_id: ids.projectId,
    control_id: ids.controlId,
    request_id: requestId,
  };
}

export function returnRequest(
  ids: Ids,
  requestId: string,
  reason: string,
): Record<string, unknown> {
  return {
    organization_id: ids.organizationId,
    project_id: ids.projectId,
    control_id: ids.controlId,
    request_id: requestId,
    reason,
  };
}

export type ReviewWrite =
  | { error: "invalid" }
  | { intent: ReviewIntent; path: string; body: Record<string, unknown> };

const ownText = (value: unknown, most: number): string | null => {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string") {
    return null;
  }
  const said = value.trim();
  return said.length > most || CREDENTIAL.test(said) ? null : said;
};

/**
 * The route's side of each write: three ids, then only the fields the contract names,
 * each checked: a version that is a whole number of at least 1, ids that are ids, a
 * message and a prepare note within their limit that do not read as a credential, a
 * reason of 10 to 1,000 characters. Anything else is refused before the API sees it.
 */
export function reviewWrite(
  intent: ReviewIntent,
  fields: Record<string, unknown>,
): ReviewWrite {
  const organization = fields.organization_id;
  const project = fields.project_id;
  const control = fields.control_id;
  if (
    typeof organization !== "string" ||
    typeof project !== "string" ||
    typeof control !== "string" ||
    !UUID.test(organization) ||
    !UUID.test(project) ||
    !UUID.test(control)
  ) {
    return { error: "invalid" };
  }
  const base = `/organizations/${organization}/projects/${project}/design-conclusions/${control}`;
  const id = (value: unknown): string | null =>
    typeof value === "string" && UUID.test(value) ? value : null;
  if (intent === "send") {
    const version = fields.workpaper_version;
    const reviewer = id(fields.reviewer_id);
    const message = ownText(fields.message, MESSAGE_MAX);
    const note = ownText(fields.prepare_note, 500);
    if (
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1 ||
      reviewer === null ||
      message === null ||
      note === null
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      path: `${base}/send-for-review`,
      body: {
        workpaper_version: version,
        reviewer_id: reviewer,
        message,
        prepare_note: note,
      },
    };
  }
  const request = id(fields.request_id);
  if (request === null) {
    return { error: "invalid" };
  }
  if (intent === "reviewer") {
    const reviewer = id(fields.reviewer_id);
    return reviewer === null
      ? { error: "invalid" }
      : {
          intent,
          path: `${base}/review-request/reviewer`,
          body: { request_id: request, reviewer_id: reviewer },
        };
  }
  if (intent === "remind") {
    return {
      intent,
      path: `${base}/review-request/remind`,
      body: { request_id: request },
    };
  }
  const reason = ownText(fields.reason, RETURN_MAX);
  if (reason === null || reason.length < RETURN_MIN) {
    return { error: "invalid" };
  }
  return {
    intent,
    path: `${base}/return`,
    body: { request_id: request, reason },
  };
}

/** Whether an answer leaves the page's reading in doubt, so it is read again: refused as
 * changed (409), or no answer, or a server error, after which it may have been taken. */
export function reviewRereads(status: number): boolean {
  return status === 409 || status === 0 || status >= 500;
}

const LEADS: Readonly<Record<ReviewIntent, string>> = {
  send: "Not signed or sent",
  reviewer: "The reviewer was not changed",
  remind: "No reminder sent",
  return: "Not returned",
};

const DOUBT: Readonly<Record<ReviewIntent, string>> = {
  send: "The sign-off and the request may not have been taken",
  reviewer: "The reviewer may not have been changed",
  remind: "The reminder may not have been sent",
  return: "The workpaper may not have been returned",
};

/** Why a write was not taken, in one sentence, in the server's own words where it gives
 * them; "" where the server confirmed. An answer that did not come back may have been
 * taken: it is said so, and the workpaper is read again. */
export function reviewRefusal(
  intent: ReviewIntent,
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
    return `${DOUBT[intent]}: the server's answer did not come back. Reading the workpaper again, to show what it holds.`;
  }
  if ((status === 409 || status === 403 || status === 429) && said !== "") {
    return `${lead}: ${said}.`;
  }
  if (status === 409) {
    return `${lead}: the workpaper changed meanwhile. It is being read again: try once it is shown.`;
  }
  if (status === 429) {
    return `${lead}: a reminder was sent less than an hour ago.`;
  }
  if (status === 401) {
    return `${lead}: your session has ended. Sign in again, then try again.`;
  }
  if (status === 402) {
    return `${lead}: the free trial has ended. Everything here stays to read.`;
  }
  if (status === 403 || status === 404) {
    return `${lead}: you may not do this on this workpaper.`;
  }
  if (status === 422) {
    return intent === "return"
      ? `${lead}: say why, in ${RETURN_MIN} to ${RETURN_MAX} characters.`
      : `${lead}: check the entry (a message of at most ${MESSAGE_MAX} characters that does not read as a credential).`;
  }
  return `${lead}: the server did not take it. Try again.`;
}

/* Home: "Waiting for your review" ------------------------------------------------------ */

/** One standing request for the viewer, as GET …/review-requests/mine lists it. */
export type WaitingReview = {
  id: string;
  controlId: string;
  reference: string;
  title: string;
  from: string;
  sentAt: string;
  /** The conclusion's words, where the server names one. */
  conclusion: string;
  urgent: number;
  /** The preparer's last reminder (Remind, section 3.8); null where none. */
  remindedAt: string | null;
};

const CONCLUSION_WORDS: Readonly<Record<string, string>> = {
  EFFECTIVE: "Effective",
  EXCEPTIONS_NOTED: "Exceptions noted",
  NOT_EFFECTIVE: "Not effective",
  NO_INSTANCE: "Design effective, no instance to walk through",
};

/**
 * The list as the API sends it (`design_review_requests.MineBody`: `{count, requests}`), or
 * an array, or an object holding it as `items`. The control is named flat as the server
 * sends it (`control_id`, `control_ref`, `control_title`; `control_reference` read too) or
 * as an object (`control: {id, reference, title}`); a conclusion this page does not know is
 * not said (never read as effective). An item with no id or no control is left out.
 */
export function parseWaitingReviews(value: unknown): WaitingReview[] | null {
  const list = Array.isArray(value)
    ? value
    : isRaw(value) && Array.isArray(value.items)
      ? value.items
      : isRaw(value) && Array.isArray(value.requests)
        ? value.requests
        : null;
  if (list === null) {
    return null;
  }
  const out: WaitingReview[] = [];
  for (const item of list) {
    if (!isRaw(item) || typeof item.id !== "string" || !UUID.test(item.id)) {
      continue;
    }
    const control = isRaw(item.control) ? item.control : {};
    const controlId =
      typeof item.control_id === "string" ? item.control_id : control.id;
    if (typeof controlId !== "string" || !UUID.test(controlId)) {
      continue;
    }
    const from = personOf(item.sent_by)?.name ?? text(item.sent_by_name, 200);
    const urgent =
      typeof item.urgent_notes === "number"
        ? item.urgent_notes
        : typeof item.urgent === "number"
          ? item.urgent
          : 0;
    out.push({
      id: item.id,
      controlId,
      reference: text(
        item.control_ref ?? item.control_reference ?? control.reference,
        80,
      ),
      title: text(item.control_title ?? control.title, 300),
      from,
      sentAt: at(item.sent_at),
      conclusion:
        typeof item.conclusion === "string"
          ? (CONCLUSION_WORDS[item.conclusion] ?? "")
          : "",
      urgent: Number.isInteger(urgent) && urgent > 0 ? urgent : 0,
      remindedAt:
        typeof item.reminded_at === "string" && item.reminded_at !== ""
          ? at(item.reminded_at)
          : null,
    });
  }
  return out.slice(0, 200);
}

/** "from Dana Lee · Nov 15 · Exceptions noted", or "· 1 urgent note" in place of the
 * conclusion where urgent notes hold the sign-off; "· Reminded Nov 16" last, where the
 * preparer reminded the reviewer. */
export function waitingLine(
  item: WaitingReview,
  when: (at: string) => string,
): string {
  return joined([
    item.from === "" ? "" : `from ${item.from}`,
    item.sentAt === "" ? "" : when(item.sentAt),
    item.urgent > 0
      ? `${item.urgent} urgent ${item.urgent === 1 ? "note" : "notes"}`
      : item.conclusion,
    reminderWords(item.remindedAt, when),
  ]);
}

/** How many requests wait for the viewer, for the count in the navigation: the server's
 * `count` (the total, which the list may carry only part of), else the list's length;
 * null where the body cannot be read. */
export function waitingCountOf(value: unknown): number | null {
  if (
    isRaw(value) &&
    typeof value.count === "number" &&
    Number.isInteger(value.count) &&
    value.count >= 0
  ) {
    return value.count;
  }
  const items = parseWaitingReviews(value);
  return items === null ? null : items.length;
}

/** "2 waiting for your review", the count's name for a screen reader. */
export function waitingCountLabel(count: number): string {
  return `${count} waiting for your review`;
}

/** The control's D&I Assessment at section 7, where the reviewer signs. */
export function waitingHref(
  item: WaitingReview,
  organizationId: string,
  projectId: string,
): string {
  const params = new URLSearchParams();
  params.set("organization", organizationId);
  params.set("project", projectId);
  params.set("section", "controls");
  params.set("control", item.controlId);
  params.set("step", "designassessment");
  return `/?${params.toString()}#di-conclusion`;
}

/** The query the Home list's route reads; null for anything but two ids. */
export function waitingPath(params: URLSearchParams): string | null {
  const organization = params.get("organization_id") ?? "";
  const project = params.get("project_id") ?? "";
  if (!UUID.test(organization) || !UUID.test(project)) {
    return null;
  }
  return `/organizations/${organization}/projects/${project}/review-requests/mine`;
}
