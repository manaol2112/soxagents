"use client";

import { type ReactNode, useEffect, useState } from "react";

import { UiIcon } from "./ui-icon";

/** Expand all or Collapse all tells every group on the page. */
const ALL_EVENT = "aw-controls-groups";

function remembered(key: string): boolean | null {
  try {
    const value = window.localStorage.getItem(key);
    return value === "open" ? true : value === "closed" ? false : null;
  } catch {
    return null;
  }
}

function remember(key: string, open: boolean): void {
  try {
    window.localStorage.setItem(key, open ? "open" : "closed");
  } catch {
    // Storage can be off; the choice then lasts for this page only.
  }
}

/**
 * One group of the register: a header that opens and closes it, and its controls. The
 * controls are on the page either way (closed hides them), so nothing about the data
 * changes. On the whole register each person's choice is kept in their browser; a
 * narrowed view always opens, so a search never hides what it found.
 */
export function ControlsGroup({
  id,
  storageKey,
  startOpen,
  keepChoice,
  header,
  children,
}: {
  id: string;
  storageKey: string;
  startOpen: boolean;
  keepChoice: boolean;
  header: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(startOpen);
  useEffect(() => {
    if (!keepChoice) {
      return;
    }
    const kept = remembered(storageKey);
    if (kept !== null) {
      setOpen(kept);
    }
  }, [keepChoice, storageKey]);
  useEffect(() => {
    const onAll = (event: Event) => {
      const next = (event as CustomEvent<boolean>).detail;
      setOpen(next);
      if (keepChoice) {
        remember(storageKey, next);
      }
    };
    window.addEventListener(ALL_EVENT, onAll);
    return () => window.removeEventListener(ALL_EVENT, onAll);
  }, [keepChoice, storageKey]);
  return (
    <section className={`cr-group${open ? " is-open" : ""}`}>
      <h3 className="cr-group-title">
        <button
          type="button"
          className="cr-group-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => {
            setOpen(!open);
            if (keepChoice) {
              remember(storageKey, !open);
            }
          }}
        >
          <UiIcon name="chevron" size={14} />
          {header}
        </button>
      </h3>
      <div id={id} className="cr-group-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** Opens or closes every group at once. */
export function GroupsToggle() {
  const all = (open: boolean) =>
    window.dispatchEvent(new CustomEvent(ALL_EVENT, { detail: open }));
  return (
    <span className="cr-all">
      <button type="button" onClick={() => all(true)}>
        Expand all
      </button>
      <span aria-hidden="true">·</span>
      <button type="button" onClick={() => all(false)}>
        Collapse all
      </button>
    </span>
  );
}
