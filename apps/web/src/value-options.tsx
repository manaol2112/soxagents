"use client";

import { useId, useState } from "react";

import { UiIcon } from "./ui-icon";
import { readAnswer, toggleSuggestion } from "./value-suggestions";

/**
 * A client value's answer: a text field, and the answers usually given (slot_options.py)
 * behind a "See suggestions" link. Opened, they show as pills to pick, as many as apply;
 * each pick adds to or takes from the field, which still takes the client's own words.
 * Nothing is saved until the form is.
 */
export function SuggestedAnswer({
  id,
  value,
  options,
  placeholder,
  disabled = false,
  onChange,
}: {
  id: string;
  value: string;
  options: readonly string[];
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const panelId = `${useId()}-suggestions`;
  const [open, setOpen] = useState(false);
  const { chosen } = readAnswer(value, options);
  const usable = !disabled && options.length > 0;
  return (
    <div className="answer">
      <input
        id={id}
        type="text"
        maxLength={300}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
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
            <span className="answer-panel-note">Pick all that apply</span>
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
                      onChange(toggleSuggestion(value, option, options))
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
