"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { AddSystemWizard } from "./add-system-wizard";
import { SYSTEM_SAVED_EVENT } from "./controls-guide-model";
import {
  APPLICABILITY_LABELS,
  type Applicability,
  applySuggestion,
  basisLabel,
  type Candidate,
  CONTROL_CATEGORIES,
  candidateAreas,
  candidateSections,
  chooseAll,
  type DetailField,
  type DetailSuggestion,
  initialSelection,
  LAYERS,
  needsReason,
  parseSuggestion,
  type SetupSystem,
  suggestedCode,
  suggestionSummary,
  systemNamed,
  systemNameKey,
  wizardProblem,
} from "./onboarding-model";
import { SocAssessment, SocReports, SocUpload } from "./soc-view";
import { UiIcon } from "./ui-icon";

type Props = {
  organizationId: string;
  projectId: string;
  /** Common systems not yet in scope, to pick a name from. */
  knownSystems: Array<{ name: string; layer: string; category: string }>;
  /** Every system in scope now, as the page last loaded it. */
  systems: SetupSystem[];
  editable: boolean;
  /** Open on an existing system's controls rather than adding a new one. */
  system?: SetupSystem;
  /** The button's words in place of "Add system", such as the first system's. */
  label?: string;
  /** Anything on the page can open the wizard by raising this event. */
  openEvent?: string;
};

type Step = 1 | 2 | 3;
type Details = {
  name: string;
  layer: string;
  description: string;
  purpose: string;
  processes: string;
  owner: string;
  /** The system's code in the client's control references; empty takes the suggestion. */
  refCode: string;
};

const DOMAIN_LABELS: Record<string, string> = Object.fromEntries(
  CONTROL_CATEGORIES.flatMap((category) =>
    category.domains.map(([key, label]) => [key, label] as [string, string]),
  ),
);
const DOMAIN_ORDER = ["ACCESS", "CHANGE", "OPERATIONS", "ITAC", "IPE"];
const STATUS_TONE: Record<Applicability, string> = {
  RECOMMENDED: "is-recommended",
  POTENTIAL: "is-potential",
  NOT_RECOMMENDED: "is-not",
  JUDGMENT: "is-judgment",
};

/**
 * Adding a system: its details, then the controls that apply to it (chosen by hand, or
 * recommended by the agent with the magic wand), then a review before the selection is
 * saved. Nothing joins or leaves scope until Save. The wizard keeps its own selections
 * while the page refreshes underneath it.
 */
