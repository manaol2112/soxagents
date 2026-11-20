"use client";

import { useId, useState } from "react";

import { UiIcon } from "./ui-icon";
import { readAnswer, toggleSuggestion } from "./value-suggestions";

/**
 * A client value's answer: a text field, and the answers usually given (slot_options.py)
 * behind a "See suggestions" link. Opened, they show as pills to pick, as many as apply;
 * each pick adds to or takes from the field, which still takes the client's own words.
 * Nothing is saved until the form is. With `single`, one answer is picked, and a pick
 * replaces the field's words (a reason, say, rather than a list of values).
 */
export function SuggestedAnswer({
  id,
  value,
  options,
  placeholder,
  disabled = false,
  single = false,
  multiline = false,
  maxLength = 300,
  error = null,
  onChange,
}: {
  id: string;
  value: string;
  options: readonly string[];
  placeholder: string;
  disabled?: boolean;
  single?: boolean;
  /** A text area that grows with the answer, for a sentence rather than a value. */
  multiline?: boolean;
  maxLength?: number;
  /** Why the field failed its check, said directly under it and tied to it. */
  error?: string | null;
  onChange: (value: string) => void;
}) {
  const panelId = `${useId()}-suggestions`;
  const [open, setOpen] = useState(false);
  const chosen = single
    ? options.filter((option) => option === value.trim())
    : readAnswer(value, options).chosen;
  const usable = !disabled && options.length > 0;
  const field = {
    id,
    maxLength,
    placeholder,
    value,
    disabled,
    "aria-invalid": error !== null ? true : undefined,
    "aria-describedby": error !== null ? `${id}-error` : undefined,
  };
  return (
    <div className="answer">
      {multiline ? (
        // Grows with its words, so a long answer is read whole.
        <textarea
          {...field}
          rows={2}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          {...field}
          type="text"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {error !== null ? (
        <p id={`${id}-error`} className="answer-error">
          {error}
        </p>
      ) : null}
      {usable && !open ? (
        <button
          type="button"
          className="answer-toggle"
          aria-expanded={false}
          aria-controls={panelId}
          onClick={() => setOpen(true)}
        >
          <UiIcon name="sparkles" size={13} />
          See suggestions
          {chosen.length > 0 ? (
            <span className="answer-count">{chosen.length} picked</span>
          ) : null}
        </button>
      ) : null}
      {usable && open ? (
        <section
          className="answer-panel"
          id={panelId}
          aria-label="Suggested answers"
        >
          <div className="answer-panel-head">
            <span className="answer-panel-title">
              <UiIcon name="sparkles" size={13} />
              Suggested answers
            </span>
            <span className="answer-panel-note">
              {single ? "Pick one, or write your own" : "Pick all that apply"}
            </span>
            <button
              type="button"
              className="answer-done"
              aria-expanded={true}
              aria-controls={panelId}
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </div>
          <ul className="answer-pills">
            {options.map((option) => {
              const on = chosen.includes(option);
              return (
                <li key={option}>
                  <button
                    type="button"
                    className={`answer-pill${on ? " is-on" : ""}`}
                    aria-pressed={on}
                    onClick={() =>
                      onChange(
                        single
                          ? on
                            ? ""
                            : option
                          : toggleSuggestion(value, option, options),
                      )
                    }
                  >
                    <UiIcon name={on ? "check" : "plus"} size={12} />
                    <span>{option}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
