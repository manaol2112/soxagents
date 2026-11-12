"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
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

/**
 * A step's work, in a wide panel over the workflow's right side (product owner, 8 November 2026):
 * the workflow stays in view on the left. Escape or Close returns to the workflow; the arrows
 * move to the step before or after. Every step's header is the minimalist one (11 November
 * 2026): its kind and number, its title with one status, and Ask; Control Understanding and
 * the activity keep the header they had.
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
  children: ReactNode;
}) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
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
  const pill = tone !== null ? statusPill(tone, status) : null;
  const stepNav = (
    <nav className="wf-panel-nav" aria-label="Steps">
      {previous !== null ? (
        <Link
          className={`wf-icon-btn${minimal ? " is-ghost" : ""}`}
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
          className={`wf-icon-btn${minimal ? " is-ghost" : ""}`}
          href={next.href}
          scroll={false}
          title={`Next: ${next.title}`}
          aria-label={`Next step: ${next.title}`}
        >
          <UiIcon name="arrow" size={15} />
        </Link>
      ) : null}
      <Link
        className={`wf-icon-btn${minimal ? " is-ghost" : ""}`}
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
      <aside className="wf-panel is-minimal" aria-labelledby="wf-panel-title">
        <header className="wf-panel-head is-minimal">
          <div className="wf-panel-titles">
            <p className="wf-panel-kicker">
              <span
                className={`wf-panel-kind kind-${head.kind}`}
                aria-hidden="true"
              >
                <UiIcon name={KIND_ICON[head.kind]} size={12} />
              </span>
              {head.label}
            </p>
            <div className="wf-panel-line">
              <h2 id="wf-panel-title" ref={heading} tabIndex={-1}>
                {title}
              </h2>
              {pill !== null ? (
                <span className={`wf-panel-pill tone-${pill.tone}`}>
                  <span className="sr-only">Status: </span>
                  {pill.tone === "done" ? (
                    <UiIcon name="check" size={12} />
                  ) : (
                    <span className="wf-panel-pill-dot" aria-hidden="true" />
                  )}
                  {pill.label}
                </span>
              ) : null}
            </div>
          </div>
          <div className="wf-panel-actions">
            {ask !== null ? <StepAsk target={ask} /> : null}
            {stepNav}
          </div>
        </header>
        <div className="wf-panel-body">
          <StepAskContext.Provider value={setAsk}>
            {children}
          </StepAskContext.Provider>
        </div>
      </aside>
    );
  }
  return (
    <aside className="wf-panel" aria-labelledby="wf-panel-title">
      <header className="wf-panel-head">
        <div className="wf-panel-titles">
          <p className="wf-peek-kicker">{kicker}</p>
          <h2 id="wf-panel-title" ref={heading} tabIndex={-1}>
            {title}
            {tone !== null ? <StatusChip tone={tone} /> : null}
          </h2>
          {status !== "" ? <p className="wf-panel-status">{status}</p> : null}
        </div>
        <nav className="wf-panel-nav" aria-label="Steps">
          {previous !== null ? (
            <Link
              className="wf-icon-btn"
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
              className="wf-icon-btn"
              href={next.href}
              scroll={false}
              title={`Next: ${next.title}`}
              aria-label={`Next step: ${next.title}`}
            >
              <UiIcon name="arrow" size={15} />
            </Link>
          ) : null}
          <Link
            className="wf-icon-btn"
            href={closeHref}
            scroll={false}
            aria-label="Close and return to the workflow"
          >
            <UiIcon name="x" size={15} />
          </Link>
        </nav>
      </header>
      <div className="wf-panel-body">{children}</div>
    </aside>
  );
}
