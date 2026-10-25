"use client";

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type { TourStep } from "./tour-model";
import { UiIcon } from "./ui-icon";

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 10;
const CARD_WIDTH = 368;

function seen(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "seen";
  } catch {
    return true;
  }
}

function markSeen(key: string): void {
  try {
    window.localStorage.setItem(key, "seen");
  } catch {
    // Storage can be off; the guide then opens again next time.
  }
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The bounds around every part of the page a step points at. */
function measure(selectors: readonly string[]): Rect | null {
  const boxes = selectors
    .flatMap((selector) => [...document.querySelectorAll(selector)])
    .map((element) => element.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.height > 0);
  if (boxes.length === 0) {
    return null;
  }
  const top = Math.min(...boxes.map((box) => box.top));
  const left = Math.min(...boxes.map((box) => box.left));
  const right = Math.max(...boxes.map((box) => box.right));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  return {
    top: top - PAD,
    left: left - PAD,
    width: right - left + PAD * 2,
    height: bottom - top + PAD * 2,
  };
}

/** Text that writes itself in when a step opens, as the agent's line; all at once under
 * reduced motion. A change to the text within the step (a value entered) shows whole. */
function useTyped(lines: readonly string[], key: string): string[] {
  const full = lines.join("\n");
  const length = useRef(full.length);
  length.current = full.length;
  const [typing, setTyping] = useState<{ key: string; count: number } | null>(
    null,
  );
  const ready = full.length > 0;
  useEffect(() => {
    if (!ready || reducedMotion()) {
      setTyping(null);
      return;
    }
    setTyping({ key, count: 0 });
    const step = Math.max(2, Math.ceil(length.current / 45));
    const timer = window.setInterval(() => {
      setTyping((now) => {
        if (now === null || now.count + step >= length.current) {
          window.clearInterval(timer);
          return null;
        }
        return { key, count: now.count + step };
      });
    }, 16);
    return () => window.clearInterval(timer);
  }, [key, ready]);
  const shown =
    typing !== null && typing.key === key ? full.slice(0, typing.count) : full;
  return shown.split("\n");
}

/**
 * An agent's guided tour (decided by the product owner): it opens by itself the first
 * time someone reaches the page and afterwards from "Guide me" or the open event. A
 * spotlight moves through the page while the agent's card says what each part is for.
 * The page stays usable throughout; the tour only points.
 */
export function SpotlightTour({
  steps,
  seenKey,
  openEvent,
  finish = null,
  watch,
  onOpenChange,
  onStep,
}: {
  steps: readonly TourStep[];
  /** Remembered in this browser once the tour is closed or finished. */
  seenKey: string;
  /** Anything on the page can open the tour by raising this event. */
  openEvent: string;
  /** The last stop's main action, in place of closing; null closes with Done. */
  finish?: { label: string; onClick: () => void } | null;
  /** A value that, when it changes, may move what a step points at. */
  watch?: unknown;
  onOpenChange?: (open: boolean) => void;
  /** Called as each step opens, before its parts are found: a page shows the tab they
   * are on. */
  onStep?: (step: TourStep) => void;
}) {
  const [open, setOpenState] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [mounted, setMounted] = useState(false);
  const [viewport, setViewport] = useState({ width: 1440, height: 900 });
  // The card's height as drawn, so it is placed where all of it fits.
  const [cardHeight, setCardHeight] = useState(280);
  const card = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const changed = useRef(onOpenChange);
  changed.current = onOpenChange;
  const setOpen = useCallback((value: boolean) => {
    setOpenState(value);
    changed.current?.(value);
  }, []);

  useEffect(() => {
    setMounted(true);
    const begin = () => {
      setIndex(0);
      setOpen(true);
    };
    document.addEventListener(openEvent, begin);
    const timer = seen(seenKey) ? 0 : window.setTimeout(begin, 700);
    return () => {
      document.removeEventListener(openEvent, begin);
      window.clearTimeout(timer);
    };
  }, [openEvent, seenKey, setOpen]);

  // The window's size places the card, with or without a spotlight (a phone docks it).
  useEffect(() => {
    if (!open) {
      return;
    }
    const size = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    size();
    window.addEventListener("resize", size);
    const element = card.current;
    const observer =
      element === null
        ? null
        : new ResizeObserver(() => setCardHeight(element.offsetHeight));
    if (element !== null) {
      observer?.observe(element);
    }
    return () => {
      window.removeEventListener("resize", size);
      observer?.disconnect();
    };
  }, [open]);

  const current = steps[Math.min(index, Math.max(steps.length - 1, 0))];
  const last = index >= steps.length - 1;
  // The step is rebuilt as values change; the spotlight moves only when the step does.
  const targets = current?.targets.join("|") ?? "";
  const stepped = useRef(onStep);
  stepped.current = onStep;
  const stepKey = current?.id ?? "";

  // The page shows what the step points at (a tab) before the spotlight looks for it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per step
  useEffect(() => {
    if (open && current !== undefined) {
      stepped.current?.(current);
    }
  }, [open, stepKey]);

  // The spotlight follows its part of the page as it moves or the window changes.
  useEffect(() => {
    if (!open || targets === "") {
      setRect(null);
      return;
    }
    const selectors = targets.split("|");
    let frame = 0;
    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setRect(measure(selectors));
        setViewport({ width: window.innerWidth, height: window.innerHeight });
      });
    };
    // Scrolled to once the page has drawn the step's tab.
    const reveal = requestAnimationFrame(() => {
      const first = selectors
        .map((selector) => document.querySelector(selector))
        .find((element) => element !== null);
      first?.scrollIntoView({
        block: "center",
        behavior: reducedMotion() ? "auto" : "smooth",
      });
      place();
    });
    const settle = window.setTimeout(place, 420);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(reveal);
      window.clearTimeout(settle);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, targets]);

  // A value entered can change what the step covers.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `watch` is the trigger
  useEffect(() => {
    if (!open || targets === "") {
      return;
    }
    const frame = requestAnimationFrame(() =>
      setRect(measure(targets.split("|"))),
    );
    return () => cancelAnimationFrame(frame);
  }, [open, targets, watch]);

  const close = useCallback(() => {
    setOpen(false);
    markSeen(seenKey);
    launcher.current?.focus();
  }, [seenKey, setOpen]);

  useEffect(() => {
    if (!open) {
      return;
    }
    card.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const typed = useTyped(
    current?.body ?? [],
    `${open}-${index}-${current?.id ?? ""}`,
  );

  // The card sits beside its spotlight: below it, else above, else over the page's foot.
  const phone = viewport.width < 640;
  const width = Math.min(CARD_WIDTH, viewport.width - 32);
  const position: CSSProperties = (() => {
    if (phone || rect === null) {
      return phone
        ? { left: 16, right: 16, bottom: 16 }
        : {
            left: (viewport.width - width) / 2,
            top: Math.max(80, viewport.height / 2 - 160),
            width,
          };
    }
    const left = Math.min(Math.max(16, rect.left), viewport.width - width - 16);
    const below = rect.top + rect.height + 14;
    if (below + cardHeight + 16 < viewport.height) {
      return { left, top: below, width };
    }
    if (rect.top - 14 - cardHeight > 16) {
      return { left, bottom: viewport.height - rect.top + 14, width };
    }
    return { left, bottom: 16, width };
  })();

  return (
    <>
      <button
        ref={launcher}
        type="button"
        className="btn btn-secondary ng-launch"
        onClick={() => {
          setIndex(0);
          setOpen(true);
        }}
      >
        <span className="ng-orb is-small" aria-hidden="true" />
        Guide me
      </button>
      {mounted && open && current !== undefined
        ? createPortal(
            <div className="ng">
              {rect === null ? (
                <div className="ng-veil" aria-hidden="true" />
              ) : (
                <div
                  className="ng-spot"
                  aria-hidden="true"
                  style={{
                    top: rect.top,
                    left: rect.left,
                    width: rect.width,
                    height: rect.height,
                  }}
                />
              )}
              <div
                ref={card}
                className="ng-card"
                role="dialog"
                aria-modal="false"
                aria-labelledby="ng-title"
                aria-describedby="ng-body"
                tabIndex={-1}
                style={position}
              >
                <div className="ng-head">
                  <span className="ng-orb" aria-hidden="true" />
                  <span className="ng-who">
                    <strong>Setup agent</strong>
                    <small>
                      Step {index + 1} of {steps.length}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="ng-close"
                    aria-label="Close the guide"
                    onClick={close}
                  >
                    <UiIcon name="x" size={14} />
                  </button>
                </div>
                <h2 id="ng-title" className="ng-title">
                  {current.done && current.targets.length > 0 ? (
                    <span className="ng-done" role="img" aria-label="Done">
                      <UiIcon name="check" size={12} />
                    </span>
                  ) : null}
                  {current.title}
                </h2>
                {/* Read whole by assistive technology; shown as it writes itself in. */}
                <div id="ng-body" className="sr-only" aria-live="polite">
                  {current.body.join(" ")}
                </div>
                <div className="ng-body" aria-hidden="true">
                  {typed.map((line, at) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: lines of one step, in order
                    <p key={at}>{line}</p>
                  ))}
                </div>
                <ol className="ng-dots" aria-hidden="true">
                  {steps.map((item, at) => (
                    <li
                      key={item.id}
                      className={[
                        at === index ? "is-now" : "",
                        // Green once visited and in place; what is ahead stays plain.
                        at < index && item.done && item.targets.length > 0
                          ? "is-done"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    />
                  ))}
                </ol>
                <div className="ng-actions">
                  <button type="button" className="ng-skip" onClick={close}>
                    {last ? "Close" : "Skip the guide"}
                  </button>
                  <span className="ng-actions-end">
                    {index > 0 ? (
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => setIndex(index - 1)}
                      >
                        Back
                      </button>
                    ) : null}
                    {!last ? (
                      <button
                        type="button"
                        className="btn-sm"
                        onClick={() => setIndex(index + 1)}
                      >
                        {index === 0 ? "Start" : "Next"}
                        <UiIcon name="arrow" size={13} />
                      </button>
                    ) : finish !== null ? (
                      <button
                        type="button"
                        className="btn-sm"
                        disabled={!current.done}
                        onClick={() => {
                          close();
                          finish.onClick();
                        }}
                      >
                        {finish.label}
                        <UiIcon name="arrow" size={13} />
                      </button>
                    ) : (
                      <button type="button" className="btn-sm" onClick={close}>
                        Done
                      </button>
                    )}
                  </span>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
