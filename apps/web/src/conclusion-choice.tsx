"use client";

import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  anotherStands,
  BASIS_WORDS,
  type ChoiceDraft,
  type ChoiceFacts,
  CONCLUSION_BASES,
  CONCLUSION_HINTS,
  CONCLUSION_KINDS,
  CONCLUSION_WORDS,
  type ConclusionBasis,
  type ConclusionChoice,
  type ConclusionKind,
  choiceProblems,
  choiceRefusal,
  draftUnchanged,
  parseDesignConclusion,
  REASON_MAX,
  RECORD_AGAIN_HINT,
  RECORDED_UNREAD,
  reasonOnChoosing,
  recordsAgain,
  type TypedReasons,
} from "./design-conclusion-model";
import { CONCLUSION_ANCHOR } from "./design-workpaper-model";
import { useRecordsRefresh } from "./section-editor";

/**
 * The preparer records the D&I conclusion in section 7 of the workpaper
 * (docs/design-workpaper.md, section 3.6): the five conclusions as a radio group, the
 * basis of "Not effective", the reason where one is needed, and "Record conclusion". What
 * is missing, and which conclusions are not offered now and why, is the model's
 * (choiceProblems, mirroring the server's refusals); the server decides. One press sends
 * one request through `POST /workspace/design-conclusions/choice`, and the conclusion
 * reads as recorded only once the server confirmed it. A refusal keeps what was chosen
 * and says the server's sentence. A recorded conclusion shows as the selected option,
 * with "Change"; a change names the conclusion it replaces.
 *
 * After the independent review (15 November 2026; section 3.6, "Tightened"):
 * - A reason belongs to the conclusion it was typed for: choosing another conclusion
 *   never carries it over, and "Change" with nothing changed keeps Record off.
 * - Another conclusion read while this one is being chosen (after a 409, or recorded by
 *   someone else) is shown as what stands, and replacing it takes "Change" again: its id
 *   is never adopted under a draft made against the one before.
 * - A 200 the page cannot read keeps the standing conclusion and the draft, says so,
 *   and reads the records again.
 * - Nothing in the form takes the `disabled` attribute while it has, or may be given,
 *   the focus: a conclusion not offered stays focusable and says why, and after an
 *   answer the focus goes to the refusal or to "Change".
 *
 * Lighter (product owner, 16 November 2026: section 7, option A): the form is drawn only
 * after "Change" (or "Record conclusion" where none is recorded), in place, with Cancel.
 * "Change" is a text link in the head's quiet line (the caller's `head`, given it), what
 * the page says after an answer is a status beside it, and a refusal stays shown under
 * where the form was, so closing the form never takes it away.
 */

/** Whether the page was opened at section 7 (`#di-conclusion`, the link from D&I
 * Conclusion and Review). It only reads the address; nothing changes it. */
export function openedAtConclusion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.location.hash === `#${CONCLUSION_ANCHOR}`
  );
}

export type ChoiceScope = {
  organizationId: string;
  projectId: string;
  controlId: string;
};

type Answer = { status: number; detail: string; result: unknown };

/** The one request a record sends. An answer that cannot be read, or none, is status 0:
 * nothing is taken as recorded. */
async function sendChoice(body: Record<string, unknown>): Promise<Answer> {
  try {
    const response = await fetch("/workspace/design-conclusions/choice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const answer = (await response.json()) as {
      status?: unknown;
      detail?: unknown;
      result?: unknown;
    };
    return {
      status: typeof answer.status === "number" ? answer.status : 0,
      detail: typeof answer.detail === "string" ? answer.detail : "",
      result: answer.result ?? null,
    };
  } catch {
    return { status: 0, detail: "", result: null };
  }
}

/** The conclusion that stands, as a draft: its reason is its own. */
const draftOf = (choice: ConclusionChoice | null): ChoiceDraft => ({
  kind: choice?.kind ?? null,
  basis: choice?.basis ?? null,
  reason: choice?.reason ?? "",
});

