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
import { AgentAvatar } from "./agent-avatar";
import {
  CONTROLS_SAVED_EVENT,
  RCM_UPLOAD_EVENT,
  SELECT_CONTROLS_EVENT,
  selectionCategory,
  workStartLine,
} from "./controls-guide-model";
import {
  acceptHeld,
  acceptRecommendedWithin,
  adviceSourceLine,
  allowanceCheck,
  type ControlAllowance,
  clickRow,
  footReason,
  libraryView,
  mapProblem,
  pickCategory,
  type SourceKey,
  type SystemAdvice,
  toggleVisible,
} from "./select-controls-model";
import { selectTargetFor } from "./system-added-model";
import { PLANS_HREF, refusalFrom, refusalWords } from "./trial-model";
import { type IconName, UiIcon } from "./ui-icon";
import { isTopmostDialog, useFocusTrap } from "./use-focus-trap";

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
        <button type="button" className="btn-danger" onClick={onDiscard}>
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
  const box = useRef<HTMLElement>(null);
  // Tab stays inside the drawer; Escape closes only the topmost dialog.
  useFocusTrap(box);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && isTopmostDialog(box.current)) {
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
        ref={box}
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

/** A refusal's words with their "explore plans" as the plans link. */
function PlansWords({ words }: { words: string }) {
  const at = words.indexOf("explore plans");
  if (at < 0) {
    return <>{words}</>;
  }
  return (
    <>
      {words.slice(0, at)}
      <a href={PLANS_HREF}>explore plans</a>
      {words.slice(at + "explore plans".length)}
    </>
  );
}

async function call(body: Record<string, unknown>): Promise<{
  status: number;
  answer: unknown;
  detail: string;
  refusal: ReturnType<typeof refusalFrom>;
}> {
  try {
    const response = await fetch("/workspace/system-wizard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const answer = (await response.json()) as {
      status?: unknown;
      detail?: unknown;
      onboarding?: unknown;
      refusal?: unknown;
    };
    const status = typeof answer.status === "number" ? answer.status : 0;
    return {
      status,
      answer: answer.onboarding ?? null,
      detail: typeof answer.detail === "string" ? answer.detail : "",
      // The subscription's refusal, as the API structured it (trial-model.ts).
      refusal: refusalFrom(status, answer.refusal),
    };
  } catch {
    return { status: 0, answer: null, detail: "", refusal: null };
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
 * it. Controls already in scope show as such. On a launched engagement each control added
 * gets its work at once; before the launch, at the launch (no finalize step since 17
 * November 2026).
 */
export function SelectControls({
  organizationId,
  projectId,
  targets,
  rcm,
  started,
  advice = {},
  allowance = null,
}: {
  organizationId: string;
  projectId: string;
  targets: Target[];
  /** Whether the client's RCM can still be uploaded: only while no control is set up. */
  rcm: boolean;
  /** Whether the engagement is launched, which decides when a control's work is created. */
  started: boolean;
  /** The agent's review of each system, by its id (adviceBySystem). */
  advice?: Record<string, SystemAdvice>;
  /** The free trial's allowance of controls for this engagement (controlAllowance);
   * null for a firm off the trial. */
  allowance?: ControlAllowance | null;
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
      rcm={rcm}
      started={started}
      advice={advice}
      allowance={allowance}
      onClose={drawer.close}
    />
  );
}

function SelectControlsDrawer({
  organizationId,
  projectId,
  targets,
  initial,
  rcm,
  started,
  advice,
  allowance,
  onClose,
}: {
  organizationId: string;
  projectId: string;
  targets: Target[];
  initial: Target | null;
  rcm: boolean;
  started: boolean;
  advice: Record<string, SystemAdvice>;
  allowance: ControlAllowance | null;
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
  // A refusal a retry cannot fix offers the plans (mapProblem).
  const [plans, setPlans] = useState(false);
  // Accept recommended said how many it left out for the trial's allowance; the line
  // stands while the selection is the one it made.
  const [accepted, setAccepted] = useState<{
    chosen: string;
    note: string;
  } | null>(null);
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
    setAccepted(null);
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
        setPlans(false);
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
  // The trial's allowance: Map is held, with the reason, while the selection passes it.
  const check =
    allowance === null ? null : allowanceCheck(allowance, view.selected);
  const held = check?.held ?? null;
  const acceptHold = acceptHeld(chosen, all, advised, allowance);
  // One reason in the footer: a refusal while shown, otherwise why Map is held.
  const reason = footReason(problem, held);
  const reasonId =
    reason === null
      ? undefined
      : `${id}-${reason === "problem" ? "problem" : "held"}`;
  const acceptNote =
    accepted !== null && accepted.chosen === chosen.join(" ")
      ? accepted.note
      : null;
  // A change to the selection clears a refusal that described the one before.
  const choose = (update: (current: string[]) => string[]) => {
    setProblem(null);
    setPlans(false);
    setChosen(update);
  };
  const toggle = (key: string) =>
    choose((current) =>
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
    setPlans(false);
    const { status, refusal } = await call({
      organization_id: organizationId,
      project_id: projectId,
      intent: "assess",
      system_id: target.id,
    });
    if (status !== 200) {
      // The AI allowance, or a trial that has ended, is said as such: a retry cannot help.
      setProblem(
        refusal !== null
          ? refusalWords(refusal)
          : "The agent could not be asked. Try again.",
      );
      setPlans(false);
      return;
    }
    setAsking(true);
    startTransition(() => router.refresh());
  }

  async function add() {
    if (target === null || chosen.length === 0 || held !== null) {
      return;
    }
    setBusy(true);
    setProblem(null);
    setPlans(false);
    const { status, detail, refusal } = await call({
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
      const said = mapProblem(status, detail, refusal);
      setProblem(said.words);
      setPlans(said.plans);
      if (refusal !== null) {
        // The allowance line reads the server's figures again.
        startTransition(() => router.refresh());
      }
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
          ? "Select controls from your library or import the organization's RCM."
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
              label="Upload the organization's RCM"
              icon="upload"
              className="btn-secondary mc-rcm"
            />
          ) : null}
        </aside>
      }
      footer={
        <>
          <span className="mc-foot-status">
            {problem !== null ? (
              <p id={`${id}-problem`} className="as-problem" role="alert">
                {plans ? <PlansWords words={problem} /> : problem}
              </p>
            ) : null}
            <span className="sc-count">
              {chosen.length} control{chosen.length === 1 ? "" : "s"} selected
              {reason === "held" ? (
                <span id={`${id}-held`} className="mc-held">
                  {held}
                </span>
              ) : null}
            </span>
          </span>
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
              // Held while the selection passes the trial's allowance: still focusable,
              // and the footer's one reason (a refusal, or why it is held) says why.
              aria-disabled={held !== null ? "true" : undefined}
              aria-describedby={reasonId}
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
            {check !== null ? (
              <div className={`mc-allowance tone-${check.tone}`}>
                <UiIcon
                  name={check.tone === "warning" ? "risk" : "info"}
                  size={14}
                />
                <span className="mc-allowance-text">
                  <strong>{check.line}</strong>
                  {acceptNote !== null ? (
                    <small id={`${id}-accept`}>{acceptNote}</small>
                  ) : acceptHold !== null && held === null ? (
                    <small id={`${id}-accept`}>{acceptHold}</small>
                  ) : null}
                </span>
                <a className="mc-allowance-link" href={PLANS_HREF}>
                  Explore plans
                </a>
              </div>
            ) : null}
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
                      // Held, with the reason under the allowance line, when the trial
                      // has room for none of the recommended controls.
                      aria-disabled={acceptHold !== null ? "true" : undefined}
                      aria-describedby={
                        acceptHold === null
                          ? undefined
                          : held !== null
                            ? reasonId
                            : `${id}-accept`
                      }
                      onClick={() => {
                        if (acceptHold !== null) {
                          return;
                        }
                        // Within the trial's allowance: as many as it has room for,
                        // and a line saying how many were left out.
                        const within = acceptRecommendedWithin(
                          chosen,
                          all,
                          advised,
                          allowance,
                        );
                        choose(() => within.chosen);
                        setAccepted(
                          within.note === null
                            ? null
                            : {
                                chosen: within.chosen.join(" "),
                                note: within.note,
                              },
                        );
                      }}
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
                  placeholder="Search controls"
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
                    choose((current) => toggleVisible(current, view))
                  }
                />
                Select all visible
              </label>
            </div>
            {options === null ? (
              <p className="as-loading" aria-live="polite">
                <AgentAvatar size={20} state="thinking" />
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
                            choose((current) => toggleVisible(current, view))
                          }
                        />
                      </th>
                      <th scope="col">Control ID</th>
                      <th scope="col">Control name</th>
                      <th scope="col">Category</th>
                      <th scope="col">Status</th>
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
                          choose((current) =>
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
                          <span className="pill mc-tag">
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
                Mapping links controls to {name}. {workStartLine(started)}
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
      title="Upload the organization's RCM"
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
        The organization&apos;s matrix is read in its own format and terms. Its
        columns are matched to the firm&apos;s next, then its controls are
        reviewed before any is imported.
      </p>
    </Drawer>
  );
}
