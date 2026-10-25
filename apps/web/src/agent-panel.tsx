"use client";

import {
  type FactsBase,
  OPEN_GUIDE_EVENT,
  useEngagementFacts,
} from "./engagement-form-facts";
import {
  agentBrief,
  type CycleStage,
  type GuideFacts,
  onboardingCycle,
  type SetupStage,
} from "./engagement-guide-model";
import { UiIcon } from "./ui-icon";

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollTo(element: Element | null): void {
  element?.scrollIntoView({
    block: "start",
    behavior: reducedMotion() ? "auto" : "smooth",
  });
}

/** Before the page has been read: nothing chosen yet. */
function blankFacts(base: FactsBase): GuideFacts {
  return {
    ...base,
    client: null,
    startFrom: "",
    name: "",
    periodEnd: "",
    leadName: "",
    methodology: "",
    scope: "",
  };
}

/** The setup agent: a visor with two lit eyes, a smile, and an antenna. Drawn in the
 * agent's tokens; it floats and blinks, and stays still under reduced motion. */
export function AgentBot({ size = 92 }: { size?: number }) {
  return (
    <svg
      className="ab-bot"
      width={size}
      height={size}
      viewBox="0 0 120 120"
      aria-hidden="true"
    >
      <circle className="ab-halo" cx="60" cy="64" r="54" />
      <g className="ab-body">
        <line className="ab-antenna" x1="60" y1="14" x2="60" y2="28" />
        <circle className="ab-tip" cx="60" cy="12" r="5" />
        <rect className="ab-ear" x="14" y="52" width="12" height="22" rx="6" />
        <rect className="ab-ear" x="94" y="52" width="12" height="22" rx="6" />
        <rect
          className="ab-head"
          x="22"
          y="28"
          width="76"
          height="66"
          rx="28"
        />
        <rect
          className="ab-visor"
          x="32"
          y="42"
          width="56"
          height="34"
          rx="17"
        />
        <g className="ab-eyes">
          <ellipse className="ab-eye" cx="49" cy="57" rx="5.5" ry="6.5" />
          <ellipse className="ab-eye" cx="71" cy="57" rx="5.5" ry="6.5" />
        </g>
        <path className="ab-smile" d="M51 67 Q60 73 69 67" />
      </g>
    </svg>
  );
}

/**
 * The setup agent beside the form (decided by the product owner): it greets, says what
 * is being set up and what is still needed as the form fills in, offers the client's
 * latest engagement as a starting point, says what follows this page, and gives a tip.
 * Its words come from the page's data; no model is called.
 */
export function AgentPanel({
  clients,
  firstName,
}: FactsBase & { firstName: string }) {
  const base = { clients };
  const facts = useEngagementFacts(base) ?? blankFacts(base);
  const brief = agentBrief(facts, firstName);
  return (
    <aside className="ap" aria-label="Setup agent">
      <div className="ap-bot">
        <AgentBot />
      </div>
      <div className="ap-bubble">
        <strong>{brief.greeting}</strong>
        <p>
          Setting up an engagement takes a few minutes. Nothing starts until the
          draft is reviewed and launched.
        </p>
      </div>
      <section className="ap-card" aria-live="polite">
        {brief.lines.map((line) => (
          <p key={line} className="ap-line">
            {line}
          </p>
        ))}
        <p className="ap-label">Next</p>
        <p className="ap-line ap-after">{brief.after}</p>
        <div className="ap-actions">
          {brief.startFrom !== null ? (
            <button
              type="button"
              className="ap-action"
              onClick={() => {
                const option = document.querySelector<HTMLInputElement>(
                  `input[name="rollforward_from"][value="${brief.startFrom?.id ?? ""}"]`,
                );
                option?.click();
                scrollTo(document.querySelector(".client-start"));
              }}
            >
              <UiIcon name="copy" size={14} />
              Start from {brief.startFrom.name}
            </button>
          ) : null}
          <button
            type="button"
            className="ap-action"
            onClick={() => document.dispatchEvent(new Event(OPEN_GUIDE_EVENT))}
          >
            <UiIcon name="sparkles" size={14} />
            Walk through the form
          </button>
        </div>
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

const STATE_LABEL: Record<CycleStage["state"], string> = {
  done: "Done",
  current: "Now",
  next: "Next",
  upcoming: "Later",
};

/**
 * The onboarding cycle across the top of the page (decided by the product owner): the
 * client and scope here, then the team and launch. The systems, controls, and templates
 * follow in Controls after launch.
 */
export function OnboardingCycle({
  clients,
  setup,
}: FactsBase & { setup: readonly SetupStage[] }) {
  const base = { clients };
  const facts = useEngagementFacts(base) ?? blankFacts(base);
  const stages = onboardingCycle(facts, setup);
  return (
    <nav className="oc oc-short" aria-label="Onboarding cycle">
      <ol>
        {stages.map((stage, at) => (
          <li
            key={stage.id}
            className={`oc-stage is-${stage.state} is-${stage.where}`}
            aria-current={stage.state === "current" ? "step" : undefined}
          >
            <span className="oc-static">
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
              <span className="sr-only">
                {STATE_LABEL[stage.state]}
                {stage.where === "setup"
                  ? ", after the engagement is created"
                  : ""}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <p className="oc-note">
        <UiIcon name="layers" size={13} />
        After launch, the systems, controls, and workpaper templates are set up
        in Controls.
      </p>
    </nav>
  );
}
