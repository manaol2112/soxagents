"use client";

import { useRouter } from "next/navigation";
import {
  Fragment,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useMemo,
  useState,
} from "react";

import { ConfirmAction } from "./confirm-action";
import { type ControlContext, parseContext } from "./control-context-model";
import { SELECT_CONTROLS_EVENT } from "./controls-guide-model";
import {
  type ControlType,
  counts,
  type Filters,
  filterRows,
  groupRows,
  initials,
  NO_FILTERS,
  type PageRow,
  PLAN_FILTER_LABEL,
  PLAN_LABEL,
  type PlanStatus,
  pageOf,
  SOURCE_LABEL,
  STEPS,
  stepStates,
  TESTING_LABEL,
  type TestingStatus,
  TYPE_FILTER_LABEL,
  TYPE_LABEL,
  tiles,
  toCsv,
  type ViewBy,
} from "./controls-page-model";
import { planningHref } from "./planning-model";
import {
  CONTROLS_FILTER_EVENT,
  type ControlsFor,
} from "./scope-controls-model";
import { SetupForm } from "./setup-form";
import { controlStepHref } from "./testing-hub-model";
import { type IconName, UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string };

/** How a control leaves scope, or comes back, as the scope forms post it. */
export type ScopeAction = {
  intent: string;
  fields: Record<string, string>;
  note: string;
  impact?: string | undefined;
};

const TYPES: Array<ControlType | "KEY"> = [
  "ITGC",
  "KEY",
  "ITAC",
  "BUSINESS",
  "IPE",
];
const PLANS: PlanStatus[] = ["DRAFT", "PENDING", "APPROVED"];
const TESTINGS: TestingStatus[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "COMPLETED",
  "EXCEPTIONS",
];
const SIZES = [25, 50, 100];
const TABS = [
  "Overview",
  "Client context",
  "Governing documents",
  "Plan",
  "Evidence",
  "Testing",
  "Conclusions",
  "History",
] as const;
type Tab = (typeof TABS)[number];
const stepOf = (key: string) =>
  STEPS.find((step) => step.key === key) ?? STEPS[0];
/** The tabs that open a step of the control's own page. */
const TAB_STEP: Record<
  Exclude<
    Tab,
    "Overview" | "Client context" | "Governing documents" | "History"
  >,
  (typeof STEPS)[number] | undefined
> = {
  Plan: stepOf("PLAN"),
  Evidence: stepOf("REQUEST"),
  Testing: stepOf("TEST"),
  Conclusions: stepOf("CONCLUDE"),
};

const PLAN_TONE: Record<PlanStatus, string> = {
  DRAFT: "is-muted",
  PENDING: "is-warning",
  APPROVED: "is-success",
};
const TESTING_TONE: Record<TestingStatus, string> = {
  NOT_STARTED: "is-muted",
  IN_PROGRESS: "is-info",
  COMPLETED: "is-success",
  EXCEPTIONS: "is-danger",
};

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

/** What a row click leaves to its own control instead of opening the control. */
const ROW_CONTROLS =
  "a, button, input, select, textarea, label, summary, [role='menu']";

function controlHref(ids: Ids, id: string): string {
  const params = new URLSearchParams({
    organization: ids.organizationId,
    project: ids.projectId,
    section: "controls",
    control: id,
  });
  return `/?${params.toString()}`;
}

/** The step's own page: the plan in Planning, the rest on the control's own page. */
function stepHref(ids: Ids, id: string, link: string): string {
  return link === "plan"
    ? planningHref(ids.organizationId, ids.projectId, { control: id })
    : controlStepHref(ids.organizationId, ids.projectId, id, link);
}

function Check({
  label,
  count,
  checked,
  onChange,
}: {
  label: string;
  count: number;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="cpg-check">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
      <small>{count}</small>
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="cpg-select">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
      <UiIcon name="chevron" size={13} />
    </label>
  );
}

