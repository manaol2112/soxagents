"use client";

import { useMemo, useState } from "react";

import { useAction } from "./control-context-view";
import {
  ACTIVITY_CATEGORY_LABELS,
  type ActivityCategory,
  type ActivityItem,
  type AgentLane,
  type Approach,
  type AttentionItem,
  type CalmReason,
  currentStage,
  filterActivity,
  type LaneRun,
  type LifecycleStage,
  laneSummary,
  type Metric,
  type NextAction,
  RECORD_SECTIONS,
  RECORD_TAB_LABELS,
  type RecordTab,
  STAGE_STATUS_LABELS,
  STAGE_TITLES,
  sectionOf,
} from "./control-workspace-model";
import { evidenceHref } from "./evidence-flow";
import {
  type EvidencePlan,
  PLAN_STATUS_LABELS,
  planAwaitsApproval,
} from "./evidence-plan-model";
import { liveRequirements } from "./evidence-workspace-model";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };

const TIME = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});
const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** Where an item is done: a page outside the record, a record on the Evidence tab, or a
 * step on one of the tabs. */
export function itemHref(
  item: Pick<AttentionItem, "href" | "target" | "tab" | "anchor">,
  hrefs: Record<RecordTab, string>,
): string {
  if (item.href !== undefined) {
    return item.href;
  }
  if (item.target !== undefined) {
    return evidenceHref(hrefs.evidence, item.target);
  }
  return `${hrefs[item.tab]}${item.anchor !== "" ? `#${item.anchor}` : ""}`;
}

const OPEN_LABELS: Record<RecordTab, string> = {
  overview: "Open",
  design: "Open the test plan",
  evidence: "Open the evidence",
  testing: "Open the testing",
  findings: "Open the findings",
  review: "Open the review",
  activity: "Open the activity",
};

const STAGE_SHORT: Partial<Record<LifecycleStage["key"], string>> = {
  rollforward: "Roll-fwd",
  conclusion: "Close",
};

/**
 * The audit lifecycle as one thin bar: each stage's real state, read from its records,
 * with the stage the audit stands at named on the right. Each segment opens the tab
 * where its work is, and says its state on hover or keyboard focus.
 */
