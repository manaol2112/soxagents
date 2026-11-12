"use client";

import Link from "next/link";
import { AgentAvatar } from "./agent-avatar";
import type { StepKey } from "./control-workflow-model";
import type { NextAction, NextStep, Stage } from "./next-step-model";
import { SpotlightTour } from "./spotlight-tour";
import type { TourStep } from "./tour-model";
import { UiIcon } from "./ui-icon";

/** Why two steps show at once, and which comes first. */
const PAIR_WHY =
  "The D&I and OE branches run side by side. OE evidence waits for the D&I sign-off, so D&I is the one to start.";

/** The event that opens the control's tour (its own button opens it too). */
const TOUR_EVENT = "aw:next-step-tour";

const TOUR: readonly TourStep[] = [
  {
    id: "next",
    targets: [".ns"],
    title: "Your next step",
    body: [
      "This card always says what to do next on the control, and why. Its button opens that step.",
    ],
    done: false,
  },
  {
    id: "node",
    targets: [".wf-node.is-next", ".wf-list-row.is-next"],
    title: "Where it sits in the workflow",
    body: [
      "The same step is marked on the workflow. AI steps are prepared for you; human gates need a decision.",
    ],
    done: false,
  },
  {
    id: "flow",
    targets: [".wf"],
    title: "Every step, one click away",
    body: [
      "Open any step to see its work. A step that cannot start yet says what it waits for.",
    ],
    done: false,
  },
];

/**
 * The control's next step, above its workflow (product owner, 10 November 2026; mock-up
 * approved the same day): what to do, why, what the records show, and one button that opens
 * the step. It reads the workflow the nodes are drawn from (next-step-model), and nothing
 * opens by itself: "Show me around" is offered, not forced.
 */
export function NextStepCard({
  next,
  stages,
  hrefs,
  askHref,
}: {
  next: NextStep;
  stages: readonly Stage[];
  hrefs: Readonly<Record<StepKey, string>>;
  /** The agent console, for a question about the control. */
  askHref: string;
}) {
  const one =
    next.mode === "next" && next.actions.length === 1
      ? (next.actions[0] ?? null)
      : null;
  const many =
    next.mode === "next" && next.actions.length > 1 ? next.actions : null;
  const working = one?.kind === "agent";
  // The tour's own button opens it, and focus returns there when it closes.
  const tour = (
    <SpotlightTour
      steps={TOUR}
      seenKey="aw.tour.next-step"
      openEvent={TOUR_EVENT}
      auto={false}
      launchLabel="Show me around"
      agent="Engagement planner"
    />
  );
  const open = (action: NextAction, primary: boolean) => (
    <Link
      className={`btn ${primary ? "btn-primary" : "btn-secondary"}`}
      href={hrefs[action.key]}
      scroll={false}
    >
      {action.label}
      {primary ? <UiIcon name="arrow" size={14} /> : null}
    </Link>
  );

  return (
    <section
      className={`ns${next.mode === "done" ? " is-done" : ""}`}
      aria-labelledby="ns-title"
    >
      <span className="ns-tile" aria-hidden="true">
        <AgentAvatar
          size={22}
          state={working ? "working" : next.mode === "done" ? "done" : "idle"}
        />
      </span>

      {one !== null ? (
        <>
          <div className="ns-text">
            <p className="ns-eyebrow">
              Next step · {one.kindLabel}
              {one.flag === "Start here" ? (
                <span className="ns-pill is-accent">Start here</span>
              ) : one.kind === "agent" ? (
                <span className="ns-pill">Working</span>
              ) : one.kind === "flag" ? (
                <span className="ns-pill is-warm">Needs attention</span>
              ) : null}
            </p>
            <h2 id="ns-title">{one.title}</h2>
            <p className="ns-why" title={one.detail}>
              {one.detail}
            </p>
            {one.facts.length > 0 ? (
              <ul className="ns-facts">
                {one.facts.slice(0, 3).map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="ns-side ns-acts">
            <a className="btn btn-quiet" href={askHref}>
              Ask the planner
            </a>
            {open(one, !working)}
            {tour}
          </div>
          {working ? (
            <div className="ns-working" aria-hidden="true">
              <span />
            </div>
          ) : null}
        </>
      ) : many !== null ? (
        <>
          <div className="ns-text">
            <h2 id="ns-title">{many.length} steps are ready for you</h2>
            <p className="ns-why" title={PAIR_WHY}>
              {PAIR_WHY}
            </p>
          </div>
          <div className="ns-side">{tour}</div>
          <ul className="ns-pair">
            {many.map((action, at) => (
              <li key={action.key}>
                <span className="ns-pair-text">
                  <strong>{action.title}</strong>
                  <span>{action.facts[0] ?? action.detail}</span>
                </span>
                {open(action, at === 0)}
              </li>
            ))}
          </ul>
        </>
      ) : next.mode === "done" ? (
        <div className="ns-text">
          <p className="ns-eyebrow">Concluded</p>
          <h2 id="ns-title">Every step on this control is done</h2>
          <p className="ns-why">
            The conclusion and the workpaper are on record. Open any step to see
            its work.
          </p>
        </div>
      ) : next.mode === "waiting" ? (
        <div className="ns-text">
          <p className="ns-eyebrow">Next step</p>
          <h2 id="ns-title">{next.title}</h2>
          <p className="ns-why" title={next.detail}>
            {next.detail}
          </p>
        </div>
      ) : null}

      <ol
        className="ns-journey"
        aria-label="Where this control is in the audit"
      >
        {stages.map((stage, at) => (
          <li
            key={stage.label}
            className={`is-${stage.state}`}
            aria-current={stage.state === "here" ? "step" : undefined}
          >
            <span className="ns-dot" aria-hidden="true">
              {stage.state === "done" ? <UiIcon name="check" size={9} /> : null}
            </span>
            <span className="ns-stage">
              {stage.label}
              {stage.state === "here" ? (
                <span className="ns-of">
                  {" "}
                  · stage {at + 1} of {stages.length}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
