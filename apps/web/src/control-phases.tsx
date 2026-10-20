import type { ReactNode } from "react";

import { stepAnchor } from "./assistant-model";
import type { PlanTask } from "./engagement-model";
import { UiIcon } from "./ui-icon";
import { StatusPill } from "./workspace-view";

export type PhaseState = "todo" | "active" | "done" | "issue";

const PHASE_WORD: Record<PhaseState, string> = {
  todo: "Not started",
  active: "In progress",
  done: "Done",
  issue: "Needs attention",
};

/**
 * One phase of a control's audit (design, interim testing, roll-forward, review): a
 * header that says where it stands, then the phase's steps in the order an auditor works
 * them. What the phase tests is in the test plan; the agent's work is under AI activity.
 */
export function PhasePanel({
  number,
  title,
  state,
  summary,
  task,
  aside,
  children,
}: {
  number: number;
  title: string;
  state: PhaseState;
  /** One line at most; the plan says what the phase covers. */
  summary?: string | undefined;
  /** The agent's task for this phase, when the kickoff created one. */
  task?: PlanTask | undefined;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`cx-phase is-${state}`} aria-label={title}>
      <header className="cx-phase-head">
        <span className="cx-phase-no" aria-hidden="true">
          {state === "done" ? <UiIcon name="check" size={14} /> : number}
        </span>
        <div className="cx-phase-title">
          <h2>{title}</h2>
          {summary !== undefined && summary !== "" ? <p>{summary}</p> : null}
        </div>
        <div className="cx-phase-side">
          <span className={`cx-status ${PHASE_TONE[state]}`}>
            {PHASE_WORD[state]}
          </span>
          {task !== undefined ? (
            <span className="cx-phase-agent" title={task.title}>
              <UiIcon name="sparkles" size={13} />
              <span>{task.agent ?? task.assignee ?? "Unassigned"}</span>
              <StatusPill status={task.status} />
            </span>
          ) : null}
          {aside}
        </div>
      </header>
      <div className="cx-phase-body">{children}</div>
    </section>
  );
}

const PHASE_TONE: Record<PhaseState, string> = {
  todo: "",
  active: "tone-info",
  done: "tone-success",
  issue: "tone-danger",
};

/** A numbered step inside a phase: where it stands and the controls for it. A finished
 * step, and one that cannot start yet, fold to one line; either opens on request. */
export function PhaseStep({
  number,
  title,
  hint,
  state,
  note,
  waits,
  keepOpen = false,
  children,
}: {
  number: number;
  title: string;
  /** What this step is for, in one line, when the title does not say it. */
  hint?: string;
  state: PhaseState;
  /** A short status note: "3 of 7 received", "Signed off by Dana". */
  note?: string | undefined;
  /** What a step not started waits for: "Starts after interim sign-off". */
  waits?: string | undefined;
  /** A finished step folds to its heading; this keeps it open, as when it shows the
   * result of something just done in it. */
  keepOpen?: boolean;
  children: ReactNode;
}) {
  const head = (
    <>
      <span className="cx-step-no" aria-hidden="true">
        {state === "done" ? <UiIcon name="check" size={12} /> : number}
      </span>
      <div>
        <h3>{title}</h3>
        {hint !== undefined && hint !== "" ? <p>{hint}</p> : null}
      </div>
      {note !== undefined && note !== "" ? (
        <span className="cx-step-note">{note}</span>
      ) : state === "todo" && waits !== undefined && waits !== "" ? (
        <span className="cx-step-note is-waits">{waits}</span>
      ) : null}
    </>
  );
  // A finished step, and one that cannot start yet, fold to one line, so the step that
  // needs work comes up the page; each opens again on request.
  if (state === "done" || state === "todo") {
    return (
      <details
        className={`cx-step is-${state} is-folding`}
        aria-label={title}
        id={stepAnchor(title)}
        open={keepOpen}
      >
        <summary className="cx-step-head">
          {head}
          <UiIcon name="chevron" size={15} />
        </summary>
        <div className="cx-step-body">{children}</div>
      </details>
    );
  }
  return (
    <section
      className={`cx-step is-${state}`}
      aria-label={title}
      id={stepAnchor(title)}
    >
      <header className="cx-step-head">{head}</header>
      <div className="cx-step-body">{children}</div>
    </section>
  );
}

/** The state a lifecycle value stands for, for a phase or step. */
export function stateOf(value: string | null | undefined): PhaseState {
  if (value === "SUCCEEDED" || value === "RECEIVED" || value === "SIGNED") {
    return "done";
  }
  if (value === "FAILED" || value === "OVERDUE" || value === "BLOCKED") {
    return "issue";
  }
  if (
    value === "RUNNING" ||
    value === "QUEUED" ||
    value === "WAITING" ||
    value === "REVIEW" ||
    value === "REQUESTED" ||
    value === "PARTIAL" ||
    value === "DRAFTED" ||
    value === "READY"
  ) {
    return "active";
  }
  return "todo";
}
