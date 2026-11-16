"use client";

import { useId, useRef, useState } from "react";

import {
  ATTESTATION,
  NOTE_LABEL,
  preparedLine,
  REOPEN_TO_CHANGE,
  SIGN_AS_PREPARER,
  type SignOffFacts,
  signOffProblems,
  signOffRefusal,
  signOffRequest,
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
  onDone: () => void;
}) {
  const uid = useId();
  const [text, setText] = useState("");
  const [reopening, setReopening] = useState(false);
  // The optional note's box, drawn once asked for.
  const [noting, setNoting] = useState(false);
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState("");
  const busy = useRef(false);
  const alert = useRef<HTMLParagraphElement>(null);
  const problems = signOffProblems(facts);

  const press = async (intent: "prepare" | "reopen") => {
    if (busy.current) {
      return;
    }
    busy.current = true;
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
      return;
    }
    setText("");
    setReopening(false);
    onDone();
  };

  if (facts.status === "PREPARED") {
    return (
      <section className="ps ps-signed" aria-labelledby={`${uid}-h`}>
        <div className="ps-row">
          <div className="ps-copy">
            <h6 id={`${uid}-h`}>Preparer's sign-off</h6>
            <p className="ps-line">
              {preparedLine(prepared.by, prepared.on, prepared.version)}
            </p>
          </div>
          {mayAct && !reopening ? (
            <button
              type="button"
              className="dw-link"
              onClick={() => {
                setReopening(true);
                // The note's box is the sign-off's: it opens again only when asked.
                setNoting(false);
              }}
            >
              {REOPEN_TO_CHANGE}
            </button>
          ) : null}
        </div>
        {mayAct ? (
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
        aria-busy={sending}
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) {
            void press("prepare");
          }
        }}
      >
        <div className="ps-row">
          <div className="ps-copy">
            <h6 id={`${uid}-h`}>Preparer's sign-off</h6>
            <p className="ps-attest">{ATTESTATION}</p>
          </div>
          <button
            type="submit"
            className="dw-ink btn-sm"
            aria-disabled={!ready || sending}
            aria-describedby={problems.length > 0 ? `${uid}-needs` : undefined}
          >
            {sending ? "Signing…" : SIGN_AS_PREPARER}
          </button>
        </div>
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
              disabled={sending}
              onChange={(event) => setText(event.currentTarget.value)}
            />
          </div>
        ) : ready ? (
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
