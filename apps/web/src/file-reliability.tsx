"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Count } from "./attribute-tickmark";
import {
  RELIABILITY_BOUNDS,
  type ReliabilityKind,
  type ReliabilityLine,
} from "./evidence-assurance-model";
import {
  decidedLine,
  RELIABILITY_DECIDE,
  RELIABILITY_WORDS,
  type ReliabilityDraft,
  type ReliabilityOffer,
  reliabilityDraftFrom,
  reliabilityEndingLine,
  reliabilityFields,
  reliabilityProblems,
} from "./file-reliability-model";
import { UiIcon } from "./ui-icon";

/**
 * A person's decision on a file's reliability (docs/evidence-assurance.md, section 10.14):
 * what the check found of the file, the decision that stands with who, when, the reason
 * and what was relied on, "Change" and "Reopen", a small form in place, and the ended
 * ones under "History". Drawn in the first screen of a finished check (opened from the
 * file's item or from the quiet line) and in the file's "About this file" tab. Nothing
 * here decides: the row sends through its own handlers, success is said only once the
 * server has answered, and a refusal is the server's own sentence, kept where it was said.
 */

export const RELIABILITY_TITLE = "Reliability";
export const RELIABILITY_FOUND = "The check found";
export const RELIABILITY_RECORD = "Record";
export const RELIABILITY_CHANGE = "Change";
export const RELIABILITY_REOPEN = "Reopen";
export const RELIABILITY_HISTORY = "History";
export const RELIABILITY_RECORDED = "Decision recorded.";
export const RELIABILITY_REOPENED =
  "Decision reopened. The file's reliability waits on you again.";
export const RELIED_ON_LABEL = "What you relied on";
export const RELIED_ON_SHOWN = "Relied on";
export const REOPEN_LABEL = "Why reopen it";
export const KINDS_LEGEND = "What you decided";

/** The row's own calls for a decision: each answers the server's refusal in one
 * sentence, or null once the server has confirmed it. Each names the decision the person
 * saw standing: a recording what it replaces (null for none), a reopening the one it
 * reopens, so a stale page never changes one unseen. */
export type ReliabilityAction = {
  /** What may be decided on the file; null where nothing may. */
  offer: (line: ReliabilityLine) => ReliabilityOffer | null;
  record: (
    fileId: string,
    fields: Record<string, string>,
    replaces: string | null,
  ) => Promise<string | null>;
  reopen: (
    fileId: string,
    id: string,
    reason: string,
  ) => Promise<string | null>;
};

const spoken = (text: string) => text.replace(/\s+/g, " ").trim().length;

