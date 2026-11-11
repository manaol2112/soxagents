"use client";

import { useMemo, useState } from "react";

import {
  ACTIVITY_CATEGORY_LABELS,
  type ActivityCategory,
  type ActivityItem,
  type Approach,
  filterActivity,
} from "./control-workspace-model";
import {
  type EvidencePlan,
  PLAN_STATUS_LABELS,
  planAwaitsApproval,
} from "./evidence-plan-model";
import { liveRequirements } from "./evidence-workspace-model";
import { type IconName, UiIcon } from "./ui-icon";

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

const HISTORY_ICON: Record<ActivityCategory, IconName> = {
  design: "layers",
  planning: "file",
  evidence: "inbox",
  testing: "check",
  review: "agents",
  findings: "risk",
  approval: "check",
  workflow: "plus",
  error: "risk",
};

/**
 * The control's history in its Plan step (decided by the product owner on 26 October
 * 2026, from the control workspace reference): each change to the plan, the client's
 * answers, the evidence and the approvals, by day, with who made it. One filter narrows it
 * by kind or by who; the audit trail below the steps holds the same record.
 */
export function ControlHistory({
  items,
  viewer = "",
}: {
  items: ActivityItem[] | null;
  /** The person viewing, by email: their own changes read You. */
  viewer?: string;
}) {
  const who = (item: ActivityItem) =>
    item.by === "agent"
      ? "AI Agent"
      : item.by === "workspace"
        ? "System"
        : viewer !== "" && item.actor.toLowerCase() === viewer.toLowerCase()
          ? "You"
          : item.actor || "A person";
  const [filter, setFilter] = useState("all");
  if (items === null) {
    return (
      <p className="cw-hint">
        The history could not be loaded. Refresh to try again.
      </p>
    );
  }
  const [kind, value] = filter.split(":");
  const shown = items.filter((item) =>
    kind === "by"
      ? item.by === value
      : kind === "category"
        ? item.category === value
        : true,
  );
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
    <section className="ph-card" aria-labelledby="ph-title">
      <header className="pp-head">
        <div>
          <h3 id="ph-title">History</h3>
          <p>
            Track changes to the plan, client answers, evidence requirements,
            and approvals for this control.
          </p>
        </div>
        <label className="ph-filter">
          <span className="sr-only">Show</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">All activities</option>
            <optgroup label="By kind">
              {present.map((key) => (
                <option key={key} value={`category:${key}`}>
                  {ACTIVITY_CATEGORY_LABELS[key]}
                </option>
              ))}
            </optgroup>
            <optgroup label="By who">
              <option value="by:agent">Agents</option>
              <option value="by:person">People</option>
              <option value="by:workspace">Workspace</option>
            </optgroup>
          </select>
        </label>
      </header>
      {shown.length === 0 ? (
        <p className="cw-hint">
          {items.length === 0
            ? "Nothing has happened on this control yet."
            : "Nothing matches this filter."}
        </p>
      ) : (
        days.map(([day, list]) => (
          <section key={day} className="ph-day">
            <h4>{day}</h4>
            <ol>
              {list.map((item) => (
                <li key={item.id} className={`is-${item.by}`}>
                  <span className="ph-dot" aria-hidden="true" />
                  <span
                    className={`ph-icon is-${item.by === "agent" ? "agent" : item.category}`}
                    aria-hidden="true"
                  >
                    <UiIcon
                      name={
                        item.by === "agent"
                          ? "sparkles"
                          : HISTORY_ICON[item.category]
                      }
                      size={15}
                    />
                  </span>
                  <div className="ph-text">
                    <p>
                      <strong>{item.title}</strong>
                      <span className={`ph-who is-${item.by}`}>
                        {who(item)}
                      </span>
                    </p>
                    {item.detail !== "" ? <small>{item.detail}</small> : null}
                  </div>
                  <time dateTime={item.at}>
                    {TIME.format(new Date(item.at))}
                  </time>
                </li>
              ))}
            </ol>
          </section>
        ))
      )}
      <p className="ph-note">Times are in UTC.</p>
    </section>
  );
}
