import {
  idleMessage,
  JOURNEY,
  type NextStep,
  type NextSteps,
  type StageKey,
  stepHref,
  stepsByStage,
} from "./home-model";
import { parseQueueFilter, type Queue } from "./queue-model";
import { QueuePanel } from "./queue-panel";
import { UiIcon } from "./ui-icon";

const STAGE_LABELS: Record<StageKey, string> = {
  SETUP: "Set up",
  PLANS: "Test plans",
  EVIDENCE: "Evidence",
  TESTING: "Testing",
  REVIEW: "Review",
  CLOSE: "Close",
};

// The button's words for each kind of step; a console item keeps the console's own.
const ACTIONS: Record<string, string> = {
  setup: "Continue setup",
  plans_held: "Settle",
  plans_revised: "Review changes",
  plans_ready: "Review and approve",
  plans_values: "Answer",
  plans_describe: "Describe",
  approval: "Decide",
  results: "Open",
  samples: "Review",
  review: "Sign off",
  control_review: "Review",
  drafts: "Submit",
  contacts: "Assign",
  late: "Follow up",
  reminders: "Review",
  replies: "Read",
  blocked: "Resolve",
  planning: "Plan",
};

/**
 * The engagement's home: where it stands (the journey of its stages) and the one ordered
 * list of what waits on the team, each with the page where it is done. The agent console
 * is one click away for anything else.
 */
export function NextStepsPanel({
  next,
  organizationId,
  projectId,
  consoleHref,
  work = null,
  filter = null,
  filterHref,
}: {
  next: NextSteps;
  organizationId: string;
  projectId: string;
  consoleHref: string;
  /** The engagement's one queue (M2a); the stage list below stands in without it. */
  work?: Queue | null;
  filter?: string | null;
  filterHref?: ((filter: string) => string) | undefined;
}) {
  const groups = stepsByStage(next.steps);
  const first = next.steps[0];
  if (work !== null && filterHref !== undefined) {
    return (
      <>
        <JourneyBar next={next} />
        <QueuePanel
          queue={work}
          filter={parseQueueFilter(filter)}
          organizationId={organizationId}
          projectId={projectId}
          baseHref={filterHref}
        />
      </>
    );
  }
  return (
    <>
      <JourneyBar next={next} />
      <section
        className="card home-next"
        aria-labelledby="home-next-title"
        id="decision-queue"
      >
        <header className="card-header">
          <div>
            <h2 id="home-next-title">Do next</h2>
            <p className="card-desc">
              Everything that waits on the team, in the order of the work. Items
              that hold the engagement up come first.
            </p>
          </div>
          <div className="card-aside">
            <a className="text-link" href={consoleHref}>
              <UiIcon name="sparkles" size={14} /> Ask the agent console
            </a>
          </div>
        </header>
        {groups.length === 0 ? (
          <div className="queue-clear">
            <span className="queue-clear-icon" aria-hidden="true">
              <UiIcon name="check" size={14} />
            </span>
            <p>
              <strong>Nothing is waiting on the team.</strong>{" "}
              {idleMessage(next)}
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.stage} className="home-group">
              <h3 className="home-group-title">
                {STAGE_LABELS[group.stage]}
                {group.stage === next.current ? (
                  <span className="home-group-current">Current stage</span>
                ) : null}
              </h3>
              <ul className="home-steps">
                {group.steps.map((step) => (
                  <StepRow
                    key={`${step.kind}-${step.title}`}
                    step={step}
                    lead={step === first}
                    href={stepHref(step, organizationId, projectId)}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </>
  );
}

function StepRow({
  step,
  lead,
  href,
}: {
  step: NextStep;
  lead: boolean;
  href: string;
}) {
  return (
    <li
      className={`home-step${lead ? " is-lead" : ""}${step.blocks ? " is-blocking" : ""}`}
    >
      <span className="home-step-copy">
        {lead ? <span className="home-step-start">Start here</span> : null}
        <strong>
          {step.controlRef !== null ? (
            <span className="home-step-ref">{step.controlRef}</span>
          ) : null}
          {step.title}
        </strong>
        {step.detail !== "" ? <small>{step.detail}</small> : null}
      </span>
      <a className={`btn btn-sm${lead ? "" : " btn-secondary"}`} href={href}>
        {ACTIONS[step.kind] ?? "Open"}
        <UiIcon name="arrow" size={13} />
      </a>
    </li>
  );
}

/** The engagement's six stages, the current one marked; with `hrefFor`, each stage opens
 * the place its work is done (Home, docs/home-plan.md). */
export function JourneyBar({
  next,
  hrefFor,
}: {
  next: NextSteps;
  hrefFor?: ((stage: StageKey) => string) | undefined;
}) {
  return (
    <nav className="home-journey card" aria-label="Engagement stages">
      <ol>
        {JOURNEY.map((key, index) => {
          const stage = next.stages.find((item) => item.key === key);
          const status = stage?.status ?? "UPCOMING";
          const body = (
            <>
              <span className="home-stage-mark" aria-hidden="true">
                {status === "DONE" ? (
                  <UiIcon name="check" size={13} />
                ) : (
                  index + 1
                )}
              </span>
              <span className="home-stage-copy">
                <strong>{stage?.label ?? STAGE_LABELS[key]}</strong>
                <small>
                  {status === "CURRENT" ? "Current · " : ""}
                  {stage?.summary ?? ""}
                </small>
              </span>
            </>
          );
          return (
            <li
              key={key}
              className={`home-stage is-${status.toLowerCase()}`}
              aria-current={status === "CURRENT" ? "step" : undefined}
            >
              {hrefFor === undefined ? (
                body
              ) : (
                <a className="home-stage-link" href={hrefFor(key)}>
                  {body}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
