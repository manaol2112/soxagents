"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  ATTESTATION,
  NOTE_LABEL,
  preparedLine,
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

type Ids = { organizationId: string; projectId: string; controlId: string };

async function send(
  body: Record<string, string>,
): Promise<{ status: number; detail: string }> {
  try {
    const response = await fetch("/workspace/workpapers/prepare", {
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

/**
 * The preparer's sign-off, at the end of section 7 (docs/design-workpaper.md, section
 * 3.7): what it attests, what it still needs, an optional note, and "Sign as preparer";
 * once signed, who and when, and "Reopen to change" with its reason. Each press is the
 * existing prepare or reopen; it reads as done only after the server confirms, and the
 * page then reads the workpaper and its records again.
 *
 * One row (product owner, 16 November 2026: section 7 lighter, option A): the heading and
 * what is attested on the left, "Sign as preparer" on the right; what it still needs only
 * while it needs something, and the note for the reviewer only once asked for ("Add a
 * note for the reviewer"). Once signed: who and which version on the left, "Reopen to
 * change" as a quiet link on the right.
 *
 * After the independent review (16 November 2026):
 * - A press the server confirmed is said at once ("Signed. Reading the workpaper
 *   again…", in a status) and nothing can be pressed again until the workpaper read
 *   again shows it: the state before is never left live, to be refused as stale.
 * - A refusal is cleared when the workpaper's status changes, and a refusal as changed
 *   (409), no answer or a server error read the workpaper again; an answer that did not
 *   come back is said as "may not have been taken", never "Not signed".
 * - The focus is never dropped: into the reason when "Reopen to change" opens it, back
 *   to "Reopen to change" on Cancel, and to the sign-off's heading once a confirmed
 *   press is shown.
 */
export function PreparerSignOff({
  ids,
  workpaperId,
  version,
  facts,
  prepared,
  mayAct,
  onDone,
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
}) {
  const uid = useId();
  const [text, setText] = useState("");
  const [reopening, setReopening] = useState(false);
  // The optional note's box, drawn once asked for.
  const [noting, setNoting] = useState(false);
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState("");
  // A press the server confirmed, until the workpaper read again shows it (its status
  // changes): nothing is pressed meanwhile.
  const [confirmed, setConfirmed] = useState<"prepare" | "reopen" | null>(null);
  const busy = useRef(false);
  const alert = useRef<HTMLParagraphElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const reopenButton = useRef<HTMLButtonElement>(null);
  // A press was answered and the workpaper is read again: when it shows another status,
  // the control that had the focus is gone, and the focus goes to the heading.
  const landing = useRef(false);
  const problems = signOffProblems(facts);

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

  const press = async (intent: "prepare" | "reopen") => {
    if (busy.current || confirmed !== null) {
      return;
    }
    busy.current = true;
    landing.current = false;
    setSending(true);
    setRefusal("");
    const answer = await send(
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
  };

  // Said while a confirmed press waits for the workpaper read again.
  const reading = (
    <p className="ps-status" role="status">
      {confirmed === "prepare"
        ? SIGNED_READING
        : confirmed === "reopen"
          ? REOPENED_READING
          : ""}
    </p>
  );

  if (facts.status === "PREPARED") {
    return (
      <section className="ps ps-signed" aria-labelledby={`${uid}-h`}>
        <div className="ps-row">
          <div className="ps-copy">
            <h6 id={`${uid}-h`} ref={heading} tabIndex={-1}>
              Preparer's sign-off
            </h6>
            <p className="ps-line">
              {preparedLine(prepared.by, prepared.on, prepared.version)}
            </p>
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
        {refusal !== "" ? (
          <p className="ps-refusal" role="alert" tabIndex={-1} ref={alert}>
            {refusal}
          </p>
        ) : null}
      </section>
    );
  }
  if (facts.status !== "DRAFT" || !mayAct) {
    return (
      <section className="ps" aria-labelledby={`${uid}-h`}>
        <div className="ps-copy">
          <h6 id={`${uid}-h`}>Preparer's sign-off</h6>
          <p className="ps-line">Not signed by the preparer yet.</p>
        </div>
      </section>
    );
  }
  const ready = problems.length === 0;
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
              Preparer's sign-off
            </h6>
            <p className="ps-attest">{ATTESTATION}</p>
          </div>
          <button
            type="submit"
            className="dw-ink btn-sm"
            aria-disabled={!ready || sending || confirmed !== null}
            aria-describedby={problems.length > 0 ? `${uid}-needs` : undefined}
          >
            {sending ? "Signing…" : SIGN_AS_PREPARER}
          </button>
        </div>
        {reading}
        {problems.length > 0 ? (
          <ul className="ps-needs" id={`${uid}-needs`}>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : null}
        {noting || text !== "" ? (
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
      {refusal !== "" ? (
        <p className="ps-refusal" role="alert" tabIndex={-1} ref={alert}>
          {refusal}
        </p>
      ) : null}
    </section>
  );
}
