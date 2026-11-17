"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import {
  CLEAR_DRAFT,
  DRAFTED_LABEL,
  decisionsWords,
} from "./design-points-model";
import {
  ATTESTATION,
  NOTE_LABEL,
  preparedDetail,
  REOPEN_TO_CHANGE,
  REOPENED_READING,
  SIGN_AS_PREPARER,
  SIGNED_READING,
  type SignOffFacts,
  signOffProblems,
  signOffRefusal,
  signOffRequest,
  signOffRereads,
} from "./preparer-signoff-model";
import { ReviewerPicker } from "./review-picker";
import {
  type LastReturn,
  MESSAGE_LABEL,
  MESSAGE_MAX,
  NEEDS_REVIEWER,
  NO_REVIEWER,
  REVIEW_ROUTES,
  type ReviewerOption,
  returnedLine,
  returnedNext,
  SEND_TO,
  SENT_READING,
  SIGN_AND_SEND,
  SIGN_AND_SEND_AGAIN,
  sendHint,
  sendRequest,
} from "./review-request-model";

type Ids = { organizationId: string; projectId: string; controlId: string };

/** The one request a press sends: the existing prepare or reopen, or (section 3.8) the
 * prepare that also sends the workpaper for review. An answer that cannot be read, or
 * none, is status 0: nothing is taken as done. */
