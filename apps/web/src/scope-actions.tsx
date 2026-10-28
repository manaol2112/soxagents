"use client";

import { useRouter } from "next/navigation";
import {
  type DragEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";

import {
  CONTROLS_SAVED_EVENT,
  FINALIZE_EVENT,
  RCM_UPLOAD_EVENT,
  type ScopeReview,
  SELECT_CONTROLS_EVENT,
  SHOW_PANE_EVENT,
  selectionCategory,
} from "./controls-guide-model";
import {
  acceptRecommended,
  adviceSourceLine,
  clickRow,
  libraryView,
  pickCategory,
  type SourceKey,
  type SystemAdvice,
  toggleVisible,
} from "./select-controls-model";
import { selectTargetFor } from "./system-added-model";
import { type IconName, UiIcon } from "./ui-icon";

type Target = { kind: "system" | "process"; id: string; name: string };

type Option = {
  libraryKey: string;
  controlRef: string;
  title: string;
  domain: string;
  inScope: boolean;
};

/** A wizard's footer while it asks whether to discard what was entered. */
export function DiscardBar({
  onKeep,
  onDiscard,
}: {
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <>
      <p className="as-confirm" role="alert">
        Discard what was entered? It has not been saved.
      </p>
      <span className="as-foot-actions">
        <button
          type="button"
          className="btn-secondary"
          // biome-ignore lint/a11y/noAutofocus: the question needs the focus at once
          autoFocus
          onClick={onKeep}
        >
          Keep editing
        </button>
        <button type="button" className="btn as-discard" onClick={onDiscard}>
          Discard
        </button>
      </span>
    </>
  );
}

/** Anything on the page opens one of the scope's drawers with this button. */
export function OpenScopeAction({
  event,
  detail = null,
  label,
  icon,
  className = "btn",
}: {
  event: string;
  detail?: string | null;
  label: string;
  icon: IconName;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => document.dispatchEvent(new CustomEvent(event, { detail }))}
    >
      <UiIcon name={icon} size={14} />
      {label}
    </button>
  );
}

/** A drawer over the page, as the wizards use; it opens on its event. */
function useDrawer(event: string): {
  open: boolean;
  detail: unknown;
  close: () => void;
} {
  const [state, setState] = useState<{ open: boolean; detail: unknown }>({
    open: false,
    detail: null,
  });
  useEffect(() => {
    const show = (raised: Event) => {
      // Taken: an opener that asks (a cancelable event) learns a drawer is here.
      raised.preventDefault();
      setState({
        open: true,
        detail: (raised as CustomEvent<unknown>).detail ?? null,
      });
    };
    document.addEventListener(event, show);
    return () => document.removeEventListener(event, show);
  }, [event]);
  return {
    open: state.open,
    detail: state.detail,
    close: () => setState({ open: false, detail: null }),
  };
}

