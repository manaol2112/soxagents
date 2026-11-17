"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  NOT_KNOWN_NOTE_MAX,
  notKnownNoteProblem,
  type QuestionPass,
  type QuestionReview,
} from "./control-context-model";
import { UiIcon } from "./ui-icon";
import { characterCount } from "./understanding-once-model";
import {
  markedParts,
  NOT_KNOWN_ACTION,
  NOT_KNOWN_HINT,
  NOT_KNOWN_LABEL,
  NOT_KNOWN_RECORD,
  notKnownProblem,
  notReviewedLine,
  offersReviewAgain,
  PROCEED_SENT,
  PROCEED_WITHOUT,
  REVIEW_AGAIN,
  REVIEW_AGAIN_SENT,
  REVIEW_BY,
  REVIEW_CHECKING,
  REVIEW_FAILED,
  REVIEW_TITLE,
  type ReviewIntent,
  RUN_AGAIN,
  reviewedLead,
  reviewProblem,
  reviewView,
} from "./understanding-specialist-model";

type Ids = { organizationId: string; projectId: string; controlId: string };

/** One of the specialist's writes through the page's control-context route: the server's
 * status and sentence. Nothing is taken as done until the server confirms it (200, or 202 for
 * a review it accepted to run). */
async function post(
  ids: Ids,
  intent: ReviewIntent | "issue-not-known",
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
 * need…". A review that could not run is one line here; its two choices are on the course's
 * last screen. Once complete, "Review again" is a person's quiet request, whose findings
 * become assumptions on the attributes, never questions here.
 */
export function QuestionReviewSection({
  ids,
  canAct,
  pass,
  review,
  completedAt,
}: {
  ids: Ids;
  canAct: boolean;
  pass: QuestionPass | null;
  review: QuestionReview | null | undefined;
  completedAt: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [sending, setSending] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const view = reviewView(pass, review, completedAt !== null);
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
  if (view.state === "none") {
    return null;
  }
  const again = offersReviewAgain(completedAt, pass, canAct);

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

  const notReviewed =
    view.state === "ready" ? notReviewedLine(view.review.notReviewed) : null;
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
      ) : (
        <p className="ur-review-text">
          {view.settled ? (
            <span className="ur-review-when" suppressHydrationWarning>
              {reviewedLead(view.review.reviewedAt)}
            </span>
          ) : null}
          {markedParts(
            view.review.narrative,
            view.settled ? [] : view.review.marked,
          ).map((part, at) =>
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
      )}
      {notReviewed !== null ? (
        <p className="ur-review-quiet">{notReviewed}</p>
      ) : null}
      {again && view.state === "ready" ? (
        <p className="ur-review-quiet">
          <button
            type="button"
            className="ur-skip"
            disabled={sending}
            onClick={() => void reviewAgain()}
          >
            {sending ? "Requesting…" : REVIEW_AGAIN}
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
 */
export function ReviewFailed({
  ids,
  canAct,
  failure,
}: {
  ids: Ids;
  canAct: boolean;
  failure: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [sending, setSending] = useState<ReviewIntent | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(intent: ReviewIntent) {
    if (sending !== null) {
      return;
    }
    setSending(intent);
    setSaid(null);
    const answer = await post(ids, intent);
    setSending(null);
    const problem = reviewProblem(intent, answer.status, answer.detail);
    setSaid(
      problem !== null
        ? { ok: false, text: problem }
        : {
            ok: true,
            text:
              intent === "review-proceed"
                ? PROCEED_SENT
                : "Running the review again…",
          },
    );
    if (problem === null) {
      startTransition(() => router.refresh());
    }
  }

  return (
    <div className="ur-end ur-review-failed">
      <h3 className="ur-q">{REVIEW_FAILED}</h3>
      <p className="ur-hint" role="status">
        {failure}
      </p>
      {canAct ? (
        <div className="ur-foot-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={sending !== null || said?.ok === true}
            onClick={() => void send("review-proceed")}
          >
            {sending === "review-proceed" ? "Proceeding…" : PROCEED_WITHOUT}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={sending !== null || said?.ok === true}
            onClick={() => void send("review-run")}
          >
            {sending === "review-run" ? "Requesting…" : RUN_AGAIN}
          </button>
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
 * A person leaves a question as not known yet (B1l point 1), with an optional note of up to
 * 500 characters. Inside the question's own form, so it is not a form: its buttons are plain
 * buttons. The question is closed only once the server has recorded it; the caller then
 * moves on in the course, and it is never shown as an answer.
 */
export function NotKnownPanel({
  ids,
  issue,
  onCancel,
  onDone,
}: {
  ids: Ids;
  issue: { id: string; version: number };
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
    const answer = await post(ids, "issue-not-known", {
      issue_id: issue.id,
      version: issue.version,
      note: note.trim(),
    });
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
      <p className="ur-notknown-hint" id={`${uid}-hint`}>
        {characterCount(note, NOT_KNOWN_NOTE_MAX)}
        {noteProblem !== null ? ` · ${noteProblem}` : ""}. {NOT_KNOWN_HINT}
      </p>
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
