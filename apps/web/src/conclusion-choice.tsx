"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import {
  BASIS_WORDS,
  type ChoiceDraft,
  type ChoiceFacts,
  CONCLUSION_BASES,
  CONCLUSION_HINTS,
  CONCLUSION_KINDS,
  CONCLUSION_WORDS,
  type ConclusionChoice,
  type ConclusionKind,
  choiceProblems,
  choiceRefusal,
  parseDesignConclusion,
  REASON_MAX,
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

const draftOf = (choice: ConclusionChoice | null): ChoiceDraft => ({
  kind: choice?.kind ?? null,
  basis: choice?.basis ?? null,
  reason: choice?.reason ?? "",
});

/** Whether the draft is the conclusion that stands. `reason` is what the draft would
 * send: "" where its conclusion needs none. */
const sameDraft = (
  draft: ChoiceDraft,
  reason: string,
  choice: ConclusionChoice | null,
) =>
  choice !== null &&
  draft.kind === choice.kind &&
  (draft.kind !== "NOT_EFFECTIVE" || draft.basis === choice.basis) &&
  reason === choice.reason.trim();

export function ConclusionChoicePanel({
  scope,
  choice,
  proposal,
  facts,
  onRecorded,
  onRefused,
  deficiencyHref = null,
}: {
  scope: ChoiceScope;
  /** The preparer's conclusion that stands, as the views last read it. */
  choice: ConclusionChoice | null;
  /** The agent's proposal: a choice that differs from it needs a reason. */
  proposal: ConclusionKind | null;
  facts: ChoiceFacts;
  /** The server confirmed: the conclusion it now holds (read from its answer). */
  onRecorded: (choice: ConclusionChoice | null) => void;
  /** The server refused with a 409: the records changed, and are read again. */
  onRefused: () => void;
  /** Where a design deficiency is logged; null where the page has no link to it. */
  deficiencyHref?: string | null;
}) {
  const uid = useId();
  // The conclusion that stands as far as this panel knows: the views' reading, or the
  // one the server just confirmed, until the views read it too.
  const [standing, setStanding] = useState<ConclusionChoice | null>(choice);
  const [editing, setEditing] = useState(choice === null);
  const [draft, setDraft] = useState<ChoiceDraft>(() => draftOf(choice));
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState("");
  const [notice, setNotice] = useState("");
  // One press, one request.
  const busy = useRef(false);
  const changeButton = useRef<HTMLButtonElement>(null);
  const firstRadio = useRef<HTMLInputElement>(null);
  const focusAfter = useRef<"change" | "radio" | null>(null);
  // The page's records (the D&I conclusion and the workflow) are read again in the
  // background once the server answered: no page is loaded again.
  const refreshRecords = useRecordsRefresh();

  // Another conclusion read by the views (another person's, or after a refusal): it is
  // what stands. What the person is choosing is kept while they are choosing.
  const seen = choice?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only another conclusion read by the views resets the panel.
  useEffect(() => {
    if (busy.current || seen === (standing?.id ?? null)) {
      return;
    }
    setStanding(choice);
    if (choice === null) {
      setEditing(true);
    } else if (!editing) {
      setDraft(draftOf(choice));
    }
  }, [seen]);

  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target === "change") {
      changeButton.current?.focus();
    } else if (target === "radio") {
      firstRadio.current?.focus();
    }
  });

  const problems = choiceProblems(draft, proposal, facts);
  // The reason is this conclusion's only where it asks for one: what was typed for
  // another conclusion is never sent with it.
  const reason = problems.reasonNeeded ? draft.reason.trim() : "";
  const unchanged = sameDraft(draft, reason, standing);
  const ready = editing && problems.ready && !unchanged && !sending;
  const why = !editing
    ? ""
    : sending
      ? "Recording…"
      : problems.kind !== ""
        ? problems.kind
        : problems.basis !== ""
          ? problems.basis
          : problems.reason !== ""
            ? problems.reason
            : unchanged
              ? "Nothing changed yet."
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
      // Recorded: what the server answered is what stands now.
      const confirmed = parseDesignConclusion(answer.result)?.choice ?? null;
      setStanding(confirmed);
      setDraft(draftOf(confirmed));
      setEditing(confirmed === null);
      setNotice(confirmed === null ? "" : "Conclusion recorded.");
      focusAfter.current = "change";
      onRecorded(confirmed);
      refreshRecords();
      return;
    }
    setRefusal(choiceRefusal(answer.status, answer.detail));
    if (answer.status === 409) {
      onRefused();
      refreshRecords();
    }
  }

  const change = () => {
    setEditing(true);
    setNotice("");
    setRefusal("");
    focusAfter.current = "radio";
  };
  const cancel = () => {
    setEditing(false);
    setDraft(draftOf(standing));
    setRefusal("");
    focusAfter.current = "change";
  };

  const reasonId = `${uid}-reason`;
  const reasonHint = `${uid}-reason-hint`;
  const basisHint = `${uid}-basis-hint`;
  const whyId = `${uid}-why`;
  const shownKind = draft.kind;

  return (
    <form
      autoComplete="off"
      className="cc"
      noValidate
      onSubmit={record}
      aria-busy={sending}
      aria-label="The preparer's conclusion"
    >
      <fieldset className="cc-kinds" disabled={sending}>
        <legend>Your conclusion</legend>
        {CONCLUSION_KINDS.map((kind, at) => {
          const off = problems.unavailable[kind];
          const isStanding = standing?.kind === kind;
          const hintId = `${uid}-${kind}`;
          // Not offered now: said under it, and it cannot be chosen (the one that
          // stands stays shown as chosen).
          const disabled = !editing ? !isStanding : off !== "" && !isStanding;
          return (
            <label
              key={kind}
              className={`cc-kind${shownKind === kind ? " is-on" : ""}${off !== "" ? " is-off" : ""}`}
              data-kind={kind}
            >
              <input
                ref={at === 0 ? firstRadio : undefined}
                type="radio"
                name={`${uid}-kind`}
                value={kind}
                checked={shownKind === kind}
                disabled={disabled}
                aria-describedby={hintId}
                onChange={() => {
                  setDraft((before) => ({
                    ...before,
                    kind,
                    basis: kind === "NOT_EFFECTIVE" ? before.basis : null,
                  }));
                  setRefusal("");
                }}
              />
              <span className="cc-kind-copy">
                <span className="cc-kind-words">
                  {CONCLUSION_WORDS[kind]}
                  {kind === proposal ? (
                    <span className="pill tone-ai cc-proposed">
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

      {editing && shownKind === "NOT_EFFECTIVE" ? (
        <fieldset
          className="cc-basis"
          disabled={sending}
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
                  onChange={() => setDraft((before) => ({ ...before, basis }))}
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

      {editing && problems.reasonNeeded ? (
        <div className="cc-reason">
          <label htmlFor={reasonId}>
            Reason (needed: {problems.reasonWhy})
          </label>
          <textarea
            id={reasonId}
            rows={3}
            value={draft.reason}
            disabled={sending}
            maxLength={REASON_MAX + 200}
            aria-invalid={problems.reason !== "" && draft.reason.trim() !== ""}
            aria-describedby={reasonHint}
            onChange={(event) => {
              const reason = event.currentTarget.value;
              setDraft((before) => ({ ...before, reason }));
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
        {editing ? (
          <>
            <button
              type="submit"
              disabled={!ready}
              aria-describedby={why !== "" ? whyId : undefined}
            >
              {sending ? "Recording…" : "Record conclusion"}
            </button>
            {standing !== null ? (
              <button
                type="button"
                className="btn-secondary"
                disabled={sending}
                onClick={cancel}
              >
                Cancel
              </button>
            ) : null}
          </>
        ) : (
          <button
            ref={changeButton}
            type="button"
            className="btn-secondary"
            onClick={change}
          >
            Change
            <span className="sr-only"> the conclusion</span>
          </button>
        )}
        <span id={whyId} className="form-hint cc-why" role="status">
          {editing ? why : notice}
        </span>
      </div>
      {refusal !== "" ? (
        <p className="cc-refusal" role="alert">
          {refusal}
        </p>
      ) : null}
    </form>
  );
}
