"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import type { SetupImpact } from "./setup-impact-model";

/** The reason asked for when the impact shows work on record. */
const IMPACT_REASON: ConfirmField = {
  name: "reason",
  label: "Why (goes in the audit trail)",
  kind: "reason",
  minLength: 3,
  maxLength: 500,
};

/** A field the dialog asks for before it confirms (Milestone 8.14). */
export type ConfirmField = {
  name: string;
  label: string;
  /** A reason, written out; the exact text a person types to confirm; or a value to
   * change, such as a new name. */
  kind: "reason" | "match" | "text";
  /** For "text", the value it starts with; confirming waits until it changes. */
  initial?: string;
  /** For "match", the text to type; for "reason", unused. */
  match?: string;
  minLength?: number;
  maxLength?: number;
};

/**
 * A consequential action asked twice (Milestone 8.13): the button opens a dialog that
 * says what will happen, and only its confirm button submits the surrounding form, with
 * the action's intent. Escape, Cancel, or a click outside closes it and nothing is sent.
 * With a field, confirming waits until it is filled in: a reason, or the name typed.
 * With an impact link, the dialog first says what the change affects, asks why where work
 * is on record, and holds a change the rules refuse.
 */
export function ConfirmAction({
  label,
  intent,
  title,
  consequence,
  confirmLabel,
  className = "btn-danger",
  tone = "danger",
  field,
  impact,
}: {
  label: string;
  intent: string;
  title: string;
  consequence: string;
  confirmLabel: string;
  className?: string;
  tone?: "danger" | "neutral";
  field?: ConfirmField;
  /** The page's impact route (setup-impact-model.ts), read each time the dialog opens. */
  impact?: string | undefined;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<SetupImpact | "loading" | "failed" | null>(
    null,
  );
  const asked =
    field ??
    (typeof found === "object" && found?.material ? IMPACT_REASON : undefined);
  const [value, setValue] = useState(field?.initial ?? "");
  const typed = value.trim().split(/\s+/).join(" ");
  const held =
    found === "loading" || (typeof found === "object" && found?.blocked);
  const ready =
    !held &&
    (asked === undefined ||
      (asked.kind === "match"
        ? typed !== "" &&
          typed === (asked.match ?? "").trim().split(/\s+/).join(" ")
        : asked.kind === "text"
          ? typed !== "" &&
            typed !== (asked.initial ?? "").trim().split(/\s+/).join(" ")
          : typed.length >= (asked.minLength ?? 1)));

  useEffect(() => {
    if (!open || impact === undefined) {
      return;
    }
    let live = true;
    setFound("loading");
    fetch(impact, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (!live) {
          return;
        }
        const parsed = body as SetupImpact | null;
        setFound(
          parsed !== null && Array.isArray(parsed.lines) ? parsed : "failed",
        );
      })
      .catch(() => {
        if (live) {
          setFound("failed");
        }
      });
    return () => {
      live = false;
    };
  }, [open, impact]);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) {
      return;
    }
    if (open && !element.open) {
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={className}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: a click on the backdrop cancels; Escape and Cancel do too, through the dialog itself. */}
      <dialog
        ref={dialog}
        className="confirm-dialog"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          // The dialog fills its box; a click on the backdrop lands on the dialog itself.
          if (event.target === event.currentTarget) {
            setOpen(false);
          }
        }}
      >
        <div className="confirm-dialog-body">
          <h2 id={`${id}-title`}>{title}</h2>
          <p id={`${id}-body`}>{consequence}</p>
          {impact === undefined || found === null ? null : found ===
            "loading" ? (
            <p className="confirm-impact-state" aria-live="polite">
              Checking what this affects…
            </p>
          ) : found === "failed" ? (
            <p className="confirm-impact-state" aria-live="polite">
              What this affects could not be checked. If it has work on record,
              the change asks for a reason.
            </p>
          ) : (
            <div className="confirm-impact" aria-live="polite">
              {found.lines.length === 0 && found.blocked !== null ? null : (
                <strong>
                  {found.lines.length === 0
                    ? "Nothing on record is affected."
                    : "What this affects"}
                </strong>
              )}
              {found.lines.length > 0 ? (
                <ul>
                  {found.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
              {found.blocked !== null ? (
                <p className="confirm-impact-blocked">{found.blocked}</p>
              ) : null}
            </div>
          )}
          {asked !== undefined ? (
            <label htmlFor={`${id}-field`} className="confirm-dialog-field">
              {asked.label}
              {asked.kind === "reason" ? (
                <textarea
                  autoComplete="off"
                  id={`${id}-field`}
                  name={asked.name}
                  rows={3}
                  maxLength={asked.maxLength ?? 500}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              ) : (
                <input
                  id={`${id}-field`}
                  name={asked.name}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={asked.maxLength ?? 200}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              )}
            </label>
          ) : null}
          <div className="confirm-dialog-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              name="intent"
              value={intent}
              className={tone === "danger" ? "btn-danger" : ""}
              disabled={!ready}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

/**
 * A form that posts once. A second press while the first is on its way is dropped, so a
 * double click cannot send the same consequential request twice; the server refuses a
 * repeat on its own as well.
 */
export function OnceForm({
  action,
  className,
  children,
}: {
  action: string;
  className?: string;
  children: ReactNode;
}) {
  const sent = useRef(false);
  const [pending, setPending] = useState(false);
  // A page restored from the back button can be sent again.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) {
        sent.current = false;
        setPending(false);
      }
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);
  return (
    <form
      autoComplete="off"
      method="post"
      action={action}
      className={className}
      aria-busy={pending}
      data-pending={pending ? "submit" : undefined}
      onSubmit={(event) => {
        if (sent.current) {
          event.preventDefault();
          return;
        }
        sent.current = true;
        // After the browser has read the fields: a disabled field would not be sent.
        window.setTimeout(() => setPending(true), 0);
      }}
    >
      {children}
    </form>
  );
}
