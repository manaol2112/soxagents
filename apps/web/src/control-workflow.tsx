"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  GROUPS,
  KIND_ICON,
  KIND_LABELS,
  progressOf,
  type StepKey,
  TONE_LABELS,
  type Tone,
  type WorkflowStep,
  workflowFrame,
  workflowLayout,
} from "./control-workflow-model";
import { useGuardedRouter } from "./guarded-router";
import { FocusSide, setStepFocus, useStepFocus } from "./step-focus";
import {
  focusCrumbOf,
  focusToggleOf,
  isFocusShortcut,
  type StepPill,
  type StripStep,
  stepStripOf,
} from "./step-focus-model";
import { StepAsk, StepAskContext, type StepAskTarget } from "./step-frame";
import {
  panelHeadFor,
  panelHeadOf,
  statusPill,
  takesMinimalLayout,
} from "./step-frame-model";
import { UiIcon } from "./ui-icon";

// The canvas and its library load only with the workflow, and never on the server.
const WorkflowCanvas = dynamic(
  () =>
    import("./control-workflow-canvas").then((module) => module.WorkflowCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="wf-loading" role="status">
        <span className="spinner small" aria-hidden="true" />
        Drawing the workflow…
      </div>
    ),
  },
);

const NARROW = "(max-width: 767px)";

/** The workflow's size in canvas units: fixed, so worked out once. */
const CONTENT = workflowLayout().size;
/** The canvas's width before it is measured: a laptop's workspace. */
const TYPICAL_WIDTH = 1100;

/** The canvas's measured width, kept as it resizes. */
function useWidth(target: { current: HTMLElement | null }, on: boolean) {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = target.current;
    if (!on || element === null) {
      return;
    }
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [target, on]);
  return width;
}

function subscribe(change: () => void) {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
}

