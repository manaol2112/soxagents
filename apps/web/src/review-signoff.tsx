"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import {
  CONCLUSION_WORDS,
  conclusionHead,
  DESIGN_CONCLUSION_NOTICES,
  type DesignConclusion,
  type DesignConclusionNotice,
  type DesignSignoff,
  designConclusionRefusal,
  exceptionLine,
  holdsBelow,
  outOfDateNext,
  parseDesignConclusionNotice,
  signableKind,
  standingKind,
  standingWords,
  VERDICT_LABELS,
} from "./design-conclusion-model";
import { formatDate } from "./format";
import { PreparerSignOff, type SendFor, shortDay } from "./preparer-signoff";
import type { SignOffFacts } from "./preparer-signoff-model";
import { ReviewerPicker } from "./review-picker";
import {
  CHANGE_REVIEWER,
  countWords,
  inReviewLine,
  mayManageRequest,
  notesWords,
  OE_CLEARED,
  OE_NOT_PERFORMED,
  preparerPressOf,
  preparerRowMayAct,
  REASSIGNED_READING,
  REMIND,
  REMINDED,
  RETURN_LABEL,
  RETURN_MAX,
  RETURN_MIN,
  RETURN_TO_PREPARER,
  RETURNED_READING,
  REVIEW_ROUTES,
  type ReviewIntent,
  type ReviewRequest,
  remindedLine,
  remindRequest,
  remindWaitMinutes,
  returnRequest,
  reviewerRequest,
  reviewRefusal,
  reviewRereads,
  reviewSide,
  SIGNED_OFF_READING,
  SIGNOFF_NOTE,
  type SignOffStage,
  sentToYouLine,
  signOffStage,
  startingReviewer,
  URGENT_HOLD,
} from "./review-request-model";

type Ids = { organizationId: string; projectId: string; controlId: string };

/** What section 7 knows of the review notes: how many are open, how many urgent. */
export type NotesCount = { open: number; urgent: number };

const REOPENED_FROM: Record<
  NonNullable<DesignSignoff["reopenedFrom"]>,
  string
> = {
  PERSON: "Reopened by a reviewer",
  WORKPAPER: "Reopened with the design workpaper",
  SUPERSEDED: "Superseded by a later sign-off",
};

const TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "Nov 16, 2:10 PM", in the viewer's own time; as sent where it is not a time. */
function whenSent(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : TIME.format(time);
}

type Answer = { status: number; detail: string };

/** One of the review's JSON writes (send, reviewer, remind, return). An answer that
 * cannot be read, or none, is status 0: nothing is taken as done. */
