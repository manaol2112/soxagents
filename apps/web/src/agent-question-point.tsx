"use client";

import { type FormEvent, type ReactNode, useState } from "react";

import {
  inlineComplete,
  inlineScreens,
  type Pick,
  type Prefill,
  type RowPicks,
} from "./control-setup-model";
import { UiIcon } from "./ui-icon";

/**
 * A question the agents raised, answered in place on the review's card (product owner, 12
 * November 2026: "User was not given an option with the question"). The agents' statement
 * and its alternatives, a conflict's sources, or a short interview's steps are the choices,
 * with the person's own words always possible. The answer is recorded by the caller through
 * the same routes as the planner's conversation, which stays one click away.
 */
export function AgentQuestionPoint({
  row,
  canAct,
  busy,
  saving,
  chips,
  title,
  why,
  foot,
  onAnswer,
  onTalk,
}: {
  row: Prefill;
  canAct: boolean;
  busy: boolean;
  saving: boolean;
  chips: ReactNode;
  title: ReactNode;
  why: ReactNode;
  /** The card's footer around its primary action. */
  foot: (primary: ReactNode) => ReactNode;
  onAnswer: (picks: RowPicks) => void;
  onTalk: () => void;
}) {
  const [picks, setPicks] = useState<RowPicks>({});
  // The words typed for each step's "Other", kept while another choice is ticked.
  const [words, setWords] = useState<Record<string, string>>({});
  const screens = inlineScreens(row, picks);
  const complete = inlineComplete(row, picks);
  const conflict = row.source === "CONFLICT";
  const choose = (step: string, pick: Pick) =>
    setPicks((was) => ({ ...was, [step]: pick }));

  return (
    <form
      className="ur-point"
      autoComplete="off"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (complete) {
          onAnswer(picks);
        }
      }}
    >
      {chips}
      {title}
      {row.context !== undefined && row.context !== "" ? (
        <p className="ur-hint">{row.context}</p>
      ) : null}
      <p className="ur-hint" id="ur-hint">
        {conflict
          ? "The sources disagree. Choose the one that reflects how the control runs, or say it in your own words."
          : screens[0]?.suggested !== ""
            ? "The agents' answer is selected. Confirm it holds for this organization, or choose another."
            : "Choose the answer that holds for this organization."}{" "}
        <button
          type="button"
          className="ur-skip"
          disabled={busy}
          onClick={onTalk}
        >
          Talk it through with the planner
        </button>
      </p>
      {row.unchecked === true ? (
        <p className="ur-hint">
          The reviewer agent has not checked the wording of this question.
        </p>
      ) : null}
      {screens.map((screen) => {
        const name = `ur-${row.key}-${screen.step}`;
        const writing = screen.pick !== null && "other" in screen.pick;
        const chosen =
          screen.pick !== null && "label" in screen.pick
            ? screen.pick.label
            : null;
        const legend = screen.question !== "" ? `${name}-q` : "ur-q";
        return (
          <div key={screen.step} className="ur-ask">
            {screen.question !== "" ? (
              <p className="ur-ask-q" id={legend}>
                {screen.question}
              </p>
            ) : null}
            <fieldset
              className="ur-options"
              aria-labelledby={legend}
              aria-describedby="ur-hint"
            >
              {screen.choices.map((option) => {
                const on = chosen === option;
                return (
                  <label
                    key={option}
                    className={`ur-option${on ? " is-on" : ""}`}
                  >
                    <input
                      type="radio"
                      name={name}
                      value={option}
                      checked={on}
                      disabled={!canAct || busy}
                      onChange={() => choose(screen.step, { label: option })}
                    />
                    <span className="ur-dot" aria-hidden="true" />
                    <span className="ur-option-text">{option}</span>
                    {option === screen.suggested && option !== "" ? (
                      <span className="ur-tag">
                        {row.source === "SOURCES"
                          ? "From the records"
                          : row.source === "TYPICAL"
                            ? "Usual"
                            : "Proposed"}
                      </span>
                    ) : null}
                  </label>
                );
              })}
              <label className={`ur-option is-other${writing ? " is-on" : ""}`}>
                <input
                  type="radio"
                  name={name}
                  value="@other"
                  checked={writing}
                  disabled={!canAct || busy}
                  onChange={() =>
                    choose(screen.step, { other: words[screen.step] ?? "" })
                  }
                />
                <span className="ur-dot" aria-hidden="true" />
                <span className="ur-option-text">Other (specify)</span>
              </label>
            </fieldset>
            {writing ? (
              <input
                className="ur-other"
                type="text"
                maxLength={300}
                value={words[screen.step] ?? ""}
                disabled={!canAct || busy}
                placeholder="Type the organization's answer"
                aria-label={`Answer to: ${screen.question || row.question}`}
                onChange={(event) => {
                  const value = event.target.value;
                  setWords((was) => ({ ...was, [screen.step]: value }));
                  choose(screen.step, { other: value });
                }}
              />
            ) : null}
          </div>
        );
      })}
      {why}
      {foot(
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!canAct || busy || !complete}
        >
          {saving ? (
            <span className="spinner small" aria-hidden="true" />
          ) : null}
          {saving ? "Saving…" : "Save & continue"}
          <UiIcon name="arrow" size={14} />
        </button>,
      )}
    </form>
  );
}
