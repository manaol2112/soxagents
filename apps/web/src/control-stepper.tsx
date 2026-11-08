import { AgentSays } from "./agent-says";
import type { AgentSays as Says } from "./agent-says-model";
import type {
  Blocker,
  ControlJourney,
  JourneyPhase,
  NeedsYou,
  Step,
  StepperItem,
} from "./control-journey-model";
import { completion } from "./control-journey-model";
import { formatDate } from "./format";
import { receiptText, reopenText, type Signoff } from "./signoff-model";
import type { TraceNode, TraceRow } from "./trace-model";
import { TraceRail } from "./trace-rail";
import { UiIcon } from "./ui-icon";

const PHASE_SHORT: Record<string, string> = {
  DESIGN: "Design & implementation",
  INTERIM: "Interim",
  ROLLFORWARD: "Roll-forward",
  REMEDIATION: "Remediation",
  RETEST: "Retest",
};

/**
 * The guided frame of a control (Milestone 1a): the five steps as a map of where the
 * control is, the testing phases with their own state, the one thing that needs a person
 * and who that person is, everything outstanding with where it is resolved, and the
 * sign-offs on record. Every state comes from the API's journey; nothing is derived or
 * decided here, and no step is a gate: each opens on a click.
 *
 * Laid out as the product owner's reference of 30 October 2026: the steps as a line of
 * marks, one banner for what needs a person with its action, and the agent's note and
 * what is outstanding behind the banner's "more" control; the completion and phase
 * details fold under the steps.
 */
