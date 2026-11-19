"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { RefText } from "./ref-text";
import {
  heldReasons,
  menuIcons,
  reasonHolder,
  sharedReason,
} from "./row-menu-model";
import { type IconName, UiIcon } from "./ui-icon";

export type RowMenuItem = {
  label: string;
  /** What a held line calls it, where its label's first word would not say it ("keep
   * out of D&I"): row-menu-model.actionName. */
  action?: string;
  icon?: IconName;
  /** A link (such as a download); otherwise onSelect runs. */
  href?: string;
  onSelect?: () => void;
  danger?: boolean;
  /** Why the action is not available now: the item says it, stays reachable by keyboard
   * with the reason as its description, and choosing it does nothing. */
  unavailable?: string | null;
  /** The group the item is in, shown as a heading above its first item. */
  section?: string;
  /** Run as the menu opens: what decides whether the item is available is read then
   * (a file's impact, E1), never on page load. */
  prefetch?: () => void;
  /** A quiet word under the label while what decides the item is on its way ("Checking…");
   * the item stays available (the form it opens checks again). */
  note?: string | null;
};

/**
 * A row's less frequent actions behind one button, so the row shows only what it is and
 * its main action. Closes on a choice, a click outside, or Escape.
 */
/** The left edge a menu must stay right of: the window's, or that of the nearest panel
 * that clips its content (a scrolling navigator, say), with a little room. */
function clippedLeft(list: HTMLElement): number {
  let edge = 8;
  for (
    let node = list.parentElement;
    node !== null;
    node = node.parentElement
  ) {
    const style = getComputedStyle(node);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") {
      edge = Math.max(edge, node.getBoundingClientRect().left + 4);
    }
  }
  return edge;
}

/** The bottom edge a menu must stay above: the window's, or that of the nearest panel
 * that clips its content (a scrolling card in a dialog, say). */
function clippedBottom(list: HTMLElement): number {
  let edge = window.innerHeight - 8;
  for (
    let node = list.parentElement;
    node !== null;
    node = node.parentElement
  ) {
    const style = getComputedStyle(node);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") {
      edge = Math.min(edge, node.getBoundingClientRect().bottom - 4);
    }
  }
  return edge;
}

/** The room a menu keeps from the window's left and right edges. */
const WINDOW_GUTTER = 16;

/** How far a menu moves sideways to stay inside the window: back from the right edge, and
 * never past the left one. A narrow window (a phone) can otherwise cut a menu off. */
export function inWindowShift(
  left: number,
  right: number,
  windowWidth: number,
  gutter = WINDOW_GUTTER,
): number {
  const overflow = right - (windowWidth - gutter);
  const shift = overflow > 0 ? -overflow : 0;
  return left + shift < gutter ? gutter - left : shift;
}

