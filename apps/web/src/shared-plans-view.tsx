"use client";

import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";

import type { PlanningPageState } from "./load-planning";
import { planningHref, planningProblem } from "./planning-model";
import {
  approveLabel,
  CLASSIFICATION_LABELS,
  type Family,
  type FamilyGroup,
  familiesIn,
  GROUP_TITLES,
  groupItems,
  type Implementation,
  implementationsLine,
  namesSentence,
  type ScopeUnit,
  sharedPlanTitle,
  UNIT_KIND_LABELS,
  UNIT_KINDS,
  type UnitKind,
} from "./shared-plans-model";
import { UiIcon } from "./ui-icon";

type Ids = {
  organizationId: string;
  projectId: string;
  section?: "planning" | "testing";
};

/** How many controls a group shows before "Show more": a long engagement stays light. */
const PAGE = 25;

const NONE: ReadonlySet<string> = new Set();

/** Sending one planning action, and waiting for the refreshed page before saying done:
 * an approval shows success only once the server has confirmed it. */
function useSend(ids: Ids) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  // Which action the problem belongs to, so it is shown beside that action only.
  const [failed, setFailed] = useState("");
  async function send(
    label: string,
    fields: Record<string, unknown>,
  ): Promise<{ ok: boolean; body: unknown }> {
    setBusy(label);
    setProblem(null);
    setFailed(label);
    let status = 0;
    let detail = "";
    let body: unknown = null;
    try {
      const response = await fetch("/workspace/planning", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          ...fields,
        }),
      });
      const answer = (await response.json()) as {
        status?: unknown;
        detail?: unknown;
        body?: unknown;
      };
      status = typeof answer.status === "number" ? answer.status : 0;
      detail = typeof answer.detail === "string" ? answer.detail : "";
      body = answer.body ?? null;
    } catch {
      status = 0;
    }
    setBusy("");
    const message = planningProblem(status, detail);
    // Changed since it was shown (another reviewer, a revised plan): the current state is
    // fetched in place, so the person reviews what is there now without reloading.
    const conflict = status === 409;
    setProblem(
      conflict && message !== null && /Refresh/.test(message)
        ? "This control changed while you were working. It now shows the current plans; review them and approve again."
        : message,
    );
    if (message === null || conflict) {
      // The page's data again, in place: no reload, the scroll and open groups kept.
      startTransition(() => router.refresh());
    }
    return { ok: message === null, body };
  }
  return {
    send,
    busy,
    refreshing,
    problem,
    failed,
    clear: () => setProblem(null),
  };
}

/**
 * The test plans by control: each control's shared plan, reviewed once for every system
 * or unit it operates in where the plans are the same. Exceptions first: ready to approve
 * together, then the plans that differ and are reviewed on their own, then those waiting
 * for information; approved controls fold away.
 */
