"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { SYSTEM_SAVED_EVENT } from "./controls-guide-model";
import {
  type AreaSuggestions,
  applySuggestion,
  basisLabel,
  CONTROL_AREAS,
  type ControlArea,
  type DetailField,
  type DetailSuggestion,
  ENVIRONMENTS,
  HOSTING_LABELS,
  LAYERS,
  parseAreaSuggestions,
  parseSuggestion,
  type SetupSystem,
  suggestionSummary,
} from "./onboarding-model";
import { DiscardBar } from "./scope-actions";
import { type KnownSystemOption, SystemNameField } from "./system-name-field";
import { type IconName, UiIcon } from "./ui-icon";

type Step = 1 | 2 | 3 | 4;

const STEPS: ReadonlyArray<[Step, string]> = [
  [1, "Details"],
  [2, "Usage & scope"],
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
const ENVIRONMENT_LABEL: Record<string, string> =
  Object.fromEntries(ENVIRONMENTS);

type Draft = {
  name: string;
  layer: string;
  description: string;
  owner: string;
  environment: string;
  purpose: string;
  hosting: string;
  processes: string;
  integrationIds: string[];
  processIds: string[];
};

const EMPTY: Draft = {
  name: "",
  layer: "APPLICATION",
  description: "",
  owner: "",
  environment: "",
  purpose: "",
  hosting: "",
  processes: "",
  integrationIds: [],
  processIds: [],
};

function problemFor(status: number): string {
  if (status === 409) {
    return "A system with this name is already in scope.";
  }
  if (status === 403) {
    return "Only the engagement's managers can add systems.";
  }
  if (status === 422) {
    return "One of the details could not be saved. Check them and try again.";
  }
  return "The system could not be added. Try again.";
}

/**
 * The Add system wizard (decided by the product owner, SP2 of the Systems & Processes
 * workflow): a drawer over the page with four steps: the system's details, how it is
 * used, the control areas the setup agent suggests from those details and the firm's
 * standard library, and a review. The person approves the areas; the agent's suggestion is
 * kept beside the approval, never as it. Nothing is saved until Add system, and adding a
 * system puts no control in scope and sends nothing: its controls are selected next.
 */
export function AddSystemWizard({
  organizationId,
  projectId,
  knownSystems,
  systems,
  onClose,
}: {
  organizationId: string;
  projectId: string;
  knownSystems: KnownSystemOption[];
  systems: SetupSystem[];
  onClose: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const [, startTransition] = useTransition();
  const [step, setStep] = useState<Step>(1);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [suggestions, setSuggestions] = useState<AreaSuggestions | null>(null);
  const [asked, setAsked] = useState("");
  const [approved, setApproved] = useState<ControlArea[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const first = useRef<HTMLButtonElement>(null);
  // Only the latest suggestion counts: an older answer arriving late is ignored.
  const latest = useRef(0);

  // The fields the agent drafted and no person has changed since, with where each came
  // from; a person's edit takes the field back.
  const [drafted, setDrafted] = useState<DetailSuggestion | null>(null);
  const [filled, setFilled] = useState<DetailField[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setFilled((current) => current.filter((field) => field !== key));
  };

  /** The agent drafts the empty details from the system's name and type, and from what
   * the engagement's records say about it. A person's entries are never replaced. */
  async function draftDetails() {
    setDrafting(true);
    setDraftNote("");
    const { status, answer } = await send("suggest", {
      layer: draft.layer,
      system_id: "",
    });
    setDrafting(false);
    const suggestion = status === 200 ? parseSuggestion(answer) : null;
    if (suggestion === null) {
      setDraftNote(
        "A draft is not available right now. Enter the details manually.",
      );
      return;
    }
    // The wizard asks no optional questions (decided by the product owner): the
    // processes a system supports are linked from the process, not drafted here.
    const applied = applySuggestion(
      draft,
      { ...suggestion, processes: "" },
      true,
    );
    setDraft(applied.details);
    setDrafted(suggestion);
    setFilled((current) => [
      ...current.filter((field) => !applied.filled.includes(field)),
      ...applied.filled,
    ]);
    setDraftNote(suggestionSummary(suggestion, applied.filled.length));
  }

  /** Under a field the agent drafted: where its text came from. */
  const draftedNote = (field: DetailField) =>
    filled.includes(field) ? (
      <span className="as-drafted">
        <UiIcon name="sparkles" size={11} />
        {basisLabel(drafted?.basis[field])}
      </span>
    ) : null;

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
      JSON.stringify(draft) !== JSON.stringify(EMPTY) ||
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

  function body(): Record<string, unknown> {
    return {
      organization_id: organizationId,
      project_id: projectId,
      name: draft.name,
      layer: draft.layer,
      description: draft.description,
      owner: draft.owner,
      environment: draft.environment,
      purpose: draft.purpose,
      hosting: draft.hosting,
      processes: draft.processes,
      integration_ids: draft.integrationIds,
      process_ids: draft.processIds,
    };
  }

  async function send(
    intent: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ status: number; answer: unknown }> {
    try {
      const response = await fetch("/workspace/system-wizard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body(), intent, ...extra }),
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

  // The agent's suggestion follows what the first two steps document.
  const facts = JSON.stringify([
    draft.layer,
    draft.hosting,
    draft.processes.trim() !== "",
    [...draft.processIds].sort(),
  ]);

  async function suggest() {
    if (asked === facts && suggestions !== null) {
      return;
    }
    const ask = latest.current + 1;
    latest.current = ask;
    setSuggestions(null);
    const { status, answer } = await send("areas");
    if (ask !== latest.current) {
      return;
    }
    const parsed = status === 200 ? parseAreaSuggestions(answer) : null;
    if (parsed === null) {
      setProblem(
        "The suggested areas could not be loaded. Choose the areas that apply.",
      );
      setSuggestions({ source: "RULES", libraryVersion: 0, areas: [] });
    } else {
      setSuggestions(parsed);
    }
    setAsked(facts);
  }

  function next() {
    setProblem(null);
    if (step === 1) {
      const name = draft.name.trim();
      if (name === "") {
        setProblem("Name the system.");
        return;
      }
      const taken = systems.some(
        (system) => system.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (taken) {
        setProblem("A system with this name is already in scope.");
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
    const { status } = await send("add", { approved_areas: approved });
    setBusy(false);
    if (status !== 200) {
      setProblem(problemFor(status));
      return;
    }
    document.dispatchEvent(new Event(SYSTEM_SAVED_EVENT));
    startTransition(() => router.refresh());
    onClose();
  }

  const suggested = (suggestions?.areas ?? []).filter((item) => item.suggested);
  const notApproved = suggested.filter((item) => !approved.includes(item.area));
  const shownName = draft.name.trim() || "the system";

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
          <span className="as-head-icon" aria-hidden="true">
            <UiIcon name="server" size={16} />
          </span>
          <h2 id={`${id}-title`}>Add system</h2>
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
                <h3>System details</h3>
                <div className="as-grid">
                  <div className="as-field">
                    <span id={`${id}-name`}>
                      System name <b aria-hidden="true">*</b>
                    </span>
                    <SystemNameField
                      labelId={`${id}-name`}
                      value={draft.name}
                      known={knownSystems}
                      triggerRef={first}
                      onChoose={(name, item) => {
                        set("name", name);
                        if (item !== null) {
                          set("layer", item.layer);
                        }
                      }}
                    />
                  </div>
                  <label htmlFor={`${id}-layer`}>
                    <span>
                      Type <b aria-hidden="true">*</b>
                    </span>
                    <select
                      id={`${id}-layer`}
                      value={draft.layer}
                      onChange={(event) => set("layer", event.target.value)}
                    >
                      {LAYERS.map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="as-field span-2">
                    <span className="as-field-head">
                      <label htmlFor={`${id}-description`}>Description</label>
                      <button
                        type="button"
                        className="as-ai-btn"
                        disabled={drafting || draft.name.trim() === ""}
                        title={
                          draft.name.trim() === ""
                            ? "Choose the system first"
                            : "Draft the empty details from what is known of the system"
                        }
                        onClick={() => void draftDetails()}
                      >
                        {drafting ? (
                          <span
                            className="ng-orb is-small"
                            aria-hidden="true"
                          />
                        ) : (
                          <UiIcon name="sparkles" size={13} />
                        )}
                        {drafting ? "Drafting…" : "Draft with AI"}
                      </button>
                    </span>
                    <textarea
                      id={`${id}-description`}
                      value={draft.description}
                      maxLength={500}
                      rows={3}
                      className={
                        filled.includes("description")
                          ? "is-drafted"
                          : undefined
                      }
                      placeholder="Core ERP system used for finance, procurement, and inventory."
                      onChange={(event) =>
                        set("description", event.target.value)
                      }
                    />
                    <span className="as-field-foot">
                      {draftedNote("description") ?? <span />}
                      <small className="as-count">
                        {draft.description.length}/500
                      </small>
                    </span>
                    {draftNote !== "" ? (
                      <p className="as-draft-note" aria-live="polite">
                        {draftNote}
                      </p>
                    ) : null}
                  </div>
                  <label htmlFor={`${id}-owner`}>
                    <span>System owner</span>
                    <input
                      id={`${id}-owner`}
                      value={draft.owner}
                      maxLength={200}
                      autoComplete="off"
                      placeholder="The client's owner of the system"
                      className={
                        filled.includes("owner") ? "is-drafted" : undefined
                      }
                      onChange={(event) => set("owner", event.target.value)}
                    />
                    {draftedNote("owner")}
                  </label>
                  <label htmlFor={`${id}-environment`}>
                    <span>Environment</span>
                    <select
                      id={`${id}-environment`}
                      value={draft.environment}
                      onChange={(event) =>
                        set("environment", event.target.value)
                      }
                    >
                      <option value="">Not stated</option>
                      {ENVIRONMENTS.map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            ) : null}
            {step === 2 ? (
              <>
                <h3>Usage &amp; scope</h3>
                <div className="as-grid">
                  <label htmlFor={`${id}-purpose`} className="span-2">
                    <span>What the system is used for</span>
                    <textarea
                      id={`${id}-purpose`}
                      value={draft.purpose}
                      maxLength={1000}
                      rows={3}
                      placeholder="Records journal entries, purchase orders, and invoices that feed the general ledger."
                      className={
                        filled.includes("purpose") ? "is-drafted" : undefined
                      }
                      onChange={(event) => set("purpose", event.target.value)}
                    />
                    {draftedNote("purpose")}
                  </label>
                  <label htmlFor={`${id}-hosting`}>
                    <span>How it is hosted</span>
                    <select
                      id={`${id}-hosting`}
                      value={draft.hosting}
                      onChange={(event) => set("hosting", event.target.value)}
                    >
                      <option value="">Not known yet</option>
                      {Object.entries(HOSTING_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
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
                  Based on the details above and the firm&apos;s standard
                  library, these control areas typically apply.
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
                  system: only the areas selected here are approved. No control
                  joins the scope here; controls are selected next.
                </p>
              </>
            ) : null}
            {step === 4 ? (
              <>
                <h3>Review</h3>
                <dl className="as-review">
                  <div>
                    <dt>System</dt>
                    <dd>
                      {draft.name.trim()} ·{" "}
                      {LAYER_LABEL[draft.layer] ?? draft.layer}
                    </dd>
                  </div>
                  <div>
                    <dt>Owner</dt>
                    <dd>{draft.owner.trim() || "Not stated"}</dd>
                  </div>
                  <div>
                    <dt>Environment</dt>
                    <dd>
                      {ENVIRONMENT_LABEL[draft.environment] ?? "Not stated"}
                    </dd>
                  </div>
                  <div>
                    <dt>Hosting</dt>
                    <dd>{HOSTING_LABELS[draft.hosting] ?? "Not known yet"}</dd>
                  </div>
                  {draft.description.trim() !== "" ? (
                    <div className="span-2">
                      <dt>Description</dt>
                      <dd>{draft.description.trim()}</dd>
                    </div>
                  ) : null}
                  {draft.purpose.trim() !== "" ? (
                    <div className="span-2">
                      <dt>Used for</dt>
                      <dd>{draft.purpose.trim()}</dd>
                    </div>
                  ) : null}
                </dl>
                <section className="as-decision" aria-label="Control areas">
                  <h4>Control areas approved</h4>
                  {approved.length === 0 ? (
                    <p className="as-hint">
                      None approved. Areas can be approved later from the
                      system.
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
                  Adding the system puts no control in scope and sends nothing.
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
                    {busy ? "Adding…" : "Add system"}
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