export function RowMenu({
  label,
  items,
  trigger = null,
}: {
  /** What the menu acts on, for its accessible name. */
  label: string;
  items: RowMenuItem[];
  /** A labelled button in place of the row's "more" icon, such as a page's Add, or a
   * row's status that opens what can change it (with a class of its own). `ariaLabel`
   * names what it acts on where the label alone does not ("Move" a file). */
  trigger?: {
    label: string;
    icon: IconName;
    className?: string;
    ariaLabel?: string;
  } | null;
}) {
  const [open, setOpen] = useState(false);
  // Opens to the left of its button, or to the right where the left has no room.
  const [toRight, setToRight] = useState(false);
  // Opens above its button where the space below is clipped.
  const [up, setUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const uid = useId();
  // A reason several held items share is said once, after the last of them; each item it
  // holds is described by that line.
  const reasons = heldReasons(items);
  const holders = reasonHolder(items);
  // A reason several items share is a line of its own, under a divider.
  const shared = sharedReason(items);
  const icons = menuIcons(items);
  const toggle = () => {
    if (!open) {
      for (const item of items) {
        item.prefetch?.();
      }
    }
    setOpen(!open);
  };
  useEffect(() => {
    if (!open) {
      setToRight(false);
      setUp(false);
      return;
    }
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    // Escape closes the menu only: caught first, so a dialog the menu sits in stays open.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", onKey, true);
    root.current
      ?.querySelector<HTMLElement>(".row-menu-list a, .row-menu-list button")
      ?.focus();
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  // Where the open menu sits, decided before it is painted and measured without any shift
  // already applied: the side first (to the right where the left has no room, above where
  // the space below is clipped), then, once the side is chosen, moved back by what still
  // overflows the window.
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const list = root.current?.querySelector<HTMLElement>(".row-menu-list");
    if (list === null || list === undefined) {
      return;
    }
    list.style.transform = "";
    const rect = list.getBoundingClientRect();
    if (!toRight && rect.left < clippedLeft(list)) {
      setToRight(true);
      return;
    }
    if (
      !up &&
      rect.bottom > clippedBottom(list) &&
      (button.current?.getBoundingClientRect().top ?? 0) - rect.height > 8
    ) {
      setUp(true);
      return;
    }
    const shift = inWindowShift(rect.left, rect.right, window.innerWidth);
    list.style.transform = shift === 0 ? "" : `translateX(${shift}px)`;
  }, [open, toRight, up]);
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
          onClick={toggle}
        >
          <UiIcon name="more" size={16} />
        </button>
      ) : (
        <button
          ref={button}
          type="button"
          className={`btn row-menu-trigger${trigger.className ? ` ${trigger.className}` : ""}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={trigger.ariaLabel}
          onClick={toggle}
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
          className={`row-menu-list${toRight ? " is-right" : ""}${up ? " is-up" : ""}${reasons.some((reason) => reason !== null) ? " has-held" : ""}`}
          role="menu"
          aria-busy={items.some((item) => Boolean(item.note))}
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
                onClick={() => {
                  setOpen(false);
                  button.current?.focus();
                }}
              >
                {icons && item.icon ? (
                  <UiIcon name={item.icon} size={14} />
                ) : null}
                <span>{item.label}</span>
              </a>
            ) : (
              <button
                key={`${item.section ?? ""}-${item.label}`}
                type="button"
                role="menuitem"
                className={item.danger ? "is-danger" : undefined}
                // Held, not disabled: Tab reaches it, its name is its label and its
                // reason its description (WCAG 2.1.1; E1 design review, round 4,
                // 18 November 2026: a disabled item was skipped, its reason only visible
                // text and a title).
                aria-disabled={item.unavailable ? true : undefined}
                aria-label={
                  item.unavailable || item.note ? item.label : undefined
                }
                aria-describedby={
                  item.unavailable
                    ? `${uid}-why-${holders[index] ?? index}`
                    : item.note
                      ? `${uid}-note-${index}`
                      : undefined
                }
                onClick={() => {
                  if (item.unavailable) {
                    return;
                  }
                  setOpen(false);
                  // Focus stays on the menu's button, so a form the choice opens gives
                  // it back there once closed (use-focus-return.ts).
                  button.current?.focus();
                  item.onSelect?.();
                }}
              >
                {icons && item.icon ? (
                  <UiIcon name={item.icon} size={14} />
                ) : null}
                <span>
                  {item.label}
                  {item.unavailable ? (
                    reasons[index] !== null && !shared[index] ? (
                      <small id={`${uid}-why-${index}`}>
                        <RefText text={reasons[index] ?? ""} />
                      </small>
                    ) : null
                  ) : item.note ? (
                    <small
                      id={`${uid}-note-${index}`}
                      className="row-menu-note"
                    >
                      {item.note}
                    </small>
                  ) : null}
                </span>
              </button>
            ),
            shared[index] ? (
              <p
                key={`held-${item.section ?? ""}-${item.label}`}
                id={`${uid}-why-${index}`}
                className="row-menu-held"
                role="none"
              >
                <RefText text={reasons[index] ?? ""} />
              </p>
            ) : null,
          ])}
        </div>
      ) : null}
    </div>
  );
}
