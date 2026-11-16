"use client";

import { useEffect, useId, useRef, useState } from "react";

import { useFocusTrap } from "./use-focus-trap";
import { LEAVE } from "./working-copy-model";

/**
 * Asked before a person goes elsewhere in the app with changes that are not in the
 * workpaper (docs/design-workpaper.md, section 3.4): Save (a version, as the editor's own
 * Save; the page goes on only once the server confirmed it), Leave without saving (the
 * working copy is kept, and is there on return), or Keep editing. Escape is Keep editing,
 * and the focus goes back to where it was. One press does one thing: while a button's
 * work is out, none of them does anything.
 */
export function LeaveDialog({
  section,
  problem,
  onSave,
  onLeave,
  onStay,
}: {
  /** The section's title, as the editor names it. */
  section: string;
  /** Why the changes cannot be saved as they are (a limit); "" where they can. */
  problem: string;
  onSave: () => Promise<void>;
  onLeave: () => Promise<void>;
  onStay: () => void;
}) {
  const id = useId();
  const box = useRef<HTMLDialogElement>(null);
  const [doing, setDoing] = useState<"save" | "leave" | null>(null);
  const busy = useRef(false);
  useFocusTrap(box);

  // Opened over the page as it mounts; the focus it found goes back when it closes.
  useEffect(() => {
    const element = box.current;
    const before =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (element !== null && !element.open) {
      element.showModal();
      element
        .querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus();
    }
    return () => {
      if (element?.open) {
        element.close();
      }
      if (before?.isConnected) {
        before.focus({ preventScroll: true });
      }
    };
  }, []);

  const run = (what: "save" | "leave", work: () => Promise<void>) => {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setDoing(what);
    void work().finally(() => {
      busy.current = false;
      setDoing(null);
    });
  };
  const stay = () => {
    if (!busy.current) {
      onStay();
    }
  };

  return (
    <dialog
      ref={box}
      className="confirm-dialog leave-dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      aria-busy={doing !== null}
      onCancel={(event) => {
        // Escape: Keep editing, as the button.
        event.preventDefault();
        stay();
      }}
      onClose={() => {
        // Closed by the browser itself (a second Escape): Keep editing. A close that the
        // dialog's own opening again overtook (strict mode) is not one.
        if (box.current?.open !== true) {
          stay();
        }
      }}
    >
      <div className="confirm-dialog-body">
        <h2 id={`${id}-title`}>{LEAVE.title(section)}</h2>
        <p id={`${id}-body`}>{LEAVE.body}</p>
        {problem !== "" ? <p className="leave-problem">{problem}</p> : null}
        <div className="confirm-dialog-actions leave-actions">
          <button
            type="button"
            disabled={doing !== null || problem !== ""}
            onClick={() => run("save", onSave)}
          >
            {doing === "save" ? "Saving…" : LEAVE.save}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={doing !== null}
            onClick={() => run("leave", onLeave)}
          >
            {LEAVE.leave}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={doing !== null}
            onClick={stay}
          >
            {LEAVE.stay}
          </button>
        </div>
      </div>
    </dialog>
  );
}
