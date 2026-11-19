"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  type Attribute,
  NOT_KNOWN_NOTE_MAX,
  notKnownNoteProblem,
  PROCEED_REASON_MAX,
  proceedReasonProblem,
  type QuestionPass,
  type QuestionReview,
  type ReviewNotRun,
  type ReviewPoint,
  type ReviewProceeded,
  type ReviewRequest,
} from "./control-context-model";
import { UiIcon } from "./ui-icon";
import { characterCount } from "./understanding-once-model";
import {
  CHALLENGE_ACTION,
  CHALLENGE_NEED_LABEL,
  CHALLENGE_NOTE_HINT,
  CHALLENGE_NOTE_LABEL,
  CHALLENGE_REREAD,
  CHALLENGE_SEND,
  CHALLENGE_SENT,
  type ChallengeIntent,
  challengeLine,
  challengeProblem,
  type FollowIntent,
  factWords,
  failureDetail,
  hintParts,
  lastReady,
  markedParts,
  NOT_KNOWN_ACTION,
  NOT_KNOWN_HINT,
  NOT_KNOWN_LABEL,
  NOT_KNOWN_RECORD,
  type NotKnownTarget,
  notKnownProblem,
  notKnownWrite,
  notReviewedLine,
  OPEN_DOCUMENT,
  OPEN_NARRATIVE,
  offersChallenge,
  offersReviewAgain,
  PROCEED_HELD_SENT,
  PROCEED_REASON_HINT,
  PROCEED_REASON_HINT_PLAIN,
  PROCEED_REASON_LABEL,
  PROCEED_SENT,
  PROCEED_WITHOUT,
  pointName,
  proceededLine,
  REVIEW_AGAIN_FAILED,
  REVIEW_AGAIN_SENT,
  REVIEW_BY,
  REVIEW_CHECKING,
  REVIEW_CHOICE_ANCHOR,
  REVIEW_FAILED,
  REVIEW_HELD,
  REVIEW_HELD_CHOICE,
  REVIEW_HELD_NO_RUN,
  REVIEW_NONE,
  REVIEW_NOT_RUN,
  REVIEW_TITLE,
  type ReviewIntent,
  RUN_AGAIN,
  RUN_AGAIN_SENT,
  reviewAgainWords,
  reviewedLead,
  reviewProblem,
  reviewView,
  runsAgain,
  SUPPORT_TITLE,
  supportLine,
} from "./understanding-specialist-model";

type Ids = { organizationId: string; projectId: string; controlId: string };

/** One of the specialist's writes through the page's control-context route: the server's
 * status and sentence. Nothing is taken as done until the server confirms it (200, or 202 for
 * a review it accepted to run). */
async function post(
  ids: Ids,
  intent:
    | ReviewIntent
    | ChallengeIntent
    | FollowIntent
    | "issue-not-known"
    | "walkthrough-not-known"
    | "value-not-known",
  fields: Record<string, unknown> = {},
): Promise<{ status: number; detail: string }> {
  try {
    const response = await fetch("/workspace/control-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intent,
        organization_id: ids.organizationId,
        project_id: ids.projectId,
        control_id: ids.controlId,
        ...fields,
      }),
    });
    const body = (await response.json()) as {
      status?: unknown;
      detail?: unknown;
    };
    return {
      status: typeof body.status === "number" ? body.status : 0,
      detail: typeof body.detail === "string" ? body.detail : "",
    };
  } catch {
    return { status: 0, detail: "" };
  }
}

/**
 * "Review of the questions asked · IT audit specialist", under "The understanding" (B1k;
 * approved prototype brief-proto/ureview2.png): the review's paragraph in the narrative's own
 * serif, the matters it does not yet establish marked quietly; once it has nothing left to
 * ask, "Reviewed <when>: …". While the specialist reads: "Checking what else the agents
 * need…", the last good review still shown. A review that could not run before completion
 * is one line here; its two choices are on the course's last screen. Once complete, "Review
 * again" is a person's quiet request, whose findings become assumptions on the attributes,
 * never questions here; a request that could not run is said under the last good review,
 * with Run again. Without a model, one quiet line says the review was not run.
 */