export function AuditProgress({
  stages,
  hrefs,
}: {
  stages: LifecycleStage[];
  hrefs: Record<RecordTab, string>;
}) {
  const current = currentStage(stages);
  return (
    <nav className="cw-track" aria-labelledby="cw-track-title">
      <div className="cw-track-head">
        <h2 id="cw-track-title">Audit progress</h2>
        <p>
          {current === null ? (
            "All stages complete"
          ) : (
            <>
              <strong>{STAGE_TITLES[current.key]}</strong>
              {current.note !== "" && current.status !== "not_started"
                ? ` · ${current.note}`
                : ""}
            </>
          )}
        </p>
      </div>
      <ol>
        {stages.map((item) => {
          const conditional =
            item.key === "rollforward" &&
            item.status === "not_started" &&
            item.note === "If a condition is met";
          const state =
            item.note !== "" ? item.note : STAGE_STATUS_LABELS[item.status];
          return (
            <li
              key={item.key}
              className={`is-${item.status}${conditional ? " is-conditional" : ""}${item === current ? " is-current" : ""}`}
            >
              <a
                href={hrefs[item.tab]}
                aria-current={item === current ? "step" : undefined}
              >
                <span className="cw-track-bar" aria-hidden="true" />
                <span className="cw-track-label">
                  <span className={STAGE_SHORT[item.key] ? "cw-long" : ""}>
                    {item.label}
                  </span>
                  {STAGE_SHORT[item.key] ? (
                    <span className="cw-short" aria-hidden="true">
                      {STAGE_SHORT[item.key]}
                    </span>
                  ) : null}
                </span>
                <span className="sr-only">
                  : {STAGE_STATUS_LABELS[item.status]}
                  {item.note !== "" ? `, ${item.note}` : ""}
                </span>
                <span className="cw-track-tip" aria-hidden="true">
                  <strong>{STAGE_TITLES[item.key]}</strong>
                  {STAGE_STATUS_LABELS[item.status]}
                  {state !== STAGE_STATUS_LABELS[item.status]
                    ? ` · ${state}`
                    : ""}
                  {item.agent ? " · An agent is working" : ""}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const CALM: Record<CalmReason, { title: string; detail: string }> = {
  concluded: {
    title: "Control concluded",
    detail: "The review is signed off and the conclusion is recorded.",
  },
  working: {
    title: "No action required",
    detail:
      "An agent is working on this control. Its output appears here for review when it is ready.",
  },
  waiting: {
    title: "No action required",
    detail:
      "The workflow is progressing. The next step rests with someone else.",
  },
  clear: {
    title: "No action required",
    detail: "Nothing on this control is pending at this time.",
  },
};

/**
 * The one thing the viewer does next, with the agent's offer to do the work where it can,
 * the viewer's other items on request, and what waits on someone else. The button opens
 * the place where a person does the work; nothing is decided from here.
 */
export function NextActionPanel({
  next,
  ids,
  hrefs,
  canAct,
  conclusionHref,
}: {
  next: NextAction;
  ids: Ids;
  hrefs: Record<RecordTab, string>;
  canAct: boolean;
  conclusionHref: string;
}) {
  const action = useAction(ids);
  const { primary, more, waiting } = next;
  const quick = (item: AttentionItem, size: "sm" | "md") =>
    item.quick !== null && canAct ? (
      <button
        type="button"
        className={`btn btn-secondary${size === "sm" ? " btn-sm" : ""}`}
        disabled={action.pending}
        onClick={() =>
          item.quick !== null &&
          action.run(item.key, { intent: item.quick.intent })
        }
      >
        <UiIcon name="sparkles" size={13} />
        {action.busy === item.key ? "In progress…" : item.quick.label}
      </button>
    ) : null;
  return (
    <section
      className={`cw-next${primary === null ? " is-calm" : ""}${primary?.kind === "blocker" ? " is-blocker" : ""}`}
      aria-labelledby="cw-next-title"
    >
      {primary === null ? (
        <>
          <p className="cw-next-kicker">
            <UiIcon name="check" size={15} />
            <span id="cw-next-title">{CALM[next.calm].title}</span>
          </p>
          <p className="cw-next-detail">{CALM[next.calm].detail}</p>
          {next.calm === "concluded" ? (
            <div className="cw-next-actions">
              <a className="btn btn-secondary" href={conclusionHref}>
                View the conclusion
                <UiIcon name="arrow" size={15} />
              </a>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <h2 className="cw-next-kicker" id="cw-next-title">
            <UiIcon
              name={primary.kind === "blocker" ? "risk" : "info"}
              size={15}
            />
            Your next action
          </h2>
          <p className="cw-next-title">{primary.title}</p>
          {primary.detail !== "" ? (
            <p className="cw-next-detail">{primary.detail}</p>
          ) : null}
          {primary.kind === "blocker" ? (
            <p className="cw-next-flag">
              Testing cannot proceed until this is done.
            </p>
          ) : null}
          <div className="cw-next-actions">
            {quick(primary, "md")}
            <a className="btn" href={itemHref(primary, hrefs)}>
              {primary.href !== undefined
                ? (primary.hrefLabel ?? "Open")
                : OPEN_LABELS[primary.tab]}
              <UiIcon name="arrow" size={15} />
            </a>
          </div>
        </>
      )}
      {action.problem !== null ? (
        <p className="cw-problem" role="alert">
          {action.problem}
        </p>
      ) : action.note !== "" ? (
        <p className="cw-hint">{action.note}</p>
      ) : null}
      {more.length > 0 ? (
        <details className="cw-more">
          <summary>
            {more.length === 1
              ? "1 more item needs attention"
              : `${more.length} more items need attention`}
            <UiIcon name="chevron" size={14} />
          </summary>
          <ul>
            {more.map((item) => (
              <li key={item.key} className={`is-${item.kind}`}>
                <div className="cw-more-text">
                  <strong>{item.title}</strong>
                  {item.detail !== "" ? <span>{item.detail}</span> : null}
                  {item.kind === "blocker" ? (
                    <small>Blocks testing</small>
                  ) : null}
                </div>
                <div className="cw-more-actions">
                  {quick(item, "sm")}
                  <a className="cw-open" href={itemHref(item, hrefs)}>
                    Open
                    <UiIcon name="arrow" size={13} />
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {waiting.length > 0 ? (
        <ul className="cw-waiting" aria-label="Waiting on others">
          {waiting.map((item) => (
            <li key={item.key}>
              <UiIcon name="clock" size={13} />
              <span>
                <span className="cw-owner">{item.owner}</span>
                {item.title}
                {item.detail !== "" ? ` · ${item.detail}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** One line on the other tabs: the viewer's next action, and where it is done. */
export function NextActionLine({
  item,
  hrefs,
}: {
  item: AttentionItem;
  hrefs: Record<RecordTab, string>;
}) {
  return (
    <p className={`cw-next-line is-${item.kind}`}>
      <span className="cw-next-line-label">Your next action</span>
      <span className="cw-next-line-title">{item.title}</span>
      <a className="cw-open" href={itemHref(item, hrefs)}>
        Open
        <UiIcon name="arrow" size={13} />
      </a>
    </p>
  );
}

/** The control's figures, each opening the view it counts. */
export function SummaryMetrics({
  metrics,
  hrefs,
}: {
  metrics: Metric[];
  hrefs: Record<RecordTab, string>;
}) {
  return (
    <ul className="cw-metrics" aria-label="Control summary">
      {metrics.map((metric) => (
        <li key={metric.key}>
          <a href={itemHref(metric, hrefs)}>
            <strong>{metric.value}</strong>
            <span>{metric.label}</span>
            {metric.note !== "" ? <small>{metric.note}</small> : null}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * The record's four sections, each keeping its tabs' routes, and Activity on its own.
 * Evidence & testing shows its three views beneath.
 */
export function RecordSections({
  tab,
  hrefs,
  counts,
}: {
  tab: RecordTab;
  hrefs: Record<RecordTab, string>;
  counts: Partial<Record<RecordTab, number | null>>;
}) {
  const section = sectionOf(tab);
  const sub = RECORD_SECTIONS.find((item) => item.key === section);
  return (
    <>
      <nav className="cw-sections" aria-label="Control record">
        {RECORD_SECTIONS.map((item) => (
          <a
            key={item.key}
            href={hrefs[item.tabs[0] ?? "overview"]}
            aria-current={section === item.key ? "page" : undefined}
          >
            {item.label}
          </a>
        ))}
        <a
          className="cw-sections-aside"
          href={hrefs.activity}
          aria-current={tab === "activity" ? "page" : undefined}
        >
          <UiIcon name="activity" size={14} />
          Activity
        </a>
      </nav>
      {sub !== undefined && sub.tabs.length > 1 ? (
        <nav className="cw-subnav" aria-label={sub.label}>
          {sub.tabs.map((key) => {
            const count = counts[key] ?? null;
            return (
              <a
                key={key}
                href={hrefs[key]}
                aria-current={tab === key ? "page" : undefined}
              >
                {RECORD_TAB_LABELS[key]}
                {count !== null && count > 0 ? (
                  <span className="cw-subnav-count">{count}</span>
                ) : null}
              </a>
            );
          })}
        </nav>
      ) : null}
    </>
  );
}

const RUN_LABELS: Record<LaneRun, string> = {
  running: "Running",
  queued: "Queued",
  stopped: "Stopped",
  idle: "",
};

/**
 * The agents on the control, one row each, with four things kept apart: whether it is
 * running, whether it can work yet (or what it waits for), what it produced, and whether
 * a person has decided on that. A row opens the tab where its work is.
 */
function rosterParts(lanes: AgentLane[]): string[] {
  const summary = laneSummary(lanes);
  return [
    summary.running > 0 ? `${summary.running} running` : "",
    summary.queued > 0 ? `${summary.queued} queued` : "",
    summary.stopped > 0 ? `${summary.stopped} stopped` : "",
    summary.decisions > 0
      ? `${summary.decisions} ${summary.decisions === 1 ? "output awaits" : "outputs await"} review`
      : "",
  ].filter((part) => part !== "");
}

/**
 * The agents' work on the control, folded by default to one line: how many are assigned,
 * whether any is running, queued, or stopped, and how many outputs wait on a person.
 * Opened, it shows each agent's state, output, and decision, and the recent activity,
 * with the whole audit trail one link away.
 */
export function AiActivity({
  lanes,
  hrefs,
  activity,
}: {
  lanes: AgentLane[];
  hrefs: Record<RecordTab, string>;
  activity: ActivityItem[] | null;
}) {
  const summary = laneSummary(lanes);
  const parts = rosterParts(lanes);
  return (
    <details className="cw-ai-panel">
      <summary>
        <span className="cw-ai-panel-title">
          <UiIcon name="sparkles" size={14} />
          AI activity
        </span>
        <span className="cw-ai-panel-line">
          {[
            lanes.length === 1
              ? "1 agent assigned"
              : `${lanes.length} agents assigned`,
            summary.running + summary.queued === 0
              ? "No agents currently running"
              : "",
            ...parts,
          ]
            .filter((part) => part !== "")
            .join(" · ")}
        </span>
        <span className="cw-ai-panel-toggle">
          <span className="cw-when-closed">Show agent activity</span>
          <span className="cw-when-open">Hide agent activity</span>
          <UiIcon name="chevron" size={14} />
        </span>
      </summary>
      <div className="cw-ai-panel-body">
        <AgentRoster lanes={lanes} hrefs={hrefs} embedded />
        <section className="cw-ai-recent" aria-labelledby="cw-recent-title">
          <h3 id="cw-recent-title">Recent activity</h3>
          <ActivityTimeline items={activity} limit={5} />
          <a className="cw-open" href={hrefs.activity}>
            Open the full audit trail
            <UiIcon name="arrow" size={13} />
          </a>
        </section>
      </div>
    </details>
  );
}

export function AgentRoster({
  lanes,
  hrefs,
  embedded = false,
}: {
  lanes: AgentLane[];
  hrefs: Record<RecordTab, string>;
  /** Inside the AI activity panel, which carries the title and the summary. */
  embedded?: boolean;
}) {
  const parts = rosterParts(lanes);
  return (
    <section
      className={`cw-roster${embedded ? " is-embedded" : ""}`}
      aria-labelledby="cw-roster-title"
    >
      <header className={`cw-roster-head${embedded ? " sr-only" : ""}`}>
        <h2 className="cw-section-title" id="cw-roster-title">
          <UiIcon name="sparkles" size={14} />
          Agents on this control
        </h2>
        <p>{parts.length > 0 ? parts.join(" · ") : "None running"}</p>
      </header>
      <div className="cw-lane cw-lane-head" aria-hidden="true">
        <span>Agent</span>
        <span>Now</span>
        <span>Produced</span>
        <span>Decision</span>
      </div>
      <ul className="cw-lanes">
        {lanes.map((lane) => (
          <li key={lane.key} data-lane={lane.key}>
            <a
              href={hrefs[lane.tab]}
              className={`cw-lane is-${lane.run} is-decision-${lane.decision.state}`}
            >
              <span className="cw-lane-agent" title={lane.job}>
                <strong>{lane.agent}</strong>
                <span className="sr-only">: {lane.job}</span>
              </span>
              <span className="cw-lane-now">
                <span className="sr-only">Now: </span>
                {lane.run !== "idle" ? (
                  <span className={`cw-run is-${lane.run}`}>
                    {lane.run === "running" ? (
                      <span className="cw-pulse" aria-hidden="true" />
                    ) : null}
                    {RUN_LABELS[lane.run]}
                  </span>
                ) : null}
                {lane.runNote !== "" ? (
                  <small>{lane.runNote}</small>
                ) : lane.waitsFor !== "" ? (
                  <small className="cw-lane-waits">{lane.waitsFor}</small>
                ) : lane.run === "idle" ? (
                  <small className="cw-lane-idle">Idle</small>
                ) : null}
              </span>
              <span className="cw-lane-output">
                <span className="sr-only">Produced: </span>
                {lane.output !== "" ? lane.output : <small>Nothing yet</small>}
              </span>
              <span className="cw-lane-decision">
                <span className="sr-only">Decision: </span>
                {lane.decision.state === "pending" ? (
                  <>
                    <span className="cw-owner">{lane.decision.owner}</span>
                    {lane.decision.text}
                  </>
                ) : lane.decision.state === "decided" ? (
                  <span className="cw-decided">
                    <UiIcon name="check" size={12} />
                    {lane.decision.text}
                  </span>
                ) : (
                  <small>None yet</small>
                )}
                {lane.note !== "" ? (
                  <small className="cw-lane-note">{lane.note}</small>
                ) : null}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The control's testing approach in one line: its kind, how it is tested, and the
 * phases the plan says apply. */
export function approachText(approach: Approach): string {
  const phases = approach.phases
    .filter((item) => item.applies !== "no")
    .map((item) =>
      item.applies === "conditional"
        ? `${item.label.toLowerCase()} if needed`
        : item.label.toLowerCase(),
    );
  return [
    approach.kind,
    approach.method,
    phases.length > 0
      ? phases.join(", ").replace(/^./, (c) => c.toUpperCase())
      : "",
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

const PLAN_TONES: Record<EvidencePlan["status"], string> = {
  NOT_PLANNED: "",
  PROPOSED: "tone-warning",
  CHANGES_PROPOSED: "tone-warning",
  CHANGES_REQUESTED: "tone-danger",
  APPROVED: "tone-success",
};

/**
 * The test plan in one card: its state, the approach, and what it holds, with the way to
 * the Test plans page, where the plan is read in full and approved. Nothing of the plan is
 * repeated here.
 */
export function TestPlanSummary({
  plan,
  approach,
  attributes,
  questions,
  href,
}: {
  plan: EvidencePlan | null;
  approach: Approach;
  /** Approved attributes. */
  attributes: number;
  /** Open questions about the control. */
  questions: number;
  href: string;
}) {
  const status = plan?.status ?? "NOT_PLANNED";
  const items = liveRequirements(plan).length;
  const awaiting = planAwaitsApproval(plan);
  const facts = [
    `${attributes} ${attributes === 1 ? "attribute" : "attributes"} approved`,
    status === "NOT_PLANNED"
      ? ""
      : `${items} evidence ${items === 1 ? "item" : "items"}`,
    questions > 0
      ? `${questions} open ${questions === 1 ? "question" : "questions"}`
      : "",
  ].filter((part) => part !== "");
  return (
    <section className="cw-plan" aria-labelledby="cw-plan-title">
      <div className="cw-plan-main">
        <h2 id="cw-plan-title">
          Test plan
          <span className={`cx-status ${PLAN_TONES[status]}`}>
            {PLAN_STATUS_LABELS[status]}
          </span>
        </h2>
        <p className="cw-plan-line">{approachText(approach)}</p>
        <p className="cw-plan-facts">
          {facts.join(" · ")}
          {plan?.approvedBy && status === "APPROVED"
            ? ` · Approved by ${plan.approvedBy}`
            : ""}
        </p>
        {approach.conflict !== "" ? (
          <p className="cw-plan-flag">
            <UiIcon name="risk" size={13} />
            {approach.conflict}
          </p>
        ) : null}
      </div>
      <a className={awaiting ? "btn" : "btn btn-secondary"} href={href}>
        {awaiting ? "Review the test plan" : "Open the test plan"}
        <UiIcon name="arrow" size={15} />
      </a>
    </section>
  );
}

/** The control's activity, newest first, by day, filtered by who did it and its kind. */
export function ActivityTimeline({
  items,
  limit,
  moreHref,
}: {
  items: ActivityItem[] | null;
  /** Show only the newest few, with a link to the whole history. */
  limit?: number;
  moreHref?: string;
}) {
  const [by, setBy] = useState<"all" | ActivityItem["by"]>("all");
  const [category, setCategory] = useState<"all" | ActivityCategory>("all");
  const shown = useMemo(
    () =>
      items === null
        ? []
        : limit !== undefined
          ? items.slice(0, limit)
          : filterActivity(items, by, category),
    [items, by, category, limit],
  );
  if (items === null) {
    return (
      <p className="cw-hint">
        The activity could not be loaded. Refresh to try again.
      </p>
    );
  }
  const present = Array.from(new Set(items.map((item) => item.category)));
  const days: Array<[string, ActivityItem[]]> = [];
  for (const item of shown) {
    const day = DAY.format(new Date(item.at));
    const last = days[days.length - 1];
    if (last !== undefined && last[0] === day) {
      last[1].push(item);
    } else {
      days.push([day, [item]]);
    }
  }
  return (
    <div className="cw-timeline">
      {limit === undefined ? (
        <div className="cw-timeline-filters">
          <fieldset className="cw-seg">
            <legend className="sr-only">Who</legend>
            {(
              [
                ["all", "Everyone"],
                ["agent", "Agents"],
                ["person", "People"],
                ["workspace", "Workspace"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={by === key}
                className={by === key ? "is-on" : undefined}
                onClick={() => setBy(key)}
              >
                {label}
              </button>
            ))}
          </fieldset>
          <label className="cw-select">
            <span className="sr-only">Kind</span>
            <select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as "all" | ActivityCategory)
              }
            >
              <option value="all">All kinds</option>
              {present.map((key) => (
                <option key={key} value={key}>
                  {ACTIVITY_CATEGORY_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          <span className="cw-count">
            {shown.length} of {items.length}
          </span>
        </div>
      ) : null}
      {shown.length === 0 ? (
        <p className="cw-hint">
          {items.length === 0
            ? "Nothing has happened on this control yet."
            : "Nothing matches these filters."}
        </p>
      ) : (
        days.map(([day, list]) => (
          <section key={day} className="cw-day">
            {limit === undefined ? <h3>{day}</h3> : null}
            <ol>
              {list.map((item) => (
                <li
                  key={item.id}
                  className={`is-${item.by} is-${item.category}`}
                >
                  <span className="cw-dot" aria-hidden="true">
                    {item.by === "agent" ? (
                      <UiIcon name="sparkles" size={11} />
                    ) : item.category === "error" ? (
                      <UiIcon name="risk" size={11} />
                    ) : null}
                  </span>
                  <div className="cw-event">
                    <p>
                      <strong>{item.title}</strong>
                      {item.detail !== "" ? (
                        <span className="cw-event-detail">{item.detail}</span>
                      ) : null}
                    </p>
                    <small>
                      {item.actor}
                      {item.by === "agent" ? (
                        <span className="cw-ai">AI</span>
                      ) : null}
                      {" · "}
                      {limit !== undefined
                        ? `${DAY.format(new Date(item.at))}, `
                        : ""}
                      {TIME.format(new Date(item.at))} UTC
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))
      )}
      {limit !== undefined && moreHref !== undefined && items.length > limit ? (
        <a className="cw-open" href={moreHref}>
          View the whole history ({items.length})
          <UiIcon name="arrow" size={13} />
        </a>
      ) : null}
    </div>
  );
}
