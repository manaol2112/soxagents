"use client";

import { useEffect, useId, useRef, useState } from "react";

import { initials } from "./format";
import {
  CHOOSE_REVIEWER,
  type ReviewerOption,
  reviewerDetail,
} from "./review-request-model";
import { UiIcon } from "./ui-icon";

/**
 * "Send for review to" (docs/design-workpaper.md, section 3.8; the prototype): one line
 * showing the reviewer chosen, which opens the engagement's reviewers as a list of radio
 * buttons, each with their role and how many D&I workpapers wait for them. Someone the
 * server does not offer (the preparer, the person who recorded the conclusion, where
 * independence is required) is shown greyed with the server's reason, and cannot be
 * chosen. Choosing one, Enter or Escape closes the list and gives the focus back to the
 * line; a click outside closes it. It chooses only: the press that sends is the caller's.
 */
export function ReviewerPicker({
  label,
  reviewers,
  value,
  viewerId,
  disabled,
  onChange,
  openAtStart = false,
}: {
  label: string;
  reviewers: readonly ReviewerOption[];
  value: string | null;
  /** The person reading, where known: their own row says "(you)". */
  viewerId: string | null;
  disabled: boolean;
  onChange: (id: string) => void;
  openAtStart?: boolean;
}) {
  const uid = useId();
  const [open, setOpen] = useState(openAtStart);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLFieldSetElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const chosen =
    reviewers.find((item) => item.id === value && item.offered) ?? null;

  // Open: the reviewer chosen (or the first that may be) takes the focus.
  useEffect(() => {
    if (!open) {
      return;
    }
    window.requestAnimationFrame(() => {
      const node = list.current;
      (
        node?.querySelector<HTMLInputElement>("input:checked:not(:disabled)") ??
        node?.querySelector<HTMLInputElement>("input:not(:disabled)")
      )?.focus();
    });
    const outside = (event: PointerEvent) => {
      if (
        root.current !== null &&
        event.target instanceof Node &&
        !root.current.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const close = () => {
    setOpen(false);
    window.requestAnimationFrame(() => trigger.current?.focus());
  };

  return (
    <div className="rp" ref={root}>
      <span className="rp-label" id={`${uid}-l`}>
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        className="rp-trigger"
        aria-expanded={open}
        aria-controls={`${uid}-list`}
        aria-labelledby={`${uid}-l ${uid}-v`}
        disabled={disabled}
        onClick={() => setOpen((was) => !was)}
      >
        <span id={`${uid}-v`} className="rp-value">
          {chosen === null ? (
            <span className="rp-none">{CHOOSE_REVIEWER}</span>
          ) : (
            <>
              <span className="rp-avatar" aria-hidden="true">
                {initials(chosen.name)}
              </span>
              <span className="rp-name">{chosen.name}</span>
              {chosen.role !== "" ? (
                <span className="rp-role"> · {chosen.role}</span>
              ) : null}
            </>
          )}
        </span>
        <span className="rp-caret" aria-hidden="true">
          <UiIcon name="chevron" size={12} />
        </span>
      </button>
      {open ? (
        <fieldset
          ref={list}
          id={`${uid}-list`}
          className="rp-list"
          onKeyDown={(event) => {
            if (event.key === "Escape" || event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <legend className="sr-only">{label}</legend>
          {reviewers.length === 0 ? (
            <p className="rp-empty">
              No one on the engagement has the reviewer role yet.
            </p>
          ) : (
            reviewers.map((item) => {
              const you = viewerId !== null && item.id === viewerId;
              const detail = reviewerDetail(item);
              return (
                <label
                  key={item.id}
                  className={`rp-option${item.offered ? "" : " is-off"}${item.id === value ? " is-on" : ""}`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name={`${uid}-r`}
                    value={item.id}
                    checked={item.id === value}
                    disabled={!item.offered}
                    aria-describedby={`${uid}-${item.id}`}
                    onChange={() => onChange(item.id)}
                    onClick={(event) => {
                      // A click (not an arrow key) chooses and closes.
                      if (event.detail > 0) {
                        close();
                      }
                    }}
                  />
                  <span className="rp-avatar" aria-hidden="true">
                    {initials(item.name)}
                  </span>
                  <span className="rp-copy">
                    <span className="rp-name">
                      {item.name}
                      {you ? " (you)" : ""}
                    </span>
                    <small id={`${uid}-${item.id}`}>{detail}</small>
                  </span>
                  {item.id === value ? (
                    <span className="rp-check" aria-hidden="true">
                      <UiIcon name="check" size={14} />
                    </span>
                  ) : null}
                </label>
              );
            })
          )}
        </fieldset>
      ) : null}
    </div>
  );
}
