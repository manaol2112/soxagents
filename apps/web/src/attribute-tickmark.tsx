"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  type AnnotationChoice,
  annotationChoices,
  annotationOf,
  draftFrom,
  endingLine,
  fileRef,
  recordedLine,
  TICKMARK_WORDS,
  type TickmarkDraft,
  type TickmarkOffer,
  tickmarkFields,
  tickmarkProblems,
} from "./check-digest-model";
import type { AnnotationSet } from "./evidence-annotations-model";
import {
  type AttributeLine,
  DISPOSITION_BOUNDS,
  type DispositionKind,
  type RowFile,
} from "./evidence-assurance-model";
import { RowMenu, type RowMenuItem } from "./row-menu";
import { UiIcon } from "./ui-icon";

/**
 * A person's tickmark on one attribute (docs/evidence-assurance.md, section 10.13), in the
 * attribute view of a finished check: "Add evidence" (the row's own upload and picker),
 * "Tickmark" (a small form in place), the disposition that stands with "Change" and
 * "Reopen", and the ended ones under "History". What the check found stays below it,
 * unchanged. Nothing here decides: the row sends through its own handlers, success is
 * said only once the server has answered, and a refusal is the server's own sentence.
 */

export const TICKMARK = "Tickmark";
export const ADD_EVIDENCE = "Add evidence";
export const UPLOAD_A_FILE = "Upload a file";
export const USE_A_HELD_FILE = "Use a file the control holds";
export const TICKMARK_RECORD = "Record";
export const TICKMARK_CHANGE = "Change";
export const TICKMARK_REOPEN = "Reopen";
export const TICKMARK_HISTORY = "History";
export const TICKMARK_RECORDED = "Tickmark recorded.";
export const TICKMARK_REOPENED =
  "Tickmark reopened. The attribute waits on you again.";
export const ADD_AN_ANNOTATION = "Add an annotation";
export const RELIED_ON_LABEL = "What you relied on instead";
export const REOPEN_LABEL = "Why reopen it";
export const NO_ANNOTATION =
  "No annotation a person reviewed shows this attribute yet. Add one on the evidence, then choose it here.";
export const READING_ITS_ANNOTATION = "Reading its annotation…";
export const AN_ANNOTATION = "An annotation on the evidence.";
export const ANNOTATIONS_UNREAD = "The annotations could not be read.";
export const TRY_AGAIN = "Try again";

/** The row's own ways to add evidence to the request. */
export type DigestAddEvidence = {
  /** Opens the evidence wizard on this request. */
  upload: () => void;
  /** Why it cannot be used now; null when it can. */
  uploadOff: string | null;
  /** Opens the row's "Use a file the control holds" picker. */
  held: () => void;
  heldOff: string | null;
};

/** What anyone who can see the row may read of a tickmark: the annotations of the
 * request's files (read only), and the one viewer on one of them. */
export type DigestTickmarkRead = {
  /** The annotations of the request's files, read when asked; null where they could
   * not be read. */
  annotations: () => Promise<AnnotationSet[] | null>;
  /** Opens the one viewer on an annotation. */
  openAnnotation: (fileId: string, annotationId: string) => void;
};

/** The row's own calls for a tickmark: each answers the server's refusal in one sentence,
 * or null once the server has confirmed it. Each names the disposition the person saw
 * standing (section 10.13, "As built (server)"): a recording what it replaces (null for
 * none), a reopening the one it reopens, so a stale page never changes one unseen. */
export type DigestTickmarkAction = DigestTickmarkRead & {
  /** What may be recorded on the attribute; null where nothing may. */
  offer: (line: AttributeLine) => TickmarkOffer | null;
  record: (
    attributeId: string,
    fields: Record<string, string>,
    replaces: string | null,
  ) => Promise<string | null>;
  reopen: (
    attributeId: string,
    id: string,
    reason: string,
  ) => Promise<string | null>;
  /** Opens the one viewer on a file to add an annotation for the attribute; `back` runs
   * once it closes. */
  addAnnotation: (
    fileId: string,
    attributeId: string,
    back: () => void,
  ) => void;
};

type Choices = {
  status: "idle" | "loading" | "failed" | "ready";
  sets: AnnotationSet[];
};

/**
 * A count under a text field. It is read with the field (aria-describedby), never on
 * every keystroke: a polite announcement only where the text crosses the limit, either
 * way, and when the form is sent (`submits` grows).
 */
