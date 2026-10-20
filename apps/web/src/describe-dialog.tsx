"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnswerProgress } from "./answer-progress";
import {
  ASSERTION_CHOICES,
  type DescribeQuestion,
  type StateableFact,
} from "./planning-model";
import { UiIcon } from "./ui-icon";
import { SuggestedAnswer } from "./value-options";

// Who usually performs or reviews a control, as suggestions; the team types its own.
const ROLE_SUGGESTIONS: Record<"PERFORMER" | "REVIEWER", readonly string[]> = {
  PERFORMER: [
    "Process owner",
    "Department manager",
    "Accounts payable supervisor",
    "Financial controller",
    "IT administrator",
    "Application owner",
  ],
  REVIEWER: [
    "No separate reviewer",
    "Financial controller",
    "Department manager",
    "Finance director",
    "IT manager",
    "Application owner",
  ],
};

const splitAssertions = (text: string): string[] =>
  text
    .split(/;|,/)
    .map((part) => part.trim())
    .filter(Boolean);

/**
 * Describe a client's own control: the facts its RCM leaves out (whether it prevents or
 * detects, who performs and reviews it, its assertions), each asked with the input that
 * fits, and the planner's proposals pre-filled to confirm or edit. Saving states them on
 * the control (master_plans.state_facts); a fact left blank stays open.
 */
export function DescribeDialog({
  controlRef,
  questions,
  focus,
  open,
  busy,
  problem,
  onClose,
  onSave,
}: {
  controlRef: string;
  questions: DescribeQuestion[];
  /** The fact the person opened it for: its answer is focused. */
  focus?: string | undefined;
  open: boolean;
  busy: boolean;
  problem: string | null;
  onClose: () => void;
  onSave: (facts: Partial<Record<StateableFact, string>>) => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  useEffect(() => {
    const element = dialog.current;
    if (element === null) {
      return;
    }
    if (open && !element.open) {
      // Each opening starts from the plan: the proposals, and nothing else, filled in.
      setAnswers(
        Object.fromEntries(
          questions.map((question) => [question.field, question.proposal]),
        ),
      );
      element.showModal();
      if (focus !== undefined) {
        window.setTimeout(() => {
          const target = element.querySelector<HTMLElement>(
            `[data-fact="${focus}"] input, [data-fact="${focus}"] textarea`,
          );
          target?.focus();
          target?.scrollIntoView({ block: "center" });
        }, 0);
      }
    } else if (!open && element.open) {
      element.close();
    }
  }, [open, focus, questions]);
  const given = questions.filter(
    (question) => (answers[question.field] ?? "").trim() !== "",
  );
  const set = (field: string, value: string) =>
    setAnswers((current) => ({ ...current, [field]: value }));
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a click on the backdrop cancels; Escape and Cancel do too, through the dialog itself.
    <dialog
      ref={dialog}
      className="confirm-dialog pl-values-dialog pl-answer-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <form
        className="confirm-dialog-body"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          if (given.length > 0) {
            onSave(
              Object.fromEntries(
                given.map((question) => [
                  question.field,
                  (answers[question.field] ?? "").trim(),
                ]),
              ),
            );
          }
        }}
      >
        <h2 id={`${id}-title`}>Describe {controlRef}</h2>
        <p id={`${id}-body`}>
          The client's RCM does not say these about the control. Answer what you
          know; the planner's proposals are filled in to confirm or edit. What
          you leave blank stays open and does not prevent approval.
        </p>
        <AnswerProgress answered={given.length} total={questions.length} />
        {/* The questions scroll inside the dialog, as the client values' do, so an open
            list of suggestions never pushes the actions out of view. */}
        <div className="pl-values">
          <ol className="pl-qs">
            {questions.map((question, index) => {
              const value = answers[question.field] ?? "";
              const done = value.trim() !== "";
              const inputId = `${id}-${question.field}`;
              return (
                <li
                  key={question.field}
                  className={`pl-q${done ? " is-done" : ""}`}
                  data-fact={question.field}
                >
                  <span className="pl-q-mark" aria-hidden="true">
                    {done ? <UiIcon name="check" size={13} /> : index + 1}
                  </span>
                  <div className="pl-q-body">
                    {question.input === "type" ||
                    question.input === "assertions" ? (
                      <span className="pl-q-title" id={inputId}>
                        {question.question}
                      </span>
                    ) : (
                      <label className="pl-q-title" htmlFor={inputId}>
                        {question.question}
                      </label>
                    )}
                    {question.proposal !== "" ? (
                      <span className="pl-q-flag is-proposal">
                        Proposed by the planner: confirm or edit
                      </span>
                    ) : null}
                    {question.input === "type" ? (
                      <fieldset
                        className="pl-describe-choice"
                        aria-labelledby={inputId}
                      >
                        {["Preventive", "Detective"].map((choice) => (
                          <label key={choice} className="pl-describe-option">
                            <input
                              type="radio"
                              name={inputId}
                              value={choice}
                              checked={value === choice}
                              onChange={() => set(question.field, choice)}
                            />
                            <span>
                              {choice}
                              <small>
                                {choice === "Preventive"
                                  ? "Stops the error before it is recorded"
                                  : "Finds the error after the fact"}
                              </small>
                            </span>
                          </label>
                        ))}
                      </fieldset>
                    ) : question.input === "assertions" ? (
                      <fieldset
                        className="pl-describe-checks"
                        aria-labelledby={inputId}
                      >
                        {ASSERTION_CHOICES.map((choice) => {
                          const chosen = splitAssertions(value);
                          const on = chosen.includes(choice);
                          return (
                            <label key={choice} className="pl-describe-check">
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() =>
                                  set(
                                    question.field,
                                    (on
                                      ? chosen.filter((item) => item !== choice)
                                      : [...chosen, choice]
                                    ).join("; "),
                                  )
                                }
                              />
                              {choice}
                            </label>
                          );
                        })}
                      </fieldset>
                    ) : question.field === "PERFORMER" ||
                      question.field === "REVIEWER" ? (
                      <SuggestedAnswer
                        id={inputId}
                        options={ROLE_SUGGESTIONS[question.field]}
                        placeholder="A role or team, not a person's name"
                        value={value}
                        onChange={(text) => set(question.field, text)}
                      />
                    ) : question.input === "text" ? (
                      <input
                        id={inputId}
                        type="text"
                        maxLength={600}
                        value={value}
                        placeholder="For example: unauthorized access to financial data"
                        onChange={(event) =>
                          set(question.field, event.target.value)
                        }
                      />
                    ) : (
                      <textarea
                        id={inputId}
                        rows={2}
                        maxLength={600}
                        value={value}
                        onChange={(event) =>
                          set(question.field, event.target.value)
                        }
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
        {problem !== null ? (
          <p className="pl-values-problem" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="confirm-dialog-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy || given.length === 0}>
            {busy
              ? "Saving…"
              : given.length === 1
                ? "Save 1 answer"
                : `Save ${given.length} answers`}
          </button>
        </div>
      </form>
    </dialog>
  );
}
