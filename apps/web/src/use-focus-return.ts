"use client";

import { useCallback, useEffect, useRef } from "react";

import {
  ANSWER_WAIT_MS,
  closesForm,
  controlKey,
  ESCAPE_FORMS,
  FOCUS_ANSWERS,
  type FocusEnd,
  type FocusSeen,
  focusLost,
  focusReturnTarget,
  keeperTarget,
} from "./focus-return";

// The element focused last, kept after it leaves the page: a menu's button drawn anew, or
// the button a form replaced, is found again by its kind and name.
let last: HTMLElement | null = null;
let tracking = false;
// The controls focused lately, newest last, with where each was: the focus keeper's
// memory.
type Seen = {
  element: HTMLElement;
  key: string;
  rows: HTMLElement[];
  href: string;
};
const seen: Seen[] = [];
// Forms returning focus themselves just now (returnFocus): the keeper leaves it to them.
let returning = 0;

function track(): void {
  if (tracking || typeof document === "undefined") {
    return;
  }
  tracking = true;
  document.addEventListener(
    "focusin",
    (event) => {
      if (
        event.target instanceof HTMLElement &&
        event.target !== document.body
      ) {
        last = event.target;
        const rows: HTMLElement[] = [];
        for (
          let node = event.target.parentElement;
          node !== null && node !== document.body;
          node = node.parentElement
        ) {
          rows.push(node);
        }
        seen.push({
          element: event.target,
          key: keyOf(event.target),
          rows,
          href: location.href,
        });
        if (seen.length > 16) {
          seen.shift();
        }
      }
    },
    true,
  );
}

/** A control to give focus to: a button or a link, never a field (focusing a field can
 * open what it holds). */
function isControl(element: HTMLElement): boolean {
  return (
    element instanceof HTMLButtonElement ||
    element instanceof HTMLAnchorElement ||
    element.getAttribute("role") === "menuitem" ||
    element.getAttribute("role") === "tab"
  );
}

/** The control drawn again where one was: its kind and name, in its nearest row still on
 * the page. */
function twinOf(entry: Seen): HTMLElement | null {
  const near = entry.rows.find((node) => node.isConnected);
  if (near === undefined) {
    return null;
  }
  return (
    [...near.querySelectorAll<HTMLElement>(entry.element.tagName)].find(
      (each) =>
        each !== entry.element && reachable(each) && keyOf(each) === entry.key,
    ) ?? null
  );
}

/** Gives focus back when the focused control left the page with what it closed. */
function keep(): void {
  if (returning > 0 || !focusLost(document.activeElement, document.body)) {
    return;
  }
  const memory: FocusSeen<HTMLElement>[] = seen.map((entry, index) => {
    // The newest: still on the page at all (the person moved on); the others: a control
    // to give focus to.
    const usable =
      index === seen.length - 1
        ? reachable(entry.element)
        : reachable(entry.element) && isControl(entry.element);
    return {
      element: entry.element,
      usable,
      twin: usable || !isControl(entry.element) ? null : twinOf(entry),
      href: entry.href,
    };
  });
  const target = keeperTarget(memory, location.href);
  // An open layer (a dialog, the guide's card) keeps the focus: nothing behind it is
  // given focus while it is open; the layer itself is (E1 design review, round 9: the
  // keeper gave it to "Guide me" behind the guide's open card).
  const layer = openLayer();
  if (layer !== null && (target === null || !layer.contains(target))) {
    focusOn(layer);
    return;
  }
  if (target !== null) {
    focusOn(target);
  }
}

/** The topmost open dialog or card the person is in, or null. */
function openLayer(): HTMLElement | null {
  const layers = [
    ...document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [role="alertdialog"][aria-modal="true"], dialog[open]',
    ),
  ].filter((each) => each.getClientRects().length > 0 && !each.hidden);
  return layers.at(-1) ?? null;
}

