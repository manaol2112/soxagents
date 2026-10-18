"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  ENGAGEMENT_STATUSES,
  type EngagementStatus,
  statusLabel,
} from "./engagement-lifecycle";
import {
  cardEntry,
  cardSignals,
  inFilter,
  openEngagements,
  sortEngagements,
  updatedLabel,
  workSummary,
} from "./engagements-model";
import { formatDate } from "./format";
import {
  byRecent,
  FAVORITES_KEY,
  keep,
  openedLabel,
  recentOf,
  startingView,
  storedFavorites,
  storedVisits,
  toggleFavorite,
  type Visits,
} from "./recent-engagements";
import { type Project, workspaceHref } from "./shell-model";
import { type IconName, UiIcon } from "./ui-icon";

type Filter = "ALL" | EngagementStatus;

const FILTERS: Array<[Filter, string]> = [
  ["ALL", "All"],
  ...ENGAGEMENT_STATUSES,
];

type Layout = "tiles" | "list";
// Each person's choice, kept in their browser only (Milestone 8.15).
const LAYOUT_KEY = "aw.engagements.layout";

function storedLayout(): Layout {
  try {
    return window.localStorage.getItem(LAYOUT_KEY) === "list"
      ? "list"
      : "tiles";
  } catch {
    return "tiles";
  }
}

function keepLayout(layout: Layout): void {
  try {
    window.localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    // Storage can be off; the choice then lasts for this page only.
  }
}

type MenuItem = { label: string; href: string; icon: IconName };

type View = "all" | "recent" | "favorites";
// Shown after the statuses, in the same group.
const VIEWS: Array<[Exclude<View, "all">, string]> = [
  ["favorites", "Starred"],
  ["recent", "Recent"],
];

/**
 * The firm's engagements as cards, with a search and a status filter kept on the page. A
 * card opens its engagement; its menu holds the other ways in, and the status and
 * close-out actions, which open over the page.
 */