/** A phone reads the workflow as a list: a canvas is not usable on a small screen. */
function useNarrow(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

export function StatusChip({ tone }: { tone: Tone }) {
  return <span className={`wf-chip tone-${tone}`}>{TONE_LABELS[tone]}</span>;
}

/** A step's status in its panel's header: one badge in both headers (design audit, 17
 * November 2026), a check when done and a dot otherwise. */
function PanelPill({ pill }: { pill: { label: string; tone: Tone } }) {
  return (
    <span className={`wf-panel-pill tone-${pill.tone}`}>
      <span className="sr-only">Status: </span>
      {pill.tone === "done" ? (
        <UiIcon name="check" size={12} />
      ) : (
        <span className="wf-panel-pill-dot" aria-hidden="true" />
      )}
      {pill.label}
    </span>
  );
}

const NO_FLAGS: Partial<Record<StepKey, string>> = {};

/**
 * The control's workspace (product owner, 8 November 2026; docs/control-workflow-plan.md): the
 * 12 steps of its audit, in four stages. A click or Enter opens a step's work in the panel beside
 * the workflow.
 */
export function ControlWorkflow({
  steps,
  hrefs,
  opened,
  activityHref,
  flags,
}: {
  steps: readonly WorkflowStep[];
  hrefs: Record<StepKey, string>;
  opened: StepKey | null;
  /** The control's activity record (the former History tab). */
  activityHref: string;
  /** The words on each next step's node, from the Next step card above the workflow
   * (10 November 2026). Absent: the nodes say "Next", and the header names them. */
  flags?: Partial<Record<StepKey, string>>;
}) {
  const router = useGuardedRouter();
  const narrow = useNarrow();
  const open = useCallback(
    (key: StepKey) => router.push(hrefs[key], { scroll: false }),
    [router, hrefs],
  );
  const progress = progressOf(steps);
  // One next step per open branch, so the header names each.
  const nexts = steps.filter((step) => step.next);
  // The canvas is as high as the workflow at the zoom it opens at (workflowFrame): no fixed
  // height to shrink it into, and no empty space under it.
  const frameRef = useRef<HTMLDivElement>(null);
  const width = useWidth(frameRef, !narrow);
  const canvasWidth = width ?? TYPICAL_WIDTH;
  const height = workflowFrame(canvasWidth, CONTENT).height;

  return (
    <section className="wf" aria-labelledby="wf-title">
      <header className="wf-head">
        <div>
          <h2 id="wf-title">Workflow</h2>
          <p>
            {progress.done} of {progress.of} steps done
            {nexts.length > 0 && flags === undefined ? (
              <>
                {" · Next: "}
                <strong>{nexts.map((step) => step.title).join(", ")}</strong>
              </>
            ) : null}
          </p>
        </div>
        <span
          className="wf-meter"
          role="img"
          aria-label={`${progress.done} of ${progress.of} steps done`}
        >
          <span
            style={{
              width: `${progress.of === 0 ? 0 : (progress.done / progress.of) * 100}%`,
            }}
          />
        </span>
        <Link
          className="btn btn-secondary btn-sm wf-activity"
          href={activityHref}
          scroll={false}
        >
          <UiIcon name="clock" size={14} />
          Activity
        </Link>
        <ul className="wf-kinds" aria-label="Kinds of step">
          {(["source", "agent", "gate", "output"] as const).map((kind) => (
            <li key={kind} className={`kind-${kind}`}>
              <UiIcon name={KIND_ICON[kind]} size={13} />
              {KIND_LABELS[kind]}
            </li>
          ))}
        </ul>
      </header>
      {narrow ? (
        <WorkflowList steps={steps} hrefs={hrefs} flags={flags ?? NO_FLAGS} />
      ) : (
        <div
          className="wf-canvas"
          ref={frameRef}
          // The frame's two border lines are outside the workflow's height.
          style={{ height: height + 2 }}
        >
          <WorkflowCanvas
            steps={steps}
            selected={opened}
            onOpen={open}
            flags={flags ?? NO_FLAGS}
            canvasWidth={canvasWidth}
          />
        </div>
      )}
    </section>
  );
}

/** The workflow as a list: on a phone. */
function WorkflowList({
  steps,
  hrefs,
  flags,
}: {
  steps: readonly WorkflowStep[];
  hrefs: Record<StepKey, string>;
  flags: Partial<Record<StepKey, string>>;
}) {
  return (
    <div className="wf-list">
      {GROUPS.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <h3 className="wf-lane">{group.label}</h3>
          <ol>
            {steps
              .filter((step) => step.group === group.key)
              .map((step) => (
                <li key={step.key}>
                  <Link
                    className={`wf-list-row${step.next ? " is-next" : ""}`}
                    href={hrefs[step.key]}
                    scroll={false}
                  >
                    <span
                      className={`wf-list-mark kind-${step.kind} tone-${step.tone}`}
                      aria-hidden="true"
                    >
                      {step.tone === "done" ? (
                        <UiIcon name="check" size={13} />
                      ) : (
                        String(step.number).padStart(2, "0")
                      )}
                    </span>
                    <span className="wf-list-text">
                      <span className={`wf-badge kind-${step.kind}`}>
                        <UiIcon name={KIND_ICON[step.kind]} size={12} />
                        {KIND_LABELS[step.kind]}
                        {step.next ? (
                          <span className="wf-next">
                            {flags[step.key] ?? "Next"}
                          </span>
                        ) : null}
                      </span>
                      <span className="wf-title">{step.title}</span>
                      <span className={`wf-state-text tone-${step.tone}`}>
                        {step.status}
                      </span>
                    </span>
                    <StatusChip tone={step.tone} />
                  </Link>
                </li>
              ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** Focus mode's toggle, beside the panel's arrows: hidden at 1100 px and under, where the
 * panel is already full width. */
function FocusToggle({ on, ghost }: { on: boolean; ghost: boolean }) {
  const words = focusToggleOf(on);
  return (
    <button
      type="button"
      className={`wf-icon-btn wf-focus-toggle${ghost ? " is-ghost" : ""}`}
      onClick={() => setStepFocus(!on)}
      aria-label={words.label}
      aria-keyshortcuts="Shift+F"
      title={words.tip}
    >
      <UiIcon name={on ? "collapse" : "expand"} size={15} />
    </button>
  );
}

/** Focus mode's step strip, under the header: one pill per step, in order, each leading to
 * its step; it scrolls sideways inside itself, with the open step brought into view. */
function StepStrip({ pills, focus }: { pills: StepPill[]; focus: boolean }) {
  const strip = useRef<HTMLOListElement>(null);
  // Shown at 1100 px and under, or in focus: the open step is brought into view whenever
  // the strip is shown (a hidden strip has no width), and again once a toggle's width
  // change has ended. Its own scroll only, and only as far as needed: scrollIntoView
  // would move the panel too.
  useLayoutEffect(() => {
    const bring = () => {
      const list = strip.current;
      const current = list?.querySelector<HTMLElement>('[aria-current="step"]');
      if (list == null || current == null || list.clientWidth === 0) {
        return;
      }
      const room = 24;
      const left =
        current.getBoundingClientRect().left -
        list.getBoundingClientRect().left;
      const right = left + current.offsetWidth;
      if (left < room) {
        list.scrollLeft += left - room;
      } else if (right > list.clientWidth - room) {
        list.scrollLeft += right - list.clientWidth + room;
      }
    };
    bring();
    const later = window.setTimeout(bring, focus ? 280 : 0);
    return () => window.clearTimeout(later);
  }, [focus]);
  if (pills.length === 0) {
    return null;
  }
  return (
    <nav className="wf-strip" aria-label="All steps">
      <ol ref={strip}>
        {pills.map((pill) => (
          <li key={pill.key}>
            <Link
              className={`wf-strip-pill is-${pill.state}`}
              href={pill.href}
              scroll={false}
              aria-label={pill.label}
              aria-current={pill.state === "current" ? "step" : undefined}
              title={pill.title}
            >
              <span className="wf-strip-mark" aria-hidden="true">
                {pill.mark === "check" ? (
                  <UiIcon name="check" size={12} />
                ) : (
                  pill.mark
                )}
              </span>
              <span className="wf-strip-title">{pill.title}</span>
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * A step's work, in a wide panel over the workflow's right side (product owner, 8 November 2026):
 * the workflow stays in view on the left. Escape or Close returns to the workflow; the arrows
 * move to the step before or after. Every step's header is the minimalist one (11 November
 * 2026): its kind and number, its title with one status, and Ask; Control Understanding and
 * the activity keep the header they had.
 *
 * Focus mode (product owner, 16 November 2026: focus mode, option A): a toggle beside the
 * arrows, or Shift+F outside a text box, widens the panel to the whole content area; the
 * navigation folds to its icons, the header names the control before the step, a strip of
 * every step sits under it, and the work is centred at a readable width. The choice is kept
 * in this browser (step-focus), never in the address. Escape does not leave it.
 */
export function WorkflowPanel({
  kicker,
  step = null,
  title,
  tone,
  status,
  closeHref,
  previous,
  next,
  control = null,
  strip = null,
  children,
}: {
  kicker: string;
  /** The open step's key; null for the activity. The header is chosen from it. */
  step?: string | null;
  title: string;
  tone: Tone | null;
  status: string;
  closeHref: string;
  previous: { title: string; href: string } | null;
  next: { title: string; href: string } | null;
  /** The control the step belongs to: focus mode names it before the step's title. */
  control?: { ref: string; title: string } | null;
  /** Every step, in order, with its address: focus mode's step strip. */
  strip?: {
    steps: readonly StripStep[];
    hrefs: Readonly<Record<string, string | undefined>>;
  } | null;
  children: ReactNode;
}) {
  const router = useGuardedRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  const { chosen, wide, focus } = useStepFocus();
  // The navigation folds to its icons while the panel is in focus (control-workflow.css);
  // before paint, so moving between steps does not draw the full navigation for a frame.
  useLayoutEffect(() => {
    if (!focus) {
      return;
    }
    const root = document.documentElement;
    root.dataset.stepFocus = "";
    return () => {
      delete root.dataset.stepFocus;
    };
  }, [focus]);
  // Shift+F toggles focus where the toggle is shown, outside a text box and a dialog.
  useEffect(() => {
    if (!wide) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        !isFocusShortcut({
          key: event.key,
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          repeat: event.repeat,
          defaultPrevented: event.defaultPrevented,
          target:
            target === null
              ? null
              : {
                  tagName: target.tagName,
                  type: target instanceof HTMLInputElement ? target.type : "",
                  editable: target.isContentEditable,
                },
        }) ||
        document.querySelector(
          "dialog[open], [role='dialog'][aria-modal='true']",
        ) !== null
      ) {
        return;
      }
      event.preventDefault();
      setStepFocus(!chosen);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wide, chosen]);
  // The side column at the right edge in focus: the review notes' strip and rail.
  const [side, setSide] = useState<HTMLDivElement | null>(null);
  const pills =
    strip === null ? [] : stepStripOf(strip.steps, step, strip.hrefs);
  const crumb = control === null ? "" : focusCrumbOf(control);
  const focusClass = focus ? " is-focus" : "";
  // The person's focus moves to the step they opened (the panel is keyed by its step, so it
  // mounts again for each).
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        // A dialog open inside the panel takes its own Escape first.
        if (
          document.querySelector(
            "dialog[open], [role='dialog'][aria-modal='true']",
          ) === null
        ) {
          router.push(closeHref, { scroll: false });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, closeHref]);
  // The step's Ask, from the frame inside the drawer (StepFrame), for the header.
  const [ask, setAsk] = useState<StepAskTarget | null>(null);
  // Every step takes the minimalist header (product owner, 11 November 2026), except Control
  // Understanding, which keeps its own, and the activity, which is no step.
  const head = step !== null ? panelHeadFor(step) : panelHeadOf(kicker);
  const minimal = head !== null && takesMinimalLayout(head.key);
  // Every step's header takes the quiet icons, Control Understanding's own layout too (design
  // review, 17 November 2026); only the activity, which is no step, keeps the outlined ones.
  const ghost = head !== null;
  const pill = tone !== null ? statusPill(tone, status) : null;
  const stepNav = (
    <nav className="wf-panel-nav" aria-label="Steps">
      {wide ? <FocusToggle on={chosen} ghost={ghost} /> : null}
      {previous !== null ? (
        <Link
          className={`wf-icon-btn${ghost ? " is-ghost" : ""}`}
          href={previous.href}
          scroll={false}
          title={`Previous: ${previous.title}`}
          aria-label={`Previous step: ${previous.title}`}
        >
          <UiIcon name="back" size={15} />
        </Link>
      ) : null}
      {next !== null ? (
        <Link
          className={`wf-icon-btn${ghost ? " is-ghost" : ""}`}
          href={next.href}
          scroll={false}
          title={`Next: ${next.title}`}
          aria-label={`Next step: ${next.title}`}
        >
          <UiIcon name="arrow" size={15} />
        </Link>
      ) : null}
      <Link
        className={`wf-icon-btn${ghost ? " is-ghost" : ""}`}
        href={closeHref}
        scroll={false}
        aria-label="Close and return to the workflow"
      >
        <UiIcon name="x" size={15} />
      </Link>
    </nav>
  );
  if (minimal) {
    return (
      <aside
        className={`wf-panel is-minimal${focusClass}`}
        aria-labelledby="wf-panel-title"
      >
        <header className="wf-panel-head is-minimal">
          <div className="wf-panel-titles">
            <p className="wf-panel-kicker">
              <span
                className={`wf-panel-kind kind-${head.kind}`}
                aria-hidden="true"
              >
                <UiIcon name={KIND_ICON[head.kind]} size={12} />
              </span>
              <span className="wf-panel-kicker-text">{head.label}</span>
            </p>
            <div className="wf-panel-line">
              {focus && crumb !== "" ? (
                <>
                  <span className="wf-crumb" title={crumb}>
                    {crumb}
                  </span>
                  <span className="wf-crumb-sep" aria-hidden="true">
                    /
                  </span>
                </>
              ) : null}
              <h2 id="wf-panel-title" ref={heading} tabIndex={-1}>
                {title}
              </h2>
              {pill !== null ? <PanelPill pill={pill} /> : null}
            </div>
          </div>
          <div className="wf-panel-actions">
            {ask !== null ? <StepAsk target={ask} /> : null}
            {stepNav}
          </div>
        </header>
        <StepStrip pills={pills} focus={focus} />
        <div className="wf-panel-main">
          <div className="wf-panel-body">
            <FocusSide.Provider value={focus ? side : null}>
              <StepAskContext.Provider value={setAsk}>
                {children}
              </StepAskContext.Provider>
            </FocusSide.Provider>
          </div>
          <div className="wf-panel-side" ref={setSide} />
        </div>
      </aside>
    );
  }
  return (
    <aside className={`wf-panel${focusClass}`} aria-labelledby="wf-panel-title">
      <header className="wf-panel-head">
        <div className="wf-panel-titles">
          <p className={head !== null ? "wf-panel-kicker" : "wf-peek-kicker"}>
            {focus && crumb !== "" ? (
              <>
                <span className="wf-crumb" title={crumb}>
                  {crumb}
                </span>
                <span className="wf-crumb-sep" aria-hidden="true">
                  /
                </span>
              </>
            ) : null}
            {head !== null ? (
              <>
                <span
                  className={`wf-panel-kind kind-${head.kind}`}
                  aria-hidden="true"
                >
                  <UiIcon name={KIND_ICON[head.kind]} size={12} />
                </span>
                <span className="wf-panel-kicker-text">{head.label}</span>
              </>
            ) : (
              kicker
            )}
          </p>
          <h2 id="wf-panel-title" ref={heading} tabIndex={-1}>
            {title}
            {tone !== null ? (
              <PanelPill pill={statusPill(tone, "")} />
            ) : null}
          </h2>
          {status !== "" ? <p className="wf-panel-status">{status}</p> : null}
        </div>
        {stepNav}
      </header>
      <StepStrip pills={pills} focus={focus} />
      <div className="wf-panel-main">
        <div className="wf-panel-body">
          <FocusSide.Provider value={focus ? side : null}>
            {children}
          </FocusSide.Provider>
        </div>
        <div className="wf-panel-side" ref={setSide} />
      </div>
    </aside>
  );
}