/** The Cancel or Close of the in-row form focus is in, where Escape closes it. */
function escapeTarget(active: HTMLElement): HTMLButtonElement | null {
  if (active.closest('[role="menu"], [role="listbox"]') !== null) {
    // A menu or a list closes itself.
    return null;
  }
  for (
    let node: HTMLElement | null = active.closest<HTMLElement>(ESCAPE_FORMS);
    node !== null;
    node = node.parentElement?.closest<HTMLElement>(ESCAPE_FORMS) ?? null
  ) {
    if (node.matches('[role="dialog"], dialog')) {
      return null;
    }
    const own = [...node.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) =>
        closesForm(button.textContent ?? "") &&
        button.closest(ESCAPE_FORMS) === node &&
        reachable(button) &&
        button.getAttribute("aria-disabled") !== "true",
    );
    if (own !== undefined) {
      return own;
    }
  }
  return null;
}

let keeping = false;

/**
 * The focus keeper: one for the page, mounted once (FocusKeeper, in the app's layout).
 * When the focused control leaves the page with what it closed (a form's Cancel, Escape,
 * Close), focus goes back to the control that opened it, or that control drawn again,
 * once the page has drawn the change: every in-row form on every screen, through this one
 * mechanism (E1 design review, round 8). A form that says where focus goes itself
 * (returnFocus) is left to do so.
 */
export function useFocusKeeper(): void {
  useEffect(() => {
    track();
    if (keeping) {
      return;
    }
    keeping = true;
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled || !focusLost(document.activeElement, document.body)) {
        return;
      }
      scheduled = true;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          scheduled = false;
          keep();
        }),
      );
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "hidden", "inert"],
    });
    // Escape in an in-row form closes it by its own Cancel (or Close), from any field in
    // it, a textarea too (Escape is not a text action); focus then goes back through the
    // keeper. One handler for every in-row form (E1 design review, round 9).
    const onEscape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing
      ) {
        return;
      }
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || active === document.body) {
        return;
      }
      const cancel = escapeTarget(active);
      if (cancel !== null) {
        event.preventDefault();
        event.stopPropagation();
        cancel.click();
      }
    };
    document.addEventListener("keydown", onEscape, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", onEscape, true);
      keeping = false;
    };
  }, []);
}

/** Mounts the focus keeper (useFocusKeeper) where the app's layout draws it. */
export function FocusKeeper(): null {
  useFocusKeeper();
  return null;
}

// From the moment a form that uses it can be shown, so the press that opens the first
// form is known.
track();

function nameOf(element: Element): string {
  return element.getAttribute("aria-label") ?? element.textContent ?? "";
}

function keyOf(element: Element): string {
  return controlKey(element.tagName, nameOf(element));
}

/** On the page, shown, and not switched off. */
function reachable(element: HTMLElement): boolean {
  return (
    element.isConnected &&
    element.getClientRects().length > 0 &&
    !(element instanceof HTMLButtonElement && element.disabled) &&
    element.closest("[inert]") === null
  );
}

function focusOn(element: HTMLElement): void {
  if (
    !(
      element instanceof HTMLButtonElement ||
      element instanceof HTMLAnchorElement ||
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
    ) &&
    !element.hasAttribute("tabindex")
  ) {
    // A line (a confirmation, a row) takes focus from a script only.
    element.setAttribute("tabindex", "-1");
  }
  element.focus();
}

type Opened = { element: HTMLElement | null; key: string | null };

/**
 * Returns keyboard focus deliberately when a form opened from a row or a menu closes or
 * answers (focus-return.ts holds the rule). `ref` goes on the form's own element (each
 * form or held box it shows); it remembers the control that opened the form and the
 * rows around it. `returnFocus("back")` is called as the form closes (Cancel, Close,
 * Escape), `returnFocus("answer")` as the server answers (a confirmation, a refusal);
 * the focus moves once the page has drawn the change, and only if it was lost.
 */