function Count({
  id,
  used,
  max,
  submits,
}: {
  id: string;
  used: number;
  max: number;
  submits: number;
}) {
  const over = used > max;
  const [said, setSaid] = useState("");
  const crossed = useRef(over);
  const now = useRef("");
  now.current = `${used} of ${max} characters${over ? ", over the limit" : ""}.`;
  useEffect(() => {
    if (crossed.current === over) {
      return;
    }
    crossed.current = over;
    setSaid(
      over
        ? `Over the limit of ${max} characters.`
        : `Back within the limit of ${max} characters.`,
    );
  }, [over, max]);
  useEffect(() => {
    if (submits > 0) {
      // Said again on each send, even where nothing changed since the last.
      setSaid(`${now.current}${submits % 2 === 0 ? "\u00a0" : ""}`);
    }
  }, [submits]);
  return (
    <>
      <span id={id} className={`cdg-tmf-count${over ? " is-over" : ""}`}>
        {`${used} of ${max} characters`}
      </span>
      <span className="sr-only" aria-live="polite" data-cdg-count-said="">
        {said}
      </span>
    </>
  );
}

const spoken = (text: string) => text.replace(/\s+/g, " ").trim().length;

/** The annotation a disposition rests on, as "E2 · View", opening the one viewer on it.
 * Read once for anyone who can see the row; where it cannot be read, or is not listed,
 * "An annotation on the evidence.", never a reading line that does not end. */
function RestsOn({
  found,
  status,
  letter,
  open,
  retry,
}: {
  found: AnnotationChoice | null;
  status: Choices["status"];
  letter: string;
  open: ((fileId: string, annotationId: string) => void) | null;
  /** Reads the annotations again; null where they cannot be read here. */
  retry: (() => void) | null;
}) {
  if (found === null) {
    return (
      <p className="cdg-tm-line">
        <span className="cdg-cap">Rests on</span>
        {retry !== null && (status === "loading" || status === "idle") ? (
          <span className="cdg-quiet-note">{READING_ITS_ANNOTATION}</span>
        ) : (
          <span>{AN_ANNOTATION}</span>
        )}
        {retry !== null && status === "failed" ? (
          <button type="button" className="cdg-link" onClick={retry}>
            {TRY_AGAIN}
            <span className="sr-only">{` reading the annotation for attribute ${letter}`}</span>
          </button>
        ) : null}
      </p>
    );
  }
  return (
    <p className="cdg-tm-line">
      <span className="cdg-cap">Rests on</span>
      <span>
        {found.label !== "" ? `${found.label}. ` : ""}
        {found.statement}
      </span>
      {open !== null ? (
        <button
          type="button"
          className="cdg-link"
          onClick={() => open(found.fileId, found.id)}
        >
          <span aria-hidden="true">{`${found.ref || "File"} · View`}</span>
          <span className="sr-only">{`View annotation ${found.number} on ${found.ref || "the file"} for attribute ${letter}`}</span>
        </button>
      ) : null}
    </p>
  );
}

