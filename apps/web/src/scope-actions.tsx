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
    const show = (raised: Event) =>
      setState({
        open: true,
        detail: (raised as CustomEvent<unknown>).detail ?? null,
      });
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
  icon,
  busy,
  onClose,
  aside = null,
  compact = false,
  footer,
  children,
}: {
  title: string;
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
        className={`as${aside === null ? " is-single" : ""}${compact ? " is-compact" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <header className="as-head">
          <span className="as-head-icon" aria-hidden="true">
            <UiIcon name={icon} size={16} />
          </span>
          <h2 id={`${id}-title`}>{title}</h2>
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
}: {
  organizationId: string;
  projectId: string;
  targets: Target[];
  finalized: boolean;
  /** Whether the client's RCM can still be uploaded: only while no control is set up. */
  rcm: boolean;
}) {
  const drawer = useDrawer(SELECT_CONTROLS_EVENT);
  if (!drawer.open) {
    return null;
  }
  const named = targets.find((target) => target.id === drawer.detail);
  return (
    <SelectControlsDrawer
      organizationId={organizationId}
      projectId={projectId}
      targets={targets}
      initial={named ?? targets[0] ?? null}
      finalized={finalized}
      rcm={rcm}
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
  onClose,
}: {
  organizationId: string;
  projectId: string;
  targets: Target[];
  initial: Target | null;
  finalized: boolean;
  rcm: boolean;
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
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const latest = useRef(0);

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

  const words = query.trim().toLowerCase();
  const all = options ?? [];
  const counts = new Map<string, { label: string; count: number }>();
  for (const item of all) {
    const category = selectionCategory(item.domain);
    const current = counts.get(category.key);
    counts.set(category.key, {
      label: category.label,
      count: (current?.count ?? 0) + 1,
    });
  }
  const shown = all.filter(
    (item) =>
      categories.includes(selectionCategory(item.domain).key) &&
      (words === "" ||
        `${item.controlRef} ${item.title}`.toLowerCase().includes(words)),
  );
  const open = shown.filter((item) => !item.inScope);
  const allChosen =
    open.length > 0 && open.every((item) => chosen.includes(item.libraryKey));

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
      title="Select controls"
      icon="shield"
      busy={busy}
      onClose={onClose}
      aside={
        <aside className="sc-filters" aria-label="Filters">
          <label htmlFor={`${id}-target`} className="sc-target">
            <span>For</span>
            <select
              id={`${id}-target`}
              value={target === null ? "" : `${target.kind}:${target.id}`}
              onChange={(event) =>
                setTarget(
                  targets.find(
                    (item) => `${item.kind}:${item.id}` === event.target.value,
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
          <fieldset>
            <legend>Filter by category</legend>
            {[...counts.entries()].map(([key, value]) => (
              <label key={key} className="sc-category">
                <input
                  type="checkbox"
                  checked={categories.includes(key)}
                  onChange={() =>
                    setCategories((current) =>
                      current.includes(key)
                        ? current.filter((item) => item !== key)
                        : [...current, key],
                    )
                  }
                />
                <span>{value.label}</span>
                <small>{value.count}</small>
              </label>
            ))}
          </fieldset>
          {rcm ? (
            <OpenScopeAction
              event={RCM_UPLOAD_EVENT}
              label="Upload the client's RCM"
              icon="upload"
              className="btn-secondary btn-sm"
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
              {chosen.length} selected
              {finalized
                ? " · each control added gets its work at once"
                : " · no work starts until the scope is finalized"}
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
              {busy ? "Adding…" : "Add controls"}
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
        <>
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
            <label className="sc-all">
              <input
                type="checkbox"
                checked={allChosen}
                disabled={open.length === 0}
                onChange={() =>
                  setChosen((current) =>
                    allChosen
                      ? current.filter(
                          (key) =>
                            !open.some((item) => item.libraryKey === key),
                        )
                      : [
                          ...new Set([
                            ...current,
                            ...open.map((item) => item.libraryKey),
                          ]),
                        ],
                  )
                }
              />
              Select all
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
                      <span className="sr-only">Select</span>
                    </th>
                    <th scope="col">Control ID</th>
                    <th scope="col">Control name</th>
                    <th scope="col">Category</th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((item) => (
                    <tr
                      key={item.libraryKey}
                      className={item.inScope ? "is-in" : undefined}
                    >
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${item.controlRef}`}
                          checked={
                            item.inScope || chosen.includes(item.libraryKey)
                          }
                          disabled={item.inScope}
                          onChange={() =>
                            setChosen((current) =>
                              current.includes(item.libraryKey)
                                ? current.filter(
                                    (key) => key !== item.libraryKey,
                                  )
                                : [...current, item.libraryKey],
                            )
                          }
                        />
                      </td>
                      <td className="mono">{item.controlRef}</td>
                      <td>{item.title}</td>
                      <td>{selectionCategory(item.domain).key}</td>
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
              {shown.length === 0 ? (
                <p className="st-none">
                  No control matches the categories and the search.
                </p>
              ) : null}
            </div>
          )}
        </>
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