export function useFocusReturn(): {
  ref: (element: HTMLElement | null) => void;
  returnFocus: (end: FocusEnd) => void;
} {
  const opened = useRef<Opened | null>(null);
  const around = useRef<HTMLElement[]>([]);
  const ref = useCallback((element: HTMLElement | null) => {
    if (element === null) {
      return;
    }
    track();
    const rows: HTMLElement[] = [];
    for (
      let node = element.parentElement;
      node !== null && node !== document.body;
      node = node.parentElement
    ) {
      rows.push(node);
    }
    around.current = rows;
    if (opened.current !== null) {
      // The same form drawn anew (its held box, say): it was opened by the same control.
      return;
    }
    const active = document.activeElement;
    const opener =
      active instanceof HTMLElement &&
      active !== document.body &&
      !element.contains(active)
        ? active
        : last !== null && !element.contains(last)
          ? last
          : null;
    opened.current = {
      element: opener,
      key: opener === null ? null : keyOf(opener),
    };
  }, []);

  const returnFocus = useCallback((end: FocusEnd) => {
    if (typeof document === "undefined") {
      return;
    }
    const opener: Opened = opened.current ?? { element: null, key: null };
    const rows = around.current;
    if (end === "back") {
      opened.current = null;
    }
    // What answers were on the page, and what each said: an answer drawn anew, or one
    // whose words changed (a confirmation line the page reuses), is this change's answer
    // (E1 design review, round 6).
    const before = new Map(
      [...document.querySelectorAll(FOCUS_ANSWERS)].map((each) => [
        each,
        each.textContent ?? "",
      ]),
    );
    const until = Date.now() + (end === "answer" ? ANSWER_WAIT_MS : 0);
    let stopped = false;
    returning += 1;
    // A person who acts meanwhile decides where focus is.
    const stop = () => {
      if (!stopped) {
        returning -= 1;
      }
      stopped = true;
      document.removeEventListener("pointerdown", stop, true);
      document.removeEventListener("keydown", stop, true);
    };
    document.addEventListener("pointerdown", stop, true);
    document.addEventListener("keydown", stop, true);
    const row = () => rows.find((node) => node.isConnected) ?? null;
    // The answer drawn nearest the form: the last new one in its nearest surviving row (a
    // held box's way out comes after its reasons); else, where the form and its rows have
    // all left the page (a dialog closed with the change), the page's own (E1, round 5).
    const fresh = (node: ParentNode): HTMLElement | null =>
      [...node.querySelectorAll<HTMLElement>(FOCUS_ANSWERS)]
        .filter(
          (each) =>
            before.get(each) !== (each.textContent ?? "") && reachable(each),
        )
        .at(-1) ?? null;
    const answer = (): HTMLElement | null => {
      for (const node of rows) {
        if (!node.isConnected) {
          continue;
        }
        const found = fresh(node);
        if (found !== null) {
          return found;
        }
      }
      return fresh(document);
    };
    const standIn = (): HTMLElement | null => {
      const near = row();
      if (near === null || opener.key === null) {
        return null;
      }
      return (
        [
          ...near.querySelectorAll<HTMLElement>(
            opener.element?.tagName ?? "button",
          ),
        ]
          .filter(reachable)
          .find((each) => keyOf(each) === opener.key) ?? null
      );
    };
    // Where focus was put, while the page settles: an answer the page then takes away
    // (the form's own line, gone with its panel when the page comes back) is replaced by
    // the next one (round 6: a withdrawal's banner was not focused).
    let placed: HTMLElement | null = null;
    const step = () => {
      if (stopped) {
        return;
      }
      const lost = focusLost(document.activeElement, document.body);
      const found = lost && end === "answer" ? answer() : null;
      const waiting = Date.now() < until;
      if (!lost || (end === "answer" && found === null && waiting)) {
        if (waiting) {
          requestAnimationFrame(step);
        } else {
          stop();
        }
        return;
      }
      if (placed !== null && found === null) {
        // Focus was placed and the page took it away with nothing new: the row.
        stop();
        const near = row();
        if (near !== null) {
          focusOn(near);
        }
        return;
      }
      const target = focusReturnTarget(end, {
        answer: found,
        opener:
          opener.element !== null && reachable(opener.element)
            ? opener.element
            : null,
        standIn: standIn(),
        row: row(),
      });
      if (target !== null) {
        focusOn(target);
        placed = target;
        if (end === "answer" && Date.now() < until) {
          // Keep watching while the page settles.
          before.set(target, target.textContent ?? "");
          requestAnimationFrame(step);
          return;
        }
      }
      stop();
    };
    // After the page has drawn the change.
    requestAnimationFrame(() => requestAnimationFrame(step));
  }, []);
  return { ref, returnFocus };
}
