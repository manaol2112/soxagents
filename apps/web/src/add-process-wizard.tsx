"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { ADD_PROCESS_EVENT, PROCESS_SAVED_EVENT } from "./controls-guide-model";
import {
  type AreaSuggestions,
  CONTROL_AREAS,
  type ControlArea,
  LAYERS,
  PROCESS_CYCLES,
  parseAreaSuggestions,
  type SetupProcess,
  type SetupSystem,
} from "./onboarding-model";
import { DiscardBar } from "./scope-actions";
import { type IconName, UiIcon } from "./ui-icon";

type Step = 1 | 2 | 3 | 4;

const STEPS: ReadonlyArray<[Step, string]> = [
  [1, "Details"],
  [2, "Systems"],
  [3, "Control areas"],
  [4, "Review"],
];

const AREA_ICON: Record<ControlArea, IconName> = {
  ITGC: "shield",
  ITAC: "window",
  IPE: "table",
  BUSINESS: "layers",
};

const LAYER_LABEL: Record<string, string> = Object.fromEntries(LAYERS);
const CYCLE_LABEL: Record<string, string> = Object.fromEntries(PROCESS_CYCLES);

type Draft = {
  name: string;
  domain: string;
  description: string;
  owner: string;
  systemIds: string[];
  primary: string;
};

const EMPTY_PROCESS: Draft = {
  name: "",
  domain: "ORDER_TO_CASH",
  description: "",
  owner: "",
  systemIds: [],
  primary: "",
};

function problemFor(status: number): string {
  if (status === 409) {
    return "A process with this name is already in scope.";
  }
  if (status === 403) {
    return "Only the engagement's managers can add processes.";
  }
  if (status === 422) {
    return "One of the details could not be saved. Check them and try again.";
  }
  return "The process could not be added. Try again.";
}

/** The button that opens the Add business process wizard, and the wizard itself; the
 * page's Add menu opens it too. */
