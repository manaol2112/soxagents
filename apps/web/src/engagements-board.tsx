"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ENGAGEMENT_STATUSES, statusLabel } from "./engagement-lifecycle";
import {
  atRisk,
  auditPeriod,
  cardEntry,
  cardSignals,
  ENGAGEMENT_SORTS,
  type EngagementFilter,
  type EngagementSort,
  engagementTypeShort,
  isPastDue,
  matchesFilter,
  nameMark,
  openEngagements,
  parseEngagementSort,
  portfolioCounts,
  riskReason,
  sortBy,
  updatedLabel,
  workSummary,
} from "./engagements-model";
import { formatDate, initials } from "./format";
import { engagementTypeLabel } from "./onboarding-model";
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

type Filter = EngagementFilter;

// The running work and its risk first, then the other statuses (shown when present).
const FILTERS: Array<[Filter, string]> = [
  ["ALL", "All"],
  ["ACTIVE", "Active"],
  ["AT_RISK", "At risk"],
  ...ENGAGEMENT_STATUSES.filter(([key]) => key !== "ACTIVE"),
];
const ALWAYS_SHOWN = new Set<Filter>(["ALL", "ACTIVE", "AT_RISK", "COMPLETED"]);

type Layout = "tiles" | "list";
// Each person's choices, kept in their browser only (Milestone 8.15). The list is the
// default (decided by the product owner).
const LAYOUT_KEY = "aw.engagements.layout";
const SORT_KEY = "aw.engagements.sort";

function stored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function keepChoice(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be off; the choice then lasts for this page only.
  }
}

// A few soft tones for the team's avatars, the same for a name every time.
const AVATAR_TONES = ["accent", "ai", "success", "warning"] as const;