export function ControlsView({
  ids,
  state,
  header,
}: {
  ids: Ids;
  state: PlanningPageState | null;
  header: ReactNode;
}) {
  const families = state?.families ?? null;
  const [open, setOpen] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Controls approved and confirmed by the server, shown as approved until the page's
  // data comes back (router.refresh), so a row is never offered twice.
  const [settling, setSettling] = useState<{
    data: unknown;
    refs: ReadonlySet<string>;
  }>({ data: null, refs: new Set() });
  const settled = settling.data === families ? settling.refs : NONE;
  const action = useSend(ids);
  const opened =
    families?.families.find((family) => family.controlRef === open) ?? null;
  if (families === null) {
    return (
      <div className="page pl-page">
        {header}
        <PlansSwitch ids={ids} />
        <section className="card pl-empty">
          <h2>The test plans could not be loaded</h2>
          <p>Wait a moment and refresh the page.</p>
        </section>
      </div>
    );
  }
  return (
    <div className="page pl-page cp-page">
      {header}
      <PlansSwitch ids={ids} />
      <section
        className={`cp-summary${action.refreshing ? " is-updating" : ""}`}
        aria-label="What needs a decision"
        aria-busy={action.refreshing}
      >
        <p>
          {families.decisions === 0 ? (
            <strong>No plan waits for a decision.</strong>
          ) : (
            <>
              <strong>
                {families.decisions} decision
                {families.decisions === 1 ? "" : "s"}
              </strong>{" "}
              cover {families.plans} plan{families.plans === 1 ? "" : "s"} still
              to approve.
            </>
          )}
        </p>
        <ul className="cp-counts">
          {(["TOGETHER", "SEPARATE", "WAITING"] as const).map((group) => (
            <li key={group} className={`cp-count is-${group.toLowerCase()}`}>
              <span>{GROUP_TITLES[group].title}</span>
              <strong>{families.counts[group]}</strong>
            </li>
          ))}
        </ul>
      </section>
      {done === null ? null : (
        <p className="banner cp-done" role="status">
          <UiIcon name="check" size={16} />
          <span>{done}</span>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => setDone(null)}
          >
            Dismiss
          </button>
        </p>
      )}
      {(["TOGETHER", "SEPARATE", "WAITING", "DONE"] as const).map((group) => (
        <GroupCard
          key={group}
          ids={ids}
          group={group}
          families={familiesIn(families.families, group)}
          settled={settled}
          onOpen={setOpen}
        />
      ))}
      {opened === null ? null : (
        <FamilyDrawer
          ids={ids}
          family={opened}
          units={state?.units ?? []}
          canDecide={families.viewerCanDecide}
          action={action}
          onClose={() => {
            setOpen(null);
            action.clear();
          }}
          onApproved={(message) => {
            setSettling({
              data: families,
              refs: new Set([...settled, opened.controlRef]),
            });
            setOpen(null);
            setDone(message);
          }}
        />
      )}
    </div>
  );
}

/** By control (this view) or each plan on its own (the review queue). */
function PlansSwitch({ ids }: { ids: Ids }) {
  return (
    <nav className="segmented cp-switch" aria-label="How the plans are shown">
      <a
        href={planningHref(ids.organizationId, ids.projectId, {
          section: ids.section,
        })}
        aria-current="page"
      >
        By control
      </a>
      <a
        href={planningHref(ids.organizationId, ids.projectId, {
          section: ids.section,
          view: "each",
        })}
      >
        Each plan
      </a>
    </nav>
  );
}

function GroupCard({
  ids,
  group,
  families,
  settled,
  onOpen,
}: {
  ids: Ids;
  group: FamilyGroup;
  families: Family[];
  settled: ReadonlySet<string>;
  onOpen: (ref: string) => void;
}) {
  const [shown, setShown] = useState(PAGE);
  if (families.length === 0 && group !== "TOGETHER") {
    return null;
  }
  const body = (
    <>
      {families.length === 0 ? (
        <p className="cp-empty">Nothing is ready to approve together.</p>
      ) : (
        <ul className="cp-rows">
          {families.slice(0, shown).map((family) => (
            <FamilyRow
              key={family.controlRef}
              ids={ids}
              family={family}
              settled={settled.has(family.controlRef)}
              onOpen={() => onOpen(family.controlRef)}
            />
          ))}
        </ul>
      )}
      {families.length > shown ? (
        <button
          type="button"
          className="btn-ghost btn-sm cp-more"
          onClick={() => setShown(shown + PAGE)}
        >
          Show {Math.min(PAGE, families.length - shown)} more of{" "}
          {families.length - shown}
        </button>
      ) : null}
    </>
  );
  const head = (
    <>
      <span className="cp-group-title">
        {GROUP_TITLES[group].title}
        <span className="view-count">{families.length}</span>
      </span>
      <span className="cp-group-line">{GROUP_TITLES[group].line}</span>
    </>
  );
  if (group === "DONE") {
    return (
      <details className={`card cp-group is-${group.toLowerCase()}`}>
        <summary className="cp-group-head">
          {head}
          <UiIcon name="chevron" size={14} />
        </summary>
        {body}
      </details>
    );
  }
  return (
    <section className={`card cp-group is-${group.toLowerCase()}`}>
      <header className="cp-group-head">{head}</header>
      {body}
    </section>
  );
}