export function EngagementsBoard({
  projects,
  selectedId,
  organizationId,
  now,
  canManage,
  newHref,
}: {
  projects: readonly Project[];
  selectedId: string | null;
  organizationId: string;
  /** The time the page was made, so "Updated 2h ago" reads the same on server and client. */
  now: string;
  canManage: boolean;
  /** The New engagement page; a client's link adds `&client=`. */
  newHref: string;
}) {
  const openHref = (project: Project) =>
    workspaceHref(
      cardEntry(project.status).section,
      organizationId,
      project.id,
    );
  const menuFor = (project: Project): MenuItem[] => {
    const items: MenuItem[] = [
      {
        label: cardEntry(project.status).label,
        href: openHref(project),
        icon: "arrow",
      },
    ];
    if (project.status !== "DRAFT") {
      items.push(
        {
          label: "Agent console",
          href: workspaceHref("console", organizationId, project.id),
          icon: "sparkles",
        },
        {
          label: "Open work",
          href: workspaceHref("tasks", organizationId, project.id),
          icon: "check",
        },
      );
    }
    if (canManage && project.clientId !== null && project.clientName !== "") {
      items.push({
        label: `New engagement for ${project.clientName}`,
        href: `${newHref}&client=${project.clientId}`,
        icon: "plus",
      });
    }
    if (canManage) {
      items.push({
        label: "Status and close-out",
        href: `/?${new URLSearchParams({ organization: organizationId, section: "projects", project: project.id, manage: "engagement" })}`,
        icon: "wrench",
      });
    }
    return items;
  };
  // "All" leaves archived engagements out; one opened by link shows under Archived.
  const [filter, setFilter] = useState<Filter>(() =>
    projects.find((project) => project.id === selectedId)?.status === "ARCHIVED"
      ? "ARCHIVED"
      : "ALL",
  );
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<Layout>("tiles");
  // Kept in this browser only: read after the page loads, so the server's page and the
  // browser's first render agree.
  const [view, setView] = useState<View>("all");
  const [visits, setVisits] = useState<Visits>({});
  const [favorites, setFavorites] = useState<string[]>([]);
  // Only on arrival: the view starts on Recent when there is one, and later choices are
  // the person's.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, on load
  useEffect(() => {
    setLayout(storedLayout());
    const seen = storedVisits();
    setVisits(seen);
    setView(
      startingView(
        recentOf(projects, seen).map((project) => project.id),
        seen,
        selectedId,
      ),
    );
    setFavorites(storedFavorites());
  }, []);
  const choose = (next: Layout) => {
    setLayout(next);
    keepLayout(next);
  };
  const chooseView = (next: View) => setView(next);
  const star = (id: string) => {
    const next = toggleFavorite(favorites, id);
    setFavorites(next);
    keep(FAVORITES_KEY, next);
  };
  const nowMs = Date.parse(now);
  const recent = recentOf(projects, visits);
  const starred = projects.filter((project) => favorites.includes(project.id));
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool =
      view === "recent"
        ? recentOf(projects, visits)
        : view === "favorites"
          ? projects.filter((project) => favorites.includes(project.id))
          : projects;
    // Starred holds what the person picked, archived ones included; Recent leaves
    // archived ones out.
    const inStatus = (status: string) =>
      view !== "all" && filter === "ALL" ? true : inFilter(status, filter);
    return byRecent(
      sortEngagements(
        pool
          .filter((project) => inStatus(project.status))
          .filter(
            (project) =>
              needle === "" ||
              `${project.name} ${project.clientName} ${project.ownerName}`
                .toLowerCase()
                .includes(needle),
          ),
      ),
      visits,
    );
  }, [projects, filter, query, view, visits, favorites]);
  const counts = new Map<string, number>();
  for (const project of projects) {
    counts.set(project.status, (counts.get(project.status) ?? 0) + 1);
  }
  return (
    <section className="eg-board">
      <div className="eg-toolbar">
        {/* One set of choices: a status, or the person's starred or recent ones. */}
        <nav className="eg-filters" aria-label="Show">
          {FILTERS.map(([key, label]) => {
            const count =
              key === "ALL"
                ? openEngagements(projects).length
                : (counts.get(key) ?? 0);
            if (key !== "ALL" && count === 0) {
              return null;
            }
            const on = view === "all" && filter === key;
            return (
              <button
                key={key}
                type="button"
                className={on ? "is-on" : undefined}
                aria-pressed={on}
                onClick={() => {
                  chooseView("all");
                  setFilter(key);
                }}
              >
                {label}
                <span>{count}</span>
              </button>
            );
          })}
          <span className="eg-filters-gap" aria-hidden="true" />
          {VIEWS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={
                [
                  key === "favorites" ? "eg-starred" : "",
                  view === key ? "is-on" : "",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              aria-pressed={view === key}
              onClick={() => {
                chooseView(key);
                setFilter("ALL");
              }}
            >
              <UiIcon name={key === "favorites" ? "star" : "clock"} size={13} />
              {label}
              <span>{key === "recent" ? recent.length : starred.length}</span>
            </button>
          ))}
        </nav>
        <fieldset className="eg-layout-switch">
          <legend className="sr-only">Layout</legend>
          {(
            [
              ["tiles", "Tiles", "grid"],
              ["list", "List", "table"],
            ] as const
          ).map(([key, label, icon]) => (
            <button
              key={key}
              type="button"
              className={layout === key ? "is-on" : undefined}
              aria-pressed={layout === key}
              onClick={() => choose(key)}
            >
              <UiIcon name={icon} size={14} />
              {label}
            </button>
          ))}
        </fieldset>
        <label className="eg-search">
          <span className="sr-only">Search engagements</span>
          <svg
            aria-hidden="true"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            autoComplete="off"
            type="search"
            value={query}
            placeholder="Search client, engagement, or lead"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="eg-empty">
          {view === "recent" && recent.length === 0
            ? "Engagements you open appear here, most recent first."
            : view === "favorites" && starred.length === 0
              ? "Star an engagement to keep it here."
              : filter === "ALL" &&
                  query.trim() === "" &&
                  view === "all" &&
                  openEngagements(projects).length === 0
                ? "No open engagements. Archived ones are under Archived."
                : "No engagements match."}
        </p>
      ) : layout === "list" ? (
        <div className="eg-list">
          <div className="eg-list-head" aria-hidden="true">
            <span>Client</span>
            <span>Engagement</span>
            <span>Status</span>
            <span>Period end</span>
            <span>Agent work</span>
            <span>Overdue</span>
            <span>Findings</span>
          </div>
          <ul>
            {shown.map((project) => {
              const work = workSummary(project.progress);
              return (
                <li key={project.id} className="eg-row-item">
                  <a
                    className={`eg-row is-${project.status.toLowerCase()}`}
                    href={openHref(project)}
                    aria-current={
                      project.id === selectedId ? "true" : undefined
                    }
                  >
                    <span
                      className={`eg-row-client${project.clientName === "" ? " is-unset" : ""}`}
                    >
                      {project.clientName !== ""
                        ? project.clientName
                        : "No client"}
                    </span>
                    <span className="eg-row-name">{project.name}</span>
                    <span>
                      <span
                        className={`eg-status is-${project.status.toLowerCase()}`}
                      >
                        {statusLabel(project.status)}
                      </span>
                    </span>
                    <span className="eg-row-cell" data-label="Period end">
                      {project.periodEnd !== null
                        ? formatDate(project.periodEnd)
                        : "Not set"}
                    </span>
                    <span className="eg-row-cell" data-label="Agent work">
                      {work.total === 0 ? "None yet" : `${work.percent}% done`}
                    </span>
                    <span
                      className={`eg-row-cell eg-num${project.overdueRequests > 0 ? " is-warn" : ""}`}
                      data-label="Overdue evidence"
                    >
                      {project.overdueRequests}
                    </span>
                    <span
                      className={`eg-row-cell eg-num${project.openDeficiencies > 0 ? " is-warn" : ""}`}
                      data-label="Open findings"
                    >
                      {project.openDeficiencies}
                    </span>
                  </a>
                  <FavoriteButton
                    name={project.name}
                    on={favorites.includes(project.id)}
                    onToggle={() => star(project.id)}
                  />
                  <CardMenu label={project.name} items={menuFor(project)} />
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <ul className="eg-grid">
          {shown.map((project) => {
            const work = workSummary(project.progress);
            const signals = cardSignals(project);
            return (
              <li key={project.id} className="eg-tile">
                <a
                  className={`eg-card is-${project.status.toLowerCase()}`}
                  href={openHref(project)}
                  aria-current={project.id === selectedId ? "true" : undefined}
                >
                  <span className="eg-card-top">
                    <span
                      className={`eg-client${project.clientName === "" ? " is-unset" : ""}`}
                    >
                      {project.clientName !== ""
                        ? project.clientName
                        : "No client"}
                    </span>
                    <span
                      className={`eg-status is-${project.status.toLowerCase()}`}
                    >
                      {statusLabel(project.status)}
                    </span>
                  </span>
                  <strong className="eg-name">{project.name}</strong>
                  <span className="eg-facts">
                    <span>
                      <UiIcon name="clock" size={13} />
                      {project.periodEnd !== null
                        ? `Period end ${formatDate(project.periodEnd)}`
                        : "Period not set"}
                    </span>
                    <span>
                      <UiIcon name="agents" size={13} />
                      {project.ownerName !== ""
                        ? project.ownerName
                        : "No owner"}
                    </span>
                  </span>
                  <span className="eg-progress">
                    <span className="eg-progress-line">
                      <span>Agent work</span>
                      <span>
                        {work.total === 0
                          ? "None yet"
                          : `${work.done} of ${work.total} · ${work.percent}%`}
                      </span>
                    </span>
                    <span className="eg-progress-bar" aria-hidden="true">
                      <span style={{ width: `${work.percent}%` }} />
                    </span>
                  </span>
                  {signals.length > 0 ? (
                    <span className="eg-signals">
                      {signals.map((signal) => (
                        <span
                          key={signal.text}
                          className={signal.tone === "warn" ? "is-warn" : ""}
                        >
                          <UiIcon
                            name={signal.tone === "warn" ? "risk" : "clock"}
                            size={13}
                          />
                          {signal.text}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  <span className="eg-foot">
                    <span>
                      <strong>{project.controls}</strong> control
                      {project.controls === 1 ? "" : "s"}
                    </span>
                    <span
                      className={project.openDeficiencies > 0 ? "is-warn" : ""}
                    >
                      <strong>{project.openDeficiencies}</strong> open finding
                      {project.openDeficiencies === 1 ? "" : "s"}
                    </span>
                    <span className="eg-updated">
                      {view === "recent" && visits[project.id] !== undefined
                        ? openedLabel(visits[project.id] ?? 0, nowMs)
                        : updatedLabel(project.lastActivityAt, now)}
                    </span>
                  </span>
                </a>
                <FavoriteButton
                  name={project.name}
                  on={favorites.includes(project.id)}
                  onToggle={() => star(project.id)}
                />
                <CardMenu label={project.name} items={menuFor(project)} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Star an engagement to keep it under Starred, in this browser. */
function FavoriteButton({
  name,
  on,
  onToggle,
}: {
  name: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`eg-star${on ? " is-on" : ""}`}
      aria-pressed={on}
      aria-label={on ? `Remove the star from ${name}` : `Star ${name}`}
      title={on ? "Remove star" : "Star"}
      onClick={onToggle}
    >
      <UiIcon name="star" size={15} />
    </button>
  );
}

/** A card's other ways in: a small menu that closes on a click outside or Escape. */
function CardMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const outside = (event: globalThis.MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", onKey);
    root.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className={`eg-menu${open ? " is-open" : ""}`} ref={root}>
      <button
        ref={button}
        type="button"
        className="eg-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More for ${label}`}
        onClick={() => setOpen((value) => !value)}
      >
        <UiIcon name="more" size={16} />
      </button>
      {open ? (
        <div className="eg-menu-list" role="menu" aria-label={label}>
          {items.map((item) => (
            <a key={item.label} role="menuitem" href={item.href}>
              <UiIcon name={item.icon} size={14} />
              <span>{item.label}</span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
