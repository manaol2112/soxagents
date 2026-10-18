"use client";

import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  countLine,
  filterChips,
  OTHER_VIEWS,
  popoverCount,
  type RegisterView,
  registerHref,
  type Sort,
  STATUS_PRESETS,
} from "./controls-register-model";
import { NO_APPLICATION } from "./engagement-model";
import { UiIcon } from "./ui-icon";

type Options = {
  applications: string[];
  areas: string[];
  owners: string[];
};

type ListName = "app" | "area" | "owner" | "stage";
type Menu = "app" | "filters";

/** The view a person last chose, kept in their browser (ControlsLayoutMemory). */
export const LAYOUT_KEY = "aw.controls.layout";

/**
 * The register's toolbar: search, application, the status presets, and Needs my
 * attention, with everything else (type, stage, area, owner, key controls, the order, and
 * the grouping) behind Filters, and the view switch. Under it, what is shown of what is in
 * scope and why, and the filters in force as chips, each removing just itself. Every change
 * goes into the address, so a view can be shared.
 */
export function ControlsToolbar({
  base,
  view,
  options,
  categories,
  stages,
  shown,
  total,
  needsYou,
  extra,
}: {
  base: { organization: string; project: string };
  view: RegisterView;
  options: Options;
  /** The control types in this register; the type filter shows only with more than one. */
  categories: ReadonlyArray<readonly [string, string]>;
  stages: ReadonlyArray<readonly [string, string]>;
  shown: number;
  total: number;
  /** The viewer's steps among the controls the other filters leave. */
  needsYou: number;
  /** Beside the count: opening or closing every group. */
  extra?: ReactNode;
}) {
  const router = useRouter();
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<Menu | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === null) {
      return;
    }
    const onDown = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) {
        setOpen(null);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const go = (change: Partial<RegisterView>) => {
    startTransition(() => {
      router.push(registerHref(base, view, change), { scroll: false });
    });
  };
  const toggle = (name: ListName, value: string) => {
    const picked = view[name];
    go({
      [name]: picked.includes(value)
        ? picked.filter((item) => item !== value)
        : [...picked, value],
    });
  };
  const chips = filterChips(view);
  const held = popoverCount(view);
  // The search keeps the rest of the view: everything but the query goes along hidden.
  const kept = [
    ...new URL(
      registerHref(base, view, { q: "" }),
      "http://register",
    ).searchParams.entries(),
  ];
  const appLabel = (name: string) => (name === "" ? NO_APPLICATION : name);
  const presets: ReadonlyArray<readonly [string | null, string]> =
    view.queue !== null && OTHER_VIEWS[view.queue] !== undefined
      ? [...STATUS_PRESETS, [view.queue, OTHER_VIEWS[view.queue] ?? view.queue]]
      : STATUS_PRESETS;
  const layoutHref = (layout: RegisterView["layout"]) =>
    registerHref(base, view, { layout });
  const keepLayout = (layout: RegisterView["layout"]) => {
    try {
      window.localStorage.setItem(LAYOUT_KEY, layout);
    } catch {
      // Storage can be off; the address still carries the view.
    }
  };
  const appSummary =
    view.app.length === 0
      ? "All applications"
      : view.app.length === 1
        ? appLabel(view.app[0] ?? "")
        : `${view.app.length} applications`;
  return (
    <div className="cr-toolbar" ref={wrap} aria-busy={pending}>
      <div className="cr-toolbar-row">
        <form
          autoComplete="off"
          method="get"
          action="/"
          className="cr-search"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("q");
            go({ q: typeof value === "string" ? value : "" });
          }}
        >
          {kept.map(([name, value], index) => (
            <input
              // biome-ignore lint/suspicious/noArrayIndexKey: a list value repeats its name.
              key={`${name}-${index}`}
              type="hidden"
              name={name}
              value={value}
            />
          ))}
          <label className="sr-only" htmlFor={`${id}-search`}>
            Search controls
          </label>
          <svg
            className="cr-search-icon"
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
            id={`${id}-search`}
            key={view.q}
            name="q"
            type="search"
            defaultValue={view.q}
            placeholder="Search controls, IDs, owners, or applications"
          />
        </form>
        {options.applications.length > 1 ? (
          <div className={`cr-menu${open === "app" ? " is-open" : ""}`}>
            <button
              type="button"
              className={`cr-tool${view.app.length > 0 ? " is-set" : ""}`}
              aria-expanded={open === "app"}
              aria-haspopup="true"
              onClick={() => setOpen(open === "app" ? null : "app")}
            >
              <UiIcon name="server" size={14} />
              <span className="cr-tool-text">{appSummary}</span>
              <span className="cr-caret" aria-hidden="true">
                <UiIcon name="chevron" size={13} />
              </span>
            </button>
            {open === "app" ? (
              <div className="cr-popover cr-popover-app">
                <Checks
                  id={`${id}-app`}
                  items={options.applications.map((name) => [
                    name,
                    appLabel(name),
                  ])}
                  picked={view.app}
                  pending={pending}
                  onToggle={(value) => toggle("app", value)}
                  noun="applications"
                />
                <div className="cr-popover-foot">
                  {view.app.length > 0 ? (
                    <button
                      type="button"
                      className="cr-link-button"
                      disabled={pending}
                      onClick={() => go({ app: [] })}
                    >
                      All applications
                    </button>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    className="cr-done"
                    onClick={() => setOpen(null)}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <label className="cr-status-select">
          <span className="sr-only">Status</span>
          <select
            value={view.queue ?? ""}
            disabled={pending}
            onChange={(event) =>
              go({
                queue: event.target.value === "" ? null : event.target.value,
              })
            }
          >
            {presets.map(([queue, label]) => (
              <option key={label} value={queue ?? ""}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`cr-tool cr-attention${view.queue === "team" ? " is-set" : ""}`}
          aria-pressed={view.queue === "team"}
          disabled={pending}
          onClick={() => go({ queue: view.queue === "team" ? null : "team" })}
        >
          Needs my attention
          <span className="cr-tool-count">{needsYou}</span>
        </button>
        <div className={`cr-menu${open === "filters" ? " is-open" : ""}`}>
          <button
            type="button"
            className={`cr-tool${held > 0 ? " is-set" : ""}`}
            aria-expanded={open === "filters"}
            aria-haspopup="true"
            onClick={() => setOpen(open === "filters" ? null : "filters")}
          >
            <UiIcon name="filter" size={14} />
            <span className="cr-tool-text">Filters</span>
            {held > 0 ? (
              <span className="cr-tool-count">
                {held}
                <span className="sr-only"> in force</span>
              </span>
            ) : null}
          </button>
          {open === "filters" ? (
            <div className="cr-popover cr-popover-filters">
              <div className="cr-popover-body">
                {categories.length > 1 ? (
                  <Section title="Type">
                    {(
                      [[null, "All types"], ...categories] as ReadonlyArray<
                        readonly [string | null, string]
                      >
                    ).map(([key, label]) => (
                      <label key={label} className="cr-check">
                        <input
                          type="radio"
                          name={`${id}-type`}
                          checked={view.category === key}
                          disabled={pending}
                          onChange={() => go({ category: key })}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </Section>
                ) : null}
                <Section title="Status">
                  <Checks
                    id={`${id}-stage`}
                    items={stages}
                    picked={view.stage}
                    pending={pending}
                    onToggle={(value) => toggle("stage", value)}
                    noun="statuses"
                  />
                </Section>
                <Section title="Area">
                  <Checks
                    id={`${id}-area`}
                    items={options.areas.map((name) => [name, name])}
                    picked={view.area}
                    pending={pending}
                    onToggle={(value) => toggle("area", value)}
                    noun="areas"
                  />
                </Section>
                <Section title="Owner">
                  <Checks
                    id={`${id}-owner`}
                    items={options.owners.map((name) => [
                      name,
                      name === "" ? "PBC coordinator" : name,
                    ])}
                    picked={view.owner}
                    pending={pending}
                    onToggle={(value) => toggle("owner", value)}
                    noun="owners"
                  />
                </Section>
                <Section title="Scope">
                  <label className="cr-check">
                    <input
                      type="checkbox"
                      checked={view.key}
                      disabled={pending}
                      onChange={(event) => go({ key: event.target.checked })}
                    />
                    <span>Key controls only</span>
                  </label>
                </Section>
                <Section title="Order">
                  <select
                    className="cr-order"
                    aria-label="Order"
                    value={view.sort}
                    disabled={pending}
                    onChange={(event) =>
                      go({ sort: event.target.value as Sort })
                    }
                  >
                    <option value="control">Control ID</option>
                    <option value="attention">Needs attention first</option>
                    <option value="stage">Stage</option>
                    <option value="owner">Owner</option>
                    <option value="application">Application</option>
                    <option value="due">Evidence due</option>
                  </select>
                </Section>
                {view.layout === "applications" ? (
                  <Section title="Group by">
                    {(
                      [
                        ["application", "Application"],
                        ["area", "Control area"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="cr-check">
                        <input
                          type="radio"
                          name={`${id}-group`}
                          checked={view.group === key}
                          disabled={pending}
                          onChange={() => go({ group: key })}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </Section>
                ) : null}
              </div>
              <div className="cr-popover-foot">
                {held > 0 ? (
                  <button
                    type="button"
                    className="cr-link-button"
                    disabled={pending}
                    onClick={() =>
                      go({
                        category: null,
                        stage: [],
                        area: [],
                        owner: [],
                        key: false,
                      })
                    }
                  >
                    Clear these filters
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  className="cr-done"
                  onClick={() => setOpen(null)}
                >
                  Done
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <nav className="cr-layout" aria-label="View">
          <a
            href={layoutHref("applications")}
            aria-current={view.layout === "applications" ? "page" : undefined}
            onClick={() => keepLayout("applications")}
          >
            <UiIcon name="grid" size={14} />
            <span>Applications</span>
          </a>
          <a
            href={layoutHref("table")}
            aria-current={view.layout === "table" ? "page" : undefined}
            onClick={() => keepLayout("table")}
          >
            <UiIcon name="table" size={14} />
            <span>Table</span>
          </a>
        </nav>
      </div>
      <div className="cr-under">
        <span
          className={`cr-count${shown < total ? " is-narrowed" : ""}`}
          aria-live="polite"
        >
          {countLine(shown, total, view)}
        </span>
        {extra}
      </div>
      {chips.length > 0 ? (
        <ul className="cr-chips" aria-label="Filters in force">
          {chips.map((chip) => (
            <li key={chip.id}>
              <a
                className="cr-chip"
                href={registerHref(base, view, chip.without)}
                aria-label={`Remove ${chip.label}`}
              >
                <span>{chip.label}</span>
                <UiIcon name="x" size={12} />
              </a>
            </li>
          ))}
          {chips.length > 1 ? (
            <li>
              <a
                className="cr-clear-all"
                href={registerHref(base, view, {
                  q: "",
                  category: null,
                  app: [],
                  area: [],
                  owner: [],
                  stage: [],
                  key: false,
                })}
              >
                Clear all
              </a>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="cr-section">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

/** A list of choices to tick, with a find box once it is long. */
function Checks({
  id,
  items,
  picked,
  pending,
  onToggle,
  noun,
}: {
  id: string;
  items: ReadonlyArray<readonly [string, string]>;
  picked: readonly string[];
  pending: boolean;
  onToggle: (value: string) => void;
  noun: string;
}) {
  const [find, setFind] = useState("");
  const typed = find.trim().toLowerCase();
  const shown =
    typed === ""
      ? items
      : items.filter(([value, text]) =>
          `${value} ${text}`.toLowerCase().includes(typed),
        );
  return (
    <div className="cr-checks">
      {items.length > 8 ? (
        <input
          type="search"
          className="cr-find"
          value={find}
          placeholder={`Find ${noun}`}
          aria-label={`Find ${noun}`}
          autoComplete="off"
          onChange={(event) => setFind(event.target.value)}
          onKeyDown={(event) => {
            // Enter ticks the only match; Escape clears the find box first.
            if (event.key === "Enter") {
              event.preventDefault();
              const only = shown.length === 1 ? shown[0]?.[0] : undefined;
              if (only !== undefined && !picked.includes(only)) {
                onToggle(only);
              }
            } else if (event.key === "Escape" && find !== "") {
              event.stopPropagation();
              setFind("");
            }
          }}
        />
      ) : null}
      {shown.length === 0 ? <p className="cr-none">No {noun} match.</p> : null}
      {shown.map(([value, text]) => (
        <label
          key={value}
          className="cr-check"
          htmlFor={`${id}-${value || "none"}`}
        >
          <input
            id={`${id}-${value || "none"}`}
            type="checkbox"
            checked={picked.includes(value)}
            disabled={pending}
            onChange={() => onToggle(value)}
          />
          <span>{text}</span>
        </label>
      ))}
    </div>
  );
}