export function SystemWizard(props: Props) {
  const [open, setOpen] = useState(false);
  const { openEvent } = props;
  useEffect(() => {
    if (openEvent === undefined) {
      return;
    }
    const show = () => setOpen(true);
    document.addEventListener(openEvent, show);
    return () => document.removeEventListener(openEvent, show);
  }, [openEvent]);
  if (!props.editable) {
    return null;
  }
  return (
    <>
      {props.system === undefined ? (
        <button
          type="button"
          className={props.label === undefined ? "btn-sm" : "btn"}
          onClick={() => setOpen(true)}
        >
          <UiIcon name="plus" size={14} /> {props.label ?? "Add system"}
        </button>
      ) : (
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => setOpen(true)}
        >
          <UiIcon name="wand" size={13} /> Review controls
        </button>
      )}
      {open && props.system === undefined ? (
        <AddSystemWizard
          organizationId={props.organizationId}
          projectId={props.projectId}
          knownSystems={props.knownSystems}
          systems={props.systems}
          onClose={() => setOpen(false)}
        />
      ) : open ? (
        <Wizard {...props} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function Wizard({
  organizationId,
  projectId,
  knownSystems,
  systems,
  system: existing,
  onClose,
}: Props & { onClose: () => void }) {
  const router = useRouter();
  const id = useId();
  const [, startTransition] = useTransition();
  const [step, setStep] = useState<Step>(existing === undefined ? 1 : 2);
  const [systemId, setSystemId] = useState<string | null>(existing?.id ?? null);
  const [created, setCreated] = useState(false);
  const [details, setDetails] = useState<Details>({
    name: existing?.name ?? "",
    layer: existing?.layer ?? "APPLICATION",
    description: existing?.description ?? "",
    purpose: existing?.purpose ?? "",
    processes: existing?.processes ?? "",
    owner: existing?.owner ?? "",
    refCode: existing?.refCode ?? "",
  });
  const [selected, setSelected] = useState<Record<string, boolean> | null>(
    null,
  );
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [onlyRecommended, setOnlyRecommended] = useState(false);
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const live = systems.find((item) => item.id === systemId) ?? null;
  const assessment = live?.assessment ?? null;
  const candidates = assessment?.candidates ?? [];
  const working =
    assessment !== null &&
    (assessment.status === "PENDING" || assessment.status === "WORKING");

  // The page refreshes while the agent works; the wizard keeps its own selections.
  useEffect(() => {
    if (!working) {
      return;
    }
    const timer = window.setInterval(
      () => startTransition(() => router.refresh()),
      2500,
    );
    return () => window.clearInterval(timer);
  }, [working, router]);

  // The starting selection once the system's controls are known; new candidates join
  // with what they are now, and a person's choices are never changed for them.
  useEffect(() => {
    if (candidates.length === 0) {
      return;
    }
    setSelected((current) => {
      const start = initialSelection(candidates, created);
      if (current === null) {
        return start;
      }
      const missing = Object.keys(start).filter((ref) => !(ref in current));
      return missing.length === 0
        ? current
        : {
            ...current,
            ...Object.fromEntries(
              missing.map((ref) => [ref, start[ref] === true]),
            ),
          };
    });
  }, [candidates, created]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && busy === "") {
        void cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function call(
    intent: string,
    extra: Record<string, unknown> = {},
    target: string | null = systemId,
  ): Promise<{ ok: boolean; onboarding: unknown }> {
    setBusy(intent);
    setProblem(null);
    let status = 0;
    let detail = "";
    let onboarding: unknown = null;
    try {
      const response = await fetch("/workspace/system-wizard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: organizationId,
          project_id: projectId,
          system_id: target ?? "",
          intent,
          ...extra,
        }),
      });
      const body = (await response.json()) as {
        status?: unknown;
        detail?: unknown;
        onboarding?: unknown;
      };
      status = typeof body.status === "number" ? body.status : 0;
      detail = typeof body.detail === "string" ? body.detail : "";
      onboarding = body.onboarding ?? null;
    } catch {
      status = 0;
    }
    setBusy("");
    const message = wizardProblem(status, detail);
    setProblem(message);
    if (message === null) {
      startTransition(() => router.refresh());
    }
    return { ok: message === null, onboarding };
  }

  async function saveDetails() {
    const name = details.name.trim();
    if (name === "") {
      setProblem("Name the system.");
      return;
    }
    let target = systemId;
    if (target === null) {
      // A system already in scope is opened from the list, never added twice.
      if (systemNamed(systems, name) !== undefined) {
        setProblem(SYSTEM_IN_SCOPE);
        return;
      }
      const known = knownSystems.find(
        (item) => systemNameKey(item.name) === systemNameKey(name),
      );
      const made = await call(
        known === undefined ? "create" : "known",
        known === undefined
          ? { name, layer: details.layer }
          : { name: known.name },
        null,
      );
      if (!made.ok) {
        return;
      }
      target = findSystem(made.onboarding, known?.name ?? name);
      if (target === null) {
        setProblem(SYSTEM_IN_SCOPE);
        return;
      }
      setSystemId(target);
      // Only a system this wizard added goes again on Cancel; one already in scope
      // (added in another tab meanwhile) is never removed from here.
      setCreated(!systems.some((item) => item.id === target));
    }
    const saved = await call(
      "details",
      {
        description: details.description,
        purpose: details.purpose,
        processes: details.processes,
        owner: details.owner,
        ref_code: details.refCode,
      },
      target,
    );
    if (saved.ok) {
      setStep(2);
    }
  }

  async function cancel() {
    // A system added in this wizard and never saved goes again.
    if (created && systemId !== null) {
      await call("remove");
    }
    onClose();
  }

  async function save() {
    if (selected === null) {
      return;
    }
    const missing = needsReason(candidates, selected, notes);
    if (missing.length > 0) {
      setStep(3);
      setProblem(
        `Say why ${missing.length === 1 ? "this recommended control is" : "these recommended controls are"} not selected: ${missing.join(", ")}.`,
      );
      return;
    }
    const result = await call("save", {
      selections: candidates.map((item) => ({
        control_ref: item.controlRef,
        selected: selected[item.controlRef] === true,
        note: notes[item.controlRef] ?? "",
      })),
    });
    if (result.ok) {
      document.dispatchEvent(new Event(SYSTEM_SAVED_EVENT));
      onClose();
    }
  }

  const shown = onlyRecommended
    ? candidates.filter((item) => item.status === "RECOMMENDED")
    : candidates;
  const sections = candidateSections(shown, details.name);
  const recommended = candidates.filter(
    (item) => item.status === "RECOMMENDED",
  );
  const chosen = candidates.filter(
    (item) => selected?.[item.controlRef] === true,
  );
  const against = candidates.filter(
    (item) =>
      item.status === "RECOMMENDED" && selected?.[item.controlRef] !== true,
  );

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: a click on the backdrop cancels; Escape and Cancel do too.
    <div
      className="sw-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && busy === "") {
          void cancel();
        }
      }}
    >
      <section
        className="sw"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <header className="sw-head">
          <div>
            <p className="sw-eyebrow">
              {existing === undefined ? "Add a system" : "Review controls"}
            </p>
            <h2 id={`${id}-title`}>{details.name.trim() || "New system"}</h2>
          </div>
          <ol className="sw-steps" aria-label="Steps">
            {["System", "Controls", "Review"].map((label, index) => (
              <li
                key={label}
                className={
                  step === index + 1
                    ? "is-current"
                    : step > index + 1
                      ? "is-done"
                      : ""
                }
              >
                <span>{index + 1}</span> {label}
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="btn-ghost btn-sm sw-close"
            aria-label="Close"
            disabled={busy !== ""}
            onClick={() => void cancel()}
          >
            <UiIcon name="x" size={16} />
          </button>
        </header>

        <div className="sw-body">
          {step === 1 ? (
            <DetailsStep
              id={id}
              organizationId={organizationId}
              projectId={projectId}
              systemId={systemId}
              details={details}
              setDetails={setDetails}
              knownSystems={knownSystems}
              existingNames={systems.map((item) => item.name)}
              naming={systemId === null}
              busy={busy}
              setBusy={setBusy}
            />
          ) : step === 2 ? (
            <section className="sw-controls" aria-labelledby={`${id}-controls`}>
              <div className="sw-controls-head">
                <h3 id={`${id}-controls`}>Select applicable controls</h3>
                <button
                  type="button"
                  className="btn-secondary btn-sm sw-wand"
                  title="Recommend applicable controls with AI"
                  disabled={working || busy !== ""}
                  onClick={() => void call("assess")}
                >
                  <UiIcon name="wand" size={14} />
                  {working
                    ? "Assessing…"
                    : assessment?.source === "NONE" || assessment === null
                      ? "Recommend controls"
                      : "Recommend again"}
                </button>
              </div>
              {working ? (
                <p className="sys-working">
                  <i aria-hidden="true" />
                  The agent is assessing {details.name}. Your selections stay as
                  they are; recommendations appear beside them.
                </p>
              ) : assessment !== null && assessment.source !== "NONE" ? (
                <div className="sw-summary">
                  <p>{assessment.summary}</p>
                  {assessment.note !== "" ? (
                    <p className="form-hint">{assessment.note}</p>
                  ) : null}
                  <div className="sw-summary-actions">
                    <button
                      type="button"
                      className="btn-sm"
                      disabled={recommended.length === 0}
                      onClick={() =>
                        setSelected((current) => ({
                          ...(current ?? {}),
                          ...Object.fromEntries(
                            recommended.map((item) => [item.controlRef, true]),
                          ),
                        }))
                      }
                    >
                      Select all {recommended.length} recommended
                    </button>
                    <label className="sw-filter">
                      <input
                        type="checkbox"
                        checked={onlyRecommended}
                        onChange={(event) =>
                          setOnlyRecommended(event.target.checked)
                        }
                      />
                      Show recommended only
                    </label>
                  </div>
                </div>
              ) : (
                <p className="form-hint">
                  Choose the controls that apply, or use the magic wand to have
                  the agent recommend them from what is known about{" "}
                  {details.name}. Recommendations are suggestions until you
                  save.
                </p>
              )}
              {candidates.length > 0 ? (
                // Where the controls are, how many are chosen in each area, and a way
                // to move straight to one: it stays in view while the list scrolls.
                <nav className="sw-areas" aria-label="Control areas">
                  <span className="sw-areas-count" role="status">
                    {chosen.length} of{" "}
                    {new Set(candidates.map((item) => item.controlRef)).size}{" "}
                    selected
                  </span>
                  {candidateAreas(candidates, selected, DOMAIN_ORDER).map(
                    (area) => (
                      <button
                        key={area.domain}
                        type="button"
                        className={`sw-area${area.chosen > 0 ? " has-chosen" : ""}`}
                        onClick={(event) =>
                          moveTo(
                            event.currentTarget,
                            `${id}-area-${area.domain}`,
                          )
                        }
                      >
                        {DOMAIN_LABELS[area.domain] ?? area.domain}
                        <span className="num">
                          {area.chosen}/{area.total}
                        </span>
                      </button>
                    ),
                  )}
                </nav>
              ) : null}
              {candidates.length === 0 ? (
                <p className="form-hint">
                  No IT controls are loaded yet. Load the library or upload the
                  client's RCM first; you can still save the system now.
                </p>
              ) : (
                sections.map((section) => (
                  <section
                    key={section.origin}
                    className="sw-source"
                    aria-label={section.label}
                  >
                    {sections.length > 1 ? (
                      <header className="sw-source-head">
                        <h4>
                          {section.label}{" "}
                          <span className="num">{section.items.length}</span>
                        </h4>
                        {section.note !== "" ? (
                          <p className="form-hint">{section.note}</p>
                        ) : null}
                      </header>
                    ) : null}
                    {DOMAIN_ORDER.map((domain) => ({
                      domain,
                      items: section.items.filter(
                        (item) => item.domain === domain,
                      ),
                    }))
                      .filter((group) => group.items.length > 0)
                      .map((group) => (
                        <fieldset
                          key={group.domain}
                          className="sw-group"
                          // The area bar moves to the first section holding the area.
                          id={
                            sections.find((other) =>
                              other.items.some(
                                (item) => item.domain === group.domain,
                              ),
                            ) === section
                              ? `${id}-area-${group.domain}`
                              : undefined
                          }
                        >
                          <legend>
                            <span>
                              {DOMAIN_LABELS[group.domain] ?? group.domain}
                            </span>
                            <button
                              type="button"
                              className="btn-ghost btn-sm sw-group-all"
                              onClick={() =>
                                setSelected((current) =>
                                  chooseAll(
                                    current,
                                    group.items,
                                    !group.items.every(
                                      (item) =>
                                        current?.[item.controlRef] === true,
                                    ),
                                  ),
                                )
                              }
                            >
                              {group.items.every(
                                (item) => selected?.[item.controlRef] === true,
                              )
                                ? "Clear"
                                : `Select all ${group.items.length}`}
                            </button>
                          </legend>
                          <ul>
                            {group.items.map((item) => (
                              <ControlRow
                                key={item.controlRef}
                                item={item}
                                checked={selected?.[item.controlRef] === true}
                                onChange={(value) =>
                                  setSelected((current) => ({
                                    ...(current ?? {}),
                                    [item.controlRef]: value,
                                  }))
                                }
                              />
                            ))}
                          </ul>
                        </fieldset>
                      ))}
                  </section>
                ))
              )}
            </section>
          ) : live !== null ? (
            <section className="sw-review" aria-label="Review">
              <div className="sw-block">
                <h3>System overview</h3>
                <dl className="cc-def-list">
                  <dt>Purpose</dt>
                  <dd>{details.purpose || "Not given"}</dd>
                  <dt>Processes</dt>
                  <dd>{details.processes || "Not given"}</dd>
                  <dt>Owner</dt>
                  <dd>{details.owner || "Not given"}</dd>
                  {assessment !== null && assessment.assumptions.length > 0 ? (
                    <>
                      <dt>Assumptions</dt>
                      <dd>
                        <ul className="sw-list">
                          {assessment.assumptions.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      </dd>
                    </>
                  ) : null}
                  {assessment !== null && assessment.questions.length > 0 ? (
                    <>
                      <dt>Open questions</dt>
                      <dd>
                        <ul className="sw-list">
                          {assessment.questions.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      </dd>
                    </>
                  ) : null}
                </dl>
              </div>
              <div className="sw-block">
                <h3>
                  Selected controls <span className="num">{chosen.length}</span>
                </h3>
                {chosen.length === 0 ? (
                  <p className="form-hint">
                    No control is selected, so nothing would be tested for{" "}
                    {details.name}.
                  </p>
                ) : (
                  <p className="sw-chosen">
                    {chosen.map((item) => (
                      <span key={item.controlRef} className="sw-chip">
                        {item.controlRef}
                      </span>
                    ))}
                  </p>
                )}
                {against.length > 0 ? (
                  <div className="sw-reasons">
                    <p className="form-hint">
                      The agent recommended these, and they are not selected.
                      Say why for each.
                    </p>
                    {against.map((item) => (
                      <label key={item.controlRef} className="sw-reason">
                        <span>
                          <strong>{item.controlRef}</strong> {item.title}
                        </span>
                        <input
                          autoComplete="off"
                          value={notes[item.controlRef] ?? ""}
                          maxLength={500}
                          placeholder="Why it does not apply, or who tests it instead"
                          onChange={(event) =>
                            setNotes({
                              ...notes,
                              [item.controlRef]: event.target.value,
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="sw-block">
                <h3>SOC 1 assessment</h3>
                <SocAssessment system={live} />
                <SocReports
                  ids={{ organizationId, projectId }}
                  reports={live.socReports}
                  editable
                />
                <SocUpload
                  ids={{ organizationId, projectId }}
                  system={live}
                  editable
                />
              </div>
            </section>
          ) : null}
          {problem !== null ? (
            <p className="cc-problem" role="alert">
              {problem}
            </p>
          ) : null}
        </div>

        <footer className="sw-foot">
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={busy !== ""}
            onClick={() => void cancel()}
          >
            Cancel
          </button>
          <span className="sw-spacer" />
          {step > 1 ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy !== ""}
              onClick={() => setStep((step - 1) as Step)}
            >
              Back
            </button>
          ) : null}
          {step === 1 ? (
            <button
              type="button"
              className="btn-sm"
              disabled={busy !== ""}
              onClick={() => void saveDetails()}
            >
              {busy !== "" && busy !== "suggest"
                ? "Saving…"
                : "Save and continue"}
            </button>
          ) : step === 2 ? (
            <button
              type="button"
              className="btn-sm"
              disabled={busy !== "" || live === null}
              onClick={() => setStep(3)}
            >
              Review
            </button>
          ) : (
            <button
              type="button"
              className="btn-sm"
              disabled={busy !== "" || candidates.length === 0}
              onClick={() => void save()}
            >
              {busy === "save" ? "Saving…" : "Save selection"}
            </button>
          )}
        </footer>
      </section>
    </div>,
    document.body,
  );
}

const SYSTEM_IN_SCOPE =
  "That system is already in scope. Open it from the list instead.";

function findSystem(onboarding: unknown, name: string): string | null {
  if (typeof onboarding !== "object" || onboarding === null) {
    return null;
  }
  const applications = (onboarding as { applications?: unknown }).applications;
  if (!Array.isArray(applications)) {
    return null;
  }
  const found = applications.find(
    (item): item is { id: string; name: string } =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as { name?: unknown }).name === "string" &&
      systemNameKey((item as { name: string }).name) === systemNameKey(name),
  );
  return found === undefined ? null : found.id;
}

// A box grows with its text, such as a suggested purpose, up to five lines.
function rowsFor(value: string): number {
  return Math.min(5, Math.max(2, Math.ceil(value.length / 100)));
}

function DetailsStep({
  id,
  organizationId,
  projectId,
  systemId,
  details,
  setDetails,
  knownSystems,
  existingNames,
  naming,
  busy,
  setBusy,
}: {
  id: string;
  organizationId: string;
  projectId: string;
  systemId: string | null;
  details: Details;
  setDetails: (value: Details) => void;
  knownSystems: Array<{ name: string; layer: string; category: string }>;
  existingNames: string[];
  naming: boolean;
  busy: string;
  setBusy: (value: string) => void;
}) {
  // The fields the agent filled and no person has changed since, with where each came
  // from; and whether a person chose the kind, which a suggestion then leaves alone.
  const [suggested, setSuggested] = useState<DetailSuggestion | null>(null);
  const [filled, setFilled] = useState<DetailField[]>([]);
  const [status, setStatus] = useState("");
  const [layerChosen, setLayerChosen] = useState(!naming);
  const set = (key: keyof Details) => (value: string) => {
    setDetails({ ...details, [key]: value });
    setFilled((current) => current.filter((field) => field !== key));
  };
  const taken = useMemo(
    () => new Set(existingNames.map(systemNameKey)),
    [existingNames],
  );

  async function suggest() {
    setBusy("suggest");
    setStatus("");
    let suggestion: DetailSuggestion | null = null;
    try {
      const response = await fetch("/workspace/system-wizard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: organizationId,
          project_id: projectId,
          system_id: systemId ?? "",
          intent: "suggest",
          name: details.name.trim(),
          layer: layerChosen ? details.layer : "",
        }),
      });
      const body = (await response.json()) as {
        status?: unknown;
        onboarding?: unknown;
      };
      suggestion =
        body.status === 200 ? parseSuggestion(body.onboarding) : null;
    } catch {
      suggestion = null;
    }
    setBusy("");
    if (suggestion === null) {
      setStatus(
        "Suggestions are not available right now. Enter the details manually.",
      );
      return;
    }
    const applied = applySuggestion(details, suggestion, layerChosen);
    setDetails(applied.details);
    setSuggested(suggestion);
    setFilled((current) => [
      ...current.filter((field) => !applied.filled.includes(field)),
      ...applied.filled,
    ]);
    setStatus(suggestionSummary(suggestion, applied.filled.length));
  }

  const note = (field: DetailField) =>
    filled.includes(field) ? (
      <span className="form-hint sw-suggested">
        <UiIcon name="wand" size={12} />
        {basisLabel(suggested?.basis[field])}
      </span>
    ) : null;

  return (
    <section className="sw-details" aria-label="System details">
      <div className="sw-details-head">
        <button
          type="button"
          className="btn-secondary btn-sm sw-wand"
          title="Suggest the empty fields with AI from what is known of the system and the engagement's records"
          disabled={busy !== "" || details.name.trim() === ""}
          onClick={() => void suggest()}
        >
          <UiIcon name="wand" size={14} />
          {busy === "suggest" ? "Suggesting…" : "Suggest details"}
        </button>
      </div>
      {status !== "" ? (
        <p className="sw-suggest-status" role="status">
          {status}
        </p>
      ) : null}
      <div className="sw-grid">
        <label htmlFor={`${id}-name`}>
          System name
          <input
            autoComplete="off"
            id={`${id}-name`}
            list={`${id}-known`}
            value={details.name}
            maxLength={120}
            disabled={!naming}
            placeholder="For example: Workday"
            onChange={(event) => {
              const name = event.target.value;
              const known = knownSystems.find(
                (item) => item.name.toLowerCase() === name.trim().toLowerCase(),
              );
              setDetails({
                ...details,
                name,
                layer: known?.layer ?? details.layer,
              });
            }}
          />
          <datalist id={`${id}-known`}>
            {knownSystems
              .filter((item) => !taken.has(systemNameKey(item.name)))
              .map((item) => (
                <option key={item.name} value={item.name} />
              ))}
          </datalist>
          {naming && taken.has(systemNameKey(details.name)) ? (
            <span className="form-hint sw-taken" role="status">
              {SYSTEM_IN_SCOPE}
            </span>
          ) : null}
        </label>
        <label htmlFor={`${id}-layer`}>
          Kind
          <select
            id={`${id}-layer`}
            value={details.layer}
            disabled={!naming}
            onChange={(event) => {
              setLayerChosen(true);
              set("layer")(event.target.value);
            }}
          >
            {LAYERS.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          {note("layer")}
        </label>
        <label htmlFor={`${id}-description`} className="sw-wide">
          Description
          <textarea
            autoComplete="off"
            id={`${id}-description`}
            rows={rowsFor(details.description)}
            maxLength={500}
            value={details.description}
            placeholder="What the system does for the client"
            onChange={(event) => set("description")(event.target.value)}
          />
          {note("description")}
        </label>
        <label htmlFor={`${id}-purpose`} className="sw-wide">
          Business purpose
          <textarea
            autoComplete="off"
            id={`${id}-purpose`}
            rows={rowsFor(details.purpose)}
            maxLength={1000}
            value={details.purpose}
            placeholder="Why it matters to financial reporting, for example: calculates and pays payroll"
            onChange={(event) => set("purpose")(event.target.value)}
          />
          {note("purpose")}
        </label>
        <label htmlFor={`${id}-processes`}>
          Processes it supports
          <input
            autoComplete="off"
            id={`${id}-processes`}
            maxLength={500}
            value={details.processes}
            placeholder="For example: Hire to retire"
            onChange={(event) => set("processes")(event.target.value)}
          />
          {note("processes")}
        </label>
        <label htmlFor={`${id}-owner`}>
          System owner
          <input
            autoComplete="off"
            id={`${id}-owner`}
            maxLength={200}
            value={details.owner}
            placeholder="For example: HRIS Manager"
            onChange={(event) => set("owner")(event.target.value)}
          />
          {note("owner")}
        </label>
        <label htmlFor={`${id}-code`}>
          Reference code
          <input
            autoComplete="off"
            id={`${id}-code`}
            maxLength={8}
            value={details.refCode}
            placeholder={suggestedCode(details.name)}
            aria-describedby={`${id}-code-hint`}
            onChange={(event) =>
              setDetails({
                ...details,
                refCode: event.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, ""),
              })
            }
          />
          <span id={`${id}-code-hint`} className="form-hint">
            The system's code in the client's control references. A control
            adapted from another system takes it, for example ITGC-
            {details.refCode || suggestedCode(details.name)}-02.
          </span>
        </label>
      </div>
    </section>
  );
}

/** Scrolls the list to an area, its heading just clear of the area bar above it. */
function moveTo(from: HTMLElement, targetId: string) {
  const target = document.getElementById(targetId);
  const list = from.closest(".sw-body");
  const bar = from.closest<HTMLElement>(".sw-areas");
  if (target === null || list === null || bar === null) {
    return;
  }
  // Where the bar sits once it sticks: at the top of the list.
  list.scrollTop +=
    target.getBoundingClientRect().top -
    (list.getBoundingClientRect().top + bar.offsetHeight) -
    8;
}

function ControlRow({
  item,
  checked,
  onChange,
}: {
  item: Candidate;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const more =
    item.description !== "" ||
    item.support !== "" ||
    item.missing !== "" ||
    item.adaptedFrom.length > 0;
  return (
    <li
      className={`sw-row${checked ? " is-checked" : ""}${open ? " is-open" : ""}`}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label htmlFor={id} className="sw-row-body">
        <span className="sw-row-head">
          <strong>{item.controlRef}</strong> {item.title}
          {item.status !== null ? (
            <>
              <span className={`sw-badge ${STATUS_TONE[item.status]}`}>
                {APPLICABILITY_LABELS[item.status]}
              </span>
              {item.source === "AGENT" ? (
                <span className="ai-mark" title="Proposed by the agent">
                  <UiIcon name="sparkles" size={11} />
                  Agent
                </span>
              ) : item.source === "RULES" ? (
                <span
                  className="ai-mark is-rules"
                  title="Proposed by the standard checks"
                >
                  Standard checks
                </span>
              ) : null}
            </>
          ) : null}
          {item.decision !== null ? (
            <span className="sw-decided">
              {item.decision === "SELECTED" ? "Selected" : "Not selected"} by{" "}
              {item.decidedBy ?? "the team"}
            </span>
          ) : null}
        </span>
        {item.description !== "" ? (
          <span className="sw-row-text">{item.description}</span>
        ) : null}
        {item.adaptedFrom.length > 0 ? (
          <span className="sw-row-from">
            Adapted from {item.adaptedFrom.join(", ")}
            {item.follows !== "" ? ` · Standard ${item.follows}` : ""}
          </span>
        ) : null}
        {item.rationale !== "" ? (
          <span className="sw-row-why">
            <span>
              {item.rationale}
              {item.confidence !== null
                ? ` (${item.confidence.toLowerCase()} confidence)`
                : ""}
            </span>
            {open && item.support !== "" ? (
              <span className="sw-row-note">
                <b>Based on</b> {item.support}
              </span>
            ) : null}
            {open && item.missing !== "" ? (
              <span className="sw-row-note">
                <b>To confirm</b> {item.missing}
              </span>
            ) : null}
          </span>
        ) : null}
      </label>
      {more ? (
        <button
          type="button"
          className="btn-ghost btn-sm sw-row-more"
          aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} details: ${item.controlRef}`}
          onClick={() => setOpen(!open)}
        >
          {open ? "Less" : "Details"}
        </button>
      ) : null}
    </li>
  );
}
