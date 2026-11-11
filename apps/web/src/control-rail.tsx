"use client";

import { type ReactNode, useEffect, useState } from "react";

import { PLAN_TAB_EVENT, PLAN_VIEW_EVENT } from "./control-rail-model";
import { type IconName, UiIcon } from "./ui-icon";

const CONTEXT_ICON: Record<string, IconName> = {
  system: "server",
  process: "layers",
  area: "shield",
  owner: "user",
  environment: "window",
  frequency: "clock",
  key: "star",
};

/** A slim bar that keeps the control in view once its header scrolls away (decided by
 * the product owner): its reference, title, status, step, and actions. */
export function ControlBar({
  heroId,
  controlRef,
  title,
  status,
  statusClass,
  step,
  actions,
}: {
  /** The header it stands in for; the bar shows once that has scrolled away. */
  heroId: string;
  controlRef: string;
  title: string;
  status: string;
  statusClass: string;
  step: string;
  actions: ReactNode;
}) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const hero = document.getElementById(heroId);
    if (hero === null) {
      return;
    }
    // The header has scrolled away once it passes under the top bar, where the top
    // bar stays in view; on small screens the top bar scrolls away too.
    const topbar = document.querySelector(".topbar");
    const header =
      topbar !== null && getComputedStyle(topbar).position === "sticky"
        ? Math.round(topbar.getBoundingClientRect().height)
        : 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry !== undefined) {
          setShown(
            !entry.isIntersecting &&
              entry.boundingClientRect.top < (entry.rootBounds?.top ?? header),
          );
        }
      },
      { rootMargin: `-${header}px 0px 0px 0px` },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, [heroId]);

  return (
    <div className="cw-bar-anchor">
      <section
        className={`cw-bar${shown ? " is-shown" : ""}`}
        aria-label="Current control"
        aria-hidden={!shown}
        inert={!shown}
      >
        <span className="cw-bar-ref">{controlRef}</span>
        <span className="cw-bar-title">{title}</span>
        <span className={statusClass}>{status}</span>
        {step !== "" ? <span className="cw-bar-step">{step}</span> : null}
        <span className="cw-bar-actions">{actions}</span>
      </section>
    </div>
  );
}

/** A next action the assistant suggests: a section of the plan to open, or a part of the
 * page to bring into view (the plan's section first, when it names one). */
export type AssistantAction = {
  key: string;
  label: string;
  /** Why, in a line, under the label. */
  detail?: string;
  icon: IconName;
  /** A section of the plan, a part of the page, a question for the agent, or a page. */
  target: { tab?: string; anchor?: string; ask?: string; href?: string };
};

function follow(
  target: AssistantAction["target"],
  askHref: string,
  about: string,
) {
  if (target.href !== undefined) {
    window.location.assign(target.href);
    return;
  }
  if (target.ask !== undefined) {
    // A question for the agent console about this control.
    const url = new URL(askHref, window.location.origin);
    url.searchParams.set("ask", `${about}: ${target.ask}`.slice(0, 1500));
    window.location.assign(url.toString());
    return;
  }
  if (target.tab !== undefined) {
    document.dispatchEvent(
      new CustomEvent(PLAN_TAB_EVENT, { detail: target.tab }),
    );
  }
  if (target.anchor !== undefined) {
    const anchor = target.anchor;
    // After the plan's section has been drawn.
    window.setTimeout(() => {
      document
        .getElementById(anchor)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 60);
  }
}

const DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

/** The plan's versions beside its History tab: the one open now, then each revision a
 * person decided, newest first. The current one opens the plan. */
export function PlanVersionsCard({
  versions,
}: {
  versions: Array<{
    revision: number;
    current: boolean;
    label: string;
    tone: string;
    at: string;
    by: string;
  }>;
}) {
  const [view, setView] = useState<string | null>(null);
  useEffect(() => {
    const seen = (event: Event) =>
      setView(String((event as CustomEvent<string>).detail));
    document.addEventListener(PLAN_VIEW_EVENT, seen);
    return () => document.removeEventListener(PLAN_VIEW_EVENT, seen);
  }, []);
  if (view !== "history" || versions.length === 0) {
    return null;
  }
  return (
    <section
      className="cw-context cw-versions"
      aria-labelledby="cw-versions-title"
    >
      <h2 id="cw-versions-title">Plan versions</h2>
      <ol>
        {versions.map((item) => (
          <li
            key={item.revision}
            className={item.current ? "is-current" : undefined}
          >
            <span className="cw-versions-dot" aria-hidden="true" />
            <span className="cw-versions-text">
              <span className="cw-versions-head">
                <span className="cw-versions-v">v{item.revision}</span>
                <span className={`cw-versions-tag is-${item.tone}`}>
                  {/* As the reference names them: a revision not yet decided is a draft. */}
                  {item.tone === "draft" ? "Draft" : item.label}
                  {item.current ? " (current)" : ""}
                </span>
              </span>
              <small>
                {item.at !== ""
                  ? `${DATE.format(new Date(item.at))} UTC${item.by !== "" ? ` · ${item.by}` : ""}`
                  : "Not decided yet"}
              </small>
            </span>
            {item.current ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  follow(
                    { tab: "understanding", anchor: "pl-plan-tabs" },
                    "",
                    "",
                  )
                }
              >
                View
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="cw-versions-all"
        onClick={() => follow({ anchor: "ph-decisions" }, "", "")}
      >
        Show all versions ({versions.length})
        <UiIcon name="chevron" size={12} />
      </button>
    </section>
  );
}

/** The control's context, as its records state it. */
export function ControlContextCard({
  rows,
  editHref = null,
}: {
  rows: Array<{ key: string; label: string; value: string }>;
  /** Where the system it runs on is edited. */
  editHref?: string | null;
}) {
  return (
    <section className="cw-context" aria-labelledby="cw-context-title">
      <header className="cw-card-head">
        <h2 id="cw-context-title">
          <UiIcon name="info" size={17} />
          Control context
        </h2>
        {editHref !== null ? (
          <a className="btn-secondary btn-sm" href={editHref}>
            <UiIcon name="compose" size={13} />
            Edit
          </a>
        ) : null}
      </header>
      <dl>
        {rows.map((row) => (
          <div key={row.key}>
            <dt>
              <span className="cw-context-icon" aria-hidden="true">
                <UiIcon name={CONTEXT_ICON[row.key] ?? "info"} size={14} />
              </span>
              {row.label}
            </dt>
            <dd className={row.value === "Not stated" ? "is-muted" : undefined}>
              {row.key === "key" && row.value === "Yes" ? (
                <span className="cw-yes">Yes</span>
              ) : (
                row.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