export function ConclusionChoicePanel({
  scope,
  choice,
  proposal,
  facts,
  onRecorded,
  onRefused,
  deficiencyHref = null,
  head,
  children,
}: {
  scope: ChoiceScope;
  /** The preparer's conclusion that stands, as the views last read it. */
  choice: ConclusionChoice | null;
  /** The agent's proposal: a choice that differs from it needs a reason. */
  proposal: ConclusionKind | null;
  facts: ChoiceFacts;
  /** The server confirmed: the conclusion it now holds (read from its answer). */
  onRecorded: (choice: ConclusionChoice | null) => void;
  /** The records are read again: the server refused with a 409 (they changed), or it
   * answered a 200 this page could not read. */
  onRefused: () => void;
  /** Where a design deficiency is logged; null where the page has no link to it. */
  deficiencyHref?: string | null;
  /** Section 7's head, given "Change" (or "Record conclusion") and the status beside it
   * to draw in its quiet line. */
  head: (change: ReactNode) => ReactNode;
  /** What stands between the head and the form (the results). */
  children?: ReactNode;
}) {
  const uid = useId();
  // The conclusion that stands as far as this panel knows: the views' reading, or the
  // one the server just confirmed, until the views read it too.
  const [standing, setStanding] = useState<ConclusionChoice | null>(choice);
  // Closed until "Change" or "Record conclusion" is pressed (option A).
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ChoiceDraft>(() => draftOf(choice));
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState("");
  const [notice, setNotice] = useState("");
  // A 200 this page could not read: recorded, and waiting for the views to read it.
  const [unread, setUnread] = useState(false);
  // One press, one request.
  const busy = useRef(false);
  // What the person typed in this session, under the conclusion it was typed for.
  const typed = useRef<TypedReasons>({});
  const basisChosen = useRef<ConclusionBasis | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const alertBox = useRef<HTMLParagraphElement>(null);
  const focusAfter = useRef<"change" | "radio" | "alert" | null>(null);
  // The page's records (the D&I conclusion and the workflow) are read again in the
  // background once the server answered: no page is loaded again.
  const refreshRecords = useRecordsRefresh();

  // Another conclusion read by the views than the one this panel knows: it is what
  // stands, and it is shown as that. A draft made against the conclusion before is not
  // carried onto it (its id would be replaced without the person having seen it):
  // replacing it takes "Change" again, and what was typed is kept for that. A reading
  // with no conclusion never takes one away: conclusions are replaced, never deleted.
  const seen = choice?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only another conclusion read by the views, or the end of a request, resets the panel.
  useEffect(() => {
    if (sending || choice === null || seen === (standing?.id ?? null)) {
      return;
    }
    // The focus moves to "Change" only from a control that goes away; a refusal that
    // has it stays, and is read on (it is still shown).
    const inside =
      form.current?.contains(document.activeElement) === true &&
      document.activeElement !== alertBox.current;
    setStanding(choice);
    setDraft(draftOf(choice));
    setEditing(false);
    if (unread) {
      // The conclusion this panel recorded, now read.
      setUnread(false);
      setRefusal("");
      setNotice("Conclusion recorded.");
    } else {
      setNotice(editing ? anotherStands(choice) : "");
    }
    if (inside || unread) {
      focusAfter.current = "change";
    }
  }, [seen, sending]);

  // After an answer, a change or a cancel the focus goes where the form goes on: it is
  // never left on something that is no longer there. The target is kept until it is
  // drawn: another conclusion read by the views asks for "Change" in the same commit
  // that still shows the form being edited, and it is focused once it is there.
  useEffect(() => {
    const target = focusAfter.current;
    let node: HTMLElement | null = null;
    if (target === "change") {
      node = changeButton.current;
    } else if (target === "alert") {
      node = alertBox.current;
    } else if (target === "radio") {
      const radios = [
        ...(form.current?.querySelectorAll<HTMLInputElement>(
          '.cc-kinds input[type="radio"]',
        ) ?? []),
      ];
      node = radios.find((radio) => radio.checked) ?? radios[0] ?? null;
    }
    if (node !== null) {
      focusAfter.current = null;
      node.focus();
    }
  });

  const problems = choiceProblems(draft, proposal, facts);
  // The reason is this conclusion's only where it asks for one: what was typed for
  // another conclusion is never sent with it.
  const reason = problems.reasonNeeded ? draft.reason.trim() : "";
  const unchanged = draftUnchanged(draft, problems.reasonNeeded, standing);
  // The standing "Exceptions noted", word for word: recorded again where an exception
  // was noted after it (the server's EXCEPTION_SINCE), as "Record again".
  const again = recordsAgain(draft, problems.reasonNeeded, standing);
  // What could be recorded; `ready` is that, while no request is out.
  const recordable = editing && problems.ready && !unchanged && !unread;
  const ready = recordable && !sending;
  const why = !editing
    ? ""
    : sending
      ? "Recording…"
      : unread
        ? "Reading the conclusion again…"
        : problems.kind !== ""
          ? problems.kind
          : problems.basis !== ""
            ? problems.basis
            : problems.reason !== ""
              ? problems.reason
              : unchanged
                ? "Nothing changed yet."
                : again
                  ? RECORD_AGAIN_HINT
                  : "";

  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy.current || draft.kind === null) {
      return;
    }
    busy.current = true;
    setSending(true);
    setRefusal("");
    setNotice("");
    const answer = await sendChoice({
      organization_id: scope.organizationId,
      project_id: scope.projectId,
      control_id: scope.controlId,
      kind: draft.kind,
      ...(draft.kind === "NOT_EFFECTIVE" ? { basis: draft.basis } : {}),
      ...(problems.reasonNeeded ? { reason } : {}),
      replaces: standing?.id ?? null,
    });
    busy.current = false;
    setSending(false);
    if (answer.status === 200) {
      const confirmed = parseDesignConclusion(answer.result)?.choice ?? null;
      if (confirmed === null) {
        // Recorded, but its answer cannot be read: the conclusion that stood and what
        // was chosen are both kept, the page says so, and the records are read again.
        setUnread(true);
        setRefusal(RECORDED_UNREAD);
        focusAfter.current = "alert";
        onRefused();
        refreshRecords();
        return;
      }
      // Recorded: what the server answered is what stands now.
      setStanding(confirmed);
      setDraft(draftOf(confirmed));
      setEditing(false);
      setNotice("Conclusion recorded.");
      focusAfter.current = "change";
      onRecorded(confirmed);
      refreshRecords();
      return;
    }
    setRefusal(choiceRefusal(answer.status, answer.detail));
    focusAfter.current = "alert";
    if (answer.status === 409) {
      onRefused();
      refreshRecords();
    }
  }

  /** Another conclusion is chosen: its own reason comes with it, never another's. */
  const choose = (kind: ConclusionKind) => {
    if (sending || !editing) {
      return;
    }
    setDraft({
      kind,
      basis:
        kind === "NOT_EFFECTIVE"
          ? (basisChosen.current ??
            (standing?.kind === kind ? standing.basis : null))
          : null,
      reason: reasonOnChoosing(kind, typed.current, standing),
    });
    setUnread(false);
    setRefusal("");
  };
  const change = () => {
    setEditing(true);
    setNotice("");
    setRefusal("");
    focusAfter.current = "radio";
  };
  const cancel = () => {
    if (sending) {
      return;
    }
    setEditing(false);
    setDraft(draftOf(standing));
    setUnread(false);
    setRefusal("");
    focusAfter.current = "change";
  };

  const reasonId = `${uid}-reason`;
  const reasonHint = `${uid}-reason-hint`;
  const basisHint = `${uid}-basis-hint`;
  const whyId = `${uid}-why`;
  const shownKind = draft.kind;

  // "Change" in the head's quiet line while the form is closed, and what the page says
  // after an answer beside it: a status that is always there, so it is heard.
  const changeLink = (
    <>
      {editing ? null : (
        <>
          {" · "}
          <button
            ref={changeButton}
            type="button"
            className="dw-link"
            onClick={change}
          >
            {standing === null ? (
              "Record conclusion"
            ) : (
              <>
                Change
                <span className="sr-only"> the conclusion</span>
              </>
            )}
          </button>
        </>
      )}
      <span className="cc-notice" role="status">
        {editing ? "" : notice}
      </span>
    </>
  );

  return (
    <>
      {head(changeLink)}
      {children}
      {editing ? (
        <form
          ref={form}
          autoComplete="off"
          className="cc"
          noValidate
          onSubmit={record}
          aria-busy={sending}
          aria-label="The preparer's conclusion"
        >
          <fieldset className="cc-kinds">
            <legend>Your conclusion</legend>
            {CONCLUSION_KINDS.map((kind) => {
              const off = problems.unavailable[kind];
              const isStanding = standing?.kind === kind;
              const wordsId = `${uid}-${kind}-words`;
              const hintId = `${uid}-${kind}`;
              // Not offered now, or not being changed: it cannot be chosen (the one that
              // stands stays shown as chosen), and it says so without the `disabled`
              // attribute, so it can still be reached and its reason heard.
              const unavailable =
                sending || (!editing ? !isStanding : off !== "" && !isStanding);
              return (
                <label
                  key={kind}
                  className={`cc-kind${shownKind === kind ? " is-on" : ""}${off !== "" ? " is-off" : ""}${unavailable ? " is-unavailable" : ""}`}
                  data-kind={kind}
                >
                  {/* Named by its words alone and described by its hint (or by why it
                      is not offered): the hint is inside the label for the eye, so the
                      name is taken from the words only and the hint is not heard
                      twice. */}
                  <input
                    type="radio"
                    name={`${uid}-kind`}
                    value={kind}
                    checked={shownKind === kind}
                    aria-disabled={unavailable ? "true" : undefined}
                    aria-labelledby={wordsId}
                    aria-describedby={hintId}
                    onClick={(event) => {
                      if (unavailable) {
                        event.preventDefault();
                      }
                    }}
                    onChange={() => {
                      if (!unavailable) {
                        choose(kind);
                      }
                    }}
                  />
                  <span className="cc-kind-copy">
                    <span id={wordsId} className="cc-kind-words">
                      {CONCLUSION_WORDS[kind]}
                      {kind === proposal ? (
                        <span className="cc-proposed">
                          Proposed by the agent
                        </span>
                      ) : null}
                    </span>
                    <small id={hintId} className={off !== "" ? "cc-off" : ""}>
                      {off !== "" ? off : CONCLUSION_HINTS[kind]}
                    </small>
                  </span>
                </label>
              );
            })}
          </fieldset>

          {shownKind === "NOT_EFFECTIVE" ? (
            <fieldset
              className="cc-basis"
              aria-describedby={problems.basis !== "" ? basisHint : undefined}
            >
              <legend>What is not effective (needed)</legend>
              <div className="cc-basis-options">
                {CONCLUSION_BASES.map((basis) => (
                  <label key={basis} className="cc-basis-option">
                    <input
                      type="radio"
                      name={`${uid}-basis`}
                      value={basis}
                      checked={draft.basis === basis}
                      aria-disabled={sending ? "true" : undefined}
                      onChange={() => {
                        if (sending) {
                          return;
                        }
                        basisChosen.current = basis;
                        setDraft((before) => ({ ...before, basis }));
                        setUnread(false);
                      }}
                    />
                    <span>{BASIS_WORDS[basis]}</span>
                  </label>
                ))}
              </div>
              {problems.basis !== "" ? (
                <small id={basisHint} className="cc-hint">
                  {problems.basis}
                </small>
              ) : null}
              {!facts.deficiency ? (
                <small className="cc-hint">
                  Its sign-off needs the design deficiency logged.
                  {deficiencyHref !== null ? (
                    <>
                      {" "}
                      <a href={deficiencyHref}>Log a design deficiency</a>
                    </>
                  ) : null}
                </small>
              ) : null}
            </fieldset>
          ) : null}

          {problems.reasonNeeded ? (
            <div className="cc-reason">
              <label htmlFor={reasonId}>
                Reason (needed: {problems.reasonWhy})
              </label>
              <textarea
                id={reasonId}
                rows={3}
                value={draft.reason}
                readOnly={sending}
                maxLength={REASON_MAX + 200}
                aria-invalid={
                  problems.reason !== "" && draft.reason.trim() !== ""
                }
                aria-describedby={reasonHint}
                onChange={(event) => {
                  const reason = event.currentTarget.value;
                  // Kept under the conclusion it is typed for, for this session.
                  if (draft.kind !== null) {
                    typed.current = { ...typed.current, [draft.kind]: reason };
                  }
                  setDraft((before) => ({ ...before, reason }));
                  setUnread(false);
                }}
              />
              <small id={reasonHint} className="cc-hint">
                {problems.reason !== ""
                  ? problems.reason
                  : `${draft.reason.trim().length.toLocaleString("en-US")} of ${REASON_MAX.toLocaleString("en-US")} characters.`}
              </small>
            </div>
          ) : null}

          <div className="cc-actions">
            {/* While the request is out the button keeps the focus it has (it is not
                given `disabled`): a second press sends nothing (`busy`). */}
            <button
              type="submit"
              className="dw-ink btn-sm"
              disabled={!recordable}
              aria-disabled={sending ? "true" : undefined}
              aria-describedby={why !== "" ? whyId : undefined}
            >
              {sending
                ? "Recording…"
                : again
                  ? "Record again"
                  : "Record conclusion"}
            </button>
            <button
              type="button"
              className="dw-link"
              aria-disabled={sending ? "true" : undefined}
              onClick={cancel}
            >
              Cancel
            </button>
            <span id={whyId} className="form-hint cc-why" role="status">
              {why}
            </span>
          </div>
        </form>
      ) : null}
      {refusal !== "" ? (
        // The focus is brought here after a refusal, so it is never left on a control
        // that changed under it. Outside the form: closing it never takes this away.
        <p
          ref={alertBox}
          className={`cc-refusal${unread ? " is-recorded" : ""}`}
          role="alert"
          tabIndex={-1}
        >
          {refusal}
        </p>
      ) : null}
    </>
  );
}