export function QuestionReviewSection({
  ids,
  canAct,
  pass,
  review,
  completedAt,
  request = null,
  notRun = null,
  approved = [],
  documentsHref = null,
  onProcess = null,
  proceeded = null,
}: {
  ids: Ids;
  canAct: boolean;
  pass: QuestionPass | null;
  review: QuestionReview | null | undefined;
  completedAt: string | null;
  /** Where the documents are opened (D&I Evidence), and the process narrative's step: the
   * support's sources open there. */
  documentsHref?: string | null;
  onProcess?: (() => void) | null;
  /** After a person proceeded without the review of some units: said here as everywhere. */
  proceeded?: ReviewProceeded | null;
  /** A read a person asked for after completion, while it runs or once it could not run. */
  request?: ReviewRequest | null;
  notRun?: ReviewNotRun | null;
  /** The approved attributes, in the Attributes step's order: the "not reviewed" line names
   * them by their letters. */
  approved?: ReadonlyArray<Pick<Attribute, "id" | "code" | "definition">>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [sending, setSending] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  // The last READY review this visit saw: a body that carries only a newer read in flight
  // or failed never hides it.
  const [last, setLast] = useState<QuestionReview | null>(null);
  const kept = lastReady(last, review);
  useEffect(() => {
    if (kept !== last) {
      setLast(kept);
    }
  }, [kept, last]);
  const view = reviewView(pass, review, completedAt !== null, {
    request,
    notRun,
    last: kept,
  });
  // A review a person asked for after completion runs in the background: the page is read
  // again every 3 seconds in place until it lands (before completion, the course reads again
  // on its own). Each read replaces the page's data whole; an older one never lands after.
  const polling = view.state === "checking" && completedAt !== null;
  useEffect(() => {
    if (!polling) {
      return;
    }
    const timer = window.setInterval(() => router.refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [polling, router]);
  // A request's own line ("Review requested…") gives way once the read it asked for lands.
  useEffect(() => {
    if (!polling && said?.ok === true && view.state !== "checking") {
      const timer = window.setTimeout(() => setSaid(null), 6000);
      return () => window.clearTimeout(timer);
    }
  }, [polling, said, view.state]);
  if (view.state === "none") {
    return null;
  }
  const again = offersReviewAgain(completedAt, pass, canAct, view);

  async function reviewAgain() {
    if (sending) {
      return;
    }
    setSending(true);
    setSaid(null);
    const answer = await post(ids, "review-run");
    setSending(false);
    const problem = reviewProblem("review-run", answer.status, answer.detail);
    setSaid(
      problem === null
        ? { ok: true, text: REVIEW_AGAIN_SENT }
        : { ok: false, text: problem },
    );
    if (problem === null) {
      startTransition(() => router.refresh());
    }
  }

  // The paragraph shown: the ready one, or the last good one while a read runs.
  const shown =
    view.state === "ready"
      ? view.review
      : view.state === "checking"
        ? view.last
        : null;
  const settled =
    view.state === "ready" ? view.settled : (shown?.openQuestions ?? 1) === 0;
  // While the pass is HELD the line says only what was not reviewed: the choice at the end
  // of the course says what happens next (owner decision, 18 November 2026).
  // After a person proceeded without the review of some, the one sentence that says so
  // everywhere (with the reason, who and when); while the pass is HELD the line says only what
  // was not reviewed, as the choice at the end of the course says what happens next.
  const proceededSaid =
    completedAt !== null && proceeded !== null
      ? proceededLine(proceeded, approved, shown?.notReviewedItems ?? [])
      : null;
  // Once proceeded, the header's lede says it (design review, 19 November 2026: said three
  // times); the review keeps only Review again.
  const notReviewed =
    proceededSaid !== null || shown === null
      ? null
      : notReviewedLine(
          shown.notReviewed,
          approved,
          shown.notReviewedItems,
          pass === "HELD" && completedAt === null,
        );
  const failedAgain =
    view.state === "ready"
      ? view.againFailed
      : view.state === "unreviewed"
        ? view.failure
        : null;
  return (
    <section
      className="ur-review"
      aria-labelledby={`ur-review-${ids.controlId}`}
      aria-busy={view.state === "checking"}
    >
      <div className="ur-review-head">
        <span className="ur-review-tile" aria-hidden="true">
          IT
        </span>
        <p className="ur-label" id={`ur-review-${ids.controlId}`}>
          {REVIEW_TITLE} <span className="ur-review-by">· {REVIEW_BY}</span>
        </p>
      </div>
      {shown !== null ? (
        <p className="ur-review-text">
          {settled ? (
            <span className="ur-review-when" suppressHydrationWarning>
              {reviewedLead(shown.reviewedAt)}
            </span>
          ) : null}
          {markedParts(shown.narrative, settled ? [] : shown.marked).map(
            (part, at) =>
              part.marked ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: the paragraph's parts in order
                <mark key={at} className="ur-review-mark">
                  {part.text}
                </mark>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: the paragraph's parts in order
                <span key={at}>{part.text}</span>
              ),
          )}
        </p>
      ) : null}
      {view.state === "checking" ? (
        <p className="ur-review-quiet" role="status">
          <span className="spinner small" aria-hidden="true" />{" "}
          {REVIEW_CHECKING}
        </p>
      ) : view.state === "failed" ? (
        // One line here; the failure sentence and the two choices end the course.
        <p className="ur-review-quiet" role="status">
          {REVIEW_FAILED}.
        </p>
      ) : view.state === "notRun" ? (
        <p className="ur-review-quiet">{REVIEW_NOT_RUN}</p>
      ) : view.state === "unreviewed" && failedAgain === null ? (
        <p className="ur-review-quiet">{REVIEW_NONE}</p>
      ) : null}
      {notReviewed !== null ? (
        <p className="ur-review-quiet">{notReviewed}</p>
      ) : null}
      {shown !== null && (shown.points ?? []).length > 0 ? (
        <ReviewSupport
          ids={ids}
          canAct={canAct}
          reviewId={shown.id}
          points={shown.points ?? []}
          approved={approved}
          completed={completedAt !== null}
          documentsHref={documentsHref}
          onProcess={onProcess}
        />
      ) : null}
      {failedAgain !== null ? (
        <p className="ur-review-quiet" role="status">
          {REVIEW_AGAIN_FAILED}. {failedAgain}
        </p>
      ) : null}
      {again ? (
        <p className="ur-review-quiet">
          <button
            type="button"
            className="ur-skip"
            disabled={sending}
            onClick={() => void reviewAgain()}
          >
            {sending ? "Requesting…" : reviewAgainWords(view)}
          </button>
        </p>
      ) : null}
      {said !== null ? (
        <p
          className={said.ok ? "ur-review-quiet" : "cc-problem"}
          role={said.ok ? "status" : "alert"}
        >
          {said.text}
        </p>
      ) : null}
    </section>
  );
}

/**
 * The review could not run (B1l point 7): one line with the failure sentence, and two
 * choices. Run again asks the specialist once more; Proceed without it completes the
 * understanding by the rules, and the attribute agent's gaps become assumptions. Each shows
 * as done only once the server confirms it; the page then reads again in place.
 *
 * `held` (owner decision, 18 November 2026): the review was read but left attributes not
 * reviewed. The same two choices, said as such: the line names what was not reviewed;
 * Proceed without it takes a reason (kept in the audit trail with those attributes); Run
 * again is offered only while the review can still run (its budget of two reads).
 */
export function ReviewFailed({
  ids,
  canAct,
  failure,
  held = null,
  reasonNeeded = false,
}: {
  ids: Ids;
  canAct: boolean;
  failure: string;
  held?: { line: string; runAgain: boolean } | null;
  /** A read before left attributes not reviewed: a proceed takes a reason, also after a
   * later read could not run (ContextBody.review_reason_needed). */
  reasonNeeded?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const uid = useId();
  const [sending, setSending] = useState<ReviewIntent | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [reason, setReason] = useState("");
  const asksReason = held !== null || reasonNeeded;
  const reasonProblem = asksReason ? proceedReasonProblem(reason) : null;

  async function send(intent: ReviewIntent) {
    if (sending !== null) {
      return;
    }
    if (intent === "review-proceed" && reasonProblem !== null) {
      return;
    }
    setSending(intent);
    setSaid(null);
    const answer = await post(
      ids,
      intent,
      intent === "review-proceed" && asksReason
        ? { reason: reason.trim() }
        : {},
    );
    setSending(null);
    const problem = reviewProblem(intent, answer.status, answer.detail);
    setSaid(
      problem !== null
        ? { ok: false, text: problem }
        : {
            ok: true,
            text:
              intent === "review-proceed"
                ? asksReason
                  ? PROCEED_HELD_SENT
                  : PROCEED_SENT
                : RUN_AGAIN_SENT,
          },
    );
    if (problem === null) {
      startTransition(() => router.refresh());
    }
  }

  const done = said?.ok === true;
  const runAgain = runsAgain(held);
  return (
    <div className="ur-end ur-review-failed" id={REVIEW_CHOICE_ANCHOR}>
      <h3 className="ur-q">{held === null ? REVIEW_FAILED : REVIEW_HELD}</h3>
      <p className="ur-hint" role="status">
        {held === null
          ? failureDetail(failure)
          : `${held.line} ${runAgain ? REVIEW_HELD_CHOICE : REVIEW_HELD_NO_RUN}`}
      </p>
      {canAct && asksReason ? (
        <div className="ur-notknown">
          <label htmlFor={`${uid}-reason`}>{PROCEED_REASON_LABEL}</label>
          <textarea
            id={`${uid}-reason`}
            rows={2}
            maxLength={PROCEED_REASON_MAX}
            value={reason}
            disabled={sending !== null || done}
            data-arrive=""
            aria-describedby={`${uid}-reason-hint`}
            onChange={(event) => setReason(event.target.value)}
          />
          <FieldHint
            id={`${uid}-reason-hint`}
            count={characterCount(reason, PROCEED_REASON_MAX)}
            problem={reason.trim() !== "" ? reasonProblem : null}
            hint={
              held !== null ? PROCEED_REASON_HINT : PROCEED_REASON_HINT_PLAIN
            }
          />
        </div>
      ) : null}
      {canAct ? (
        <div className="ur-foot-actions" data-arrive-view="">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={sending !== null || done || reasonProblem !== null}
            data-arrive={!asksReason && !runAgain ? "" : undefined}
            onClick={() => void send("review-proceed")}
          >
            {sending === "review-proceed" ? "Proceeding…" : PROCEED_WITHOUT}
          </button>
          {runAgain ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={sending !== null || done}
              data-arrive={asksReason ? undefined : ""}
              onClick={() => void send("review-run")}
            >
              {sending === "review-run" ? "Requesting…" : RUN_AGAIN}
            </button>
          ) : null}
        </div>
      ) : null}
      {said !== null ? (
        <p
          className={said.ok ? "ur-hint" : "cc-problem"}
          role={said.ok ? "status" : "alert"}
        >
          {said.text}
        </p>
      ) : null}
    </div>
  );
}

/**
 * What each point the review found established rests on (owner decision, 18 November 2026,
 * "Show the support"): beside the review, so the person confirming the understanding sees
 * it. Each item as the read kept it: the walkthrough answer (its question and answer), the
 * statement's value, the answered question, or the passage quoted with its source and a way
 * to open it. A person may challenge a point: it is asked again in the questions below, and
 * shows as open until answered. Nothing shows as done before the server confirms it; focus
 * goes to the challenge's first field, and back to its button when it closes.
 */
export function ReviewSupport({
  ids,
  canAct,
  reviewId,
  points,
  approved,
  completed,
  documentsHref,
  onProcess,
}: {
  ids: Ids;
  canAct: boolean;
  reviewId: string;
  points: ReviewPoint[];
  approved: ReadonlyArray<Pick<Attribute, "id" | "code" | "definition">>;
  completed: boolean;
  documentsHref: string | null;
  onProcess: (() => void) | null;
}) {
  return (
    <div className="ur-review-support">
      <p className="ur-label">{SUPPORT_TITLE}</p>
      <ul className="ur-support-list">
        {points.map((point) => (
          <SupportPoint
            key={point.key}
            ids={ids}
            canAct={canAct}
            reviewId={reviewId}
            point={point}
            name={pointName(point, approved)}
            completed={completed}
            documentsHref={documentsHref}
            onProcess={onProcess}
          />
        ))}
      </ul>
    </div>
  );
}

function SupportPoint({
  ids,
  canAct,
  reviewId,
  point,
  name,
  completed,
  documentsHref,
  onProcess,
}: {
  ids: Ids;
  canAct: boolean;
  reviewId: string;
  point: ReviewPoint;
  name: string;
  completed: boolean;
  documentsHref: string | null;
  onProcess: (() => void) | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const uid = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLSelectElement & HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [need, setNeed] = useState(point.needs[0] ?? "");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (open) {
      first.current?.focus();
    }
  }, [open]);
  const noteProblem = notKnownNoteProblem(note);

  function close() {
    setOpen(false);
    window.setTimeout(() => opener.current?.focus(), 0);
  }

  async function send() {
    if (sending || noteProblem !== null || need === "") {
      return;
    }
    setSending(true);
    setSaid(null);
    const answer = await post(ids, "review-challenge", {
      review_id: reviewId,
      unit: point.key,
      need,
      note: note.trim(),
    });
    setSending(false);
    const problem = challengeProblem(answer.status, answer.detail);
    if (answer.status === 409) {
      // The review changed: it is read again at once, never left to the person to do.
      setSaid({ ok: false, text: CHALLENGE_REREAD });
      setOpen(false);
      startTransition(() => router.refresh());
      return;
    }
    if (problem !== null) {
      setSaid({ ok: false, text: problem });
      return;
    }
    setSaid({ ok: true, text: CHALLENGE_SENT });
    setOpen(false);
    startTransition(() => router.refresh());
  }

  return (
    <li className="ur-support-point">
      <p className="ur-support-name">
        <strong>{name}</strong>
        {challengeLine(point.challenge) === null ? null : (
          <span className="ur-review-quiet">
            {" "}
            {challengeLine(point.challenge)}
          </span>
        )}
      </p>
      {point.challenge === "OPEN" || point.challenge === "PREPARING" ? null : (
        <ul className="ur-support-items">
          {point.support.map((item) => {
            const words = supportLine(item);
            return (
              <li
                key={`${item.kind}-${item.ref}-${item.needs.join("-")}`}
                className="ur-support-item"
              >
                <div className="ur-support-body">
                  <span className="ur-support-kind">{words.kind}</span>
                  {words.label !== "" ? (
                    <span className="ur-support-label">{words.label}</span>
                  ) : null}
                  {words.said !== "" ? (
                    <span className="ur-support-said">{words.said}</span>
                  ) : null}
                </div>
                {item.kind === "DOCUMENT" && documentsHref !== null ? (
                  <div className="ur-support-open">
                    <a className="text-link" href={documentsHref}>
                      {OPEN_DOCUMENT}
                    </a>
                  </div>
                ) : item.kind === "NARRATIVE" && onProcess !== null ? (
                  <div className="ur-support-open">
                    <button
                      type="button"
                      className="text-link"
                      onClick={onProcess}
                    >
                      {OPEN_NARRATIVE}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {offersChallenge(point, canAct, completed) &&
      !open &&
      said?.ok !== true ? (
        <p className="ur-review-quiet ur-support-challenge">
          <button
            type="button"
            className="ur-skip"
            ref={opener}
            aria-expanded={false}
            aria-controls={`${uid}-challenge`}
            onClick={() => setOpen(true)}
          >
            {CHALLENGE_ACTION}
          </button>
        </p>
      ) : null}
      {open ? (
        <div className="ur-notknown" id={`${uid}-challenge`}>
          {point.needs.length > 1 ? (
            <>
              <label htmlFor={`${uid}-need`}>{CHALLENGE_NEED_LABEL}</label>
              <select
                id={`${uid}-need`}
                ref={first}
                value={need}
                disabled={sending}
                onChange={(event) => setNeed(event.target.value)}
              >
                {point.needs.map((each) => (
                  <option key={each} value={each}>
                    {factWords(each)}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <label htmlFor={`${uid}-note`}>{CHALLENGE_NOTE_LABEL}</label>
          <textarea
            id={`${uid}-note`}
            ref={point.needs.length > 1 ? undefined : first}
            rows={2}
            maxLength={NOT_KNOWN_NOTE_MAX}
            value={note}
            disabled={sending}
            aria-describedby={`${uid}-hint`}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                close();
              }
            }}
          />
          <FieldHint
            id={`${uid}-hint`}
            count={characterCount(note, NOT_KNOWN_NOTE_MAX)}
            problem={noteProblem}
            hint={CHALLENGE_NOTE_HINT}
          />
          <div className="ur-foot-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={sending}
              onClick={close}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={sending || noteProblem !== null}
              onClick={() => void send()}
            >
              {sending ? (
                <span className="spinner small" aria-hidden="true" />
              ) : null}
              {sending ? "Asking…" : CHALLENGE_SEND}
            </button>
          </div>
        </div>
      ) : null}
      {said !== null && (!said.ok || point.challenge === "") ? (
        // Once the server's state reads the point as challenged, its own line says so: the
        // confirmation is said once.
        <p
          className={said.ok ? "ur-review-quiet" : "cc-problem"}
          role={said.ok ? "status" : "alert"}
        >
          {said.text}
        </p>
      ) : null}
    </li>
  );
}

/** A field's line under it: the count, the problem (in the danger tone) and the hint, one
 * full stop between each. */
function FieldHint({
  id,
  count,
  problem,
  hint,
}: {
  id: string;
  count: string;
  problem: string | null;
  hint: string;
}) {
  const parts = hintParts(count, problem, hint);
  return (
    <p className="ur-notknown-hint" id={id}>
      {parts.count}
      {parts.problem !== null ? (
        <>
          {" · "}
          <span className="ur-hint-problem">{parts.problem}</span>
        </>
      ) : null}
      . {parts.hint}
    </p>
  );
}

/** "Not known yet, proceed" on a question's foot: a quiet text button that opens the note. */
export function NotKnownButton({
  disabled,
  onOpen,
}: {
  disabled: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="ur-skip"
      disabled={disabled}
      onClick={onOpen}
    >
      {NOT_KNOWN_ACTION}
    </button>
  );
}

/**
 * A person leaves a question as not known yet (B1l point 1: an agent's or the review's
 * question, a walkthrough question or a statement value), with an optional note of up to 500
 * characters. Inside the question's own form, so it is not a form: its buttons are plain
 * buttons. The question is closed only once the server has recorded it; the caller then
 * moves on in the course, and it is never shown as an answer.
 */
export function NotKnownPanel({
  ids,
  target,
  onCancel,
  onDone,
}: {
  ids: Ids;
  target: NotKnownTarget;
  onCancel: () => void;
  onDone: () => void;
}) {
  const uid = useId();
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    box.current?.focus();
  }, []);
  const noteProblem = notKnownNoteProblem(note);

  async function record() {
    if (sending || noteProblem !== null) {
      return;
    }
    setSending(true);
    setProblem(null);
    const write = notKnownWrite(target, note.trim());
    const answer = await post(ids, write.intent, write.fields);
    setSending(false);
    const refused = notKnownProblem(answer.status, answer.detail);
    if (refused !== null) {
      setProblem(refused);
      return;
    }
    onDone();
  }

  return (
    <div className="ur-notknown">
      <label htmlFor={`${uid}-note`} id={`${uid}-label`}>
        {NOT_KNOWN_LABEL}
      </label>
      <textarea
        id={`${uid}-note`}
        ref={box}
        rows={2}
        maxLength={NOT_KNOWN_NOTE_MAX}
        value={note}
        disabled={sending}
        aria-describedby={`${uid}-hint`}
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <FieldHint
        id={`${uid}-hint`}
        count={characterCount(note, NOT_KNOWN_NOTE_MAX)}
        problem={noteProblem}
        hint={NOT_KNOWN_HINT}
      />
      <div className="ur-foot-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={sending}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={sending || noteProblem !== null}
          onClick={() => void record()}
        >
          {sending ? (
            <span className="spinner small" aria-hidden="true" />
          ) : null}
          {sending ? "Recording…" : NOT_KNOWN_RECORD}
          {sending ? null : <UiIcon name="arrow" size={13} />}
        </button>
      </div>
      {problem !== null ? (
        <p className="cc-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The page's follow-up while the server says a read is due and none is queued (B1l point 1:
 * no dead end; ContextBody.review_due): an explicit, idempotent request (POST
 * .../understanding/review/follow) that the server queue it, or end it as one that could not
 * run. Never a write in a GET; a second request changes nothing. True when the server took
 * it (200 or 202), so the caller reads again.
 */
export async function followReview(ids: Ids): Promise<boolean> {
  const answer = await post(ids, "review-follow");
  return answer.status === 200 || answer.status === 202;
}

/**
 * "Run the review", the way out when the follow-up was refused: a person's own request that
 * the specialist read (POST .../understanding/review/run, 202). True when it was taken.
 */
export async function runReview(ids: Ids): Promise<boolean> {
  const answer = await post(ids, "review-run");
  return answer.status === 202 || answer.status === 200;
}