/** The ended decisions, under a closed "History", each with how it ended. */
function History({ line }: { line: ReliabilityLine }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  if (line.history.length === 0) {
    return null;
  }
  return (
    <div className="cdg-tm-history">
      <button
        type="button"
        className="cdg-link"
        aria-expanded={open}
        aria-controls={`${id}-history`}
        onClick={() => setOpen((value) => !value)}
      >
        {`${RELIABILITY_HISTORY} (${line.history.length})`}
        <span className="sr-only">{` of the decisions on ${line.name}`}</span>
        <UiIcon name="chevron" size={12} />
      </button>
      <ul id={`${id}-history`} hidden={!open}>
        {line.history.map((item) => (
          <li key={item.id}>
            <p>
              <strong>{RELIABILITY_WORDS[item.kind].shown}</strong>
              <span className="cdg-tm-by">
                {decidedLine(item.recordedBy, item.recordedAt)}
              </span>
            </p>
            <p className="cdg-tm-ended">{reliabilityEndingLine(item)}</p>
            {item.reason !== "" ? (
              <p className="cdg-tm-ended">{`Reason: ${item.reason}`}</p>
            ) : null}
            {item.reliedOn !== "" ? (
              <p className="cdg-tm-ended">{`${RELIED_ON_SHOWN}: ${item.reliedOn}`}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The file's reliability: what the check found, the decision that stands (or "Decide"),
 * the form in place, then the history. With `onClose`: its own heading and Close (the
 * first screen); without, under a section that names it ("About this file").
 */
export function FileReliability({
  line,
  fileRef,
  action,
  startForm = false,
  onClose,
}: {
  line: ReliabilityLine;
  /** The file's reference among the row's files ("E6"); "" where it has none. */
  fileRef: string;
  /** Null for a person who may not act: nothing is offered, everything is read. */
  action: ReliabilityAction | null;
  /** Opened by its item's button: the form opens at once where nothing stands. */
  startForm?: boolean;
  /** Where given, the panel has its own heading and Close (the first screen). */
  onClose?: (() => void) | undefined;
}) {
  const id = useId();
  const standing = line.decision;
  const offer = action?.offer(line) ?? null;
  const [mode, setMode] = useState<"none" | "form" | "reopen">("none");
  const [draft, setDraft] = useState<ReliabilityDraft>(() =>
    reliabilityDraftFrom(null),
  );
  const [tried, setTried] = useState(false);
  const [submits, setSubmits] = useState(0);
  // The decision the person saw standing when the form opened (its id; null for none):
  // what a recording replaces and a reopening reopens. After a refusal the form follows
  // what stands once the list is read again, which the person then sees.
  const [seen, setSeen] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const opener = useRef<HTMLElement | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const reopenRef = useRef<HTMLTextAreaElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const decideRef = useRef<HTMLButtonElement>(null);
  const name = fileRef !== "" ? fileRef : line.name;

  const standingId = standing?.id ?? null;
  useEffect(() => {
    if (follow) {
      setSeen(standingId);
    }
  }, [follow, standingId]);
  // A reopening whose decision no longer stands has nothing left to reopen: the form
  // goes, and the server's sentence stays (below).
  useEffect(() => {
    if (mode === "reopen" && standingId === null) {
      setMode("none");
    }
  }, [mode, standingId]);
  // The form takes the focus when it opens: its chosen kind, else the first.
  useEffect(() => {
    if (mode === "form") {
      const form = formRef.current;
      (
        form?.querySelector<HTMLInputElement>('input[type="radio"]:checked') ??
        form?.querySelector<HTMLInputElement>('input[type="radio"]')
      )?.focus();
    } else if (mode === "reopen") {
      reopenRef.current?.focus();
    }
  }, [mode]);

  const open = (next: "form" | "reopen", from: HTMLElement | null) => {
    opener.current = from;
    setProblem(null);
    setDone("");
    setTried(false);
    setSeen(standing?.id ?? null);
    setFollow(false);
    if (next === "form") {
      setDraft(reliabilityDraftFrom(standing));
    } else {
      setReopenReason("");
    }
    setMode(next);
  };
  // Opened by its item's button: the form, at once, where nothing stands and offered;
  // otherwise the panel's heading takes the focus.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    if (startForm && standing === null && offer !== null) {
      open("form", null);
    } else if (onClose !== undefined) {
      headRef.current?.focus();
    }
  });
  const close = () => {
    setMode("none");
    setProblem(null);
    // Once the form has gone: what opened it, else Decide (drawn again now), else the
    // panel's heading.
    window.setTimeout(() => {
      const back = [opener.current, decideRef.current, headRef.current].find(
        (each) => each?.isConnected === true,
      );
      back?.focus();
    }, 0);
  };
  const confirmed = (words: string) => {
    setMode("none");
    setDone(words);
    window.setTimeout(() => doneRef.current?.focus(), 0);
  };

  const problems = reliabilityProblems(draft);
  const submit = async () => {
    setTried(true);
    setSubmits((n) => n + 1);
    if (
      action === null ||
      busy ||
      draft.kind === null ||
      Object.keys(problems).length > 0
    ) {
      return;
    }
    setBusy(true);
    setProblem(null);
    setFollow(false);
    const refused = await action.record(
      line.fileId,
      reliabilityFields({ ...draft, kind: draft.kind }),
      seen,
    );
    setBusy(false);
    if (refused === null) {
      confirmed(RELIABILITY_RECORDED);
    } else {
      setProblem(refused);
      setFollow(true);
    }
  };
  const reopenProblem =
    spoken(reopenReason) < RELIABILITY_BOUNDS.reasonMin
      ? `Give the reason in a sentence of at least ${RELIABILITY_BOUNDS.reasonMin} characters.`
      : spoken(reopenReason) > RELIABILITY_BOUNDS.reasonMax
        ? `The reason can be at most ${RELIABILITY_BOUNDS.reasonMax} characters.`
        : null;
  const reopen = async () => {
    setTried(true);
    setSubmits((n) => n + 1);
    if (action === null || seen === null || busy || reopenProblem !== null) {
      return;
    }
    setBusy(true);
    setProblem(null);
    setFollow(false);
    const refused = await action.reopen(
      line.fileId,
      seen,
      reopenReason.replace(/\s+/g, " ").trim(),
    );
    setBusy(false);
    if (refused === null) {
      confirmed(RELIABILITY_REOPENED);
    } else {
      setProblem(refused);
      setFollow(true);
    }
  };

  const set = (change: Partial<ReliabilityDraft>) =>
    setDraft((was) => ({ ...was, ...change }));
  const err = (field: keyof typeof problems) =>
    tried ? (problems[field] ?? null) : null;
  const kinds: readonly ReliabilityKind[] = offer?.kinds ?? [];
  const words = standing === null ? null : RELIABILITY_WORDS[standing.kind];

  const body = (
    <>
      {onClose !== undefined ? (
        <div className="cdg-rel-head">
          {fileRef !== "" ? (
            <span className="cdg-mark" aria-hidden="true">
              {fileRef}
            </span>
          ) : null}
          <h6 id={`${id}-title`} ref={headRef} tabIndex={-1}>
            {`Reliability of ${line.name}`}
          </h6>
          <button type="button" className="cdg-link" onClick={onClose}>
            Close
            <span className="sr-only">{` the reliability of ${name}`}</span>
          </button>
        </div>
      ) : null}
      {/* What the check found stays, beside any decision: a decision never changes it.
          Where the check sent no sentence, the file's name says it alone. */}
      {line.question !== "" ? (
        <p className="cdg-tm-line cdg-rel-found">
          <span className="cdg-cap">{RELIABILITY_FOUND}</span>
          <span>{line.question}</span>
        </p>
      ) : null}
      {standing !== null && words !== null ? (
        <section className="cdg-tm" aria-labelledby={`${id}-standing`}>
          <div className="cdg-tm-head">
            <span className="cdg-cap">Decision</span>
            <strong
              id={`${id}-standing`}
              className={`cdg-state is-${words.tone}`}
            >
              <UiIcon name={words.icon} size={13} />
              {words.shown}
            </strong>
            <span className="cdg-tm-by">
              {decidedLine(standing.recordedBy, standing.recordedAt)}
            </span>
            {offer !== null ? (
              // Hidden, not removed, while a form is open: the focus comes back to it.
              <span className="cdg-tm-acts" hidden={mode !== "none"}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={(event) => open("form", event.currentTarget)}
                >
                  {RELIABILITY_CHANGE}
                  <span className="sr-only">{` the decision on ${name}`}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={(event) => open("reopen", event.currentTarget)}
                >
                  {RELIABILITY_REOPEN}
                  <span className="sr-only">{` the decision on ${name}`}</span>
                </button>
              </span>
            ) : null}
          </div>
          <p className="cdg-tm-reason">{standing.reason}</p>
          {standing.reliedOn !== "" ? (
            <p className="cdg-tm-line">
              <span className="cdg-cap">{RELIED_ON_SHOWN}</span>
              <span>{standing.reliedOn}</span>
            </p>
          ) : null}
          {mode === "reopen" ? (
            <form
              className="cdg-tmf is-reopen"
              noValidate
              autoComplete="off"
              onSubmit={(event) => {
                event.preventDefault();
                void reopen();
              }}
            >
              <label htmlFor={`${id}-reopen`}>{REOPEN_LABEL}</label>
              <textarea
                id={`${id}-reopen`}
                ref={reopenRef}
                rows={2}
                value={reopenReason}
                aria-invalid={tried && reopenProblem !== null}
                aria-describedby={`${id}-reopen-count${tried && reopenProblem !== null ? ` ${id}-reopen-error` : ""}`}
                onChange={(event) => setReopenReason(event.target.value)}
              />
              <Count
                id={`${id}-reopen-count`}
                used={spoken(reopenReason)}
                max={RELIABILITY_BOUNDS.reasonMax}
                submits={submits}
              />
              {tried && reopenProblem !== null ? (
                <p id={`${id}-reopen-error`} className="cdg-tmf-error">
                  {reopenProblem}
                </p>
              ) : null}
              {problem !== null ? (
                <p className="cdg-tmf-problem" role="alert">
                  {problem}
                </p>
              ) : null}
              <div className="cdg-tmf-acts">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={close}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-secondary btn-sm"
                  disabled={busy}
                >
                  {busy ? "Reopening…" : RELIABILITY_REOPEN}
                </button>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}
      {standing === null && offer !== null && mode !== "form" ? (
        <div className="cdg-tm-bar">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            ref={decideRef}
            onClick={(event) => open("form", event.currentTarget)}
          >
            {RELIABILITY_DECIDE}
            <span className="sr-only">{` the reliability of ${name}`}</span>
          </button>
        </div>
      ) : null}
      {done !== "" ? (
        <p className="cdg-tm-done" role="status" tabIndex={-1} ref={doneRef}>
          <UiIcon name="check" size={13} />
          {done}
        </p>
      ) : null}
      {mode === "form" && offer !== null ? (
        <form
          className="cdg-tmf"
          ref={formRef}
          noValidate
          autoComplete="off"
          aria-labelledby={`${id}-form`}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h6 id={`${id}-form`} className="cdg-tmf-title">
            {standing === null
              ? `Decide the reliability of ${name}`
              : `Change the decision on ${name}`}
          </h6>
          <fieldset
            className="cdg-tmf-kinds"
            aria-describedby={
              err("kind") !== null ? `${id}-kind-error` : undefined
            }
          >
            <legend>{KINDS_LEGEND}</legend>
            {kinds.map((kind) => (
              <label key={kind} className="cdg-tmf-kind">
                <input
                  type="radio"
                  name={`${id}-kind`}
                  value={kind}
                  checked={draft.kind === kind}
                  onChange={() => set({ kind })}
                />
                <span>
                  <strong>{RELIABILITY_WORDS[kind].label}</strong>
                  <span className="cdg-tmf-hint">
                    {RELIABILITY_WORDS[kind].hint}
                  </span>
                </span>
              </label>
            ))}
            {err("kind") !== null ? (
              <p id={`${id}-kind-error`} className="cdg-tmf-error">
                {err("kind")}
              </p>
            ) : null}
          </fieldset>
          <div className="cdg-tmf-field">
            <label htmlFor={`${id}-reason`}>Reason</label>
            <textarea
              id={`${id}-reason`}
              rows={3}
              value={draft.reason}
              required
              aria-invalid={err("reason") !== null}
              aria-describedby={`${id}-reason-count${err("reason") !== null ? ` ${id}-reason-error` : ""}`}
              onChange={(event) => set({ reason: event.target.value })}
            />
            <Count
              id={`${id}-reason-count`}
              used={spoken(draft.reason)}
              max={RELIABILITY_BOUNDS.reasonMax}
              submits={submits}
            />
            {err("reason") !== null ? (
              <p id={`${id}-reason-error`} className="cdg-tmf-error">
                {err("reason")}
              </p>
            ) : null}
          </div>
          {draft.kind === "ESTABLISHED_ON_REVIEW" ? (
            <div className="cdg-tmf-field">
              <label htmlFor={`${id}-relied`}>{RELIED_ON_LABEL}</label>
              <textarea
                id={`${id}-relied`}
                rows={2}
                value={draft.reliedOn}
                required
                aria-invalid={err("reliedOn") !== null}
                aria-describedby={`${id}-relied-count${err("reliedOn") !== null ? ` ${id}-relied-error` : ""}`}
                onChange={(event) => set({ reliedOn: event.target.value })}
              />
              <Count
                id={`${id}-relied-count`}
                used={spoken(draft.reliedOn)}
                max={RELIABILITY_BOUNDS.reliedOnMax}
                submits={submits}
              />
              {err("reliedOn") !== null ? (
                <p id={`${id}-relied-error`} className="cdg-tmf-error">
                  {err("reliedOn")}
                </p>
              ) : null}
            </div>
          ) : null}
          {problem !== null ? (
            <p className="cdg-tmf-problem" role="alert">
              {problem}
            </p>
          ) : null}
          <div className="cdg-tmf-acts">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={close}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-sm" disabled={busy}>
              {busy ? "Recording…" : RELIABILITY_RECORD}
            </button>
          </div>
        </form>
      ) : null}
      {problem !== null &&
      !(mode === "form" && offer !== null) &&
      !(mode === "reopen" && standing !== null) ? (
        // The form the refusal was said in is gone (what stands changed under it): the
        // server's sentence stays, where the action was taken.
        <p className="cdg-tmf-problem" role="alert">
          {problem}
        </p>
      ) : null}
      <History line={line} />
    </>
  );
  // A region of its own on the first screen; under "About this file", the section that
  // holds it names it.
  return onClose !== undefined ? (
    <section className="cdg-rel is-panel" aria-labelledby={`${id}-title`}>
      {body}
    </section>
  ) : (
    <div className="cdg-rel">{body}</div>
  );
}
