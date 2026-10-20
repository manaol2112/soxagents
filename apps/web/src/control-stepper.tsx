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
 */
export function ControlStepper({
  journey,
  items,
  phases,
  current,
  hrefs,
  needs,
  actionHref,
  blockers,
  receipts,
  classicHref,
}: {
  journey: ControlJourney | null;
  items: StepperItem[];
  phases: JourneyPhase[];
  current: Step;
  hrefs: Record<Step, string>;
  needs: NeedsYou;
  /** Where the viewer does the next action, when it is theirs. */
  actionHref: string | null;
  blockers: Blocker[];
  receipts: Signoff[];
  classicHref: string;
}) {
  const done = completion(journey);
  return (
    <div className="cw-guide">
      <nav className="cw-stepper" aria-label="Control workflow">
        <ol>
          {items.map((item, index) => (
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
                    <UiIcon name="check" size={12} />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="cw-step-copy">
                  <strong>{item.label}</strong>
                  {item.note !== "" ? <small>{item.note}</small> : null}
                </span>
              </a>
            </li>
          ))}
        </ol>
        <p className="cw-completion">
          <span className={done.testing ? "is-done" : ""}>
            <UiIcon name={done.testing ? "check" : "clock"} size={12} /> Testing
            {done.testing ? " complete" : " open"}
          </span>
          <span className={done.review ? "is-done" : ""}>
            <UiIcon name={done.review ? "check" : "clock"} size={12} /> Review
            {done.review ? " complete" : " pending"}
          </span>
          <span className={done.final ? "is-done is-final" : ""}>
            <UiIcon name={done.final ? "check" : "clock"} size={12} />
            {done.final ? " Final conclusion" : " Not final"}
          </span>
          <a className="cw-classic" href={classicHref}>
            All details
          </a>
        </p>
      </nav>
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
      <section
        className={`cw-needs${needs.mine ? " is-mine" : ""}`}
        aria-labelledby="cw-needs-title"
      >
        <p className="cw-needs-kicker" id="cw-needs-title">
          {needs.mine ? "Needs you" : `Waits on ${needs.who.toLowerCase()}`}
        </p>
        <p className="cw-needs-title">{needs.title}</p>
        {needs.reason !== "" ? (
          <p className="cw-needs-reason">{needs.reason}</p>
        ) : null}
        {needs.mine && actionHref !== null ? (
          <div className="cw-needs-actions">
            <a className="btn" href={actionHref}>
              Open
              <UiIcon name="arrow" size={14} />
            </a>
          </div>
        ) : null}
      </section>
      {blockers.length > 0 ? (
        <section className="cw-blockers" aria-labelledby="cw-blockers-title">
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
    </div>
  );
}

const STEP_WORDS: Record<Step, string> = {
  PLAN: "Plan",
  REQUEST: "Request",
  TEST: "Test",
  CONCLUDE: "Conclude",
  REVIEW: "Review",
};
