"use client";

import {
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { UiIcon } from "./ui-icon";
import { readAnswer, toggleSuggestion } from "./value-suggestions";

/** Closes a pop-up on a click outside it or on Escape. */
function useDismiss(
  open: boolean,
  close: () => void,
  root: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        close();
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open, close, root]);
}

/**
 * A client value's answer in the control's client-specific questions (decided by the
 * product owner): one field to type the client's own words or pick from the answers
 * usually given (slot_options.py), as many as apply. Nothing is saved until the form is.
 */
export function AnswerField({
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
  const listId = `${useId()}-answers`;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root);
  const { chosen } = readAnswer(value, options);
  const usable = !disabled && options.length > 0;
  return (
    <div className={`answer-field${open ? " is-open" : ""}`} ref={root}>
      <input
        id={id}
        type="text"
        maxLength={300}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {usable ? (
        <button
          type="button"
          className="answer-field-toggle"
          aria-label="The answers usually given"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((current) => !current)}
        >
          <UiIcon name="chevron" size={13} />
        </button>
      ) : null}
      {usable && open ? (
        <div
          id={listId}
          className="answer-field-list"
          role="listbox"
          aria-multiselectable="true"
          aria-label="The answers usually given"
        >
          <p className="answer-field-note">
            <UiIcon name="sparkles" size={12} />
            Usually given: pick all that apply
          </p>
          {options.map((option) => {
            const on = chosen.includes(option);
            return (
              <div
                key={option}
                role="option"
                tabIndex={-1}
                aria-selected={on}
                className={on ? "is-on" : undefined}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onChange(toggleSuggestion(value, option, options));
                }}
              >
                <span className="answer-field-check" aria-hidden="true">
                  {on ? <UiIcon name="check" size={11} /> : null}
                </span>
                {option}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Why a question is asked, on request: a "?" that opens a short note beside it. */
export function HelpTip({ label, text }: { label: string; text: string }) {
  const tipId = `${useId()}-tip`;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root);
  if (text === "") {
    return <span className="help-tip is-empty" aria-hidden="true" />;
  }
  return (
    <span className="help-tip" ref={root}>
      <button
        type="button"
        aria-label={`Why this is asked: ${label}`}
        aria-expanded={open}
        aria-controls={tipId}
        onClick={() => setOpen((current) => !current)}
      >
        <UiIcon name="help" size={16} />
      </button>
      {open ? (
        <span id={tipId} className="help-tip-note" role="note">
          {text}
        </span>
      ) : null}
    </span>
  );
}

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