/** The ended dispositions, under a closed "History". */
function History({ line }: { line: AttributeLine }) {
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
        {`${TICKMARK_HISTORY} (${line.history.length})`}
        <span className="sr-only"> of the tickmarks on this attribute</span>
        <UiIcon name="chevron" size={12} />
      </button>
      <ul id={`${id}-history`} hidden={!open}>
        {line.history.map((item) => (
          <li key={item.id}>
            <p>
              <strong>{TICKMARK_WORDS[item.kind].shown}</strong>
              <span className="cdg-tm-by">
                {recordedLine(item.recordedBy, item.recordedAt)}
              </span>
            </p>
            {/* How it ended, under a neutral label, with the server's own reason for
                every ending where it gave one. */}
            <p className="cdg-tm-ended">{endingLine(item)}</p>
            {item.reason !== "" ? (
              <p className="cdg-tm-ended">{`Reason: ${item.reason}`}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Under the attribute's status line: "Add evidence" and "Tickmark" (or, where one stands,
 * the disposition with "Change" and "Reopen"); the form in place; then the history.
 */
export function AttributeTickmark({
  line,
  letter,
  files,
  tickmark,
  addEvidence,
  read = null,
}: {
  line: AttributeLine;
  letter: string;
  files: RowFile[];
  /** Null for a person who may not act: nothing is offered. */
  tickmark: DigestTickmarkAction | null;
  /** Null for a person who may not act. */
  addEvidence: DigestAddEvidence | null;
  /** What anyone who can see the row may read (the annotation a tickmark rests on);
   * null where nothing can be read. The person who may act reads through `tickmark`. */
  read?: DigestTickmarkRead | null;
}) {
  const id = useId();
  const standing = line.disposition;
  const offer = tickmark?.offer(line) ?? null;
  const [mode, setMode] = useState<"none" | "form" | "reopen">("none");
  const [draft, setDraft] = useState<TickmarkDraft>(() => draftFrom(null));
  const [tried, setTried] = useState(false);
  // Each send of a form, so that its counts are said then (Count).
  const [submits, setSubmits] = useState(0);
  // The disposition the person saw standing when the form opened (its id; null for
  // none): what a recording replaces and a reopening reopens. After a refusal the form
  // follows what stands once the list is read again, which the person then sees.
  const [seen, setSeen] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [onFile, setOnFile] = useState(files[0]?.id ?? "");
  const [choices, setChoices] = useState<Choices>({
    status: "idle",
    sets: [],
  });
  // What reads the annotations: the person's own calls, else what anyone may read.
  const reader: DigestTickmarkRead | null = tickmark ?? read;
  // Where the focus goes back to when the form or the reopen closes.
  const opener = useRef<HTMLElement | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const reopenRef = useRef<HTMLTextAreaElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  // A later answer overtakes an earlier one: a stale list never replaces a newer one.
  const latest = useRef(0);

  const readChoices = useCallback(async () => {
    if (reader === null) {
      return;
    }
    const run = ++latest.current;
    setChoices((was) => ({ status: "loading", sets: was.sets }));
    const sets = await reader.annotations();
    if (run !== latest.current) {
      return;
    }
    setChoices(
      sets === null
        ? { status: "failed", sets: [] }
        : { status: "ready", sets },
    );
  }, [reader]);
  const items = annotationChoices(choices.sets, line.attributeId, files);

  // The annotation a standing "Shown, on my review" rests on is read once, to name its
  // file; the person's choices, once the form asks for them. A read that failed is read
  // again only when asked ("Try again", or the form opened again).
  const wanted =
    standing?.kind === "SHOWN_ON_REVIEW" ||
    (mode === "form" && draft.kind === "SHOWN_ON_REVIEW");
  const status = choices.status;
  useEffect(() => {
    if (wanted && status === "idle") {
      void readChoices();
    }
  }, [wanted, status, readChoices]);

  // After a refusal, what stands once the list is read again is what the person sees.
  const standingId = standing?.id ?? null;
  useEffect(() => {
    if (follow) {
      setSeen(standingId);
    }
  }, [follow, standingId]);
  // A reopening whose tickmark no longer stands has nothing left to reopen: the form
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

  if (offer === null && addEvidence === null && standing === null) {
    return <History line={line} />;
  }

  const open = (next: "form" | "reopen", from: HTMLElement) => {
    opener.current = from;
    setProblem(null);
    setDone("");
    setTried(false);
    setSeen(standing?.id ?? null);
    setFollow(false);
    // A read that failed is tried again once the form opens again.
    setChoices((was) =>
      was.status === "failed" ? { status: "idle", sets: [] } : was,
    );
    if (next === "form") {
      // "Change" starts from what stands; a kind the check no longer allows is not kept.
      const start = draftFrom(standing);
      const kept =
        start.kind !== null &&
        offer !== null &&
        !offer.kinds.includes(start.kind)
          ? { ...start, kind: null }
          : start;
      // Where one kind is all that may be recorded (a contradiction), it is chosen.
      const [one, ...more] = offer?.kinds ?? [];
      setDraft(
        kept.kind === null && one !== undefined && more.length === 0
          ? { ...kept, kind: one }
          : kept,
      );
    } else {
      setReopenReason("");
    }
    setMode(next);
  };
  const close = () => {
    setMode("none");
    setProblem(null);
    const back = opener.current;
    // Back to what opened it, where it is still there.
    window.setTimeout(() => back?.isConnected && back.focus(), 0);
  };
  const confirmed = (words: string) => {
    setMode("none");
    setDone(words);
    window.setTimeout(() => doneRef.current?.focus(), 0);
  };

  const problems = tickmarkProblems(draft);
  const submit = async () => {
    setTried(true);
    setSubmits((n) => n + 1);
    if (
      tickmark === null ||
      busy ||
      draft.kind === null ||
      Object.keys(problems).length > 0
    ) {
      return;
    }
    setBusy(true);
    setProblem(null);
    setFollow(false);
    const refused = await tickmark.record(
      line.attributeId,
      tickmarkFields({ ...draft, kind: draft.kind }),
      seen,
    );
    setBusy(false);
    if (refused === null) {
      confirmed(TICKMARK_RECORDED);
    } else {
      setProblem(refused);
      setFollow(true);
    }
  };
  const reopenProblem =
    spoken(reopenReason) < DISPOSITION_BOUNDS.reasonMin
      ? `Give the reason in a sentence of at least ${DISPOSITION_BOUNDS.reasonMin} characters.`
      : spoken(reopenReason) > DISPOSITION_BOUNDS.reasonMax
        ? `The reason can be at most ${DISPOSITION_BOUNDS.reasonMax} characters.`
        : null;
  const reopen = async () => {
    setTried(true);
    setSubmits((n) => n + 1);
    if (tickmark === null || seen === null || busy || reopenProblem !== null) {
      return;
    }
    setBusy(true);
    setProblem(null);
    setFollow(false);
    const refused = await tickmark.reopen(
      line.attributeId,
      seen,
      reopenReason.replace(/\s+/g, " ").trim(),
    );
    setBusy(false);
    if (refused === null) {
      confirmed(TICKMARK_REOPENED);
    } else {
      setProblem(refused);
      setFollow(true);
    }
  };

  const set = (change: Partial<TickmarkDraft>) =>
    setDraft((was) => ({ ...was, ...change }));
  const err = (field: keyof typeof problems) =>
    tried ? (problems[field] ?? null) : null;
  const kinds: readonly DispositionKind[] = offer?.kinds ?? [];
  const menu: RowMenuItem[] =
    addEvidence === null
      ? []
      : [
          {
            label: UPLOAD_A_FILE,
            icon: "upload",
            onSelect: addEvidence.upload,
            unavailable: addEvidence.uploadOff,
          },
          {
            label: USE_A_HELD_FILE,
            icon: "paperclip",
            onSelect: addEvidence.held,
            unavailable: addEvidence.heldOff,
          },
        ];

  const words = standing === null ? null : TICKMARK_WORDS[standing.kind];
  return (
    <div className="cdg-tm-wrap">
      {standing !== null && words !== null ? (
        <section
          className={`cdg-tm is-${words.tone}`}
          aria-labelledby={`${id}-standing`}
        >
          <div className="cdg-tm-head">
            <span className="cdg-cap">{TICKMARK}</span>
            <h6 id={`${id}-standing`} className={`cdg-state is-${words.tone}`}>
              <UiIcon name={words.icon} size={13} />
              {words.shown}
            </h6>
            <span className="cdg-tm-by">
              {recordedLine(standing.recordedBy, standing.recordedAt)}
            </span>
            {offer !== null ? (
              // Hidden, not removed, while a form is open: the focus comes back to it.
              <span className="cdg-tm-acts" hidden={mode !== "none"}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={(event) => open("form", event.currentTarget)}
                >
                  {TICKMARK_CHANGE}
                  <span className="sr-only">{` the tickmark on attribute ${letter}`}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={(event) => open("reopen", event.currentTarget)}
                >
                  {TICKMARK_REOPEN}
                  <span className="sr-only">{` the tickmark on attribute ${letter}`}</span>
                </button>
              </span>
            ) : null}
          </div>
          <p className="cdg-tm-reason">{standing.reason}</p>
          {standing.reliedOn !== "" ? (
            <p className="cdg-tm-line">
              <span className="cdg-cap">Relied on instead</span>
              <span>{standing.reliedOn}</span>
            </p>
          ) : null}
          {standing.kind === "SHOWN_ON_REVIEW" ? (
            <RestsOn
              found={annotationOf(choices.sets, standing.annotationId, files)}
              status={choices.status}
              letter={letter}
              open={reader?.openAnnotation ?? null}
              retry={reader === null ? null : () => void readChoices()}
            />
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
                max={DISPOSITION_BOUNDS.reasonMax}
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
                  {busy ? "Reopening…" : TICKMARK_REOPEN}
                </button>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}
      {addEvidence !== null || (offer !== null && standing === null) ? (
        <div className="cdg-tm-bar" hidden={mode === "form"}>
          {addEvidence !== null ? (
            <RowMenu
              label={`attribute ${letter}`}
              items={menu}
              trigger={{
                label: ADD_EVIDENCE,
                icon: "plus",
                className: "btn-secondary btn-sm cdg-tm-add",
                ariaLabel: `${ADD_EVIDENCE} for attribute ${letter}`,
              }}
            />
          ) : null}
          {offer !== null && standing === null ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={(event) => open("form", event.currentTarget)}
            >
              <UiIcon name="tag" size={13} />
              {TICKMARK}
              <span className="sr-only">{` attribute ${letter}`}</span>
            </button>
          ) : null}
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
              ? `${TICKMARK} for attribute ${letter}`
              : `Change the tickmark on attribute ${letter}`}
          </h6>
          {offer.note !== "" ? (
            <p className="cdg-tmf-note">
              <UiIcon name="info" size={13} />
              {offer.note}
            </p>
          ) : null}
          <fieldset
            className="cdg-tmf-kinds"
            aria-describedby={
              err("kind") !== null ? `${id}-kind-error` : undefined
            }
          >
            <legend>What you conclude</legend>
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
                  <strong>{TICKMARK_WORDS[kind].label}</strong>
                  <span className="cdg-tmf-hint">
                    {TICKMARK_WORDS[kind].hint}
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
          {draft.kind === "SHOWN_ON_REVIEW" ? (
            <fieldset
              className="cdg-tmf-notes"
              aria-describedby={
                err("annotation") !== null ? `${id}-note-error` : undefined
              }
            >
              <legend>The annotation it rests on</legend>
              {(choices.status === "loading" || choices.status === "idle") &&
              items.length === 0 ? (
                <p className="cdg-quiet-note" role="status">
                  Reading the annotations…
                </p>
              ) : choices.status === "failed" ? (
                <p className="cdg-tmf-error cdg-tm-line">
                  <span>{ANNOTATIONS_UNREAD}</span>
                  <button
                    type="button"
                    className="cdg-link"
                    onClick={() => void readChoices()}
                  >
                    {TRY_AGAIN}
                    <span className="sr-only"> reading the annotations</span>
                  </button>
                </p>
              ) : items.length === 0 ? (
                <p className="cdg-quiet-note">{NO_ANNOTATION}</p>
              ) : (
                items.map((choice) => (
                  <label key={choice.id} className="cdg-tmf-kind">
                    <input
                      type="radio"
                      name={`${id}-note`}
                      value={choice.id}
                      checked={draft.annotationId === choice.id}
                      onChange={() => set({ annotationId: choice.id })}
                    />
                    <span>
                      <strong>
                        {`${choice.ref || "File"}, annotation ${choice.number}`}
                        {choice.label !== "" ? `: ${choice.label}` : ""}
                      </strong>
                      <span className="cdg-tmf-hint">
                        {`${choice.kindWords}. `}
                        {choice.statement}
                        {choice.decidedBy !== ""
                          ? ` Reviewed by ${choice.decidedBy}.`
                          : ""}
                      </span>
                    </span>
                  </label>
                ))
              )}
              {tickmark !== null && files.length > 0 ? (
                <div className="cdg-tmf-add">
                  {files.length > 1 ? (
                    <>
                      <label htmlFor={`${id}-file`} className="sr-only">
                        The file to annotate
                      </label>
                      <select
                        id={`${id}-file`}
                        value={onFile}
                        onChange={(event) => setOnFile(event.target.value)}
                      >
                        {files.map((file) => (
                          <option key={file.id} value={file.id}>
                            {`${fileRef(files, file.id)} · ${file.name}`}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    ref={addRef}
                    onClick={() =>
                      tickmark.addAnnotation(
                        onFile || (files[0]?.id ?? ""),
                        line.attributeId,
                        () => {
                          // Back in the form: what was added is read, and the focus
                          // is where it was.
                          void readChoices();
                          window.setTimeout(() => addRef.current?.focus(), 0);
                        },
                      )
                    }
                  >
                    <UiIcon name="plus" size={13} />
                    {ADD_AN_ANNOTATION}
                  </button>
                </div>
              ) : null}
              {err("annotation") !== null ? (
                <p id={`${id}-note-error`} className="cdg-tmf-error">
                  {err("annotation")}
                </p>
              ) : null}
            </fieldset>
          ) : null}
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
              max={DISPOSITION_BOUNDS.reasonMax}
              submits={submits}
            />
            {err("reason") !== null ? (
              <p id={`${id}-reason-error`} className="cdg-tmf-error">
                {err("reason")}
              </p>
            ) : null}
          </div>
          {draft.kind === "NOT_AVAILABLE" ? (
            <div className="cdg-tmf-field">
              <label htmlFor={`${id}-relied`}>
                {RELIED_ON_LABEL}
                <span className="cdg-tmf-optional"> (optional)</span>
              </label>
              <textarea
                id={`${id}-relied`}
                rows={2}
                value={draft.reliedOn}
                aria-invalid={err("reliedOn") !== null}
                aria-describedby={`${id}-relied-count${err("reliedOn") !== null ? ` ${id}-relied-error` : ""}`}
                onChange={(event) => set({ reliedOn: event.target.value })}
              />
              <Count
                id={`${id}-relied-count`}
                used={spoken(draft.reliedOn)}
                max={DISPOSITION_BOUNDS.reliedOnMax}
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
              {busy ? "Recording…" : TICKMARK_RECORD}
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
    </div>
  );
}