/** A row's other actions, opened over the page so the table's scroll does not clip it. */
function RowMenu({
  label,
  links,
}: {
  label: string;
  links: Array<{ text: string; href: string }>;
}) {
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (at === null) {
      return;
    }
    const close = () => setAt(null);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", close, true);
    };
  }, [at]);
  return (
    <>
      <button
        type="button"
        className="cpg-menu"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        onClick={(event) => {
          event.stopPropagation();
          const box = event.currentTarget.getBoundingClientRect();
          setAt(
            at === null
              ? { top: box.bottom + 4, right: window.innerWidth - box.right }
              : null,
          );
        }}
      >
        <UiIcon name="more" size={16} />
      </button>
      {at !== null ? (
        <div className="cpg-menu-panel" role="menu" style={at}>
          {links.map((link) => (
            <a key={link.href} role="menuitem" href={link.href}>
              {link.text}
            </a>
          ))}
        </div>
      ) : null}
    </>
  );
}

function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`cpg-pill ${tone}`}>{children}</span>;
}

/** A control's client context and documents, read when its row first opens. */
function useControlContext(ids: Ids, id: string, open: boolean) {
  const [context, setContext] = useState<ControlContext | null | "failed">(
    null,
  );
  useEffect(() => {
    if (!open || context !== null) {
      return;
    }
    let live = true;
    const params = new URLSearchParams({
      intent: "control-context",
      organization_id: ids.organizationId,
      project_id: ids.projectId,
      control_id: id,
    });
    fetch(`/workspace/references?${params.toString()}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { status?: unknown; answer?: unknown }) => {
        if (live) {
          setContext(
            body.status === 200
              ? (parseContext(body.answer) ?? "failed")
              : "failed",
          );
        }
      })
      .catch(() => {
        if (live) {
          setContext("failed");
        }
      });
    return () => {
      live = false;
    };
  }, [ids, id, open, context]);
  return context;
}

function Detail({
  ids,
  row,
  action,
  editable,
}: {
  ids: Ids;
  row: PageRow;
  action: ScopeAction | undefined;
  editable: boolean;
}) {
  const [tab, setTab] = useState<Tab>("Overview");
  const context = useControlContext(ids, row.id, true);
  const loaded = context !== null && context !== "failed" ? context : null;
  const questions = (loaded?.design?.slots ?? []).filter(
    (slot) => !slot.automatic,
  );
  const documents = loaded?.documents ?? [];
  const states = stepStates(row.step);
  const facts: Array<{ label: string; value: ReactNode; icon: IconName }> = [
    {
      label: "System / application",
      value: row.system || "None",
      icon: "server",
    },
    { label: "Process", value: row.process, icon: "layers" },
    { label: "Control area", value: row.area, icon: "shield" },
    {
      label: "Type",
      value: <span className="cpg-type">{TYPE_LABEL[row.type]}</span>,
      icon: "grid",
    },
    {
      label: "Key control",
      value: row.key ? (
        <Pill tone="is-success">
          <UiIcon name="check" size={11} /> Yes
        </Pill>
      ) : (
        "No"
      ),
      icon: "star",
    },
    { label: "Frequency", value: row.frequency || "Not stated", icon: "clock" },
  ];
  const count = (item: Tab) =>
    item === "Client context" && loaded !== null
      ? questions.length
      : item === "Governing documents" && loaded !== null
        ? documents.length
        : null;
  const phase = (step: (typeof STEPS)[number] | undefined) =>
    step === undefined ? null : (
      <div className="cpg-phase">
        <p>
          <strong>{step.label}</strong>{" "}
          {row.phaseLabels[step.key] ??
            (states[step.key] === "done" ? "Done" : "Not started")}
        </p>
        <a
          className="btn-secondary btn-sm"
          href={stepHref(ids, row.id, step.link)}
        >
          Open {step.label.toLowerCase()} in the control
          <UiIcon name="arrow" size={13} />
        </a>
      </div>
    );
  return (
    <div className="cpg-detail">
      <div className="cpg-detail-main">
        <nav className="cpg-tabs" aria-label={`${row.ref} details`}>
          {TABS.map((item) => (
            <button
              key={item}
              type="button"
              className={item === tab ? "is-on" : undefined}
              aria-pressed={item === tab}
              onClick={() => setTab(item)}
            >
              {item}
              {count(item) !== null ? <small>{count(item)}</small> : null}
            </button>
          ))}
        </nav>
        {tab === "Overview" ? (
          <>
            <h4>Control description</h4>
            <p className="cpg-description">{row.description || row.title}</p>
            <dl className="cpg-facts">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>
                    <span className="cpg-fact-icon" aria-hidden="true">
                      <UiIcon name={fact.icon} size={14} />
                    </span>
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
            {editable && action !== undefined && row.included ? (
              <SetupForm className="cpg-remove">
                <Hidden ids={ids} action={action} />
                <ConfirmAction
                  label="Remove from scope"
                  intent={action.intent}
                  className="btn-ghost btn-sm ctl-remove"
                  title={`Remove ${row.ref} from scope?`}
                  consequence={action.note}
                  confirmLabel="Remove from scope"
                  impact={action.impact}
                />
              </SetupForm>
            ) : null}
          </>
        ) : tab === "Client context" ? (
          context === null ? (
            <p className="cpg-muted">Loading the client-specific questions…</p>
          ) : questions.length === 0 ? (
            <p className="cpg-muted">
              This control has no client-specific questions.
            </p>
          ) : (
            <ul className="cpg-list">
              {questions.map((slot) => (
                <li key={slot.key}>
                  <span>{slot.question || slot.label}</span>
                  {slot.value !== "" ? (
                    <strong>{slot.value}</strong>
                  ) : (
                    <Pill tone={slot.blocks ? "is-warning" : "is-muted"}>
                      {slot.blocks ? "Required" : "Optional"}
                    </Pill>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : tab === "Governing documents" ? (
          context === null ? (
            <p className="cpg-muted">Loading the documents…</p>
          ) : documents.length === 0 ? (
            <p className="cpg-muted">
              No policy, procedure, narrative or reference applies to this
              control yet.
            </p>
          ) : (
            <ul className="cpg-list">
              {documents.map((document) => (
                <li key={document.id}>
                  <span>
                    <UiIcon name="file" size={13} /> {document.title}
                  </span>
                  <small>{document.kind.replace("_", " ").toLowerCase()}</small>
                </li>
              ))}
            </ul>
          )
        ) : tab === "History" ? (
          <a
            className="btn-secondary btn-sm"
            href={`${controlHref(ids, row.id)}&tab=activity#activity`}
          >
            Open the control&apos;s history
            <UiIcon name="arrow" size={13} />
          </a>
        ) : (
          phase(TAB_STEP[tab])
        )}
      </div>
      <aside className="cpg-steps" aria-label="Status and next steps">
        <h4>Status and next steps</h4>
        <ol>
          {STEPS.map((step) => {
            const state = states[step.key];
            return (
              <li key={step.key} className={`is-${state}`}>
                <span className="cpg-step-mark" aria-hidden="true">
                  {state === "done" ? <UiIcon name="check" size={11} /> : null}
                </span>
                <span className="cpg-step-text">
                  <strong>
                    {step.key === "PLAN" && row.plan === "PENDING"
                      ? "Plan to approve"
                      : step.label}
                  </strong>
                  <small>
                    {row.phaseLabels[step.key] ??
                      (state === "done"
                        ? "Done"
                        : state === "now"
                          ? "Now"
                          : "Not started")}
                  </small>
                </span>
                {state === "now" ? (
                  <a
                    className="btn btn-sm"
                    href={stepHref(ids, row.id, step.link)}
                  >
                    {step.action}
                  </a>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled
                  >
                    {step.action}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </aside>
    </div>
  );
}

function Hidden({ ids, action }: { ids: Ids; action: ScopeAction }) {
  return (
    <>
      <input type="hidden" name="organization_id" value={ids.organizationId} />
      <input type="hidden" name="project_id" value={ids.projectId} />
      <input type="hidden" name="intent" value={action.intent} />
      <input type="hidden" name="step" value="controls" />
      {Object.entries(action.fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </>
  );
}

/**
 * The Controls page (decided by the product owner on 26 October 2026, from the reference
 * given): the engagement's controls, selected for each system and process, with where each
 * plan and test stands; filtered from the bar or the side, grouped, paged, exported, and
 * opened in place with its status and next steps. Planning, evidence and testing happen on
 * their own pages; the next action opens them.
 */
export function ControlsPage({
  ids,
  rows,
  actions,
  systems,
  processes,
  initial,
  editable,
  notices = null,
  extra = null,
}: {
  ids: Ids;
  rows: PageRow[];
  /** Each control's scope action: out of scope for one in scope, back for one out. */
  actions: Record<string, ScopeAction>;
  /** The filter names: systems by name, processes by key. */
  systems: string[];
  processes: Array<{ key: string; label: string }>;
  /** A system or process the address names (`for=`), applied on arrival. */
  initial: ControlsFor | null;
  editable: boolean;
  /** What stands between the header and the tiles. */
  notices?: ReactNode;
  extra?: ReactNode;
}) {
  const [filters, setFiltersNow] = useState<Filters>(() => {
    if (initial === null) {
      return NO_FILTERS;
    }
    if (initial.kind === "process") {
      return { ...NO_FILTERS, processes: [initial.id] };
    }
    const named = rows.find((row) => row.systemId === initial.id)?.system;
    return named === undefined
      ? NO_FILTERS
      : { ...NO_FILTERS, systems: [named] };
  });
  const [view, setView] = useState<"table" | "cards">("table");
  const [by, setBy] = useState<ViewBy>("control");
  const [open, setOpen] = useState<string | null>(null);
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);
  const [side, setSide] = useState(true);
  const [typed, setTyped] = useState("");
  // On a narrow screen the filters start folded away; More filters opens them.
  useEffect(() => {
    if (window.matchMedia("(max-width: 900px)").matches) {
      setSide(false);
    }
  }, []);
  // The search waits for a pause in typing.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFiltersNow((now) => ({ ...now, query: typed }));
      setPage(1);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [typed]);
  // A system or process opened from elsewhere on the page filters to it.
  useEffect(() => {
    const apply = (event: Event) => {
      const next = (event as CustomEvent<ControlsFor | null>).detail ?? null;
      setPage(1);
      setFiltersNow(
        next === null
          ? NO_FILTERS
          : next.kind === "process"
            ? { ...NO_FILTERS, processes: [next.id] }
            : {
                ...NO_FILTERS,
                systems: [
                  rows.find((row) => row.systemId === next.id)?.system ?? "",
                ],
              },
      );
    };
    document.addEventListener(CONTROLS_FILTER_EVENT, apply);
    return () => document.removeEventListener(CONTROLS_FILTER_EVENT, apply);
  }, [rows]);
  // A change of filter starts again on the first page.
  const setFilters = (next: SetStateAction<Filters>) => {
    setFiltersNow(next);
    setPage(1);
  };
  const shown = useMemo(() => filterRows(rows, filters), [rows, filters]);
  const tally = useMemo(
    () => counts(rows, filters.scope),
    [rows, filters.scope],
  );
  const top = useMemo(() => tiles(rows), [rows]);
  const paged = pageOf(shown, page, size);
  const groups = groupRows(paged.rows, by);
  const owners = [
    ...new Set(rows.map((row) => row.owner).filter(Boolean)),
  ].sort();
  const set = (patch: Partial<Filters>) =>
    setFilters((now) => ({ ...now, ...patch }));
  const pageIds = paged.rows.map((row) => row.id);
  const allOnPage =
    pageIds.length > 0 && pageIds.every((id) => selected.includes(id));
  const scopeLabel =
    filters.scope.length === 1 && filters.scope[0] === "OUT"
      ? "Controls out of scope"
      : filters.scope.length === 1
        ? "Controls in scope"
        : "Controls";
  const download = (list: readonly PageRow[], name: string) => {
    const blob = new Blob([toCsv(list)], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const tileList: Array<{
    label: string;
    value: number;
    icon: IconName;
    tone: string;
    apply: () => void;
  }> = [
    {
      label: "In scope",
      value: top.inScope,
      icon: "shield",
      tone: "is-success",
      apply: () => setFilters({ ...NO_FILTERS, query: filters.query }),
    },
    {
      label: "Out of scope",
      value: top.outOfScope,
      icon: "shield",
      tone: "is-muted",
      apply: () => setFilters({ ...NO_FILTERS, scope: ["OUT"] }),
    },
    {
      label: "Plan to approve",
      value: top.planToApprove,
      icon: "file",
      tone: "is-warning",
      apply: () => setFilters({ ...NO_FILTERS, plan: ["PENDING"] }),
    },
    {
      label: "Testing in progress",
      value: top.testingInProgress,
      icon: "wand",
      tone: "is-info",
      apply: () => setFilters({ ...NO_FILTERS, testing: ["IN_PROGRESS"] }),
    },
    {
      label: "Testing complete",
      value: top.testingComplete,
      icon: "check",
      tone: "is-success",
      apply: () => setFilters({ ...NO_FILTERS, testing: ["COMPLETED"] }),
    },
    {
      label: "Needs attention",
      value: top.needsAttention,
      icon: "risk",
      tone: "is-danger",
      apply: () => setFilters({ ...NO_FILTERS, testing: ["EXCEPTIONS"] }),
    },
  ];
  const row = (item: PageRow) => {
    const isOpen = open === item.id;
    const action = actions[item.id];
    return (
      <Fragment key={item.id}>
        <tr
          className={`cpg-row${isOpen ? " is-open" : ""}${item.included ? " is-link" : ""}`}
          onClick={
            item.included
              ? (event) => {
                  const target = event.target as Element;
                  // The checkbox, chevron, menu and buttons keep their own job, and
                  // selecting text to copy it does not navigate.
                  if (
                    target.closest(ROW_CONTROLS) !== null ||
                    (window.getSelection()?.toString() ?? "") !== ""
                  ) {
                    return;
                  }
                  router.push(controlHref(ids, item.id));
                }
              : undefined
          }
        >
          <td className="cpg-pick">
            <input
              type="checkbox"
              aria-label={`Select ${item.ref}`}
              checked={selected.includes(item.id)}
              onChange={() => setSelected((list) => toggle(list, item.id))}
            />
          </td>
          <td className="cpg-expand">
            <button
              type="button"
              aria-expanded={isOpen}
              aria-label={`${isOpen ? "Close" : "Open"} ${item.ref}`}
              onClick={() => setOpen(isOpen ? null : item.id)}
            >
              <UiIcon name="chevron" size={14} />
            </button>
          </td>
          <td>
            <span className="cpg-control">
              {item.included ? (
                <a href={controlHref(ids, item.id)}>{item.ref}</a>
              ) : (
                <strong>{item.ref}</strong>
              )}
              <span>
                {item.title}
                {item.key ? (
                  <span className="cpg-key">
                    <UiIcon name="star" size={10} /> Key
                  </span>
                ) : null}
              </span>
            </span>
          </td>
          <td>
            <span className="cpg-two">
              <span>{item.system || "None"}</span>
              <small>{item.process}</small>
            </span>
          </td>
          <td>
            <span className="cpg-type">{TYPE_LABEL[item.type]}</span>
          </td>
          <td>{item.frequency}</td>
          <td>{SOURCE_LABEL[item.source] ?? item.source}</td>
          <td>
            <Pill tone={item.included ? "is-success" : "is-muted"}>
              {item.included ? "In scope" : "Out of scope"}
            </Pill>
          </td>
          <td>
            {item.included ? (
              <Pill tone={PLAN_TONE[item.plan]}>{PLAN_LABEL[item.plan]}</Pill>
            ) : (
              "—"
            )}
          </td>
          <td>
            {item.included ? (
              <Pill tone={TESTING_TONE[item.testing]}>
                {TESTING_LABEL[item.testing]}
              </Pill>
            ) : (
              "—"
            )}
          </td>
          <td>
            <span className="cpg-owner">
              <span className="cpg-avatar" aria-hidden="true">
                {initials(item.owner || "Unassigned")}
              </span>
              {item.owner || "Unassigned"}
            </span>
          </td>
          <td>
            {item.included ? (
              <a
                className="btn btn-sm cpg-next"
                href={controlHref(ids, item.id)}
              >
                Open control
                <UiIcon name="arrow" size={13} />
              </a>
            ) : editable && action !== undefined ? (
              <SetupForm className="cpg-bring">
                <Hidden ids={ids} action={action} />
                <button type="submit" className="btn-secondary btn-sm cpg-next">
                  <UiIcon name="plus" size={13} /> Bring into scope
                </button>
              </SetupForm>
            ) : null}
          </td>
          <td className="cpg-more-cell">
            {item.included ? (
              <RowMenu
                label={`More for ${item.ref}`}
                links={[
                  { text: "Open the control", href: controlHref(ids, item.id) },
                  // Only the step the control is on, as in its status panel.
                  ...STEPS.filter((step) => step.key === item.step).map(
                    (step) => ({
                      text: step.action,
                      href: stepHref(ids, item.id, step.link),
                    }),
                  ),
                  {
                    text: "History",
                    href: `${controlHref(ids, item.id)}&tab=activity#activity`,
                  },
                ]}
              />
            ) : null}
          </td>
        </tr>
        {isOpen ? (
          <tr className="cpg-detail-row">
            <td colSpan={13}>
              <Detail
                ids={ids}
                row={item}
                action={action}
                editable={editable}
              />
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  };
  return (
    <div className="cpg">
      <header className="cpg-head">
        <span className="cpg-head-icon" aria-hidden="true">
          <UiIcon name="shield" size={26} />
        </span>
        <div>
          <h1>Controls</h1>
          <p>
            The controls selected for each system and process. Each opens with
            its scope, test plan, evidence and testing in Planning, Evidence and
            Testing.
          </p>
        </div>
        <div className="cpg-head-actions">
          <Select
            label="View by"
            value={by}
            options={[
              ["control", "View by control"],
              ["system", "View by system"],
              ["process", "View by process"],
            ]}
            onChange={(value) => setBy(value as ViewBy)}
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={() => download(shown, "controls.csv")}
          >
            <UiIcon name="upload" size={14} />
            Export
          </button>
          {editable ? (
            <button
              type="button"
              className="btn"
              onClick={() =>
                document.dispatchEvent(
                  new CustomEvent(SELECT_CONTROLS_EVENT, { detail: null }),
                )
              }
            >
              <UiIcon name="plus" size={14} />
              Add controls
            </button>
          ) : null}
        </div>
      </header>
      {notices}

      <section className="cpg-tiles" aria-label="Controls in brief">
        {tileList.map((tile) => (
          <button
            key={tile.label}
            type="button"
            className="cpg-tile"
            onClick={tile.apply}
          >
            <span>
              <strong>{tile.value}</strong>
              <small className={tile.tone}>{tile.label}</small>
            </span>
            <span className={`cpg-tile-icon ${tile.tone}`} aria-hidden="true">
              <UiIcon name={tile.icon} size={20} />
            </span>
          </button>
        ))}
      </section>

      <div className="cpg-bar">
        <label className="cpg-search">
          <UiIcon name="search" size={15} />
          <input
            type="search"
            value={typed}
            placeholder="Search controls, ID, keyword, or description…"
            aria-label="Search controls"
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
        <Select
          label="System"
          value={filters.systems.length === 1 ? (filters.systems[0] ?? "") : ""}
          options={[
            ["", "All systems"],
            ...systems.map((name) => [name, name] as const),
          ]}
          onChange={(value) => set({ systems: value === "" ? [] : [value] })}
        />
        <Select
          label="Process"
          value={
            filters.processes.length === 1 ? (filters.processes[0] ?? "") : ""
          }
          options={[
            ["", "All processes"],
            ...processes.map((item) => [item.key, item.label] as const),
          ]}
          onChange={(value) => set({ processes: value === "" ? [] : [value] })}
        />
        <Select
          label="Control type"
          value={filters.types.length === 1 ? (filters.types[0] ?? "") : ""}
          options={[
            ["", "All control types"],
            ...TYPES.map((type) => [type, TYPE_FILTER_LABEL[type]] as const),
          ]}
          onChange={(value) =>
            set({ types: value === "" ? [] : [value as ControlType | "KEY"] })
          }
        />
        <Select
          label="Testing status"
          value={filters.testing.length === 1 ? (filters.testing[0] ?? "") : ""}
          options={[
            ["", "All statuses"],
            ...TESTINGS.map(
              (status) => [status, TESTING_LABEL[status]] as const,
            ),
          ]}
          onChange={(value) =>
            set({ testing: value === "" ? [] : [value as TestingStatus] })
          }
        />
        <button
          type="button"
          className="btn-secondary cpg-more"
          aria-expanded={side}
          onClick={() => setSide((now) => !now)}
        >
          <UiIcon name="filter" size={14} />
          More filters
        </button>
        <fieldset className="cpg-views">
          <legend className="sr-only">Layout</legend>
          <button
            type="button"
            className={view === "table" ? "is-on" : undefined}
            aria-pressed={view === "table"}
            onClick={() => setView("table")}
          >
            <UiIcon name="table" size={14} /> Table
          </button>
          <button
            type="button"
            className={view === "cards" ? "is-on" : undefined}
            aria-pressed={view === "cards"}
            onClick={() => setView("cards")}
          >
            <UiIcon name="grid" size={14} /> Cards
          </button>
        </fieldset>
      </div>

      <div className={`cpg-body${side ? "" : " is-wide"}`}>
        {side ? (
          <aside className="card cpg-filters" aria-label="Filters">
            <header>
              <h2>Filters</h2>
              <button
                type="button"
                className="cpg-link"
                onClick={() => setFilters(NO_FILTERS)}
              >
                Clear all
              </button>
            </header>
            <fieldset>
              <legend>System / application</legend>
              {systems.map((name) => (
                <Check
                  key={name}
                  label={name}
                  count={tally.systems[name] ?? 0}
                  checked={filters.systems.includes(name)}
                  onChange={() =>
                    set({ systems: toggle(filters.systems, name) })
                  }
                />
              ))}
            </fieldset>
            <fieldset>
              <legend>Control type</legend>
              {TYPES.filter(
                (type) => type !== "IPE" || (tally.types.IPE ?? 0) > 0,
              ).map((type) => (
                <Check
                  key={type}
                  label={TYPE_FILTER_LABEL[type]}
                  count={tally.types[type] ?? 0}
                  checked={filters.types.includes(type)}
                  onChange={() => set({ types: toggle(filters.types, type) })}
                />
              ))}
            </fieldset>
            <fieldset>
              <legend>Scope status</legend>
              <Check
                label="In scope"
                count={tally.scope.IN}
                checked={filters.scope.includes("IN")}
                onChange={() => set({ scope: toggle(filters.scope, "IN") })}
              />
              <Check
                label="Out of scope"
                count={tally.scope.OUT}
                checked={filters.scope.includes("OUT")}
                onChange={() => set({ scope: toggle(filters.scope, "OUT") })}
              />
            </fieldset>
            <fieldset>
              <legend>Plan status</legend>
              {PLANS.map((status) => (
                <Check
                  key={status}
                  label={PLAN_FILTER_LABEL[status]}
                  count={tally.plan[status] ?? 0}
                  checked={filters.plan.includes(status)}
                  onChange={() => set({ plan: toggle(filters.plan, status) })}
                />
              ))}
            </fieldset>
            <fieldset>
              <legend>Testing status</legend>
              {TESTINGS.map((status) => (
                <Check
                  key={status}
                  label={TESTING_LABEL[status]}
                  count={tally.testing[status] ?? 0}
                  checked={filters.testing.includes(status)}
                  onChange={() =>
                    set({ testing: toggle(filters.testing, status) })
                  }
                />
              ))}
            </fieldset>
            <fieldset>
              <legend>Owner</legend>
              <Select
                label="Owner"
                value={filters.owner}
                options={[
                  ["", "All owners"],
                  ...owners.map((name) => [name, name] as const),
                ]}
                onChange={(value) => set({ owner: value })}
              />
            </fieldset>
            <button
              type="button"
              className="btn-secondary cpg-reset"
              onClick={() => {
                setFilters(NO_FILTERS);
                setTyped("");
              }}
            >
              <UiIcon name="retry" size={14} />
              Reset filters
            </button>
          </aside>
        ) : null}

        <section className="card cpg-main" aria-labelledby="cpg-title">
          <header className="cpg-main-head">
            <h2 id="cpg-title">
              {scopeLabel} <span>({shown.length})</span>
            </h2>
            {selected.length > 0 ? (
              <button
                type="button"
                className="cpg-link"
                onClick={() => setSelected([])}
              >
                {selected.length} selected
              </button>
            ) : null}
            <Select
              label="Bulk actions"
              value=""
              options={[
                ["", "Bulk actions"],
                ...(selected.length > 0
                  ? ([
                      ["export", `Export ${selected.length} selected`],
                      ["clear", "Clear the selection"],
                    ] as const)
                  : ([] as const)),
              ]}
              onChange={(value) => {
                if (value === "export") {
                  download(
                    rows.filter((item) => selected.includes(item.id)),
                    "controls-selected.csv",
                  );
                } else if (value === "clear") {
                  setSelected([]);
                }
              }}
            />
          </header>
          {shown.length === 0 ? (
            <p className="cpg-empty">
              No control matches these filters.{" "}
              <button
                type="button"
                className="cpg-link"
                onClick={() => {
                  setFilters(NO_FILTERS);
                  setTyped("");
                }}
              >
                Reset filters
              </button>
            </p>
          ) : view === "table" ? (
            <div className="cpg-scroll">
              <table className="cpg-table">
                <thead>
                  <tr>
                    <th scope="col" className="cpg-pick">
                      <input
                        type="checkbox"
                        aria-label="Select the controls on this page"
                        checked={allOnPage}
                        onChange={() =>
                          setSelected((list) =>
                            allOnPage
                              ? list.filter((id) => !pageIds.includes(id))
                              : [...new Set([...list, ...pageIds])],
                          )
                        }
                      />
                    </th>
                    <th scope="col" className="cpg-expand">
                      <span className="sr-only">Open</span>
                    </th>
                    <th scope="col">Control</th>
                    <th scope="col">System / process</th>
                    <th scope="col">Type</th>
                    <th scope="col">Frequency</th>
                    <th scope="col">Source</th>
                    <th scope="col">Scope status</th>
                    <th scope="col">Plan status</th>
                    <th scope="col">Testing status</th>
                    <th scope="col">Owner</th>
                    <th scope="col">Next action</th>
                    <th scope="col" className="cpg-more-cell">
                      <span className="sr-only">More</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <Fragment key={group.key}>
                      {group.label !== "" ? (
                        <tr className="cpg-group">
                          <th scope="rowgroup" colSpan={13}>
                            {group.label} <span>({group.rows.length})</span>
                          </th>
                        </tr>
                      ) : null}
                      {group.rows.map(row)}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ul className="cpg-cards">
              {paged.rows.map((item) => (
                <li key={item.id} className="cpg-card">
                  <span className="cpg-control">
                    {item.included ? (
                      <a href={controlHref(ids, item.id)}>{item.ref}</a>
                    ) : (
                      <strong>{item.ref}</strong>
                    )}
                    <span>{item.title}</span>
                  </span>
                  <small>
                    {[item.system, item.process].filter(Boolean).join(" · ")}
                  </small>
                  <span className="cpg-card-pills">
                    <span className="cpg-type">{TYPE_LABEL[item.type]}</span>
                    {item.included ? (
                      <>
                        <Pill tone={PLAN_TONE[item.plan]}>
                          {PLAN_LABEL[item.plan]}
                        </Pill>
                        <Pill tone={TESTING_TONE[item.testing]}>
                          {TESTING_LABEL[item.testing]}
                        </Pill>
                      </>
                    ) : (
                      <Pill tone="is-muted">Out of scope</Pill>
                    )}
                  </span>
                  {item.included ? (
                    <a className="btn btn-sm" href={controlHref(ids, item.id)}>
                      Open control <UiIcon name="arrow" size={13} />
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <footer className="cpg-foot">
            <span>
              Showing {paged.rows.length} of {shown.length} controls
            </span>
            <span className="cpg-pager">
              <button
                type="button"
                aria-label="Previous page"
                disabled={paged.page <= 1}
                onClick={() => setPage(paged.page - 1)}
              >
                <UiIcon name="back" size={13} />
              </button>
              <span className="cpg-page">{paged.page}</span>
              <button
                type="button"
                aria-label="Next page"
                disabled={paged.page >= paged.pages}
                onClick={() => setPage(paged.page + 1)}
              >
                <UiIcon name="arrow" size={13} />
              </button>
              <Select
                label="Rows per page"
                value={String(size)}
                options={SIZES.map(
                  (value) => [String(value), `${value} / page`] as const,
                )}
                onChange={(value) => {
                  setSize(Number(value));
                  setPage(1);
                }}
              />
            </span>
          </footer>
        </section>
      </div>
      {extra}
    </div>
  );
}