export function AddProcessButton({
  label,
  primary = false,
  ...props
}: {
  label: string;
  primary?: boolean;
  organizationId: string;
  projectId: string;
  systems: SetupSystem[];
  processes: SetupProcess[];
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    document.addEventListener(ADD_PROCESS_EVENT, show);
    return () => document.removeEventListener(ADD_PROCESS_EVENT, show);
  }, []);
  return (
    <>
      <button
        type="button"
        className={primary ? "btn" : "btn-sm"}
        onClick={() => setOpen(true)}
      >
        <UiIcon name="plus" size={14} /> {label}
      </button>
      {open ? (
        <AddProcessWizard {...props} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

/**
 * The Add business process wizard (decided by the product owner, SP3 of the Systems &
 * Processes workflow): a drawer with four steps: the process's details, the systems that
 * support it (one primary; none needed), the control areas the setup agent suggests, and a
 * review. The person approves the areas; the agent's suggestion is kept beside the
 * approval. Adding a process puts no control in scope and sends nothing.
 */
function AddProcessWizard({
  organizationId,
  projectId,
  systems,
  processes,
  onClose,
}: {
  organizationId: string;
  projectId: string;
  systems: SetupSystem[];
  processes: SetupProcess[];
  onClose: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const [, startTransition] = useTransition();
  const [step, setStep] = useState<Step>(1);
  const [draft, setDraft] = useState<Draft>(EMPTY_PROCESS);
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<AreaSuggestions | null>(null);
  const [asked, setAsked] = useState("");
  const [approved, setApproved] = useState<ControlArea[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const latest = useRef(0);

  useEffect(() => {
    first.current?.focus();
  }, []);

  // What was entered is never lost to a stray key or click: closing asks first.
  const [confirming, setConfirming] = useState(false);
  const closing = useRef<() => void>(() => undefined);
  closing.current = () => {
    if (busy) {
      return;
    }
    if (confirming) {
      setConfirming(false);
    } else if (
      JSON.stringify(draft) !== JSON.stringify(EMPTY_PROCESS) ||
      approved.length > 0
    ) {
      setConfirming(true);
    } else {
      onClose();
    }
  };
  const requestClose = () => closing.current();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closing.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  function toggleSystem(systemId: string) {
    setDraft((current) => {
      const on = current.systemIds.includes(systemId);
      const systemIds = on
        ? current.systemIds.filter((item) => item !== systemId)
        : [...current.systemIds, systemId];
      // The first system chosen is the primary one until another is made primary.
      const primary = on
        ? current.primary === systemId
          ? (systemIds[0] ?? "")
          : current.primary
        : current.primary || systemId;
      return { ...current, systemIds, primary };
    });
  }

  async function send(
    intent: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ status: number; answer: unknown }> {
    try {
      const response = await fetch("/workspace/system-wizard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: organizationId,
          project_id: projectId,
          intent,
          name: draft.name,
          domain: draft.domain,
          description: draft.description,
          owner: draft.owner,
          system_ids: draft.systemIds,
          primary_system_id: draft.primary,
          ...extra,
        }),
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

  const facts = JSON.stringify([draft.domain, [...draft.systemIds].sort()]);

  async function suggest() {
    if (asked === facts && suggestions !== null) {
      return;
    }
    const ask = latest.current + 1;
    latest.current = ask;
    setSuggestions(null);
    const { status, answer } = await send("process-areas");
    if (ask !== latest.current) {
      return;
    }
    const parsed = status === 200 ? parseAreaSuggestions(answer) : null;
    if (parsed === null) {
      setProblem(
        "The suggested areas could not be loaded. Choose the areas that apply.",
      );
    }
    setSuggestions(parsed ?? { source: "RULES", libraryVersion: 0, areas: [] });
    setAsked(facts);
  }

  function next() {
    setProblem(null);
    if (step === 1) {
      const name = draft.name.trim();
      if (name === "") {
        setProblem("Name the process.");
        return;
      }
      if (
        processes.some(
          (process) => process.name.trim().toLowerCase() === name.toLowerCase(),
        )
      ) {
        setProblem("A process with this name is already in scope.");
        return;
      }
    }
    if (step === 2) {
      void suggest();
    }
    setStep((current) => (current < 4 ? ((current + 1) as Step) : current));
  }

  async function add() {
    setBusy(true);
    setProblem(null);
    const { status } = await send("process-add", { approved_areas: approved });
    setBusy(false);
    if (status !== 200) {
      setProblem(problemFor(status));
      return;
    }
    document.dispatchEvent(new Event(PROCESS_SAVED_EVENT));
    startTransition(() => router.refresh());
    onClose();
  }

  const words = search.trim().toLowerCase();
  const listed = systems.filter(
    (system) => words === "" || system.name.toLowerCase().includes(words),
  );
  const suggested = (suggestions?.areas ?? []).filter((item) => item.suggested);
  const notApproved = suggested.filter((item) => !approved.includes(item.area));
  const systemName = (value: string) =>
    systems.find((system) => system.id === value)?.name ?? value;
  const shownName = draft.name.trim() || "the process";

  return createPortal(
    // A click outside never closes it: what was entered stays until Cancel or Close.
    <div className="as-backdrop" role="presentation">
      <section
        className="as"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <header className="as-head">
          <span className="as-head-icon is-process" aria-hidden="true">
            <UiIcon name="layers" size={16} />
          </span>
          <h2 id={`${id}-title`}>Add business process</h2>
          <button
            type="button"
            className="as-close"
            aria-label="Close"
            disabled={busy}
            onClick={requestClose}
          >
            <UiIcon name="x" size={16} />
          </button>
        </header>
        <div className="as-main">
          <ol className="as-steps" aria-label="Steps">
            {STEPS.map(([number, label]) => (
              <li
                key={number}
                className={
                  number === step ? "is-now" : number < step ? "is-done" : ""
                }
                aria-current={number === step ? "step" : undefined}
              >
                <span className="as-step-mark" aria-hidden="true">
                  {number < step ? <UiIcon name="check" size={12} /> : number}
                </span>
                {label}
              </li>
            ))}
          </ol>
          <div className="as-body">
            {step === 1 ? (
              <>
                <h3>Process details</h3>
                <div className="as-grid">
                  <label htmlFor={`${id}-name`}>
                    <span>
                      Process name <b aria-hidden="true">*</b>
                    </span>
                    <input
                      ref={first}
                      id={`${id}-name`}
                      value={draft.name}
                      maxLength={120}
                      required
                      autoComplete="off"
                      placeholder="Procure to pay"
                      onChange={(event) => set("name", event.target.value)}
                    />
                  </label>
                  <label htmlFor={`${id}-domain`}>
                    <span>
                      Based on <b aria-hidden="true">*</b>
                    </span>
                    <select
                      id={`${id}-domain`}
                      value={draft.domain}
                      onChange={(event) => set("domain", event.target.value)}
                    >
                      {PROCESS_CYCLES.map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label htmlFor={`${id}-description`} className="span-2">
                    <span>Description</span>
                    <textarea
                      id={`${id}-description`}
                      value={draft.description}
                      maxLength={500}
                      rows={3}
                      placeholder="Purchasing, receiving, and paying suppliers."
                      onChange={(event) =>
                        set("description", event.target.value)
                      }
                    />
                    <small className="as-count">
                      {draft.description.length}/500
                    </small>
                  </label>
                  <label htmlFor={`${id}-owner`}>
                    <span>Process owner</span>
                    <input
                      id={`${id}-owner`}
                      value={draft.owner}
                      maxLength={200}
                      autoComplete="off"
                      placeholder="The client's owner of the process"
                      onChange={(event) => set("owner", event.target.value)}
                    />
                  </label>
                </div>
                <p className="as-hint">
                  The cycle it is based on decides the tester, the sample sizes,
                  and the workpaper template of its controls.
                </p>
              </>
            ) : null}
            {step === 2 ? (
              <>
                <h3>Link to systems</h3>
                <p className="as-lead">
                  Select the systems that support this process.
                </p>
                {systems.length === 0 ? (
                  <p className="as-hint">
                    No system is in scope yet. Systems are added on their own,
                    from the Systems tab.
                  </p>
                ) : (
                  <>
                    <label className="as-search">
                      <UiIcon name="search" size={14} />
                      <input
                        type="search"
                        value={search}
                        placeholder="Search systems"
                        aria-label="Search systems"
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>
                    <ul className="as-systems">
                      {listed.map((system) => {
                        const on = draft.systemIds.includes(system.id);
                        return (
                          <li key={system.id} className={on ? "is-on" : ""}>
                            <label>
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => toggleSystem(system.id)}
                              />
                              <strong>{system.name}</strong>
                              <small>
                                {LAYER_LABEL[system.layer] ?? system.layer}
                              </small>
                            </label>
                            {on && draft.primary === system.id ? (
                              <span className="as-tag is-primary">Primary</span>
                            ) : on ? (
                              <button
                                type="button"
                                className="as-link"
                                onClick={() => set("primary", system.id)}
                              >
                                Make primary
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </>
            ) : null}
            {step === 3 ? (
              <>
                <h3>Control areas for {shownName}</h3>
                <p className="as-lead">
                  <span className="as-ai">
                    <UiIcon name="sparkles" size={12} />
                    Agent suggestion
                  </span>
                  Based on the cycle, the linked systems, and the firm&apos;s
                  standard library, these control areas typically apply.
                </p>
                {suggestions === null ? (
                  <p className="as-loading" aria-live="polite">
                    <span className="ng-orb is-small" aria-hidden="true" />
                    The setup agent is reading the details…
                  </p>
                ) : (
                  <>
                    <ul className="as-areas">
                      {CONTROL_AREAS.map((area) => {
                        const found = suggestions.areas.find(
                          (item) => item.area === area.id,
                        );
                        const checked = approved.includes(area.id);
                        return (
                          <li
                            key={area.id}
                            className={`is-${area.id.toLowerCase()}${checked ? " is-on" : ""}`}
                          >
                            <label>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setApproved((current) =>
                                    current.includes(area.id)
                                      ? current.filter(
                                          (item) => item !== area.id,
                                        )
                                      : [...current, area.id],
                                  )
                                }
                              />
                              <span className="as-area-icon" aria-hidden="true">
                                <UiIcon name={AREA_ICON[area.id]} size={16} />
                              </span>
                              <span className="as-area-text">
                                <strong>{area.label}</strong>
                                <small>{area.detail}</small>
                                {found !== undefined ? (
                                  <em>{found.reason}</em>
                                ) : null}
                              </span>
                              <span className="as-area-side">
                                {found?.suggested ? (
                                  <span className="as-tag is-ai">
                                    <UiIcon name="sparkles" size={11} />
                                    Suggested
                                  </span>
                                ) : (
                                  <span className="as-tag">Not suggested</span>
                                )}
                                {found !== undefined ? (
                                  <small>{found.controls} in the library</small>
                                ) : null}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                    {suggested.length > 0 ? (
                      <button
                        type="button"
                        className="as-link"
                        onClick={() =>
                          setApproved(
                            CONTROL_AREAS.map((area) => area.id).filter(
                              (area) =>
                                approved.includes(area) ||
                                suggested.some((item) => item.area === area),
                            ),
                          )
                        }
                      >
                        Select the suggested areas
                      </button>
                    ) : null}
                  </>
                )}
                <p className="as-note">
                  <UiIcon name="info" size={14} />
                  These are suggestions. Confirm the areas that apply to this
                  process: only the areas selected here are approved. No control
                  joins the scope here; controls are selected next.
                </p>
              </>
            ) : null}
            {step === 4 ? (
              <>
                <h3>Review</h3>
                <dl className="as-review">
                  <div>
                    <dt>Process</dt>
                    <dd>{draft.name.trim()}</dd>
                  </div>
                  <div>
                    <dt>Based on</dt>
                    <dd>{CYCLE_LABEL[draft.domain] ?? draft.domain}</dd>
                  </div>
                  <div>
                    <dt>Owner</dt>
                    <dd>{draft.owner.trim() || "Not stated"}</dd>
                  </div>
                  <div>
                    <dt>Systems</dt>
                    <dd>
                      {draft.systemIds.length === 0
                        ? "None linked"
                        : draft.systemIds
                            .map(
                              (item) =>
                                `${systemName(item)}${item === draft.primary ? " (primary)" : ""}`,
                            )
                            .join(", ")}
                    </dd>
                  </div>
                  {draft.description.trim() !== "" ? (
                    <div className="span-2">
                      <dt>Description</dt>
                      <dd>{draft.description.trim()}</dd>
                    </div>
                  ) : null}
                </dl>
                <section className="as-decision" aria-label="Control areas">
                  <h4>Control areas approved</h4>
                  {approved.length === 0 ? (
                    <p className="as-hint">
                      None approved. Areas can be approved later.
                    </p>
                  ) : (
                    <ul className="as-tags">
                      {CONTROL_AREAS.filter((area) =>
                        approved.includes(area.id),
                      ).map((area) => (
                        <li key={area.id} className="as-tag is-approved">
                          <UiIcon name="check" size={11} />
                          {area.label}
                        </li>
                      ))}
                    </ul>
                  )}
                  {notApproved.length > 0 ? (
                    <>
                      <h4>Suggested by the agent, not approved</h4>
                      <ul className="as-tags">
                        {notApproved.map((item) => (
                          <li key={item.area} className="as-tag">
                            {CONTROL_AREAS.find((area) => area.id === item.area)
                              ?.label ?? item.area}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </section>
                <p className="as-note">
                  <UiIcon name="info" size={14} />
                  Adding the process puts no control in scope and sends nothing.
                  Its controls are selected next, under Select controls.
                </p>
              </>
            ) : null}
          </div>
        </div>
        <footer className="as-foot">
          {confirming ? (
            <DiscardBar
              onKeep={() => setConfirming(false)}
              onDiscard={onClose}
            />
          ) : (
            <>
              {problem !== null ? (
                <p className="as-problem" role="alert">
                  {problem}
                </p>
              ) : (
                <span />
              )}
              <span className="as-foot-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={requestClose}
                >
                  Cancel
                </button>
                {step > 1 ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => {
                      setProblem(null);
                      setStep((current) => (current - 1) as Step);
                    }}
                  >
                    Back
                  </button>
                ) : null}
                {step < 4 ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={step === 3 && suggestions === null}
                    onClick={next}
                  >
                    Next
                    <UiIcon name="arrow" size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void add()}
                  >
                    {busy ? "Adding…" : "Add process"}
                  </button>
                )}
              </span>
            </>
          )}
        </footer>
      </section>
    </div>,
    document.body,
  );
}
