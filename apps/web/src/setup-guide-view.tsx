import { AgentBot } from "./agent-panel";
import { WalkThroughButton } from "./controls-guide";
import { controlsBrief } from "./controls-guide-model";
import type { Onboarding, SetupStep } from "./onboarding-model";
import { setupHref } from "./onboarding-view";
import { setupBrief, setupCycle } from "./setup-guide-model";
import type { ShellModel } from "./shell-model";
import { UiIcon } from "./ui-icon";

type Ready = Extract<ShellModel, { status: "ready" }>;

const STATE_LABEL = {
  done: "Done",
  current: "Now",
  next: "Next",
  upcoming: "Later",
} as const;

/**
 * The onboarding cycle across guided setup (decided by the product owner): creating the
 * engagement done, then each setup step to launch, the open one current. A setup step
 * opens from here.
 */
export function SetupCycle({
  model,
  onboarding,
  current,
}: {
  model: Ready;
  onboarding: Onboarding;
  current: SetupStep;
}) {
  const stages = setupCycle(onboarding, current);
  return (
    <nav className="oc oc-setup oc-short" aria-label="Onboarding cycle">
      <ol>
        {stages.map((stage, at) => {
          const body = (
            <>
              <span className="oc-num" aria-hidden="true">
                {stage.state === "done" ? (
                  <UiIcon name="check" size={13} />
                ) : (
                  at + 1
                )}
              </span>
              <span className="oc-text">
                <strong>{stage.title}</strong>
                <small>{stage.detail}</small>
              </span>
              <span className="sr-only">{STATE_LABEL[stage.state]}</span>
            </>
          );
          return (
            <li
              key={stage.id}
              className={`oc-stage is-${stage.state} is-here`}
              aria-current={stage.state === "current" ? "step" : undefined}
            >
              <a
                className="oc-link"
                href={setupHref(model, stage.id as SetupStep)}
              >
                {body}
              </a>
            </li>
          );
        })}
      </ol>
      <p className="oc-note">
        <UiIcon name="layers" size={13} />
        After launch, the systems, controls, and workpaper templates are set up
        in Controls.
      </p>
    </nav>
  );
}

/**
 * The setup agent beside each step of guided setup: what the step settles, what it still
 * needs, what is worth checking, the next step once this one is ready, and a tip. Worded
 * from setup's own readiness.
 */
export function SetupAgent({
  model,
  onboarding,
  step,
  justCreated,
}: {
  model: Ready;
  onboarding: Onboarding;
  step: SetupStep;
  /** The first step after the engagement was created: the agent says so first. */
  justCreated: boolean;
}) {
  const brief = setupBrief(onboarding, step);
  return (
    <aside className="ap" aria-label="Setup agent">
      <div className="ap-bot">
        <AgentBot />
      </div>
      <div className="ap-bubble">
        <strong>
          {justCreated ? `${onboarding.projectName} is created.` : brief.title}
        </strong>
        <p>
          {justCreated
            ? `Next: ${brief.title}. ${brief.outcome}`
            : brief.outcome}
        </p>
      </div>
      <section className="ap-card" aria-live="polite">
        <p className="ap-line">{brief.progress}</p>
        {brief.todo.length > 0 ? (
          <>
            <p className="ap-label">Still needed</p>
            <ul className="ap-list is-todo">
              {brief.todo.map((item) => (
                <li key={item}>
                  <UiIcon name="risk" size={13} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="ap-ready">
            <UiIcon name="check" size={14} />
            {step === "launch" ? "Ready to launch." : "This step is ready."}
          </p>
        )}
        {brief.worth.length > 0 ? (
          <>
            <p className="ap-label">Worth checking</p>
            <ul className="ap-list">
              {brief.worth.map((item) => (
                <li key={item}>
                  <UiIcon name="info" size={13} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {brief.next !== null ? (
          <div className="ap-actions">
            <a className="btn ap-next" href={setupHref(model, brief.next.step)}>
              {brief.next.label}
              <UiIcon name="arrow" size={14} />
            </a>
          </div>
        ) : null}
      </section>
      <section className="ap-tip">
        <span className="ap-tip-icon" aria-hidden="true">
          <UiIcon name="info" size={14} />
        </span>
        <span>
          <strong>Tip</strong>
          <p>{brief.tip}</p>
        </span>
      </section>
    </aside>
  );
}

/**
 * The setup agent's strip under the Controls setup (decided by the product owner): what to
 * do next, worded from the engagement's own setup, and the way into the tour.
 */
export function ControlsAssistant({ onboarding }: { onboarding: Onboarding }) {
  const brief = controlsBrief(onboarding);
  return (
    <aside className="cs-assist" aria-label="Setup agent">
      <span className="cs-assist-bot">
        <AgentBot />
      </span>
      <div className="cs-assist-text" aria-live="polite">
        <p className="cs-assist-label">Setup agent</p>
        <p>{brief.next}</p>
      </div>
      <WalkThroughButton label="Guide me" />
    </aside>
  );
}
