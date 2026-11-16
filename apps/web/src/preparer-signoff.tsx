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
        <h6 id={`${uid}-h`}>Preparer's sign-off</h6>
        <div className="ps-row">
          <p className="ps-line">
            {preparedLine(prepared.by, prepared.on, prepared.version)}
          </p>
          {mayAct && !reopening ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setReopening(true)}
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
                  className="btn btn-secondary btn-sm"
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
                  className="btn btn-sm"
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
        <h6 id={`${uid}-h`}>Preparer's sign-off</h6>
        <p className="ps-line dw-quiet">Not signed by the preparer yet.</p>
      </section>
    );
  }
  const ready = problems.length === 0;
  return (
    <section className="ps" aria-labelledby={`${uid}-h`}>
      <h6 id={`${uid}-h`}>Preparer's sign-off</h6>
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
        <p className="ps-attest">{ATTESTATION}</p>
        <label htmlFor={`${uid}-n`}>{NOTE_LABEL}</label>
        <textarea
          id={`${uid}-n`}
          rows={2}
          maxLength={500}
          value={text}
          disabled={sending}
          onChange={(event) => setText(event.currentTarget.value)}
        />
        {problems.length > 0 ? (
          <ul className="ps-needs" id={`${uid}-needs`}>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : null}
        <div className="ps-actions">
          <button
            type="submit"
            className="btn btn-sm"
            aria-disabled={!ready || sending}
            aria-describedby={problems.length > 0 ? `${uid}-needs` : undefined}
          >
            {sending ? "Signing…" : SIGN_AS_PREPARER}
          </button>
        </div>
      </form>
      {refusal !== "" ? (
        <p className="ps-refusal" role="alert" tabIndex={-1} ref={alert}>
          {refusal}
        </p>
      ) : null}
    </section>
  );
}