async function send(
  url: string,
  body: Record<string, unknown>,
): Promise<{ status: number; detail: string }> {
  try {
    const response = await fetch(url, {
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

/** Section 3.8: "Sign and send for review", where the body names the review. */
export type SendFor = {
  /** Who may be chosen, and who is shown but not offered, with why. */
  reviewers: readonly ReviewerOption[];
  /** The reviewer the picker starts on; null where a choice is needed. */
  startOn: string | null;
  /** The reviewer's last return, where the workpaper came back: its reason is shown, and
   * the button reads "Sign and send again". */
  returned: LastReturn | null;
  viewerId: string | null;
  /** The message drafted from the agent's observations (section 3.9): the box starts
   * with it, marked as drafted, until the person types or clears it; "" for none. */
  draft?: string;
};

/** A point not settled yet, in the sign-off's list (section 3.9): its short words, the
 * name of its place, and the way there (null where the page cannot go to it). */
export type Decision = {
  key: string;
  words: string;
  place: string;
  onGo: (() => void) | null;
};

/**
 * The preparer's row of section 6's Sign-off (docs/design-workpaper.md, sections 3.7 to
 * 3.9): what it attests, each point not settled yet with the way to its place (the button
 * waits while any), what it still needs, and "Sign and send for review" with the
 * reviewer chosen in "Send for review to" and an optional message; once signed, who,
 * when and which version, and "Reopen to change" with its reason. Where the body is from
 * before 3.8 (`sendFor` null) the press is the existing "Sign as preparer", with its note.
 * Each press reads as done only after the server confirms; the page then reads the
 * workpaper and its records again.
 *
 * After the independent review (16 November 2026):
 * - A press the server confirmed is said at once ("Signed. Reading the workpaper
 *   again…", in a status) and nothing can be pressed again until the workpaper read
 *   again shows it: the state before is never left live, to be refused as stale.
 * - A refusal is cleared when the workpaper's status changes, and a refusal as changed
 *   (409), no answer or a server error read the workpaper again; an answer that did not
 *   come back is said as "may not have been taken", never "Not signed".
 * - The focus is never dropped: into the reason when "Reopen to change" opens it, back
 *   to "Reopen to change" on Cancel, and to the row's heading once a confirmed press is
 *   shown.
 */
export function PreparerSignOff({
  ids,
  workpaperId,
  version,
  facts,
  prepared,
  mayAct,
  onDone,
  sendFor = null,
  unread = false,
  below = null,
  decisions = [],
}: {
  ids: Ids;
  workpaperId: string;
  /** The workpaper record's version, as the views last read it. */
  version: number;
  facts: SignOffFacts;
  prepared: { by: string | null; on: string | null; version: number | null };
  /** The viewer may update the workpaper (the server still decides). */
  mayAct: boolean;
  /** The views and the page's records are read again: after a press the server
   * confirmed, and after an answer that leaves them in doubt (`signOffRereads`). */
  onDone: () => void;
  sendFor?: SendFor | null;
  /** The D&I conclusion could not be read: a draft is not prepared from here, since the
   * existing prepare would name no reviewer (section 3.8: a reviewer must be chosen). */
  unread?: boolean;
  /** Under the prepared line: the preparer's message, where the reviewer reads it. */
  below?: ReactNode;
  /** The points not settled yet, for the preparer's list (section 3.9). */
  decisions?: readonly Decision[];
}) {
  const uid = useId();
  const [text, setText] = useState("");
  // The message sent with the review request (section 3.8). It starts with the draft
  // from the agent's observations (section 3.9) and follows a newer draft until the
  // person types or clears it; what they typed is never written over.
  const draft = sendFor?.draft ?? "";
  const [message, setMessage] = useState(draft);
  const [drafted, setDrafted] = useState(draft !== "");
  const typed = useRef(false);
  useEffect(() => {
    if (typed.current) {
      return;
    }
    setMessage(draft);
    setDrafted(draft !== "");
  }, [draft]);
  const [reopening, setReopening] = useState(false);
  // The optional note's box, drawn once asked for (before 3.8).
  const [noting, setNoting] = useState(false);
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState("");
  // Section 3.8: the reviewer chosen, starting on the server's default; and, once the
  // workpaper came back, the picker folded to one line until "Change" opens it.
  const [reviewerId, setReviewerId] = useState<string | null>(
    sendFor?.startOn ?? null,
  );
  const [picking, setPicking] = useState(false);
  const startOn = sendFor?.startOn ?? null;
  // Returned (again): the picker starts on the reviewer who returned it, whatever was
  // chosen on this page before (a reviewer changed since in "Change reviewer" is the one
  // who returned it). Otherwise a choice already made is kept.
  const returnedAt = sendFor?.returned?.at ?? null;
  const seenReturn = useRef(returnedAt);
  useEffect(() => {
    if (seenReturn.current !== returnedAt) {
      seenReturn.current = returnedAt;
      if (returnedAt !== null) {
        setReviewerId(startOn);
        setPicking(false);
        return;
      }
    }
    if (startOn !== null) {
      setReviewerId((before) => before ?? startOn);
    }
  }, [returnedAt, startOn]);
  // A press the server confirmed, until the workpaper read again shows it (its status
  // changes): nothing is pressed meanwhile.
  const [confirmed, setConfirmed] = useState<
    "prepare" | "reopen" | "send" | null
  >(null);
  const busy = useRef(false);
  const alert = useRef<HTMLParagraphElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const reopenButton = useRef<HTMLButtonElement>(null);
  // A press was answered and the workpaper is read again: when it shows another status,
  // the control that had the focus is gone, and the focus goes to the heading.
  const landing = useRef(false);
  const offered = (sendFor?.reviewers ?? []).filter((item) => item.offered);
  const chosen = offered.find((item) => item.id === reviewerId) ?? null;
  const problems = [
    ...signOffProblems(facts),
    ...(sendFor !== null && facts.status === "DRAFT" && chosen === null
      ? [offered.length === 0 ? NO_REVIEWER : NEEDS_REVIEWER]
      : []),
  ];
  // The decisions' count leads their own list (screenshot check of 3.9): it is not said
  // again among the other needs.
  const needs =
    decisions.length > 0
      ? problems.filter(
          (problem) => problem !== decisionsWords(decisions.length),
        )
      : problems;

  // The workpaper read again shows another status: what was said before it (a refusal,
  // a confirmed press) no longer holds.
  const status = useRef(facts.status);
  useEffect(() => {
    if (status.current === facts.status) {
      return;
    }
    status.current = facts.status;
    setRefusal("");
    setConfirmed(null);
    if (landing.current) {
      landing.current = false;
      window.requestAnimationFrame(() => heading.current?.focus());
    }
  }, [facts.status]);

  const press = async (kind: "prepare" | "reopen") => {
    if (busy.current || confirmed !== null) {
      return;
    }
    // The D&I conclusion could not be read: nothing is prepared without a reviewer.
    if (unread && kind === "prepare") {
      return;
    }
    // Section 3.8: the sign-off sends the workpaper for review, in one transaction.
    const intent = kind === "prepare" && sendFor !== null ? "send" : kind;
    if (intent === "send" && chosen === null) {
      return;
    }
    busy.current = true;
    landing.current = false;
    setSending(true);
    setRefusal("");
    const answer =
      intent === "send"
        ? await send(
            REVIEW_ROUTES.send,
            sendRequest(ids, version, chosen?.id ?? "", message.trim()),
          )
        : await send(
            "/workspace/workpapers/prepare",
            signOffRequest(ids, workpaperId, version, intent, text.trim()),
          );
    busy.current = false;
    setSending(false);
    const said = signOffRefusal(intent, answer.status, answer.detail);
    if (said !== "") {
      setRefusal(said);
      window.requestAnimationFrame(() => alert.current?.focus());
      if (signOffRereads(answer.status)) {
        // Changed meanwhile, or the press may have been taken: read what the server
        // holds, so a retry is made on it.
        landing.current = true;
        onDone();
      }
      return;
    }
    setText("");
    setReopening(false);
    onDone();
    // Confirmed: said at once, and held until the workpaper read again shows it.
    landing.current = true;
    setConfirmed(intent);
    if (intent === "reopen") {
      // Its form goes: the focus goes to the heading, and the status says it.
      window.requestAnimationFrame(() => heading.current?.focus());
    }
    if (intent === "send") {
      // Sent: the message went with the request; nothing is drafted into it again.
      typed.current = true;
      setMessage("");
      setDrafted(false);
    }
  };

  // Said while a confirmed press waits for the workpaper read again.
  const reading = (
    <p className="ps-status" role="status">
      {confirmed === "prepare"
        ? SIGNED_READING
        : confirmed === "send"
          ? SENT_READING
          : confirmed === "reopen"
            ? REOPENED_READING
            : ""}
    </p>
  );
  const refused =
    refusal !== "" ? (
      <p className="ps-refusal" role="alert" tabIndex={-1} ref={alert}>
        {refusal}
      </p>
    ) : null;

  if (facts.status === "PREPARED") {
    return (
      <section className="ps ps-signed" aria-labelledby={`${uid}-h`}>
        <div className="ps-row">
          <div className="ps-copy">
            <h6 id={`${uid}-h`} ref={heading} tabIndex={-1}>
              <b>Prepared</b>{" "}
              <span className="ps-who">
                {preparedDetail(prepared.by, prepared.on, prepared.version)}
              </span>
            </h6>
          </div>
          {mayAct && !reopening && confirmed === null ? (
            <button
              ref={reopenButton}
              type="button"
              className="dw-link"
              onClick={() => {
                setReopening(true);
                // The note's box is the sign-off's: it opens again only when asked.
                setNoting(false);
                window.requestAnimationFrame(() =>
                  document.getElementById(`${uid}-r`)?.focus(),
                );
              }}
            >
              {REOPEN_TO_CHANGE}
            </button>
          ) : null}
        </div>
        {below}
        {reading}
        {mayAct && confirmed === null ? (
          reopening ? (
            <form
              autoComplete="off"
              className="ps-form"
              onSubmit={(event) => {
                event.preventDefault();
                void press("reopen");
              }}
            >
              <label htmlFor={`${uid}-r`}>Why it is reopened</label>
              <textarea
                id={`${uid}-r`}
                rows={2}
                maxLength={500}
                value={text}
                disabled={sending}
                onChange={(event) => setText(event.currentTarget.value)}
              />
              <div className="ps-actions">
                <button
                  type="button"
                  className="dw-link"
                  disabled={sending}
                  onClick={() => {
                    setReopening(false);
                    setText("");
                    setRefusal("");
                    window.requestAnimationFrame(() =>
                      reopenButton.current?.focus(),
                    );
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="dw-ink btn-sm"
                  disabled={sending || text.trim().length < 3}
                >
                  {sending ? "Reopening…" : "Reopen"}
                </button>
              </div>
            </form>
          ) : null
        ) : null}
        {refused}
      </section>
    );
  }
  const returned = sendFor?.returned ?? null;
  if (facts.status !== "DRAFT" || !mayAct || unread) {
    return (
      <section className="ps" aria-labelledby={`${uid}-h`}>
        <div className="ps-copy">
          <h6 id={`${uid}-h`}>
            <b>Prepared</b>{" "}
            <span className="ps-who">
              {unread && facts.status === "DRAFT" && mayAct
                ? "the sign-off could not be read. Refresh the page."
                : returned !== null
                  ? `not yet · returned by ${returned.by.name}`
                  : "not signed by the preparer yet"}
            </span>
          </h6>
          {returned !== null && returned.reason !== "" ? (
            <blockquote className="ps-quote">{returned.reason}</blockquote>
          ) : null}
        </div>
      </section>
    );
  }
  const ready = problems.length === 0;
  const again = returned !== null;
  return (
    <section className="ps" aria-labelledby={`${uid}-h`}>
      <form
        autoComplete="off"
        className="ps-form"
        aria-busy={sending || confirmed !== null}
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && confirmed === null) {
            void press("prepare");
          }
        }}
      >
        <div className="ps-row">
          <div className="ps-copy">
            <h6 id={`${uid}-h`} ref={heading} tabIndex={-1}>
              <b>Prepared</b>{" "}
              <span className="ps-who">
                {returned !== null
                  ? returnedLine(returned, shortDay)
                  : "by you"}
              </span>
            </h6>
            {returned !== null ? (
              <>
                {returned.reason !== "" ? (
                  <blockquote className="ps-quote">
                    {returned.reason}
                  </blockquote>
                ) : null}
                <p className="ps-line">{returnedNext(chosen?.name ?? null)}</p>
              </>
            ) : null}
            <p className="ps-attest">{ATTESTATION}</p>
          </div>
          <div className="ps-go">
            <button
              type="submit"
              className="dw-ink btn-sm"
              aria-disabled={!ready || sending || confirmed !== null}
              aria-describedby={
                [
                  decisions.length > 0 ? `${uid}-decisions` : "",
                  needs.length > 0 ? `${uid}-needs` : "",
                ]
                  .filter((id) => id !== "")
                  .join(" ") || undefined
              }
            >
              {sending
                ? sendFor !== null
                  ? "Sending…"
                  : "Signing…"
                : sendFor === null
                  ? SIGN_AS_PREPARER
                  : again
                    ? SIGN_AND_SEND_AGAIN
                    : SIGN_AND_SEND}
            </button>
            {sendFor !== null && chosen !== null && !again ? (
              <small className="ps-hint">{sendHint(chosen.name)}</small>
            ) : null}
          </div>
        </div>
        {reading}
        {decisions.length > 0 ? (
          <p className="ps-decisions-head" id={`${uid}-decisions`}>
            {decisionsWords(decisions.length)}
          </p>
        ) : null}
        {decisions.length > 0 ? (
          <ul className="ps-decisions" aria-labelledby={`${uid}-decisions`}>
            {decisions.map((item) => (
              <li key={item.key}>
                <span>{item.words}</span>
                {item.onGo !== null ? (
                  <button type="button" className="dw-link" onClick={item.onGo}>
                    {item.place}
                    <span className="sr-only">: go to the point</span>
                  </button>
                ) : (
                  <span className="ps-who">{item.place}</span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {needs.length > 0 ? (
          <ul className="ps-needs" id={`${uid}-needs`}>
            {needs.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : null}
        {sendFor !== null ? (
          again && chosen !== null && !picking ? (
            // Sent again to the same reviewer unless the preparer changes it.
            <p className="ps-line ps-to">
              Goes to {chosen.name}{" "}
              <button
                type="button"
                className="dw-link"
                disabled={sending || confirmed !== null}
                onClick={() => setPicking(true)}
              >
                Change
                <span className="sr-only"> the reviewer</span>
              </button>
            </p>
          ) : (
            <div className="ps-send">
              <ReviewerPicker
                label={SEND_TO}
                reviewers={sendFor.reviewers}
                value={reviewerId}
                viewerId={sendFor.viewerId}
                disabled={sending || confirmed !== null}
                openAtStart={again && picking}
                onChange={setReviewerId}
              />
              {again ? null : (
                <div className="ps-note">
                  <label htmlFor={`${uid}-n`}>{MESSAGE_LABEL}</label>
                  <textarea
                    id={`${uid}-n`}
                    rows={drafted && message !== "" ? 4 : 2}
                    maxLength={MESSAGE_MAX}
                    value={message}
                    disabled={sending || confirmed !== null}
                    aria-describedby={
                      drafted && message !== "" ? `${uid}-drafted` : undefined
                    }
                    onChange={(event) => {
                      typed.current = true;
                      setMessage(event.currentTarget.value);
                    }}
                  />
                  {drafted && message !== "" ? (
                    <p className="ps-add-note ps-drafted">
                      <small id={`${uid}-drafted`}>{DRAFTED_LABEL}</small>
                      <button
                        type="button"
                        className="dw-link"
                        disabled={sending || confirmed !== null}
                        onClick={() => {
                          typed.current = true;
                          setMessage("");
                          setDrafted(false);
                          window.requestAnimationFrame(() =>
                            document.getElementById(`${uid}-n`)?.focus(),
                          );
                        }}
                      >
                        {CLEAR_DRAFT}
                      </button>
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          )
        ) : noting || text !== "" ? (
          <div className="ps-note">
            <label htmlFor={`${uid}-n`}>{NOTE_LABEL}</label>
            <textarea
              id={`${uid}-n`}
              rows={2}
              maxLength={500}
              value={text}
              disabled={sending || confirmed !== null}
              onChange={(event) => setText(event.currentTarget.value)}
            />
          </div>
        ) : ready && confirmed === null ? (
          <p className="ps-add-note">
            <button
              type="button"
              className="dw-link"
              onClick={() => {
                setNoting(true);
                window.requestAnimationFrame(() =>
                  document.getElementById(`${uid}-n`)?.focus(),
                );
              }}
            >
              Add a note for the reviewer
            </button>
          </p>
        ) : null}
      </form>
      {refused}
    </section>
  );
}

const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

/** "Nov 17": a day the records give, in the viewer's own time; as sent where it is not a
 * date. */
export function shortDay(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : DAY.format(time);
}
