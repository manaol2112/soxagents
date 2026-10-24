"use client";

import { useEffect, useState } from "react";

import { ConsoleChat } from "./console-chat";
import {
  type ActivityItem,
  type ConsoleThread,
  type ThreadSummary,
  threadGroups,
  type WaitingItem,
} from "./console-model";
import { formatDate } from "./format";
import { UiIcon } from "./ui-icon";

/** Which control a waiting item is on, unless its title already says, then why it waits. */
function waitingWords(item: WaitingItem): string {
  const named =
    item.controlRef !== null && item.title.includes(item.controlRef);
  return [named ? null : item.controlLabel, item.detail]
    .filter((part) => part !== null && part !== "")
    .join(" · ");
}

type Tab = "chats" | "waiting" | "activity";

const PANEL_KEY = "aw-console-panel";
// Wide enough for the conversation and the panel side by side; narrower, the panel slides over.
const WIDE = "(min-width: 1101px)";

/** The console: the conversation, and a panel of chats and what needs the person. */
export function ConsoleShell({
  organizationId,
  projectId,
  engagement,
  initial,
  alert,
  threads,
  threadId,
  waiting,
  activity,
  consoleHref,
}: {
  organizationId: string;
  projectId: string;
  engagement: string;
  initial: ConsoleThread | null;
  /** A notice from the last page action, shown above the conversation. */
  alert: string | null;
  threads: Array<ThreadSummary & { href: string }>;
  threadId: string | null;
  waiting: Array<WaitingItem & { href: string }>;
  activity: ActivityItem[];
  consoleHref: string;
}) {
  // Unknown until the browser says how wide it is: open beside the chat, closed over it.
  const [open, setOpen] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>(waiting.length > 0 ? "waiting" : "chats");
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(PANEL_KEY);
    } catch {
      // Private windows may refuse storage; the panel then opens by the width alone.
    }
    setOpen(window.matchMedia(WIDE).matches ? stored !== "closed" : false);
  }, []);
  const toggle = () => {
    const wide = window.matchMedia(WIDE).matches;
    setOpen((value) => {
      const next = !(value ?? wide);
      if (wide) {
        try {
          window.localStorage.setItem(PANEL_KEY, next ? "open" : "closed");
        } catch {
          // Not remembered, which is fine.
        }
      }
      return next;
    });
  };
  // Over the conversation, the panel closes with Escape.
  useEffect(() => {
    if (open !== true) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !window.matchMedia(WIDE).matches) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const tabs: Array<[Tab, string, number]> = [
    ["chats", "Chats", 0],
    ["waiting", "Waiting on you", waiting.length],
    ["activity", "Activity", 0],
  ];
  const groups =
    now === null ? [{ label: "Recent", threads }] : threadGroups(threads, now);
  const panelState =
    open === null ? " panel-auto" : open ? " has-panel" : " panel-closed";
  return (
    <div className={`page cv${panelState}`}>
      <ConsoleChat
        organizationId={organizationId}
        projectId={projectId}
        engagement={engagement}
        initial={initial}
        alert={alert}
        panelOpen={open === true}
        onTogglePanel={toggle}
        waitingCount={waiting.length}
      />
      <button
        type="button"
        className="cv-scrim"
        aria-label="Close the side panel"
        tabIndex={-1}
        onClick={() => setOpen(false)}
      />
      <aside className="cv-panel" aria-label="Chats and what needs you">
        <div className="cv-panel-top">
          <a className="cv-panel-new" href={consoleHref}>
            <UiIcon name="compose" size={15} /> New chat
          </a>
          <button
            type="button"
            className="cv-iconbtn cv-panel-close"
            aria-label="Hide the side panel"
            onClick={toggle}
          >
            <UiIcon name="x" size={15} />
          </button>
        </div>
        <div className="cv-panel-tabs" role="tablist">
          {tabs.map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? "is-on" : undefined}
              onClick={() => setTab(key)}
            >
              {label}
              {count > 0 ? (
                <span className="cv-panel-count">{count}</span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="cv-panel-body">
          {tab === "chats" ? (
            threads.length === 0 ? (
              <p className="cv-panel-empty">Your conversations appear here.</p>
            ) : (
              groups.map((group) => (
                <section key={group.label} className="cv-thread-group">
                  <h2>{group.label}</h2>
                  <ul className="cv-threads">
                    {group.threads.map((item) => (
                      <li key={item.id}>
                        <a
                          href={item.href}
                          aria-current={
                            item.id === threadId ? "page" : undefined
                          }
                          title={`${item.messages} message${item.messages === 1 ? "" : "s"} · ${formatDate(item.updatedAt)}`}
                        >
                          {item.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )
          ) : tab === "waiting" ? (
            waiting.length === 0 ? (
              <p className="cv-panel-empty">
                <UiIcon name="check" size={16} />
                Nothing is waiting on you.
              </p>
            ) : (
              <ul className="cv-waiting">
                {waiting.map((item) => (
                  // The same step on several controls shares its title: the queue
                  // item's id keeps each row its own.
                  <li
                    key={
                      item.id !== ""
                        ? item.id
                        : `${item.href}|${item.title}|${item.controlLabel ?? ""}|${item.detail}`
                    }
                  >
                    <a href={item.href}>
                      <span className="cv-waiting-icon" aria-hidden="true">
                        <UiIcon name={ICONS[item.kind] ?? "bell"} size={14} />
                      </span>
                      <span>
                        <strong>{item.title}</strong>
                        <small>{waitingWords(item)}</small>
                      </span>
                      <UiIcon name="chevron" size={14} />
                    </a>
                  </li>
                ))}
              </ul>
            )
          ) : activity.length === 0 ? (
            <p className="cv-panel-empty">No agent activity yet.</p>
          ) : (
            <ol className="cv-activity">
              {activity.slice(0, 12).map((item) => (
                <li key={`${item.at}-${item.action}-${item.detail}`}>
                  <span className="cv-activity-dot" aria-hidden="true" />
                  <span>
                    <strong>{item.agent}</strong>
                    <span>
                      {item.action}
                      {item.detail !== "" ? ` · ${item.detail}` : ""}
                    </span>
                    <time dateTime={item.at}>{formatDate(item.at)}</time>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
}

const ICONS: Record<string, "check" | "table" | "shield" | "mail" | "bell"> = {
  approval: "check",
  samples: "table",
  review: "shield",
  control_review: "shield",
  drafts: "mail",
};