async function postReview(
  intent: ReviewIntent,
  body: Record<string, unknown>,
): Promise<Answer> {
  try {
    const response = await fetch(REVIEW_ROUTES[intent], {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const answer = (await response.json()) as {
      status?: unknown;
      detail?: unknown;
    };
    return {
      status: typeof answer.status === "number" ? answer.status : 0,
      detail: typeof answer.detail === "string" ? answer.detail : "",
    };
  } catch {
    return { status: 0, detail: "" };
  }
}

/** The reviewer's sign-off or its reopening: the existing route, in the background
 * (`x-dc-fetch`), answered as JSON. */
async function postSignOff(
  fields: Record<string, string>,
): Promise<{ notice: DesignConclusionNotice; detail: string }> {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  try {
    const response = await fetch("/workspace/design-conclusions", {
      method: "POST",
      body: data,
      headers: { "x-dc-fetch": "1" },
    });
    const body = (await response.json()) as {
      notice?: unknown;
      detail?: unknown;
    };
    return {
      notice:
        parseDesignConclusionNotice(
          typeof body.notice === "string" ? body.notice : null,
        ) ?? "dc-unavailable",
      detail: typeof body.detail === "string" ? body.detail : "",
    };
  } catch {
    return { notice: "dc-unavailable", detail: "" };
  }
}

/** What a write said: done, or why not, and whether what the page holds is in doubt. */
type Said = { done: boolean; refusal: string; doubt: boolean };

type Kind = "sign" | "reopen" | "return" | "reviewer" | "remind";

const READING: Readonly<Record<Kind, string>> = {
  sign: SIGNED_OFF_READING,
  reopen: "Sign-off reopened. Reading the workpaper again…",
  return: RETURNED_READING,
  reviewer: REASSIGNED_READING,
  remind: REMINDED,
};

/**
 * Section 7's Sign-off (docs/design-workpaper.md, section 3.8; the approved prototype):
 * two numbered rows, the preparer's and the reviewer's. The preparer signs and sends the
 * workpaper for review to a reviewer chosen in "Send for review to"; the reviewer the
 * request names reads the message and one line of what the sign-off rests on, and signs
 * it off or returns it to the preparer with a reason; once signed, both rows carry a
 * mark with who and when, and what the sign-off means for OE.
 *
 * Every write shows as done only once the server confirms it, in a status, and nothing
 * is pressed again until the page's records read again show it; a refusal is said in the
 * server's own sentence (role="alert", which takes the focus); an answer that leaves the
 * page in doubt (409, none, a server error) reads the records again. The focus is never
 * dropped: into a form when it opens, back to its button on Cancel, and to the row's
 * heading once a confirmed write is shown.
 *
 * A body from before 3.8 (`reviewFlow` false) is read as before: the preparer signs with
 * the existing prepare, and a reviewer who may sign signs without a request.
 */
export function SignOffBlock({
  ids,
  workpaperId,
  version,
  facts,
  prepared,
  preparerMayAct,
  conclusion,
  viewerId,
  canAct,
  notes,
  onNotes,
  onDone,
}: {
  ids: Ids;
  workpaperId: string;
  version: number;
  facts: SignOffFacts;
  prepared: { by: string | null; on: string | null; version: number | null };
  preparerMayAct: boolean;
  /** The D&I conclusion's body; null where it could not be read. */
  conclusion: DesignConclusion | null;
  viewerId: string | null;
  canAct: boolean;
  notes: NotesCount | null;
  onNotes: (() => void) | null;
  onDone: () => void;
}) {
  const uid = useId();
  // Section 3.8's "Sign and send for review" where the body names the review; the
  // existing prepare only for a body that was read and is from before it; nothing where
  // the body could not be read (a prepare then would name no reviewer).
  const press = preparerPressOf(conclusion);
  const flow = press === "send";
  // Who is reading: the conclusion's own word (the body's, or the session's user), else
  // what the review notes' route said.
  const viewer = conclusion?.viewerId ?? viewerId;
  const request = conclusion?.reviewRequest ?? null;
  const lastReturn = conclusion?.lastReturn ?? null;
  const signedOff = conclusion?.status === "SIGNED_OFF";
  const stage = signOffStage({
    paperStatus: facts.status,
    signedOff,
    request,
    lastReturn,
  });
  const side =
    request === null || conclusion === null
      ? null
      : reviewSide({
          request,
          viewerId: viewer,
          viewerPrepared: conclusion.viewerPrepared,
          viewerIsReviewer: conclusion.viewerIsReviewer,
          canSign: conclusion.canSign,
        });
  const sendFor: SendFor | null =
    flow && conclusion !== null
      ? {
          reviewers: conclusion.reviewers,
          // Sent again: the reviewer who returned it, where they may still be chosen;
          // otherwise the server's default.
          startOn:
            (stage === "returned" && lastReturn !== null
              ? startingReviewer(conclusion.reviewers, lastReturn.by.id)
              : null) ??
            startingReviewer(
              conclusion.reviewers,
              conclusion.defaultReviewerId,
            ),
          returned: stage === "returned" ? lastReturn : null,
          viewerId: viewer,
        }
      : null;
  const preparedDone = facts.status === "PREPARED" || signedOff;
  // The reviewer reads the preparer's message under the prepared line (the prototype).
  const message =
    request !== null && request.message !== "" ? (
      <blockquote className="ps-quote">{request.message}</blockquote>
    ) : null;
  return (
    <section className="so" aria-labelledby={`${uid}-label`}>
      <p className="so-label" id={`${uid}-label`}>
        Sign-off
      </p>
      <ol className="so-steps">
        <li className={`so-step${preparedDone ? " is-done" : ""}`}>
          <Mark n={1} done={preparedDone} />
          <PreparerSignOff
            ids={ids}
            workpaperId={workpaperId}
            version={version}
            facts={facts}
            prepared={prepared}
            // A reviewer who did not prepare a PREPARED workpaper returns it, or reopens
            // their own sign-off: the preparer's "Reopen to change" is not theirs to see
            // (the prototype). A draft is the server's `can_edit` alone: nobody prepared
            // it yet, so a reviewer who prepares this control signs and sends it.
            mayAct={preparerRowMayAct({
              preparerMayAct,
              paperStatus: facts.status,
              reviewFlow: flow,
              viewerIsReviewer: conclusion?.viewerIsReviewer === true,
              viewerPrepared: conclusion?.viewerPrepared === true,
            })}
            onDone={onDone}
            sendFor={sendFor}
            unread={press === "unread"}
            below={side === "reviewer" ? message : null}
          />
        </li>
        <li
          className={`so-step${signedOff ? " is-done" : ""}${stage === "sent" ? " is-waiting" : ""}`}
        >
          <Mark n={2} done={signedOff} waiting={stage === "sent"} />
          {conclusion === null ? (
            <div className="so-row">
              <h6>
                <b>Reviewed</b>{" "}
                <span className="ps-who">
                  the sign-off could not be read. Refresh the page.
                </span>
              </h6>
            </div>
          ) : (
            <ReviewRow
              ids={ids}
              conclusion={conclusion}
              stage={stage}
              side={side}
              request={request}
              message={side === "reviewer" ? null : message}
              viewerId={viewer}
              canAct={canAct}
              notes={notes}
              onNotes={onNotes}
              onDone={onDone}
              paperStatus={facts.status}
            />
          )}
        </li>
      </ol>
    </section>
  );
}

function Mark({
  n,
  done,
  waiting = false,
}: {
  n: number;
  done: boolean;
  waiting?: boolean;
}) {
  return (
    <span
      className={`so-mark${done ? " is-done" : ""}${waiting ? " is-waiting" : ""}`}
      aria-hidden="true"
    >
      {done ? "✓" : n}
    </span>
  );
}

function ReviewRow({
  ids,
  conclusion,
  stage,
  side,
  request,
  message,
  viewerId,
  canAct,
  notes,
  onNotes,
  onDone,
  paperStatus,
}: {
  ids: Ids;
  conclusion: DesignConclusion;
  stage: SignOffStage;
  side: ReturnType<typeof reviewSide> | null;
  request: ReviewRequest | null;
  message: ReactNode;
  viewerId: string | null;
  canAct: boolean;
  notes: NotesCount | null;
  onNotes: (() => void) | null;
  onDone: () => void;
  paperStatus: SignOffFacts["status"];
}) {
  const uid = useId();
  const [open, setOpen] = useState<"return" | "reviewer" | "reopen" | null>(
    null,
  );
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [next, setNext] = useState<string | null>(null);
  const [sending, setSending] = useState<Kind | null>(null);
  const [refusal, setRefusal] = useState("");
  // A write the server confirmed, until the records read again show it.
  const [confirmed, setConfirmed] = useState<Kind | null>(null);
  const busy = useRef(false);
  const landing = useRef(false);
  const alert = useRef<HTMLParagraphElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const now = Date.now();

  // What the records say of the review: when it changes, what was said before it no
  // longer holds, and a confirmed write's focus goes to the heading.
  const key = [
    conclusion.status,
    paperStatus,
    request?.id ?? "",
    request?.reviewer.id ?? "",
    request?.remindedAt ?? "",
    conclusion.lastReturn?.at ?? "",
    conclusion.signed?.id ?? "",
  ].join("|");
  const seen = useRef(key);
  useEffect(() => {
    if (seen.current === key) {
      return;
    }
    seen.current = key;
    setRefusal("");
    setConfirmed(null);
    setOpen(null);
    if (landing.current) {
      landing.current = false;
      window.requestAnimationFrame(() => heading.current?.focus());
    }
  }, [key]);

  const run = async (kind: Kind, perform: () => Promise<Said>) => {
    if (busy.current || confirmed !== null) {
      return;
    }
    busy.current = true;
    landing.current = false;
    setSending(kind);
    setRefusal("");
    const said = await perform();
    busy.current = false;
    setSending(null);
    if (!said.done) {
      setRefusal(said.refusal);
      window.requestAnimationFrame(() => alert.current?.focus());
      if (said.doubt) {
        // Changed meanwhile, or it may have been taken: read what the server holds.
        landing.current = true;
        onDone();
      }
      return;
    }
    // Confirmed: said at once in a status, and held until the records read again show
    // it; its form goes, and the focus goes to the heading.
    setNote("");
    setReason("");
    setOpen(null);
    onDone();
    landing.current = true;
    setConfirmed(kind);
    window.requestAnimationFrame(() => heading.current?.focus());
  };

  const review = (
    intent: Exclude<ReviewIntent, "send">,
    body: Record<string, unknown>,
  ) =>
    run(intent, async () => {
      const answer = await postReview(intent, body);
      return {
        done: answer.status === 200,
        refusal: reviewRefusal(intent, answer.status, answer.detail),
        doubt: reviewRereads(answer.status),
      };
    });

  const signOff = (intent: "sign" | "reopen", fields: Record<string, string>) =>
    run(intent, async () => {
      const answer = await postSignOff({
        organization_id: ids.organizationId,
        project_id: ids.projectId,
        control_id: ids.controlId,
        intent,
        ...fields,
      });
      const done =
        answer.notice === (intent === "sign" ? "dc-signed" : "dc-reopened");
      return {
        done,
        refusal: done
          ? ""
          : designConclusionRefusal(intent, answer.notice, answer.detail) ||
            DESIGN_CONCLUSION_NOTICES[answer.notice],
        doubt:
          answer.notice === "dc-unavailable" || answer.notice === "dc-blocked",
      };
    });

  const openForm = (
    which: "return" | "reviewer" | "reopen",
    from: HTMLButtonElement,
  ) => {
    opener.current = from;
    setOpen(which);
    setRefusal("");
    if (which === "reviewer") {
      setNext(null);
      return;
    }
    window.requestAnimationFrame(() =>
      document.getElementById(`${uid}-${which}`)?.focus(),
    );
  };
  const cancel = () => {
    setOpen(null);
    setReason("");
    setRefusal("");
    window.requestAnimationFrame(() => opener.current?.focus());
  };

  const reading = (
    <p className="ps-status" role="status">
      {confirmed === null ? "" : READING[confirmed]}
    </p>
  );
  const refused =
    refusal !== "" ? (
      <p className="ps-refusal" role="alert" tabIndex={-1} ref={alert}>
        {refusal}
      </p>
    ) : null;

  // What the card says of an exception that holds the sign-off (its reasons, what the
  // preparer does next), and everything else that holds it, each sentence whole, once.
  const head = conclusionHead(conclusion);
  const holds = holdsBelow(conclusion);
  const standing = standingKind(conclusion);
  const choice = conclusion.choice;
  const signable = choice === null ? null : signableKind(choice.kind);
  const preparedVersion = conclusion.workpaper?.preparedVersion ?? null;
  const signs =
    conclusion.canSign &&
    choice !== null &&
    signable !== null &&
    preparedVersion !== null;
  const stale = conclusion.status === "OUT_OF_DATE";
  const urgent = notes?.urgent ?? 0;
  const urgentSaid = holds.some((item) => /urgent review note/i.test(item));
  const excepted =
    head.reasons.length > 0 ? (
      <div className="dc-excepted" role="note">
        {head.reasons.map((text) => (
          <p key={text}>{text}</p>
        ))}
        <p className="dc-excepted-next">{head.next}</p>
      </div>
    ) : null;
  const outOfDate = stale ? (
    <p className="so-line so-stale">
      The sign-off no longer holds. {outOfDateNext(conclusion)}
    </p>
  ) : null;

  /* Signed off ---------------------------------------------------------------------- */
  const signed = conclusion.signed;
  if (stage === "signed" && signed !== null) {
    const words =
      standing === undefined
        ? VERDICT_LABELS[signed.verdict]
        : standingWords(standing);
    return (
      <div className="so-row">
        <div className="so-head">
          <h6 ref={heading} tabIndex={-1}>
            <b>Reviewed</b>{" "}
            <span className="ps-who">
              {[
                `by ${signed.signedBy || "a reviewer"}`,
                signed.signedAt === "" ? "" : shortDay(signed.signedAt),
                words,
              ]
                .filter((part) => part !== "")
                .join(" · ")}
            </span>
          </h6>
          {conclusion.viewerIsReviewer &&
          open === null &&
          confirmed === null ? (
            <button
              type="button"
              className="dw-link"
              onClick={(event) => openForm("reopen", event.currentTarget)}
            >
              Reopen
              <span className="sr-only"> the sign-off</span>
            </button>
          ) : null}
        </div>
        {signed.note !== "" ? (
          <blockquote className="ps-quote">{signed.note}</blockquote>
        ) : null}
        <p className="so-line">
          {signed.verdict === "NOT_EFFECTIVE" ? OE_NOT_PERFORMED : OE_CLEARED}
        </p>
        {reading}
        {open === "reopen" ? (
          <form
            autoComplete="off"
            className="ps-form so-form"
            onSubmit={(event) => {
              event.preventDefault();
              void signOff("reopen", { reason: reason.trim() });
            }}
          >
            <label htmlFor={`${uid}-reopen`}>
              Why the sign-off is reopened
            </label>
            <textarea
              id={`${uid}-reopen`}
              rows={2}
              minLength={10}
              maxLength={500}
              value={reason}
              disabled={sending !== null}
              onChange={(event) => setReason(event.currentTarget.value)}
            />
            <div className="ps-actions">
              <button
                type="button"
                className="dw-link"
                disabled={sending !== null}
                onClick={cancel}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="dw-ink btn-sm"
                disabled={sending !== null || reason.trim().length < 10}
              >
                {sending === "reopen" ? "Reopening…" : "Reopen"}
              </button>
            </div>
            <small className="ps-hint">
              OE waits until the conclusion is signed off again.
            </small>
          </form>
        ) : null}
        {refused}
        <Earlier conclusion={conclusion} />
      </div>
    );
  }

  /* Not sent yet: the draft, or returned to the preparer ---------------------------- */
  if (stage === "unsigned" || stage === "returned") {
    const yours = conclusion.viewerPrepared || conclusion.canChoose;
    return (
      <div className="so-row">
        <h6 ref={heading} tabIndex={-1}>
          <b>Reviewed</b>{" "}
          <span className="ps-who">
            {yours
              ? stage === "returned"
                ? "after you send it again"
                : "after you send it"
              : "after the preparer sends it"}
          </span>
        </h6>
        {outOfDate}
        {reading}
        {refused}
        <Earlier conclusion={conclusion} />
      </div>
    );
  }

  /* The basis line, the holds and the sign-off form (the named reviewer; and, with no
     request standing, a reviewer who may sign, as before 3.8) ------------------------- */
  const reviewerForm = (withReturn: boolean) => (
    <form
      autoComplete="off"
      className="so-review"
      aria-busy={sending !== null || confirmed !== null}
      onSubmit={(event) => {
        event.preventDefault();
        if (
          !signs ||
          signable === null ||
          choice === null ||
          preparedVersion === null
        ) {
          return;
        }
        void signOff("sign", {
          conclusion: signable,
          choice_id: choice.id,
          workpaper_version: String(preparedVersion),
          note: note.trim(),
          ...(request === null ? {} : { request_id: request.id }),
        });
      }}
    >
      <div className="so-review-copy">
        <dl className="so-basis">
          <div>
            <dt>Deficiencies</dt>
            <dd>{countWords(conclusion.deficiencies.length)}</dd>
          </div>
          <div>
            <dt>Exceptions</dt>
            <dd>{countWords(conclusion.exceptions.length, "recorded")}</dd>
          </div>
          <div>
            <dt>Notes</dt>
            <dd>
              {notes === null ? (
                "not read"
              ) : onNotes !== null && notes.open > 0 ? (
                <button
                  type="button"
                  className="dw-link so-notes"
                  onClick={onNotes}
                >
                  {notesWords(notes.open, notes.urgent)}
                  <span className="sr-only">: open the review notes</span>
                </button>
              ) : (
                notesWords(notes.open, notes.urgent)
              )}
            </dd>
          </div>
        </dl>
        {conclusion.deficiencies.length > 0 ? (
          <ul className="dc-list">
            {conclusion.deficiencies.map((item) => (
              <li key={item.reference}>
                <strong>{item.reference}</strong> {item.title}
              </li>
            ))}
          </ul>
        ) : null}
        {conclusion.exceptions.length > 0 ? (
          <ul className="dc-list">
            {conclusion.exceptions.map((item) => (
              <li key={`${item.requirementId}:${item.attributeId}`}>
                <strong>{exceptionLine(item, formatDate)}</strong>
                {item.reason !== "" ? (
                  <span className="dc-note">{item.reason}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {urgent > 0 && !urgentSaid ? (
          <p className="so-line so-held">{URGENT_HOLD}</p>
        ) : null}
        {excepted}
        {holds.length > 0 ? (
          <div className="dc-blocked" role="note" id={`${uid}-holds`}>
            {holds.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </div>
        ) : null}
        {outOfDate}
        {signs ? (
          <div className="ps-note">
            <label htmlFor={`${uid}-note`}>{SIGNOFF_NOTE}</label>
            <textarea
              id={`${uid}-note`}
              rows={2}
              maxLength={1000}
              value={note}
              disabled={sending !== null || confirmed !== null}
              placeholder="What was reviewed, for the record"
              onChange={(event) => setNote(event.currentTarget.value)}
            />
          </div>
        ) : null}
      </div>
      <div className="so-review-go">
        {signable !== null && choice !== null ? (
          <button
            type="submit"
            className="dw-ink btn-sm"
            aria-disabled={!signs || sending !== null || confirmed !== null}
            aria-describedby={holds.length > 0 ? `${uid}-holds` : undefined}
          >
            {sending === "sign"
              ? "Signing off…"
              : `Sign off: ${CONCLUSION_WORDS[signable]}`}
          </button>
        ) : null}
        {withReturn &&
        request !== null &&
        open !== "return" &&
        confirmed === null ? (
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={sending !== null}
            onClick={(event) => openForm("return", event.currentTarget)}
          >
            {RETURN_TO_PREPARER}
          </button>
        ) : null}
      </div>
    </form>
  );

  const returnForm =
    open === "return" && request !== null ? (
      <form
        autoComplete="off"
        className="ps-form so-form"
        onSubmit={(event) => {
          event.preventDefault();
          const said = reason.trim();
          if (said.length < RETURN_MIN || said.length > RETURN_MAX) {
            return;
          }
          void review("return", returnRequest(ids, request.id, said));
        }}
      >
        <label htmlFor={`${uid}-return`}>{RETURN_LABEL}</label>
        <textarea
          id={`${uid}-return`}
          rows={2}
          minLength={RETURN_MIN}
          maxLength={RETURN_MAX}
          value={reason}
          disabled={sending !== null}
          onChange={(event) => setReason(event.currentTarget.value)}
        />
        <div className="ps-actions">
          <small className="ps-hint">
            The workpaper goes back to a draft, and the preparer sees your
            reason.
          </small>
          <button
            type="button"
            className="dw-link"
            disabled={sending !== null}
            onClick={cancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="dw-ink btn-sm"
            aria-disabled={
              reason.trim().length < RETURN_MIN || sending !== null
            }
          >
            {sending === "return" ? "Returning…" : "Return"}
          </button>
        </div>
      </form>
    ) : null;

  /* Prepared, with no request standing ---------------------------------------------- */
  if (stage === "prepared" || request === null) {
    return (
      <div className="so-row">
        <h6 ref={heading} tabIndex={-1}>
          <b>Reviewed</b>{" "}
          <span className="ps-who">
            {conclusion.reviewFlow
              ? "not sent for review"
              : "not signed off yet"}
          </span>
        </h6>
        {signs || conclusion.canSign ? (
          reviewerForm(false)
        ) : (
          <>
            {excepted}
            {holds.length > 0 ? (
              <div className="dc-blocked" role="note">
                {holds.map((text) => (
                  <p key={text}>{text}</p>
                ))}
              </div>
            ) : null}
            {outOfDate}
          </>
        )}
        {reading}
        {refused}
        <Earlier conclusion={conclusion} />
      </div>
    );
  }

  /* In review: the named reviewer's view ------------------------------------------- */
  if (side === "reviewer") {
    return (
      <div className="so-row">
        <h6 ref={heading} tabIndex={-1}>
          <b>Your review</b>{" "}
          <span className="ps-who">{sentToYouLine(request, shortDay)}</span>
        </h6>
        {reviewerForm(true)}
        {returnForm}
        {reading}
        {refused}
        <Earlier conclusion={conclusion} />
      </div>
    );
  }

  /* In review: the preparer's view, and anyone else's ------------------------------ */
  // Change reviewer and Remind: the sender, the preparer or a lead, as the server's
  // `may_manage` (its `can_manage_request` where the body carries it).
  const mayChange = mayManageRequest({
    request,
    viewerId,
    viewerPrepared: conclusion.viewerPrepared,
    canManage: conclusion.canManageRequest,
    canAct,
  });
  const wait = remindWaitMinutes(request, now);
  const reminded = remindedLine(request, now, shortDay);
  const offered = conclusion.reviewers.filter(
    (item) => item.offered && item.id !== request.reviewer.id,
  );
  return (
    <div className="so-row">
      <div className="so-head">
        <h6 ref={heading} tabIndex={-1}>
          <b>In review</b>{" "}
          <span className="ps-who">{inReviewLine(request, whenSent)}</span>
        </h6>
        {mayChange && open === null && confirmed === null ? (
          <span className="so-links">
            <button
              type="button"
              className="dw-link"
              disabled={sending !== null}
              onClick={(event) => openForm("reviewer", event.currentTarget)}
            >
              {CHANGE_REVIEWER}
            </button>
            <button
              type="button"
              className="dw-link"
              aria-disabled={wait > 0 || sending !== null}
              aria-describedby={reminded !== "" ? `${uid}-reminded` : undefined}
              onClick={() => {
                if (wait > 0) {
                  return;
                }
                void review("remind", remindRequest(ids, request.id));
              }}
            >
              {sending === "remind" ? "Reminding…" : REMIND}
            </button>
          </span>
        ) : null}
      </div>
      {message}
      {reminded !== "" ? (
        <p className="so-line" id={`${uid}-reminded`}>
          {reminded}
        </p>
      ) : null}
      {side === "other_reviewer" ? (
        <p className="so-line">
          {request.reviewer.name} signs it off or returns it. The preparer or a
          lead can make you the reviewer with Change reviewer.
        </p>
      ) : null}
      {excepted}
      {outOfDate}
      {open === "reviewer" ? (
        <form
          autoComplete="off"
          className="ps-form so-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (next === null || next === request.reviewer.id) {
              return;
            }
            void review("reviewer", reviewerRequest(ids, request.id, next));
          }}
        >
          <ReviewerPicker
            label="Send it to instead"
            reviewers={conclusion.reviewers.filter(
              (item) => item.id !== request.reviewer.id,
            )}
            value={next}
            viewerId={viewerId}
            disabled={sending !== null}
            openAtStart
            onChange={setNext}
          />
          {offered.length === 0 ? (
            <p className="so-line">No other reviewer can be chosen.</p>
          ) : null}
          <div className="ps-actions">
            <button
              type="button"
              className="dw-link"
              disabled={sending !== null}
              onClick={cancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="dw-ink btn-sm"
              aria-disabled={next === null || sending !== null}
            >
              {sending === "reviewer" ? "Changing…" : CHANGE_REVIEWER}
            </button>
          </div>
        </form>
      ) : null}
      {reading}
      {refused}
      <Earlier conclusion={conclusion} />
    </div>
  );
}

/** The sign-offs reopened before this one, folded. */
function Earlier({ conclusion }: { conclusion: DesignConclusion }) {
  const earlier = conclusion.history.filter((item) => item.reopenedAt !== null);
  if (earlier.length === 0) {
    return null;
  }
  return (
    <details className="dc-history so-history">
      <summary>Earlier sign-offs ({earlier.length})</summary>
      <ol>
        {earlier.map((item) => (
          <li key={item.id}>
            <strong>
              {item.conclusion !== null
                ? CONCLUSION_WORDS[item.conclusion]
                : VERDICT_LABELS[item.verdict]}
            </strong>{" "}
            · signed by {item.signedBy || "a reviewer"} on{" "}
            {formatDate(item.signedAt)} · workpaper version{" "}
            {item.workpaperVersion}
            <span className="dc-note">
              {item.reopenedFrom !== null
                ? REOPENED_FROM[item.reopenedFrom]
                : "Reopened"}
              {item.reopenedAt !== null
                ? ` on ${formatDate(item.reopenedAt)}`
                : ""}
              {item.reopenReason !== "" ? `: ${item.reopenReason}` : ""}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