function Chips({ family }: { family: Family }) {
  return (
    <span className="cp-chips">
      {family.classifications.map((item) => (
        <span key={item} className="cc-badge">
          {CLASSIFICATION_LABELS[item] ?? item}
        </span>
      ))}
    </span>
  );
}

function FamilyRow({
  ids,
  family,
  settled,
  onOpen,
}: {
  ids: Ids;
  family: Family;
  settled: boolean;
  onOpen: () => void;
}) {
  const separate = family.implementations.filter(
    (row) => !row.approved && row.applicability === "DIFFERENT_PLAN",
  );
  const waiting = family.implementations.find(
    (row) => !row.approved && row.applicability === "NEEDS_INFORMATION",
  );
  return (
    <li className={`cp-row${settled ? " is-settled" : ""}`}>
      <button
        type="button"
        className="cp-row-main"
        onClick={onOpen}
        disabled={settled}
      >
        <span className="cp-row-title">
          <span className="mono">{family.controlRef}</span>
          <strong>{family.title}</strong>
        </span>
        <span className="cp-row-meta">
          <Chips family={family} />
          <span>{implementationsLine(family)}</span>
          {family.group === "SEPARATE" && separate.length > 0 ? (
            <span className="cp-row-note">
              {separate.map((row) => row.label).join(", ")} differ
              {separate.length === 1 ? "s" : ""}
            </span>
          ) : family.group === "WAITING" && waiting !== undefined ? (
            <span className="cp-row-note">{waiting.reason}</span>
          ) : null}
        </span>
      </button>
      {settled ? (
        <span className="cp-row-done">
          <UiIcon name="check" size={14} />
          Approved
        </span>
      ) : family.group === "TOGETHER" ? (
        <button type="button" className="btn btn-sm" onClick={onOpen}>
          Review
          <UiIcon name="arrow" size={13} />
        </button>
      ) : family.group === "SEPARATE" && separate[0] !== undefined ? (
        <a
          className="btn btn-secondary btn-sm"
          href={planningHref(ids.organizationId, ids.projectId, {
            section: ids.section,
            control: separate[0].controlId,
          })}
        >
          Review {separate.length === 1 ? "plan" : "first plan"}
        </a>
      ) : (
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={onOpen}
          aria-label={`Details of ${family.controlRef}`}
        >
          Details
        </button>
      )}
    </li>
  );
}

const APPLICABILITY_TONES: Record<Implementation["applicability"], string> = {
  SAME_PLAN: "tone-success",
  DIFFERENT_PLAN: "tone-warning",
  NEEDS_INFORMATION: "tone-neutral",
};

/**
 * One control: its shared plan, shown once; the systems and units it applies to; what
 * differs where it differs; where it operates; and the one decision for the plans that
 * are the same. Opens over the list and closes on Escape or the backdrop.
 */