export function ControlStepper({
  journey,
  items,
  phases,
  current,
  hrefs,
  ids = null,
  needs,
  actionHref,
  blockers,
  receipts,
  activityHref,
  agent,
  trace,
  simple = false,
  summary = true,
  planPending = false,
}: {
  journey: ControlJourney | null;
  items: StepperItem[];
  phases: JourneyPhase[];
  current: Step;
  hrefs: Record<Step, string>;
  /** The engagement, for the agent block's cancel action (Milestone 3a). */
  ids?: { organizationId: string; projectId: string } | null;
  needs: NeedsYou;
  /** Where the viewer does the next action, when it is theirs. */
  actionHref: string | null;
  blockers: Blocker[];
  receipts: Signoff[];
  /** The control's activity record (the audit trail), below the steps. */
  activityHref: string;
  /** The agent block for the open step (M1c). */
  agent: Says | null;
  /** The trace rail: the chain of records, and each attribute's row (M1c). The Test
   * step draws it in its workspace instead and passes null here. */
  trace: { nodes: TraceNode[]; rows: TraceRow[] } | null;
  /** The Plan step with the test plan open below (decided by the product owner): the
   * plan itself says what it needs and is edited in place, so the steps and phases stay
   * and the summary blocks (needs you, the agent, outstanding, trace) do not repeat it. */
  simple?: boolean;
  /** The summary blocks (needs you, the agent, outstanding, trace); off where the step's
   * own work says the same (the Request step). The steps, phases and sign-offs stay. */
  summary?: boolean;
  /** The test plan waits for a person's approval: the Plan step reads In review. */
  planPending?: boolean;
}) {
  const done = completion(journey);
  return (
    <div className="cw-guide">
      <nav className="cw-stepper" aria-label="Control workflow">
        <ol>
          {items.map((item, index) => {
            // A done step and the open one say their state beside the name; an
            // upcoming step says it to a screen reader (product owner's reference, 2
            // November 2026).
            const spoken =
              item.status === "done" ||
              item.status === "current" ||
              item.status === "working"
                ? ""
                : " sr-only";
            return (
              <li
                key={item.step}
                className={`is-${item.status}${item.step === current ? " is-open" : ""}`}
              >
                <a
                  href={hrefs[item.step]}
                  aria-current={item.step === current ? "step" : undefined}
                  title={
                    item.step === current
                      ? `${item.label}: open now`
                      : item.status === "working"
                        ? `${item.label}: work in progress`
                        : undefined
                  }
                >
                  <span className="cw-step-mark" aria-hidden="true">
                    {item.status === "done" ? (
                      <UiIcon name="check" size={16} />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className="cw-step-copy">
                    <span className="cw-step-name">
                      <strong>{STEP_NAME[item.step] ?? item.label}</strong>
                      <span
                        className={`cw-step-state is-${item.status}${spoken}`}
                      >
                        {stepState(item, planPending)}
                      </span>
                    </span>
                    <small>{STEP_DETAIL[item.step]}</small>
                    {item.note !== "" ? (
                      <span className="sr-only">: {item.note}</span>
                    ) : null}
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
        {simple ? null : (
          <details className="cw-guide-more">
            <summary>
              Status details
              <UiIcon name="chevron" size={13} />
            </summary>
            <p className="cw-completion">
              <span className={done.testing ? "is-done" : ""}>
                <UiIcon name={done.testing ? "check" : "clock"} size={12} />{" "}
                Testing
                {done.testing ? " complete" : " open"}
              </span>
              <span className={done.review ? "is-done" : ""}>
                <UiIcon name={done.review ? "check" : "clock"} size={12} />{" "}
                Review
                {done.review ? " complete" : " pending"}
              </span>
              <span className={done.final ? "is-done is-final" : ""}>
                <UiIcon name={done.final ? "check" : "clock"} size={12} />
                {done.final ? " Final conclusion" : " Not final"}
              </span>
              <a className="cw-classic" href={activityHref}>
                Activity
              </a>
            </p>
            {phases.length > 0 ? (
              <ol className="cw-phases" aria-label="Testing phases">
                {phases.map((phase) => (
                  <li
                    key={phase.phase}
                    className={`is-${phase.state.toLowerCase()}${phase.phase === journey?.stepPhase ? " is-open" : ""}`}
                  >
                    <span className="cw-phase-name">
                      {PHASE_SHORT[phase.phase] ?? phase.label}
                    </span>
                    <span className="cw-phase-state">
                      {phase.stateLabel}
                      {phase.releasedEarly ? " · released early" : ""}
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
          </details>
        )}
      </nav>
      {simple || !summary ? null : (
        <NeedsBanner
          needs={needs}
          actionHref={actionHref}
          agent={agent}
          blockers={blockers}
          hrefs={hrefs}
          ids={ids}
          current={current}
        />
      )}
      {receipts.length > 0 ? (
        <section className="cw-receipts" aria-labelledby="cw-receipts-title">
          <h2 id="cw-receipts-title">On record</h2>
          <ul>
            {receipts.map((item) => (
              <li
                key={item.id}
                className={item.reopenedAt !== null ? "is-reopened" : ""}
              >
                <span>
                  {receiptText(item)} · {formatDate(item.signedAt)}
                </span>
                {item.reopenedAt !== null ? (
                  <small>{reopenText(item)}</small>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {trace !== null && !simple && summary ? (
        <TraceRail nodes={trace.nodes} rows={trace.rows} />
      ) : null}
    </div>
  );
}

/** The one thing that needs a person and who that person is, with its action, and the
 * agent's note and what is outstanding behind its "more" control. On the Overview tab
 * (product owner's reference, 2 November 2026), and in the guided frame where asked. */
export function NeedsBanner({
  needs,
  actionHref,
  agent,
  blockers,
  hrefs,
  ids = null,
  current,
}: {
  needs: NeedsYou;
  actionHref: string | null;
  agent: Says | null;
  blockers: Blocker[];
  hrefs: Record<Step, string>;
  ids?: { organizationId: string; projectId: string } | null;
  current: Step;
}) {
  const more = agent !== null || blockers.length > 0;
  return (
    <section
      className={`cw-needs${needs.mine ? " is-mine" : ""}`}
      aria-labelledby="cw-needs-title"
    >
      <span className="cw-needs-icon" aria-hidden="true">
        <UiIcon name={needs.mine ? "file" : "clock"} size={22} />
      </span>
      <div className="cw-needs-copy">
        <p className="cw-needs-kicker" id="cw-needs-title">
          {needs.mine
            ? "Needs you"
            : needs.waitsOn !== ""
              ? `Waits on ${needs.waitsOn}`
              : `Waits on ${needs.who.toLowerCase()}`}
        </p>
        <p className="cw-needs-title">{needs.title}</p>
        {needs.reason !== "" ? (
          <p className="cw-needs-reason">{needs.reason}</p>
        ) : null}
      </div>
      {needs.mine && actionHref !== null ? (
        <div className="cw-needs-actions">
          <a className="btn" href={actionHref}>
            Open
            <UiIcon name="arrow" size={14} />
          </a>
        </div>
      ) : null}
      {more ? (
        // The agent's note on this step and what is outstanding, on request: the
        // banner keeps to the one thing that needs a person.
        <details className="cw-needs-more">
          <summary
            aria-label="The agent's note and what is outstanding"
            title="The agent's note and what is outstanding"
          >
            <UiIcon name="more" size={16} />
          </summary>
          <div className="cw-needs-drawer">
            {agent !== null ? (
              <AgentSays says={agent} ids={ids} back={hrefs[current]} />
            ) : null}
            {blockers.length > 0 ? (
              <section
                className="cw-blockers"
                aria-labelledby="cw-blockers-title"
              >
                <h2 id="cw-blockers-title">Outstanding</h2>
                <ul>
                  {blockers.map((item) => (
                    <li
                      key={item.text}
                      className={item.holdsConclusion ? "is-holding" : ""}
                    >
                      <span>{item.text}</span>
                      <a href={hrefs[item.step]}>{STEP_WORDS[item.step]}</a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}

/** The agent's note on the control and what is outstanding, folded (product owner, 2
 * November 2026: the Needs-you banner left the Overview; these fold into AI insights).
 * Nothing when there is neither. */
export function AgentNotes({
  agent,
  blockers,
  hrefs,
  ids = null,
  back,
}: {
  agent: Says | null;
  blockers: Blocker[];
  hrefs: Record<Step, string>;
  ids?: { organizationId: string; projectId: string } | null;
  back: string;
}) {
  if (agent === null && blockers.length === 0) {
    return null;
  }
  return (
    <details className="ov-notes">
      <summary>
        {agent !== null && blockers.length > 0
          ? `The agent's note and ${blockers.length} outstanding`
          : agent !== null
            ? "The agent's note"
            : `${blockers.length} outstanding`}
        <UiIcon name="chevron" size={13} />
      </summary>
      <div className="cw-needs-drawer">
        {agent !== null ? (
          <AgentSays says={agent} ids={ids} back={back} />
        ) : null}
        {blockers.length > 0 ? (
          <section className="cw-blockers" aria-label="Outstanding">
            <ul>
              {blockers.map((item) => (
                <li
                  key={item.text}
                  className={item.holdsConclusion ? "is-holding" : ""}
                >
                  <span>{item.text}</span>
                  <a href={hrefs[item.step]}>{STEP_WORDS[item.step]}</a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </details>
  );
}

/** A step's state in a word, under its name: the plan waiting for approval reads In
 * review; a step behind the control's with work still open, In progress. */
function stepState(item: StepperItem, planPending: boolean): string {
  if (item.status === "done") {
    return "Completed";
  }
  if (item.status === "working") {
    return "In progress";
  }
  if (item.status === "current") {
    return item.step === "PLAN" && planPending ? "In review" : "In progress";
  }
  return "Not started";
}

/** What each step is for, under its name (product owner's reference, 2 November 2026). */
const STEP_DETAIL: Record<Step, string> = {
  PLAN: "Define and approve the test plan",
  REQUEST: "Draft and send evidence requests",
  TEST: "Perform testing and evaluate",
  CONCLUDE: "Conclude on control status",
  REVIEW: "Independent review",
};

/** The steps' names on the progress line, as the reference names them; the Conclude
 * step reads Evaluate there. */
const STEP_NAME: Partial<Record<Step, string>> = {
  CONCLUDE: "Evaluate",
};

const STEP_WORDS: Record<Step, string> = {
  PLAN: "Plan",
  REQUEST: "Request",
  TEST: "Test",
  CONCLUDE: "Conclude",
  REVIEW: "Review",
};
