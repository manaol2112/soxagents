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
  filterActivity,
  type LaneRun,
  laneSummary,
  type RecordTab,
} from "./control-workspace-model";
import { evidenceHref } from "./evidence-flow";
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

/**
 * What needs a person on the control, most pressing first, with the agent's offer to do
 * the work where it can, and what waits on someone else. Each item opens the place on the
 * record where it is done.
 */
export function AttentionPanel({
  attention,
  ids,
  hrefs,
  canAct,
}: {
  attention: AttentionItem[];
  ids: Ids;
  hrefs: Record<RecordTab, string>;
  canAct: boolean;
}) {
  const action = useAction(ids);
  const yours = attention.filter((item) => item.kind !== "waiting");
  const waiting = attention.filter((item) => item.kind === "waiting");
  return (
    <section className="cw-agent cw-needs" aria-labelledby="cw-attention-title">
      <section className="cw-attention">
        <h2 className="cw-section-title" id="cw-attention-title">
          Needs attention
          <span>{yours.length}</span>
        </h2>
        {yours.length === 0 ? (
          <p className="cw-calm">
            <UiIcon name="check" size={14} />
            No action is required on this control at this time.
          </p>
        ) : (
          <ul>
            {yours.map((item) => (
              <li key={item.key} className={`is-${item.kind}`}>
                <span className="cw-attention-icon" aria-hidden="true">
                  <UiIcon
                    name={item.kind === "blocker" ? "risk" : "info"}
                    size={14}
                  />
                </span>
                <div className="cw-attention-text">
                  <strong>{item.title}</strong>
                  {item.detail !== "" ? <span>{item.detail}</span> : null}
                  {item.kind === "blocker" ? (
                    <small>Blocks testing · Requires your action</small>
                  ) : null}
                </div>
                <div className="cw-attention-actions">
                  {item.quick !== null && canAct ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={action.pending}
                      onClick={() =>
                        item.quick !== null &&
                        action.run(item.key, { intent: item.quick.intent })
                      }
                    >
                      <UiIcon name="sparkles" size={13} />
                      {action.busy === item.key
                        ? "In progress…"
                        : item.quick.label}
                    </button>
                  ) : null}
                  <a
                    className="cw-open"
                    href={
                      item.target !== undefined
                        ? evidenceHref(hrefs.evidence, item.target)
                        : `${hrefs[item.tab]}${item.anchor !== "" ? `#${item.anchor}` : ""}`
                    }
                  >
                    Open
                    <UiIcon name="arrow" size={13} />
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
        {action.problem !== null ? (
          <p className="cw-problem" role="alert">
            {action.problem}
          </p>
        ) : action.note !== "" ? (
          <p className="cw-hint">{action.note}</p>
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
    </section>
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
export function AgentRoster({
  lanes,
  hrefs,
}: {
  lanes: AgentLane[];
  hrefs: Record<RecordTab, string>;
}) {
  const summary = laneSummary(lanes);
  const parts = [
    summary.running > 0 ? `${summary.running} running` : "",
    summary.queued > 0 ? `${summary.queued} queued` : "",
    summary.stopped > 0 ? `${summary.stopped} stopped` : "",
    summary.decisions > 0
      ? `${summary.decisions} ${summary.decisions === 1 ? "output awaits" : "outputs await"} review`
      : "",
  ].filter((part) => part !== "");
  return (
    <section className="cw-roster" aria-labelledby="cw-roster-title">
      <header className="cw-roster-head">
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

const APPLIES_LABELS: Record<Approach["phases"][number]["applies"], string> = {
  yes: "Applies",
  conditional: "If a condition is met",
  no: "Not applicable",
  pending: "To decide",
  unplanned: "Not planned yet",
};

/** The control's testing approach in one line, with each phase's reason on request. */
export function ApproachLine({ approach }: { approach: Approach }) {
  const phases = approach.phases
    .filter((item) => item.applies !== "no")
    .map((item) =>
      item.applies === "conditional"
        ? `${item.label.toLowerCase()} if needed`
        : item.label.toLowerCase(),
    );
  return (
    <details className="cw-approach">
      <summary>
        <span className="cw-label">Testing approach</span>
        <span className="cw-approach-line">
          {[
            approach.kind,
            approach.method,
            phases.length > 0
              ? `${phases.join(", ").replace(/^./, (c) => c.toUpperCase())}`
              : "",
          ]
            .filter((part) => part !== "")
            .join(" · ")}
        </span>
        {approach.conflict !== "" ? (
          <span className="cw-approach-flag">
            <UiIcon name="risk" size={12} />
            Records disagree
          </span>
        ) : null}
      </summary>
      {approach.conflict !== "" ? (
        <p className="cw-approach-conflict">{approach.conflict}</p>
      ) : null}
      <dl className="cw-facts">
        {approach.phases.map((item) => (
          <div key={item.phase}>
            <dt>{item.label}</dt>
            <dd>
              {APPLIES_LABELS[item.applies]}
              {item.reason !== "" ? <small>{item.reason}</small> : null}
            </dd>
          </div>
        ))}
        <div>
          <dt>Process understanding</dt>
          <dd>
            {approach.processRequired ? "Required" : "Not required"}
            <small>
              {approach.processRequired
                ? "A business process control is tested against its process."
                : "Its own criteria and configuration define it."}
            </small>
          </dd>
        </div>
      </dl>
    </details>
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