function FamilyDrawer({
  ids,
  family,
  units,
  canDecide,
  action,
  onClose,
  onApproved,
}: {
  ids: Ids;
  family: Family;
  units: ScopeUnit[];
  canDecide: boolean;
  action: ReturnType<typeof useSend>;
  onClose: () => void;
  onApproved: (message: string) => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const [comment, setComment] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("has-dialog");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("has-dialog");
      previous?.focus();
    };
  }, [onClose]);
  const ready = family.implementations.filter((row) =>
    family.ready.includes(row.controlId),
  );
  const approving = action.busy === "approve-family";
  // Set before the first await, so a second press before the button re-renders as
  // disabled sends nothing (the API refuses a repeat as well).
  const sending = useRef(false);
  const approve = async () => {
    if (sending.current) {
      return;
    }
    sending.current = true;
    const result = await action.send("approve-family", {
      intent: "approve-family",
      control_ref: family.controlRef,
      items: groupItems(family),
      presented_hash: family.presentedHash,
      comment,
    });
    sending.current = false;
    if (result.ok) {
      onApproved(
        `${family.controlRef}: ${ready.length} plan${ready.length === 1 ? "" : "s"} approved with one decision (${ready.map((row) => row.label).join(", ")}).`,
      );
    }
  };
  // On the page itself, so no transformed parent can hold the drawer inside it.
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop closes on a click; Escape and Close do too.
    <div
      className="cp-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialog}
        className="cp-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${family.controlRef} ${family.title}`}
        tabIndex={-1}
      >
        <header className="cp-drawer-head">
          <div>
            <p className="cp-drawer-ref mono">{family.controlRef}</p>
            <h2>{family.title}</h2>
            <p className="cp-drawer-meta">
              {family.area} · <Chips family={family} />
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close"
          >
            <UiIcon name="x" size={16} />
          </button>
        </header>
        <div className="cp-drawer-body">
          <section className="cp-block">
            <h3>Applies to</h3>
            <ul className="cp-impls">
              {family.implementations.map((row) => (
                <ImplementationLine
                  key={row.controlId}
                  ids={ids}
                  row={row}
                  marked={family.implementations.length > 1}
                />
              ))}
            </ul>
          </section>
          {family.shared === null ? (
            family.group === "DONE" || family.referenceNote === "" ? null : (
              <section className="cp-block">
                <h3>No shared plan</h3>
                <p className="cp-muted">{family.referenceNote}</p>
              </section>
            )
          ) : (
            <section className="cp-block">
              <h3>
                {sharedPlanTitle(family)}
                <small>
                  {family.shared.procedures.length} procedures ·{" "}
                  {family.shared.attributes.length} attributes ·{" "}
                  {family.shared.evidence.length} evidence items
                </small>
              </h3>
              {family.referenceNote === "" ? null : (
                <p className="cp-muted">{family.referenceNote}</p>
              )}
              {(
                [
                  ["Procedures", family.shared.procedures],
                  ["Attributes", family.shared.attributes],
                  ["Evidence", family.shared.evidence],
                ] as const
              ).map(([title, items]) => (
                <details key={title} className="cp-shared">
                  <summary>
                    {title}
                    <span className="view-count">{items.length}</span>
                  </summary>
                  <ol>
                    {items.map((item) => (
                      <li key={`${title}-${item.code}`}>
                        <span className="mono">{item.code}</span> {item.text}
                      </li>
                    ))}
                  </ol>
                </details>
              ))}
              {ready[0] === undefined ? null : (
                <a
                  className="text-link cp-full"
                  href={planningHref(ids.organizationId, ids.projectId, {
                    section: ids.section,
                    control: ready[0].controlId,
                  })}
                >
                  Open the full plan
                </a>
              )}
            </section>
          )}
          <WhereItOperates
            family={family}
            units={units}
            canDecide={canDecide}
            action={action}
          />
        </div>
        <footer className="cp-drawer-foot">
          {action.problem !== null && action.failed === "approve-family" ? (
            <p className="pl-problem" role="alert">
              {action.problem}
            </p>
          ) : null}
          {ready.length === 0 ? (
            <p className="cp-foot-note">
              {family.group === "DONE"
                ? "Every plan for this control is approved."
                : "No plan is ready to approve together. Review the plans that differ on their own."}
            </p>
          ) : !canDecide ? (
            <p className="cp-foot-note">
              A reviewer with approval rights approves these plans.
            </p>
          ) : (
            <>
              <label className="cp-comment">
                <span>
                  Comment <small>(optional)</small>
                </span>
                <textarea
                  value={comment}
                  maxLength={4000}
                  rows={2}
                  onChange={(event) => setComment(event.target.value)}
                />
              </label>
              <p className="cp-foot-note">
                Approves the{" "}
                {family.referenceBasis === "LARGEST_GROUP"
                  ? "proposed shared plan"
                  : "shared plan"}{" "}
                above for {namesSentence(ready.map((row) => row.label))} Each
                keeps its own approval record.
              </p>
              <button
                type="button"
                className="btn"
                disabled={approving || action.refreshing}
                onClick={() => void approve()}
              >
                {approving ? (
                  <>
                    <span className="spinner small" aria-hidden="true" />
                    Approving…
                  </>
                ) : (
                  approveLabel(family)
                )}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function ImplementationLine({
  ids,
  row,
  marked,
}: {
  ids: Ids;
  row: Implementation;
  /** Whether to say which implementation's plan is the reference. */
  marked: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="cp-impl">
      <div className="cp-impl-line">
        <span className="cp-impl-name">
          {row.approved ? (
            <UiIcon name="check" size={14} />
          ) : (
            <span className="cp-dot" aria-hidden="true" />
          )}
          {row.label}
          {row.lead && marked ? <small>reference</small> : null}
          {row.scope.covers.length > 0 ? (
            <small>covers {row.scope.covers.join(", ")}</small>
          ) : null}
        </span>
        <span
          className={`pill pill-dot ${row.approved ? "tone-success" : APPLICABILITY_TONES[row.applicability]}`}
        >
          {row.approved ? "Approved" : row.applicabilityLabel}
        </span>
      </div>
      {!row.approved && row.applicability !== "SAME_PLAN" ? (
        <p className="cp-impl-reason">
          {row.reason}
          {row.differences.length > 0 ? (
            <button
              type="button"
              className="text-link is-plain cp-toggle"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? "Hide" : "What differs"}
            </button>
          ) : null}{" "}
          <a
            className="text-link"
            href={planningHref(ids.organizationId, ids.projectId, {
              section: ids.section,
              control: row.controlId,
            })}
          >
            Review its plan
          </a>
        </p>
      ) : null}
      {open ? (
        <ul className="cp-diffs">
          {row.differences.map((item) => (
            <li key={`${item.section}-${item.item}-${item.change}`}>
              <strong>
                {item.sectionLabel} {item.item}
              </strong>{" "}
              {item.change === "ADDED"
                ? "only in this plan"
                : item.change === "REMOVED"
                  ? "only in the shared plan"
                  : `differs${item.fields.length > 0 ? ` (${item.fields.join(", ")})` : ""}`}
              {item.change === "CHANGED" ? (
                <span className="cp-diff-pair">
                  <span>Shared: {item.shared}</span>
                  <span>Here: {item.current}</span>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Where the control operates: the units a central control covers, and, by a lead's
 * decision with its reason, operating separately per unit. Units are added here when
 * first needed; nothing has to be set up in advance.
 */
function WhereItOperates({
  family,
  units,
  canDecide,
  action,
}: {
  family: Family;
  units: ScopeUnit[];
  canDecide: boolean;
  action: ReturnType<typeof useSend>;
}) {
  const [mode, setMode] = useState<"idle" | "covers" | "split" | "add">("idle");
  const [picked, setPicked] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<UnitKind>("ENTITY");
  const [name, setName] = useState("");
  const only =
    family.implementations.length === 1 ? family.implementations[0] : undefined;
  const operatesAlready = family.implementations.some(
    (row) => row.scope.operates.length > 0,
  );
  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  const start = (next: "covers" | "split") => {
    setMode(next);
    setPicked(
      next === "covers" && only !== undefined
        ? units
            .filter((unit) => only.scope.covers.includes(unit.name))
            .map((unit) => unit.id)
        : [],
    );
    setReason("");
  };
  if (only === undefined && !operatesAlready) {
    // A control per system: its systems are chosen in setup.
    return null;
  }
  return (
    <section className="cp-block">
      <h3>Where it operates</h3>
      {only === undefined ? (
        <p className="cp-muted">
          Operates separately in{" "}
          {namesSentence(family.implementations.map((row) => row.label))}
        </p>
      ) : (
        <p className="cp-muted">
          {only.scope.covers.length > 0
            ? `Run once, covering ${namesSentence(only.scope.covers)}`
            : "Run once for the engagement."}
        </p>
      )}
      {only !== undefined && canDecide && mode === "idle" ? (
        <div className="cp-actions">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => start("covers")}
          >
            Set what it covers
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => start("split")}
          >
            Operates separately…
          </button>
        </div>
      ) : null}
      {mode === "covers" || mode === "split" ? (
        <div className="cp-form">
          <p className="cp-form-title">
            {mode === "covers"
              ? "The entities, locations, or units it covers. It stays one control, run once."
              : "Where it operates separately. Each becomes its own implementation, planned, tested, and concluded on its own; choose at least two."}
          </p>
          {units.length === 0 ? (
            <p className="cp-muted">No entities or locations yet. Add one.</p>
          ) : (
            <div className="cp-units">
              {units.map((unit) => (
                <label key={unit.id} className="cp-unit">
                  <input
                    type="checkbox"
                    checked={picked.includes(unit.id)}
                    onChange={() => toggle(unit.id)}
                  />
                  {unit.name}
                  <small>{UNIT_KIND_LABELS[unit.kind]}</small>
                </label>
              ))}
            </div>
          )}
          <button
            type="button"
            className="text-link is-plain cp-add-unit"
            onClick={() => setMode("add")}
          >
            + Add an entity, location, or unit
          </button>
          {mode === "split" ? (
            <label className="cp-reason">
              Why it operates separately
              <textarea
                value={reason}
                rows={2}
                maxLength={1000}
                placeholder="For example: each entity's finance team reconciles on its own ledger"
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          ) : null}
          {action.problem === null ||
          action.failed === "approve-family" ? null : (
            <p className="pl-problem" role="alert">
              {action.problem}
            </p>
          )}
          <div className="cp-actions">
            <button
              type="button"
              className="btn-sm"
              disabled={
                action.busy !== "" ||
                (mode === "split" &&
                  (picked.length < 2 || reason.trim().length < 10))
              }
              onClick={async () => {
                if (only === undefined) {
                  return;
                }
                const sent = await action.send(mode, {
                  intent: mode === "covers" ? "coverage" : "split",
                  control_id: only.controlId,
                  unit_ids: picked,
                  reason,
                });
                if (sent.ok) {
                  setMode("idle");
                }
              }}
            >
              {action.busy === mode
                ? "Saving…"
                : mode === "covers"
                  ? "Save"
                  : `Operate separately in ${picked.length}`}
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setMode("idle")}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {mode === "add" ? (
        <div className="cp-form">
          <div className="cp-add-row">
            <select
              value={kind}
              aria-label="Kind"
              onChange={(event) => setKind(event.target.value as UnitKind)}
            >
              {UNIT_KINDS.map((item) => (
                <option key={item} value={item}>
                  {UNIT_KIND_LABELS[item]}
                </option>
              ))}
            </select>
            <input
              value={name}
              maxLength={200}
              aria-label="Name"
              placeholder="Name as it appears in scope"
              onChange={(event) => setName(event.target.value)}
            />
            <button
              type="button"
              className="btn-sm"
              disabled={name.trim() === "" || action.busy !== ""}
              onClick={async () => {
                const sent = await action.send("unit", {
                  intent: "scope-unit-add",
                  kind,
                  name,
                });
                if (sent.ok) {
                  setName("");
                  setMode("covers");
                }
              }}
            >
              Add
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setMode("covers")}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