export function Drawer({
  title,
  subtitle,
  className,
  icon,
  busy,
  onClose,
  aside = null,
  compact = false,
  footer,
  children,
}: {
  title: string;
  /** One line under the title. */
  subtitle?: string;
  /** A drawer with a layout of its own adds its class (Map controls). */
  className?: string;
  icon: IconName;
  busy: boolean;
  onClose: () => void;
  aside?: ReactNode;
  /** A short question, sized to its words rather than to a form. */
  compact?: boolean;
  footer: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return createPortal(
    // A click outside never closes it: what was entered stays until Cancel or Close.
    <div className="as-backdrop" role="presentation">
      <section
        className={`as${aside === null ? " is-single" : ""}${compact ? " is-compact" : ""}${className === undefined ? "" : ` ${className}`}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <header className="as-head">
          <span className="as-head-icon" aria-hidden="true">
            <UiIcon name={icon} size={16} />
          </span>
          {subtitle === undefined ? (
            <h2 id={`${id}-title`}>{title}</h2>
          ) : (
            <span className="as-head-text">
              <h2 id={`${id}-title`}>{title}</h2>
              <span>{subtitle}</span>
            </span>
          )}
          <button
            type="button"
            className="as-close"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <UiIcon name="x" size={16} />
          </button>
        </header>
        <div className="as-main">
          {aside}
          <div className="as-body">{children}</div>
        </div>
        <footer className="as-foot">{footer}</footer>
      </section>
    </div>,
    document.body,
  );
}

async function call(
  body: Record<string, unknown>,
): Promise<{ status: number; answer: unknown }> {
  try {
    const response = await fetch("/workspace/system-wizard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const answer = (await response.json()) as {
      status?: unknown;
      onboarding?: unknown;
    };
    return {
      status: typeof answer.status === "number" ? answer.status : 0,
      answer: answer.onboarding ?? null,
    };
  } catch {
    return { status: 0, answer: null };
  }
}

function parseOptions(value: unknown): {
  approved: string[] | null;
  options: Option[];
} | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.controls)) {
    return null;
  }
  return {
    approved: Array.isArray(record.approved_areas)
      ? record.approved_areas.filter(
          (item): item is string => typeof item === "string",
        )
      : null,
    options: record.controls
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      )
      .map((item) => ({
        libraryKey: String(item.library_key ?? ""),
        controlRef: String(item.control_ref ?? ""),
        title: String(item.title ?? ""),
        domain: String(item.domain ?? ""),
        inScope: item.in_scope === true,
      })),
  };
}

/**
 * Select controls (decided by the product owner, SP4 of the Systems & Processes workflow):
 * the firm's library controls for one system or process at a time, filtered by category,
 * searched, and chosen together. The categories start on the areas a person approved for
 * it. Controls already in scope show as such. Before the scope is finalized, selecting
 * creates no work; after, each control added gets its work.
 */
export function SelectControls({
  organizationId,
  projectId,
  targets,
  finalized,
  rcm,
  advice = {},
}: {
  organizationId: string;
  projectId: string;
  targets: Target[];
  finalized: boolean;
  /** Whether the client's RCM can still be uploaded: only while no control is set up. */
  rcm: boolean;
  /** The agent's review of each system, by its id (adviceBySystem). */
  advice?: Record<string, SystemAdvice>;
}) {
  const drawer = useDrawer(SELECT_CONTROLS_EVENT);
  if (!drawer.open) {
    return null;
  }
  // A system just added joins the targets once the page has refreshed.
  const start = selectTargetFor(targets, drawer.detail);
  if (start.wait) {
    return null;
  }
  return (
    <SelectControlsDrawer
      organizationId={organizationId}
      projectId={projectId}
      targets={targets}
      initial={start.target}
      finalized={finalized}
      rcm={rcm}
      advice={advice}
      onClose={drawer.close}
    />
  );
}

function SelectControlsDrawer({
  organizationId,
  projectId,
  targets,
  initial,
  finalized,
  rcm,
  advice,
  onClose,
}: {
  organizationId: string;
  projectId: string;
  targets: Target[];
  initial: Target | null;
  finalized: boolean;
  rcm: boolean;
  advice: Record<string, SystemAdvice>;
  onClose: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const [, startTransition] = useTransition();
  const [target, setTarget] = useState<Target | null>(initial);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [categoryWords, setCategoryWords] = useState("");
  const [sources, setSources] = useState<SourceKey[]>([]);
  const [recommendedOnly, setRecommendedOnly] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const latest = useRef(0);
  // The row last clicked, where a Shift-click range starts.
  const anchor = useRef<string | null>(null);

  // The agent's review of the system; a process has none.
  const advised =
    target?.kind === "system" ? (advice[target.id] ?? null) : null;
  // While the agent reviews the system, the page refreshes to bring its answer in; just
  // after asking, until the review shows as started, for a minute at most.
  const reviewing =
    advised?.state === "WORKING" || (asking && advised?.state === "NONE");
  useEffect(() => {
    if (!reviewing) {
      return;
    }
    const timer = window.setInterval(
      () => startTransition(() => router.refresh()),
      4000,
    );
    return () => window.clearInterval(timer);
  }, [reviewing, router]);
  useEffect(() => {
    if (!asking) {
      return;
    }
    const timer = window.setTimeout(() => setAsking(false), 60000);
    return () => window.clearTimeout(timer);
  }, [asking]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(typed), 150);
    return () => window.clearTimeout(timer);
  }, [typed]);

  useEffect(() => {
    if (target === null) {
      return;
    }
    const ask = latest.current + 1;
    latest.current = ask;
    setOptions(null);
    setChosen([]);
    anchor.current = null;
    setAsking(false);
    setRecommendedOnly(false);
    void call({
      organization_id: organizationId,
      project_id: projectId,
      intent: "scope-options",
      ...(target.kind === "system"
        ? { system_id: target.id }
        : { target_process_id: target.id }),
    }).then(({ status, answer }) => {
      // Only the latest target's answer counts.
      if (ask !== latest.current) {
        return;
      }
      const parsed = status === 200 ? parseOptions(answer) : null;
      if (parsed === null) {
        setProblem("The library controls could not be loaded. Try again.");
        setOptions([]);
        return;
      }
      setProblem(null);
      setOptions(parsed.options);
      const present = [
        ...new Set(
          parsed.options.map((item) => selectionCategory(item.domain).key),
        ),
      ];
      // Start on the areas a person approved, when they decided and any apply here.
      const approved = present.filter((key) =>
        (parsed.approved ?? []).includes(key === "ENTITY" ? "BUSINESS" : key),
      );
      setCategories(approved.length > 0 ? approved : present);
    });
  }, [organizationId, projectId, target]);

  const all = options ?? [];
  const view = libraryView(
    all,
    {
      categories,
      sources,
      words: query,
      categoryWords,
      chosen,
      recommendedOnly,
    },
    advised,
  );
  const toggle = (key: string) =>
    setChosen((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  const name = target?.name ?? "a system or process";

  async function ask() {
    if (target === null || target.kind !== "system") {
      return;
    }
    setProblem(null);
    const { status } = await call({
      organization_id: organizationId,
      project_id: projectId,
      intent: "assess",
      system_id: target.id,
    });
    if (status !== 200) {
      setProblem("The agent could not be asked. Try again.");
      return;
    }
    setAsking(true);
    startTransition(() => router.refresh());
  }

  async function add() {
    if (target === null || chosen.length === 0) {
      return;
    }
    setBusy(true);
    setProblem(null);
    const { status } = await call({
      organization_id: organizationId,
      project_id: projectId,
      intent: "scope-select",
      ...(target.kind === "system"
        ? { system_id: target.id }
        : { target_process_id: target.id }),
      library_keys: chosen,
    });
    setBusy(false);
    if (status !== 200) {
      setProblem(
        status === 409
          ? "One of the controls is already in scope elsewhere. Refresh and try again."
          : status === 403
            ? "Only the engagement's managers can select controls."
            : "The controls could not be added. Try again.",
      );
      return;
    }
    document.dispatchEvent(new Event(CONTROLS_SAVED_EVENT));
    startTransition(() => router.refresh());
    onClose();
  }

  return (
    <Drawer
      title={`Map controls to ${name}`}
      subtitle={
        rcm
          ? "Select controls from your library or import a client RCM."
          : "Select controls from your library."
      }
      className="mc"
      icon="shield"
      busy={busy}
      onClose={onClose}
      aside={
        <aside className="sc-filters mc-library" aria-label="Control library">
          {targets.length > 1 ? (
            <label htmlFor={`${id}-target`} className="sc-target">
              <span>For</span>
              <select
                id={`${id}-target`}
                value={target === null ? "" : `${target.kind}:${target.id}`}
                onChange={(event) =>
                  setTarget(
                    targets.find(
                      (item) =>
                        `${item.kind}:${item.id}` === event.target.value,
                    ) ?? null,
                  )
                }
              >
                {targets.some((item) => item.kind === "system") ? (
                  <optgroup label="Systems">
                    {targets
                      .filter((item) => item.kind === "system")
                      .map((item) => (
                        <option key={item.id} value={`system:${item.id}`}>
                          {item.name}
                        </option>
                      ))}
                  </optgroup>
                ) : null}
                {targets.some((item) => item.kind === "process") ? (
                  <optgroup label="Business processes">
                    {targets
                      .filter((item) => item.kind === "process")
                      .map((item) => (
                        <option key={item.id} value={`process:${item.id}`}>
                          {item.name}
                        </option>
                      ))}
                  </optgroup>
                ) : null}
              </select>
            </label>
          ) : null}
          <h3 className="mc-heading">Control library</h3>
          <label className="as-search">
            <UiIcon name="search" size={14} />
            <input
              type="search"
              value={categoryWords}
              placeholder="Search control categories…"
              aria-label="Search control categories"
              onChange={(event) => setCategoryWords(event.target.value)}
            />
          </label>
          <fieldset>
            <legend>Filter by category</legend>
            {view.categories.map((item) => (
              <label key={item.key} className="sc-category">
                <input
                  type="checkbox"
                  checked={categories.includes(item.key)}
                  onChange={() =>
                    setCategories((current) =>
                      current.includes(item.key)
                        ? current.filter((key) => key !== item.key)
                        : [...current, item.key],
                    )
                  }
                />
                <span>{item.label}</span>
                <small>{item.count}</small>
              </label>
            ))}
          </fieldset>
          <fieldset className="mc-sources">
            <legend>Filter by source</legend>
            {view.sources.map((item) => (
              <label key={item.key} className="sc-category">
                <input
                  type="checkbox"
                  checked={sources.includes(item.key)}
                  onChange={() =>
                    setSources((current) =>
                      current.includes(item.key)
                        ? current.filter((key) => key !== item.key)
                        : [...current, item.key],
                    )
                  }
                />
                <span>{item.label}</span>
                <small>{item.count}</small>
              </label>
            ))}
          </fieldset>
          {rcm ? (
            <OpenScopeAction
              event={RCM_UPLOAD_EVENT}
              label="Upload client RCM"
              icon="upload"
              className="btn-secondary mc-rcm"
            />
          ) : null}
        </aside>
      }
      footer={
        <>
          {problem !== null ? (
            <p className="as-problem" role="alert">
              {problem}
            </p>
          ) : (
            <span className="sc-count">
              {chosen.length} control{chosen.length === 1 ? "" : "s"} selected
            </span>
          )}
          <span className="as-foot-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || chosen.length === 0}
              onClick={() => void add()}
            >
              {busy
                ? "Mapping…"
                : chosen.length === 0
                  ? "Map controls"
                  : `Map ${chosen.length} control${chosen.length === 1 ? "" : "s"}`}
              <UiIcon name="arrow" size={14} />
            </button>
          </span>
        </>
      }
    >
      {targets.length === 0 ? (
        <p className="as-hint">
          Add a system or a business process first: controls are selected for
          one of them.
        </p>
      ) : (
        <div className="mc-grid">
          <section className="mc-available" aria-labelledby={`${id}-available`}>
            <h3 id={`${id}-available`} className="mc-eyebrow">
              Available controls
            </h3>
            {target?.kind === "system" ? (
              <div className="mc-advice" role="status">
                <span className="mc-advice-icon" aria-hidden="true">
                  <UiIcon name="sparkles" size={15} />
                </span>
                {reviewing ? (
                  <span className="mc-advice-text">
                    <strong>The agent is reviewing {name}…</strong>
                    <small>
                      Its recommendations appear here when it finishes.
                    </small>
                  </span>
                ) : advised === null || advised.state === "NONE" ? (
                  <>
                    <span className="mc-advice-text">
                      <strong>No recommendations yet</strong>
                      <small>
                        The agent can recommend the controls that apply to{" "}
                        {name}, from its details and any SOC 1 report uploaded
                        for it.
                      </small>
                    </span>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => void ask()}
                    >
                      Ask the agent
                    </button>
                  </>
                ) : (
                  <>
                    <span className="mc-advice-text">
                      <strong>
                        {view.recommended === 0 && view.potential === 0
                          ? "Nothing more to recommend"
                          : `${view.recommended} recommended${view.potential > 0 ? `, ${view.potential} potentially applicable` : ""}`}
                      </strong>
                      <small>
                        {adviceSourceLine(advised.source, name)}
                        {advised.cuecs > 0
                          ? ` It used the ${advised.cuecs} CUEC${advised.cuecs === 1 ? "" : "s"} in the uploaded SOC 1 report.`
                          : ""}{" "}
                        Accept them or choose your own.
                      </small>
                    </span>
                    {advised.source === "FALLBACK" ? (
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => void ask()}
                      >
                        Ask the agent again
                      </button>
                    ) : null}
                    <label className="sc-all">
                      <input
                        type="checkbox"
                        checked={recommendedOnly}
                        onChange={() => setRecommendedOnly((value) => !value)}
                      />
                      Recommended only
                    </label>
                    <button
                      type="button"
                      className="btn-sm"
                      disabled={view.recommended === 0}
                      onClick={() =>
                        setChosen((current) =>
                          acceptRecommended(current, all, advised),
                        )
                      }
                    >
                      Accept recommended
                    </button>
                  </>
                )}
              </div>
            ) : null}
            <div className="sc-tools">
              <label className="as-search">
                <UiIcon name="search" size={14} />
                <input
                  type="search"
                  value={typed}
                  placeholder="Search by control ID or name…"
                  aria-label="Search controls"
                  onChange={(event) => setTyped(event.target.value)}
                />
              </label>
              <select
                className="mc-category"
                aria-label="Category"
                value={view.categoryChoice}
                onChange={(event) =>
                  setCategories(pickCategory(all, event.target.value))
                }
              >
                <option value="ALL">All categories</option>
                {view.categoryChoice === "SOME" ? (
                  <option value="SOME" disabled>
                    Selected categories
                  </option>
                ) : null}
                {view.allCategories.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
              <label className="sc-all">
                <input
                  type="checkbox"
                  checked={view.allChosen}
                  disabled={view.open.length === 0}
                  onChange={() =>
                    setChosen((current) => toggleVisible(current, view))
                  }
                />
                Select all visible
              </label>
            </div>
            {options === null ? (
              <p className="as-loading" aria-live="polite">
                <span className="ng-orb is-small" aria-hidden="true" />
                Reading the library…
              </p>
            ) : (
              <div className="st-scroll">
                <table className="st-table sc-table">
                  <thead>
                    <tr>
                      <th scope="col">
                        <input
                          type="checkbox"
                          aria-label="Select all visible"
                          checked={view.allChosen}
                          disabled={view.open.length === 0}
                          onChange={() =>
                            setChosen((current) => toggleVisible(current, view))
                          }
                        />
                      </th>
                      <th scope="col">Control ID</th>
                      <th scope="col">Control name</th>
                      <th scope="col">Category</th>
                      <th scope="col">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.shown.map((item) => (
                      <tr
                        key={item.libraryKey}
                        className={
                          item.inScope
                            ? "is-in"
                            : chosen.includes(item.libraryKey)
                              ? "is-picked"
                              : undefined
                        }
                        // The whole row picks the control; Shift picks a range.
                        onClick={(event) => {
                          if (item.inScope) {
                            return;
                          }
                          setChosen((current) =>
                            clickRow(
                              current,
                              view.shown,
                              item.libraryKey,
                              anchor.current,
                              event.shiftKey,
                            ),
                          );
                          anchor.current = item.libraryKey;
                        }}
                      >
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${item.controlRef}`}
                            checked={
                              item.inScope || chosen.includes(item.libraryKey)
                            }
                            disabled={item.inScope}
                            // The row's click, which this click reaches, changes it.
                            onChange={() => undefined}
                          />
                        </td>
                        <td className="mono">{item.controlRef}</td>
                        <td>
                          {item.title}
                          {advised?.byKey[item.libraryKey] !== undefined ? (
                            <small className="mc-why">
                              <span className="pill tone-ai">
                                {advised.byKey[item.libraryKey]?.status ===
                                "RECOMMENDED"
                                  ? "Recommended"
                                  : "Potentially applicable"}
                              </span>
                              {[
                                advised.byKey[item.libraryKey]?.rationale ?? "",
                                (advised.byKey[item.libraryKey]?.cuecs.length ??
                                  0) > 0
                                  ? `Answers ${advised.byKey[item.libraryKey]?.cuecs.join(", ")}`
                                  : "",
                              ]
                                .filter((part) => part !== "")
                                .join(" · ")}
                            </small>
                          ) : null}
                        </td>
                        <td>
                          <span className="pill tone-info mc-tag">
                            {selectionCategory(item.domain).key}
                          </span>
                        </td>
                        <td>
                          {item.inScope ? (
                            <span className="st-status is-in">
                              <i aria-hidden="true" />
                              In scope
                            </span>
                          ) : (
                            <span className="as-tag">Standard</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {view.shown.length === 0 ? (
                  <p className="st-none">
                    No control matches the categories and the search.
                  </p>
                ) : null}
              </div>
            )}
          </section>
          <aside className="mc-selected" aria-labelledby={`${id}-selected`}>
            <h3 id={`${id}-selected`}>
              Selected controls
              <span className="mc-badge">{view.selected.length}</span>
            </h3>
            {view.selected.length === 0 ? (
              <p className="mc-empty">
                Tick controls in the list to map them to {name}.
              </p>
            ) : (
              <ul>
                {view.selected.map((item) => (
                  <li key={item.libraryKey}>
                    <span>
                      <strong className="mono">{item.controlRef}</strong>
                      <small>{item.title}</small>
                    </span>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      aria-label={`Remove ${item.controlRef}`}
                      onClick={() => toggle(item.libraryKey)}
                    >
                      <UiIcon name="x" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mc-note">
              <UiIcon name="info" size={14} />
              <span>
                {finalized
                  ? `Mapping links controls to ${name}. Each control added gets its work at once.`
                  : `Mapping links controls to ${name}. Testing will not start until the scope is finalized.`}
              </span>
            </p>
          </aside>
        </div>
      )}
    </Drawer>
  );
}

const RCM_STEPS = [
  "Upload file",
  "Map columns",
  "Review matches",
  "Select controls",
];

/** The RCM flow's four steps (SP5), as a list beside its content. */
export function RcmSteps({ now }: { now: number }) {
  return (
    <ol className="as-steps rcm-steps" aria-label="Steps">
      {RCM_STEPS.map((label, at) => (
        <li
          key={label}
          className={at === now ? "is-now" : at < now ? "is-done" : ""}
          aria-current={at === now ? "step" : undefined}
        >
          <span className="as-step-mark" aria-hidden="true">
            {at < now ? <UiIcon name="check" size={12} /> : at + 1}
          </span>
          {label}
        </li>
      ))}
    </ol>
  );
}

/**
 * Upload the client's RCM (decided by the product owner, SP5): the file dropped or
 * chosen, then sent; its columns are mapped, its matches reviewed, and its controls
 * imported on the page that follows. An alternative to selecting controls, never a
 * prerequisite for adding systems.
 */
export function RcmUpload({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const drawer = useDrawer(RCM_UPLOAD_EVENT);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!drawer.open) {
    return null;
  }
  const close = () => {
    setFile(null);
    drawer.close();
  };
  const take = (chosen: File | null | undefined) => {
    if (chosen === null || chosen === undefined) {
      return;
    }
    setFile(chosen);
    // The form sends what its input holds: a dropped file is put there too.
    if (input.current !== null) {
      const transfer = new DataTransfer();
      transfer.items.add(chosen);
      input.current.files = transfer.files;
    }
  };
  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setOver(false);
    take(event.dataTransfer.files[0]);
  };
  return (
    <Drawer
      title="Upload client's RCM"
      icon="upload"
      busy={busy}
      onClose={close}
      aside={<RcmSteps now={0} />}
      footer={
        <>
          <span className="sc-count">
            {file === null ? "No file chosen" : file.name}
          </span>
          <span className="as-foot-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || file === null}
              onClick={() => {
                setBusy(true);
                form.current?.requestSubmit();
              }}
            >
              {busy ? "Uploading…" : "Next"}
              <UiIcon name="arrow" size={14} />
            </button>
          </span>
        </>
      }
    >
      <form
        ref={form}
        method="post"
        action="/workspace/setup/rcm-upload"
        encType="multipart/form-data"
        autoComplete="off"
      >
        <input type="hidden" name="organization_id" value={organizationId} />
        <input type="hidden" name="project_id" value={projectId} />
        <label
          htmlFor={`${id}-file`}
          className={`rcm-drop${over ? " is-over" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <span className="rcm-drop-icon" aria-hidden="true">
            <UiIcon name="upload" size={22} />
          </span>
          <strong>Drag and drop the file here</strong>
          <span>or choose a file to upload</span>
          <span className="btn btn-sm">Choose file</span>
          <small>Supported formats: Excel (.xlsx), CSV (.csv)</small>
          <input
            ref={input}
            id={`${id}-file`}
            className="sr-only"
            type="file"
            name="content"
            accept=".xlsx,.xlsm,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => take(event.target.files?.[0])}
          />
        </label>
      </form>
      <p className="as-note">
        <UiIcon name="info" size={14} />
        The client&apos;s matrix is read in its own format and terms. Its
        columns are matched to the firm&apos;s next, then its controls are
        reviewed before any is imported.
      </p>
    </Drawer>
  );
}

/**
 * Review and finalize (decided by the product owner, SP6): the scope as it stands, what
 * deserves a look, and the one action that starts the engagement's work for everything
 * in scope. Shown as success only once the server has confirmed it.
 */
export function FinalizeScope({
  organizationId,
  projectId,
  review,
  policies,
  canFinalize,
  planningHref,
  controlsHref = null,
}: {
  organizationId: string;
  projectId: string;
  review: ScopeReview;
  /** The policies and procedures in use. */
  policies: number;
  canFinalize: boolean;
  /** Where the scope goes next once it is finalized: Planning. */
  planningHref: string;
  /** The Controls page, where the controls row's Edit leads. */
  controlsHref?: string | null;
}) {
  const drawer = useDrawer(FINALIZE_EVENT);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  if (!drawer.open) {
    return null;
  }
  // Edit leaves the review for the tab that holds what is edited.
  const edit = (pane: string) => {
    if (pane === "controls" && controlsHref !== null) {
      window.location.assign(controlsHref);
      return;
    }
    drawer.close();
    document.dispatchEvent(new CustomEvent(SHOW_PANE_EVENT, { detail: pane }));
  };
  const close = () => {
    if (done) {
      startTransition(() => router.refresh());
      setDone(false);
    }
    drawer.close();
  };
  const plural = (count: number, one: string, many = `${one}s`) =>
    `${count} ${count === 1 ? one : many}`;
  const rows: Array<{
    pane: string;
    icon: IconName;
    label: string;
    detail: string;
  }> = [
    {
      pane: "systems",
      icon: "server",
      label: "Systems",
      detail: `${plural(review.totals.systems, "system")} in scope`,
    },
    {
      pane: "processes",
      icon: "layers",
      label: "Processes",
      detail: `${plural(review.totals.processes, "process", "processes")} in scope`,
    },
    {
      pane: "policies",
      icon: "file",
      label: "Policies & procedures",
      detail: `${plural(policies, "document")} in use`,
    },
    {
      pane: "controls",
      icon: "shield",
      label: "Controls",
      detail: `${plural(review.totals.controls, "control")} in scope`,
    },
  ];
  if (done) {
    // The server confirmed it: the scope is final and planning can start.
    return (
      <Drawer
        title="Review and finalize"
        icon="check"
        busy={false}
        onClose={close}
        compact
        footer={
          <>
            <span className="sc-count">
              Work created for every control in scope
            </span>
            <span className="as-foot-actions">
              <button type="button" className="btn-secondary" onClick={close}>
                Stay here
              </button>
              <a className="btn" href={planningHref}>
                Go to Planning
                <UiIcon name="arrow" size={14} />
              </a>
            </span>
          </>
        }
      >
        <section className="fz-ready" role="status">
          <span className="fz-ready-mark" aria-hidden="true">
            <UiIcon name="check" size={20} />
          </span>
          <div>
            <h3>Scope ready for planning</h3>
            <p>
              {plural(review.totals.controls, "control is", "controls are")}{" "}
              approved for this engagement. The planning agent prepares their
              test plans for review.
            </p>
          </div>
        </section>
      </Drawer>
    );
  }
  async function finalize() {
    setBusy(true);
    setProblem(null);
    const { status } = await call({
      organization_id: organizationId,
      project_id: projectId,
      intent: "scope-finalize",
      ...review.totals,
    });
    setBusy(false);
    if (status !== 200) {
      setProblem(
        status === 409
          ? "The scope changed since this review, or it is already final. Refresh to see it as it stands."
          : status === 403
            ? "Only the engagement's managers can finalize the scope."
            : "The scope could not be finalized. Try again.",
      );
      return;
    }
    setDone(true);
  }
  const blocked =
    review.blocked ??
    (canFinalize
      ? null
      : "Only the engagement's managers can finalize the scope.");
  return (
    <Drawer
      title="Review and finalize"
      icon="check"
      busy={busy}
      onClose={drawer.close}
      footer={
        <>
          {problem !== null ? (
            <p className="as-problem" role="alert">
              {problem}
            </p>
          ) : (
            <span className="sc-count">
              {blocked ?? "The work starts for every control in scope."}
            </span>
          )}
          <span className="as-foot-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={drawer.close}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || blocked !== null}
              onClick={() => void finalize()}
            >
              {busy ? "Finalizing…" : "Confirm scope and start planning"}
            </button>
          </span>
        </>
      }
    >
      <p className="as-hint">Confirm the scope and start planning.</p>
      <ul className="fz-rows" aria-label="Scope">
        {rows.map((row) => (
          <li key={row.pane}>
            <span className={`fz-row-icon is-${row.pane}`} aria-hidden="true">
              <UiIcon name={row.icon} size={16} />
            </span>
            <span className="fz-row-text">
              <strong>{row.label}</strong>
              <small>{row.detail}</small>
            </span>
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={busy}
              onClick={() => edit(row.pane)}
            >
              Edit
            </button>
          </li>
        ))}
      </ul>
      <dl className="as-review">
        {review.byArea.map((area) => (
          <div key={area.area}>
            <dt>{area.label}</dt>
            <dd>{area.controls}</dd>
          </div>
        ))}
      </dl>
      {review.notes.length > 0 ? (
        <section className="fz-notes" aria-label="To look at">
          <h4>Worth a look before finalizing</h4>
          <ul>
            {review.notes.map((note) => (
              <li key={note}>
                <UiIcon name="info" size={13} />
                {note}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="as-note">
        <UiIcon name="info" size={14} />
        Finalizing creates each control&apos;s walkthrough, evidence request,
        test, and review. Evidence requests are drafted for approval: nothing is
        sent to the client until an approver confirms it. Later scope changes
        update the work at once.
      </p>
    </Drawer>
  );
}
