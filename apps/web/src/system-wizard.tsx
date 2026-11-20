"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
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
  initialNotes,
  initialSelection,
  isReason,
  LAYERS,
  leftOutReasons,
  needsReason,
  parseSuggestion,
  reasonFacts,
  reasonPlan,
  recordedReasons,
  type SetupSystem,
  suggestedCode,
  suggestionSummary,
  systemNamed,
  systemNameKey,
  wizardProblem,
} from "./onboarding-model";
import { impactHref } from "./setup-impact-model";
import { SocAssessment, SocReports, SocUpload } from "./soc-view";
import { refusalFrom } from "./trial-model";
import { UiIcon } from "./ui-icon";
import { isTopmostDialog, useFocusTrap } from "./use-focus-trap";
import { SuggestedAnswer } from "./value-options";

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
  const box = useRef<HTMLElement>(null);
  // Tab stays inside the wizard; Escape closes only the topmost dialog.
  useFocusTrap(box);
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
  // One reason for the other controls of each area left out that need one
  // (reasonNeeded), by area, copied into each one's note on save (reasonPlan).
  const [areaNotes, setAreaNotes] = useState<Record<string, string>>({});
  // A save was tried: each reason field still missing says so beside itself.
  const [tried, setTried] = useState(false);
  const [onlyRecommended, setOnlyRecommended] = useState(false);
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  // What is on record for the in-scope controls the selection takes out, read once on
  // the Review step (and again after the API finds work on record), by control.
  const [impact, setImpact] = useState<{
    key: string;
    state: "loading" | "ready" | "failed";
    onRecord: ReadonlySet<string>;
    lines: ReadonlyMap<string, string[]>;
  } | null>(null);
  const [impactRound, setImpactRound] = useState(0);
  const latestImpact = useRef(0);

  const live = systems.find((item) => item.id === systemId) ?? null;
  const assessment = live?.assessment ?? null;
  const reasonOptions = useMemo(
    () => leftOutReasons(live?.socReports ?? []),
    [live],
  );
  const candidates = assessment?.candidates ?? [];
  const working =
    assessment !== null &&
    (assessment.status === "PENDING" || assessment.status === "WORKING");
  // The system's own in-scope controls this selection takes out.
  const removing = useMemo(
    () =>
      candidates.filter(
        (item) =>
          item.controlId !== null &&
          item.inScope &&
          selected !== null &&
          selected[item.controlRef] !== true,
      ),
    [candidates, selected],
  );
  const removingKey = removing
    .map((item) => `${item.controlRef}:${item.controlId}`)
    .join(",");
  const impactNow =
    impact !== null && impact.key === `${removingKey}#${impactRound}`
      ? impact
      : null;
  const impactLoading =
    removing.length > 0 &&
    (impactNow === null || impactNow.state === "loading");
  const onRecord: ReadonlySet<string> = impactNow?.onRecord ?? new Set();

  // Reasons already on record for controls still left out come back with the selection,
  // so a later save keeps them.
  useEffect(() => {
    if (candidates.length === 0) {
      return;
    }
    setNotes((current) => ({ ...initialNotes(candidates), ...current }));
  }, [candidates]);

  // The impact of taking those controls out, read before the selection is saved. A failed
  // read asks the reason for each of them (fail closed); a late answer is ignored.
  useEffect(() => {
    if (step !== 3 || removing.length === 0) {
      return;
    }
    const key = `${removingKey}#${impactRound}`;
    if (impact?.key === key) {
      return;
    }
    const ask = latestImpact.current + 1;
    latestImpact.current = ask;
    setImpact({ key, state: "loading", onRecord: new Set(), lines: new Map() });
    const targets = removing.map((item) => ({
      ref: item.controlRef,
      id: item.controlId ?? "",
    }));
    void Promise.all(
      targets.map(async (target) => {
        const response = await fetch(
          impactHref(organizationId, projectId, {
            kind: "control",
            id: target.id,
          }),
        );
        if (!response.ok) {
          throw new Error("impact unavailable");
        }
        const body = (await response.json()) as {
          material?: unknown;
          lines?: unknown;
        };
        if (typeof body.material !== "boolean") {
          throw new Error("impact unavailable");
        }
        const lines = Array.isArray(body.lines)
          ? body.lines.filter(
              (line): line is string => typeof line === "string",
            )
          : [];
        return { ref: target.ref, material: body.material, lines };
      }),
    ).then(
      (answers) => {
        if (ask !== latestImpact.current) {
          return;
        }
        const material = answers.filter((answer) => answer.material);
        setImpact({
          key,
          state: "ready",
          onRecord: new Set(material.map((answer) => answer.ref)),
          lines: new Map(material.map((answer) => [answer.ref, answer.lines])),
        });
      },
      () => {
        if (ask !== latestImpact.current) {
          return;
        }
        setImpact({
          key,
          state: "failed",
          onRecord: new Set(targets.map((target) => target.ref)),
          lines: new Map(),
        });
      },
    );
  }, [
    step,
    removingKey,
    impactRound,
    impact?.key,
    organizationId,
    projectId,
    removing,
  ]);

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
      if (
        event.key === "Escape" &&
        busy === "" &&
        isTopmostDialog(box.current)
      ) {
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
  ): Promise<{ ok: boolean; onboarding: unknown; detail: string }> {
    setBusy(intent);
    setProblem(null);
    let status = 0;
    let detail = "";
    let onboarding: unknown = null;
    let refusal: ReturnType<typeof refusalFrom> = null;
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
        refusal?: unknown;
      };
      status = typeof body.status === "number" ? body.status : 0;
      detail = typeof body.detail === "string" ? body.detail : "";
      onboarding = body.onboarding ?? null;
      refusal = refusalFrom(status, body.refusal);
    } catch {
      status = 0;
    }
    setBusy("");
    const message = wizardProblem(status, detail, refusal);
    setProblem(message);
    if (message === null) {
      startTransition(() => router.refresh());
    }
    return { ok: message === null, onboarding, detail };
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

  // The reason fields of the Review step: one per recommended control left out, one per
  // area for the others.
  const reasonId = (ref: string) => `${id}-why-${ref}`;
  const areaId = (domain: string) => `${id}-why-area-${domain}`;

  async function save() {
    if (selected === null || live === null || impactLoading) {
      return;
    }
    const plan = reasonPlan(
      candidates,
      selected,
      notes,
      areaNotes,
      reasonFacts(live),
      onRecord,
      DOMAIN_ORDER,
    );
    if (!plan.complete) {
      // Each field still missing a reason says so beside itself; the first takes focus.
      setStep(3);
      setProblem(null);
      setTried(true);
      const first =
        plan.recommended[0] !== undefined
          ? reasonId(plan.recommended[0])
          : areaId(plan.areas.find((area) => !area.valid)?.domain ?? "");
      requestAnimationFrame(() => document.getElementById(first)?.focus());
      return;
    }
    const result = await call("save", {
      selections: candidates.map((item) => ({
        control_ref: item.controlRef,
        selected: selected[item.controlRef] === true,
        note: plan.filled[item.controlRef] ?? "",
      })),
    });
    if (result.ok) {
      document.dispatchEvent(new Event(SYSTEM_SAVED_EVENT));
      onClose();
    } else if (result.detail === "say why: this has work on record") {
      // Work reached a control since the impact was read: read it again, so the reason
      // is asked for it.
      setImpactRound((round) => round + 1);
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
  // Every control left out, and how the Review step treats each: a recommended control
  // has its own field (`against`), the others that need a reason one field per area
  // (`plan.areas`), a reason already on record is shown with Edit (`recorded`), and the
  // rest need none (`unasked`).
  const leftOut = [
    ...new Set(
      candidates
        .filter((item) => selected?.[item.controlRef] !== true)
        .map((item) => item.controlRef),
    ),
  ];
  const plan =
    live === null || selected === null
      ? null
      : reasonPlan(
          candidates,
          selected,
          notes,
          areaNotes,
          reasonFacts(live),
          onRecord,
          DOMAIN_ORDER,
        );
  const recorded =
    selected === null
      ? []
      : recordedReasons(candidates, selected, notes, DOMAIN_ORDER);
  // The controls a reason would be asked for with none on record: a recorded reason can
  // be edited only where one stays required, so Edit never drops it.
  const askable = new Set(
    live === null || selected === null
      ? []
      : needsReason(candidates, selected, {}, reasonFacts(live), onRecord),
  );
  const asked = new Set([
    ...against.map((item) => item.controlRef),
    ...(plan?.areas ?? []).flatMap((area) => area.refs),
    ...recorded.flatMap((entry) => entry.refs),
  ]);
  const unasked = leftOut.filter((ref) => !asked.has(ref));
  const linesOf = (ref: string) => impactNow?.lines.get(ref) ?? [];
  const areaLabel = (domain: string) => DOMAIN_LABELS[domain] ?? domain;

  function editRecorded(entry: {
    domain: string;
    note: string;
    refs: string[];
  }) {
    // The controls go back to their area's field, holding the reason on record.
    setNotes((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([ref]) => !entry.refs.includes(ref)),
      ),
    );
    setAreaNotes((current) => ({
      ...current,
      [entry.domain]:
        (current[entry.domain] ?? "").trim() === ""
          ? entry.note
          : (current[entry.domain] ?? ""),
    }));
    requestAnimationFrame(() =>
      document.getElementById(areaId(entry.domain))?.focus(),
    );
  }

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
        ref={box}
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
                  organization's RCM first; you can still save the system now.
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
              </div>
              {leftOut.length > 0 ? (
                <div className="sw-block">
                  <h3>
                    Not selected <span className="num">{leftOut.length}</span>
                  </h3>
                  {impactLoading ? (
                    <p className="form-hint sw-checking" role="status">
                      <span className="spinner small" aria-hidden="true" />
                      Checking the work on record for the controls this
                      selection takes out of scope…
                    </p>
                  ) : impactNow?.state === "failed" ? (
                    <div className="sw-why-foot">
                      <p className="form-hint">
                        The work on record could not be checked, so a reason is
                        needed for each control this selection takes out.
                      </p>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => setImpactRound((round) => round + 1)}
                      >
                        Check again
                      </button>
                    </div>
                  ) : against.length > 0 || (plan?.areas.length ?? 0) > 0 ? (
                    <p className="form-hint">
                      Say why these controls are not selected. The reason is
                      recorded in the audit trail.
                    </p>
                  ) : null}
                  {against.length > 0 ? (
                    <div className="sw-reasons">
                      <p className="form-hint">
                        The agent recommended these, and they are not selected.
                        Say why for each.
                      </p>
                      {against.map((item) => {
                        const field = reasonId(item.controlRef);
                        const bad = tried && !isReason(notes[item.controlRef]);
                        const lines = linesOf(item.controlRef);
                        return (
                          <div key={item.controlRef} className="sw-reason">
                            <label htmlFor={field}>
                              <strong>{item.controlRef}</strong> {item.title}
                            </label>
                            <SuggestedAnswer
                              id={field}
                              single
                              multiline
                              maxLength={500}
                              value={notes[item.controlRef] ?? ""}
                              options={reasonOptions}
                              placeholder="Why it does not apply, or who tests it instead"
                              error={bad ? REASON_ERROR : null}
                              onChange={(value) =>
                                setNotes((current) => ({
                                  ...current,
                                  [item.controlRef]: value,
                                }))
                              }
                            />
                            {lines.length > 0 ? (
                              <ul className="sw-list sw-impact">
                                {lines.map((line) => (
                                  <li key={line}>{line}</li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  {(plan?.areas ?? []).map((area) => {
                    const field = areaId(area.domain);
                    const bad = tried && !area.valid;
                    const lines = area.refs.flatMap((ref) =>
                      linesOf(ref).map((line) => `${ref}: ${line}`),
                    );
                    return (
                      <fieldset key={area.domain} className="sw-why">
                        <legend className="sw-why-head">
                          {areaLabel(area.domain)}{" "}
                          <span className="num">{area.refs.length}</span>
                        </legend>
                        <ChipList refs={area.refs} />
                        {lines.length > 0 ? (
                          <ul className="sw-list sw-impact">
                            {lines.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        ) : null}
                        <div className="sw-reason">
                          <label htmlFor={field}>
                            Why{" "}
                            {area.refs.length === 1
                              ? "this control is"
                              : `these ${area.refs.length} controls are`}{" "}
                            not selected
                          </label>
                          <SuggestedAnswer
                            id={field}
                            single
                            multiline
                            maxLength={500}
                            value={areaNotes[area.domain] ?? ""}
                            options={reasonOptions}
                            placeholder="Pick a suggestion or write the reason"
                            error={bad ? REASON_ERROR : null}
                            onChange={(value) =>
                              setAreaNotes((current) => ({
                                ...current,
                                [area.domain]: value,
                              }))
                            }
                          />
                        </div>
                      </fieldset>
                    );
                  })}
                  {recorded.map((entry) => (
                    <div
                      key={`${entry.domain}-${entry.note}`}
                      className="sw-why"
                    >
                      <p className="sw-why-head">
                        {areaLabel(entry.domain)}{" "}
                        <span className="num">{entry.refs.length}</span>
                      </p>
                      <ChipList refs={entry.refs} />
                      <div className="sw-why-foot">
                        <p className="sw-why-note">
                          <b>Reason recorded</b>
                          {entry.note}
                        </p>
                        {entry.refs.every((ref) => askable.has(ref)) ? (
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            aria-label={`Edit the reason recorded for ${areaLabel(entry.domain)}`}
                            onClick={() => editRecorded(entry)}
                          >
                            Edit
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {unasked.length > 0 ? (
                    <div className="sw-reasons">
                      <p className="form-hint">
                        No reason is needed for{" "}
                        {unasked.length === 1
                          ? "this control"
                          : `these ${unasked.length} controls`}
                        .
                      </p>
                      <ChipList refs={unasked} />
                    </div>
                  ) : null}
                </div>
              ) : null}
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
              disabled={busy !== "" || candidates.length === 0 || impactLoading}
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
            placeholder="What the system does for the organization"
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
            The system's code in the organization's control references. A
            control adapted from another system takes it, for example ITGC-
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

const CHIPS_SHOWN = 12;
const REASON_ERROR = "Give a reason of at least 3 characters.";

/** Controls left out, outlined so they never read as the selected ones; past twelve, the
 * rest open on request. */
function ChipList({ refs }: { refs: readonly string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? refs : refs.slice(0, CHIPS_SHOWN);
  return (
    <p className="sw-chosen is-out">
      {shown.map((ref) => (
        <span key={ref} className="sw-chip">
          {ref}
        </span>
      ))}
      {refs.length > CHIPS_SHOWN ? (
        <button
          type="button"
          className="sw-chip sw-chip-more"
          aria-expanded={all}
          onClick={() => setAll(!all)}
        >
          {all ? "Show fewer" : `and ${refs.length - CHIPS_SHOWN} more`}
        </button>
      ) : null}
    </p>
  );
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
  // A decision's reason shows on the row, two lines until the row is opened.
  const note = item.decision !== null ? item.decisionNote.trim() : "";
  // Measured once the clamped line is drawn (it is drawn again when the note changes): a
  // note longer than its two lines opens with the row.
  const [longNote, setLongNote] = useState(false);
  const measureNote = useCallback((box: HTMLSpanElement | null) => {
    if (box !== null) {
      setLongNote(box.scrollHeight > box.clientHeight + 1);
    }
  }, []);
  const more =
    item.description !== "" ||
    item.support !== "" ||
    item.missing !== "" ||
    item.adaptedFrom.length > 0 ||
    longNote;
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
          {item.decision !== null && note === "" ? (
            <span className="sw-decided">
              {item.decision === "SELECTED" ? "Selected" : "Not selected"} by{" "}
              {item.decidedBy ?? "the team"}
            </span>
          ) : null}
        </span>
        {note !== "" ? (
          <span
            key={note}
            ref={measureNote}
            className={`sw-row-decision${open ? "" : " is-clamped"}`}
          >
            {item.decision === "SELECTED" ? "Selected" : "Not selected"} by{" "}
            {item.decidedBy ?? "the team"}: {note}
          </span>
        ) : null}
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