function avatarTone(name: string): string {
  let sum = 0;
  for (const char of name) {
    sum += char.charCodeAt(0);
  }
  return AVATAR_TONES[sum % AVATAR_TONES.length] ?? "accent";
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
  const [layout, setLayout] = useState<Layout>("list");
  const [sort, setSort] = useState<EngagementSort>("status");
  // Kept in this browser only: read after the page loads, so the server's page and the
  // browser's first render agree.
  const [view, setView] = useState<View>("all");
  const [visits, setVisits] = useState<Visits>({});
  const [favorites, setFavorites] = useState<string[]>([]);
  // Only on arrival: the view starts on Recent when there is one, and later choices are
  // the person's.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, on load
  useEffect(() => {
    setLayout(stored(LAYOUT_KEY) === "tiles" ? "tiles" : "list");
    setSort(parseEngagementSort(stored(SORT_KEY)));
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
    keepChoice(LAYOUT_KEY, next);
  };
  const chooseSort = (next: EngagementSort) => {
    setSort(next);
    keepChoice(SORT_KEY, next);
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
    const inView = (project: Project) =>
      view !== "all" && filter === "ALL"
        ? true
        : matchesFilter(project, filter);
    const found = pool
      .filter(inView)
      .filter(
        (project) =>
          needle === "" ||
          `${project.name} ${project.clientName} ${project.ownerName} ${project.team.join(" ")}`
            .toLowerCase()
            .includes(needle),
      );
    // The usual order puts what was opened lately first; a chosen column decides alone.
    return sort === "status"
      ? byRecent(sortBy(found, "status"), visits)
      : sortBy(found, sort);
  }, [projects, filter, query, view, visits, favorites, sort]);
  const totals = portfolioCounts(projects);
  const counts = new Map<string, number>();
  for (const project of projects) {
    counts.set(project.status, (counts.get(project.status) ?? 0) + 1);
  }
  counts.set("ALL", totals.open);
  counts.set("AT_RISK", totals.atRisk);
  const pick = (next: Filter) => {
    chooseView("all");
    setFilter(next);
  };
  const waiting = [
    totals.draft > 0 ? `${totals.draft} in setup` : "",
    totals.paused > 0 ? `${totals.paused} paused` : "",
    totals.archived > 0 ? `${totals.archived} archived` : "",
  ].filter(Boolean);
  const tiles: Array<{
    key: Filter;
    label: string;
    value: number;
    detail: string;
    icon: IconName;
    tone: string;
  }> = [
    {
      key: "ALL",
      label: "Open engagements",
      value: totals.open,
      detail: waiting.length > 0 ? waiting.join(" · ") : "None archived",
      icon: "layers",
      tone: "accent",
    },
    {
      key: "ACTIVE",
      label: "Active",
      value: totals.active,
      detail: "Fieldwork under way",
      icon: "activity",
      tone: "info",
    },
    {
      key: "COMPLETED",
      label: "Completed",
      value: totals.completed,
      detail: "Fieldwork finished",
      icon: "check",
      tone: "success",
    },
    {
      key: "AT_RISK",
      label: "At risk",
      value: totals.atRisk,
      detail: "Late evidence or a missed milestone",
      icon: "risk",
      tone: totals.atRisk > 0 ? "danger" : "neutral",
    },
  ];
  return (
    <section className="eg-board">
      {/* The headline counts; each one filters the list below to what it counts. */}
      <div className="eg-kpis">
        {tiles.map((tile) => {
          const on = view === "all" && filter === tile.key;
          return (
            <button
              key={tile.key}
              type="button"
              className={`eg-kpi tone-${tile.tone}${on ? " is-on" : ""}`}
              aria-pressed={on}
              onClick={() => pick(tile.key)}
            >
              <span className="eg-kpi-icon" aria-hidden="true">
                <UiIcon name={tile.icon} size={18} />
              </span>
              <span className="eg-kpi-copy">
                <strong>{tile.value}</strong>
                <span>{tile.label}</span>
                <small>{tile.detail}</small>
              </span>
            </button>
          );
        })}
      </div>
      <div className="eg-toolbar">
        {/* One set of choices: a status, or the person's starred or recent ones. */}
        <nav className="eg-filters" aria-label="Show">
          {FILTERS.map(([key, label]) => {
            const count = counts.get(key) ?? 0;
            if (!ALWAYS_SHOWN.has(key) && count === 0) {
              return null;
            }
            const on = view === "all" && filter === key;
            return (
              <button
                key={key}
                type="button"
                className={
                  [
                    on ? "is-on" : "",
                    key === "AT_RISK" && count > 0 ? "eg-risk" : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                aria-pressed={on}
                onClick={() => pick(key)}
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
        {/* Search, sort and layout stay together, on the filters' line or their own. */}
        <div className="eg-tools">
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
              placeholder="Search engagement, client, or team"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="eg-sort">
            <span>Sort</span>
            <select
              value={sort}
              onChange={(event) =>
                chooseSort(parseEngagementSort(event.target.value))
              }
            >
              {ENGAGEMENT_SORTS.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="eg-layout-switch">
            <legend className="sr-only">Layout</legend>
            {(
              [
                ["list", "List", "table"],
                ["tiles", "Tiles", "grid"],
              ] as const
            ).map(([key, label, icon]) => (
              <button
                key={key}
                type="button"
                className={layout === key ? "is-on" : undefined}
                aria-pressed={layout === key}
                aria-label={label}
                title={label}
                onClick={() => choose(key)}
              >
                <UiIcon name={icon} size={15} />
              </button>
            ))}
          </fieldset>
        </div>
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
        <div className="eg-table">
          <div className="eg-thead" aria-hidden="true">
            <span>Engagement</span>
            <span>Status</span>
            <span>Audit period</span>
            <span>Progress</span>
            <span>Controls</span>
            <span title="Open findings">Findings</span>
            <span>Next milestone</span>
            <span>Team</span>
          </div>
          <ul>
            {shown.map((project) => {
              const work = workSummary(project.progress);
              const next = project.nextMilestone;
              const late = next !== null && isPastDue(next.due, now);
              const client =
                project.clientName !== "" ? project.clientName : "No client";
              return (
                <li key={project.id} className="eg-row-item">
                  <a
                    className={`eg-trow is-${project.status.toLowerCase()}`}
                    href={openHref(project)}
                    aria-current={
                      project.id === selectedId ? "true" : undefined
                    }
                  >
                    {/* The client leads, as people name an engagement by its client;
                        the engagement and its type follow. */}
                    <span className="eg-ident">
                      <span className="eg-mono" aria-hidden="true">
                        {nameMark(
                          project.clientName !== ""
                            ? project.clientName
                            : project.name,
                        )}
                      </span>
                      <span
                        className="eg-ident-text"
                        title={
                          project.kind !== ""
                            ? engagementTypeLabel(project.kind)
                            : undefined
                        }
                      >
                        <strong>
                          {project.clientName !== ""
                            ? project.clientName
                            : project.name}
                        </strong>
                        <small>
                          {[
                            project.clientName !== "" ? project.name : client,
                            project.kind !== ""
                              ? engagementTypeShort(project.kind)
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </span>
                    </span>
                    <span className="eg-cell" data-label="Status">
                      {atRisk(project) ? (
                        <span
                          className="eg-status is-risk"
                          title={riskReason(project)}
                        >
                          At risk
                        </span>
                      ) : (
                        <span
                          className={`eg-status is-${project.status.toLowerCase()}`}
                        >
                          {statusLabel(project.status)}
                        </span>
                      )}
                    </span>
                    <span className="eg-cell eg-soft" data-label="Audit period">
                      {auditPeriod(project.periodEnd)}
                    </span>
                    <span
                      className="eg-cell eg-progress-cell"
                      data-label="Progress"
                      title={
                        work.total === 0
                          ? "No agent work yet"
                          : `Agent work: ${work.done} of ${work.total} done`
                      }
                    >
                      <span className="eg-meter" aria-hidden="true">
                        <span style={{ width: `${work.percent}%` }} />
                      </span>
                      <span className="eg-pct">{work.percent}%</span>
                    </span>
                    <span className="eg-cell eg-num" data-label="Controls">
                      {project.controls}
                    </span>
                    <span
                      className={`eg-cell eg-num ${project.openDeficiencies > 0 ? "is-warn" : "is-clear"}`}
                      data-label="Open findings"
                    >
                      {project.openDeficiencies}
                    </span>
                    <span
                      className="eg-cell eg-next"
                      data-label="Next milestone"
                      title={
                        next === null
                          ? undefined
                          : `${next.name}, ${late ? "missed, due" : "due"} ${formatDate(next.due)}`
                      }
                    >
                      {next === null ? (
                        <span className="eg-soft">None scheduled</span>
                      ) : (
                        <>
                          <UiIcon name="calendar" size={15} />
                          <span className="eg-next-text">
                            <span>{next.name}</span>
                            <small className={late ? "is-late" : undefined}>
                              {late
                                ? `Missed · ${formatDate(next.due)}`
                                : formatDate(next.due)}
                            </small>
                          </span>
                        </>
                      )}
                    </span>
                    <span
                      className="eg-cell eg-team"
                      data-label="Team"
                      title={project.team.join(", ")}
                    >
                      {project.team.length === 0 ? (
                        <span className="eg-soft">No team</span>
                      ) : (
                        <>
                          {/* Three marks at most: two people and a count when more. */}
                          {project.team
                            .slice(0, project.team.length > 3 ? 2 : 3)
                            .map((name) => (
                              <span
                                key={name}
                                className={`eg-avatar tone-${avatarTone(name)}`}
                                aria-hidden="true"
                              >
                                {initials(name)}
                              </span>
                            ))}
                          {project.team.length > 3 ? (
                            <span
                              className="eg-avatar is-more"
                              aria-hidden="true"
                            >
                              +{project.team.length - 2}
                            </span>
                          ) : null}
                          <span className="sr-only">
                            {project.team.join(", ")}
                          </span>
                        </>
                      )}
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
