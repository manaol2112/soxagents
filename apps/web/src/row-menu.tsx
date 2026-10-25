"use client";

import { useEffect, useRef, useState } from "react";

import { type IconName, UiIcon } from "./ui-icon";

export type RowMenuItem = {
  label: string;
  icon?: IconName;
  /** A link (such as a download); otherwise onSelect runs. */
  href?: string;
  onSelect?: () => void;
  danger?: boolean;
  /** Why the action is not available now; the item shows it and stays off. */
  unavailable?: string | null;
  /** The group the item is in, shown as a heading above its first item. */
  section?: string;
};

/**
 * A row's less frequent actions behind one button, so the row shows only what it is and
 * its main action. Closes on a choice, a click outside, or Escape.
 */
export function RowMenu({
  label,
  items,
  trigger = null,
}: {
  /** What the menu acts on, for its accessible name. */
  label: string;
  items: RowMenuItem[];
  /** A labelled button in place of the row's "more" icon, such as a page's Add. */
  trigger?: { label: string; icon: IconName } | null;
}) {
  const [open, setOpen] = useState(false);
  // Opens to the left of its button, or to the right where the left has no room.
  const [toRight, setToRight] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) {
      setToRight(false);
      return;
    }
    const list = root.current?.querySelector<HTMLElement>(".row-menu-list");
    if (
      list !== null &&
      list !== undefined &&
      list.getBoundingClientRect().left < 8
    ) {
      setToRight(true);
    }
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", onKey);
    root.current
      ?.querySelector<HTMLElement>(".row-menu-list a, .row-menu-list button")
      ?.focus();
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className={`row-menu${open ? " is-open" : ""}`} ref={root}>
      {trigger === null ? (
        <button
          ref={button}
          type="button"
          className="row-menu-button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`More for ${label}`}
          title="More"
          onClick={() => setOpen((value) => !value)}
        >
          <UiIcon name="more" size={16} />
        </button>
      ) : (
        <button
          ref={button}
          type="button"
          className="btn row-menu-trigger"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <UiIcon name={trigger.icon} size={15} />
          {trigger.label}
          <span className="row-menu-caret" aria-hidden="true">
            <UiIcon name="chevron" size={13} />
          </span>
        </button>
      )}
      {open ? (
        <div
          className={`row-menu-list${toRight ? " is-right" : ""}`}
          role="menu"
          aria-label={label}
        >
          {items.map((item, index) => [
            item.section !== undefined &&
            item.section !== items[index - 1]?.section ? (
              <p
                key={`section-${item.section}`}
                className="row-menu-section"
                role="presentation"
              >
                {item.section}
              </p>
            ) : null,
            item.href !== undefined && !item.unavailable ? (
              <a
                key={`${item.section ?? ""}-${item.label}`}
                role="menuitem"
                href={item.href}
                onClick={() => setOpen(false)}
              >
                {item.icon ? <UiIcon name={item.icon} size={14} /> : null}
                <span>{item.label}</span>
              </a>
            ) : (
              <button
                key={`${item.section ?? ""}-${item.label}`}
                type="button"
                role="menuitem"
                className={item.danger ? "is-danger" : undefined}
                disabled={Boolean(item.unavailable)}
                title={item.unavailable ?? undefined}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                {item.icon ? <UiIcon name={item.icon} size={14} /> : null}
                <span>
                  {item.label}
                  {item.unavailable ? <small>{item.unavailable}</small> : null}
                </span>
              </button>
            ),
          ])}
        </div>
      ) : null}
    </div>
  );
}
