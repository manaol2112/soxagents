"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";

import { formatDate } from "./format";
import type { PlanningPageState } from "./load-planning";
import {
  type ControlPhases,
  nextRelease,
  PHASE_SHORT,
  type Phase,
  type PhaseStatus,
  phaseNote,
  phaseStatus,
  planningHref,
  planningProblem,
  releasable,
  releaseIsEarly,
  STEP_TONES,
} from "./planning-model";
import { implementationName } from "./shared-plans-model";
import { UiIcon } from "./ui-icon";

type Ids = {
  organizationId: string;
  projectId: string;
  /** The destination the page's links stay in (M2b); the Test plans page by default. */
  section?: "planning" | "testing";
};
type Released = "INTERIM" | "ROLLFORWARD";

/** One call to the planning route; refreshes the page when it succeeds. */
function useRelease(ids: Ids) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function run(
    fields: Record<string, unknown>,
  ): Promise<{ ok: boolean; body: unknown }> {
    setBusy(true);
    setProblem(null);
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
    setBusy(false);
    const message = planningProblem(status, detail);
    setProblem(message);
    if (message === null) {
      startTransition(() => router.refresh());
    }
    return { ok: message === null, body };
  }
  return { run, pending: pending || busy, problem };
}

/** Plans (the review queue) or phases (release by phase). */
/** The ways to see the plans: by control (shared plans, the default), each plan on its
 * own, and, on Test plans, by phase (Testing has its own Phases view). */
export function ViewSwitch({
  ids,
  view,
}: {
  ids: Ids;
  view: "plans" | "phases";
}) {
  const link = (target: "controls" | "each" | "phases") =>
    planningHref(ids.organizationId, ids.projectId, {
      section: ids.section,
      view: target === "controls" ? null : target,
    });
  return (
    <nav className="segmented pl-views" aria-label="How the plans are shown">
      <a href={link("controls")}>By control</a>
      <a
        href={link("each")}
        aria-current={view === "plans" ? "page" : undefined}
      >
        Each plan
      </a>
      {ids.section === "testing" ? null : (
        <a
          href={link("phases")}
          aria-current={view === "phases" ? "page" : undefined}
        >
          Phases
        </a>
      )}
    </nav>
  );
}

function StepPill({ status }: { status: PhaseStatus | null }) {
  if (status === null) {
    return <span className="pl-none">Not planned</span>;
  }
  return (
    <span className={`pill ${STEP_TONES[status.step]}`}>
      {status.stepLabel}
    </span>
  );
}

function StepNote({ status }: { status: PhaseStatus | null }) {
  if (status === null) {
    return null;
  }
  if (
    (status.step === "RELEASED" || status.step === "COMPLETE") &&
    status.releasedAt
  ) {
    return (
      <span className="pl-sub" title={status.early ? status.reason : undefined}>
        {status.releasedBy ?? "Recorded"} · {formatDate(status.releasedAt)}
        {status.early ? " · early" : ""}
      </span>
    );
  }
  return status.waitingFor ? (
    <span className="pl-sub">{status.waitingFor}</span>
  ) : null;
}

/** Each control's phases, and their release, phase by phase. */
export function PhasesView({
  ids,
  state,
  header,
}: {
  ids: Ids;
  state: PlanningPageState | null;
  header: React.ReactNode;
}) {
  const progress = state?.phases ?? null;
  const action = useRelease(ids);
  const reasonId = useId();
  const [phase, setPhase] = useState<Released>("INTERIM");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState<string | null>(null);
  const rows = useMemo(() => {
    const words = search.trim().toLowerCase();
    return (progress?.controls ?? []).filter(
      (row) =>
        words === "" ||
        `${row.controlRef} ${row.title} ${row.application} ${row.units}`
          .toLowerCase()
          .includes(words),
    );
  }, [progress, search]);
  if (progress === null) {
    return (
      <div className="page pl-page">
        {header}
        <ViewSwitch ids={ids} view="phases" />
        <section className="card pl-empty">
          <h2>The phases could not be loaded</h2>
          <p>Wait a moment and refresh the page.</p>
        </section>
      </div>
    );
  }
  const can = progress.viewerCanRelease;
  const chosen = rows.filter((row) => selected.has(row.controlId));
  const early = chosen.some((row) => {
    const status = phaseStatus(row, phase);
    return status !== null && releaseIsEarly(status);
  });
  const ready = rows.filter((row) => phaseStatus(row, phase)?.step === "READY");
  const choose = (next: Released) => {
    setPhase(next);
    setSelected(new Set());
  };
  return (
    <div className="page pl-page">
      {header}
      <ViewSwitch ids={ids} view="phases" />
      {progress.recommendation ? (
        <section className="card pl-recommend" aria-label="Recommended next">
          <UiIcon name="sparkles" size={16} />
          <p>{progress.recommendation}</p>
          {can ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                const next: Released =
                  progress.ready.INTERIM > 0 ? "INTERIM" : "ROLLFORWARD";
                setPhase(next);
                setSelected(
                  new Set(
                    (progress.controls ?? [])
                      .filter((row) => phaseStatus(row, next)?.step === "READY")
                      .map((row) => row.controlId),
                  ),
                );
              }}
            >
              Select the ready controls
            </button>
          ) : null}
        </section>
      ) : null}
      <div className="kpis pl-phase-figures">
        {(
          [
            [
              "Interim ready to release",
              progress.ready.INTERIM,
              "Design testing complete",
            ],
            [
              "Interim released",
              progress.released.INTERIM,
              "Requests may go for approval",
            ],
            [
              "Roll-forward ready to release",
              progress.ready.ROLLFORWARD,
              "Interim testing complete",
            ],
            [
              "Roll-forward released",
              progress.released.ROLLFORWARD,
              "Requests may go for approval",
            ],
          ] as const
        ).map(([label, value, detail]) => (
          <article key={label} className="kpi">
            <span className="kpi-label">{label}</span>
            <strong className="kpi-value">{value}</strong>
            <span className="kpi-detail">{detail}</span>
          </article>
        ))}
      </div>
      {outcome === null ? null : (
        <p className="banner" role="status">
          <UiIcon name="info" size={16} />
          <span>{outcome}</span>
        </p>
      )}
      <section className="card pl-queue" aria-busy={action.pending}>
        <div className="pl-toolbar">
          <label className="pl-search">
            <UiIcon name="search" size={14} />
            <span className="sr-only">Search controls</span>
            <input
              type="search"
              value={search}
              placeholder="Search by control, title, or system"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {can ? (
            <fieldset className="segmented pl-release-phase">
              <legend className="sr-only">Phase to release</legend>
              {(["INTERIM", "ROLLFORWARD"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={phase === item}
                  className={phase === item ? "is-active" : undefined}
                  onClick={() => choose(item)}
                >
                  Release {PHASE_SHORT[item].toLowerCase()}
                </button>
              ))}
            </fieldset>
          ) : null}
        </div>
        {can && chosen.length > 0 ? (
          <section
            className="pl-batch"
            aria-label="Release the selected controls"
          >
            <strong>
              {chosen.length} control{chosen.length === 1 ? "" : "s"} selected
            </strong>
            <span className="pl-batch-note">
              Each is released on its own. Releasing never sends a request: each
              still needs an approver.
            </span>
            <label htmlFor={reasonId} className="sr-only">
              Why the phase is released now
            </label>
            <input
              id={reasonId}
              type="text"
              maxLength={1000}
              value={reason}
              placeholder={
                early
                  ? "Why release before the earlier phase is complete (required)"
                  : "Reason (optional)"
              }
              onChange={(event) => setReason(event.target.value)}
            />
            <button
              type="button"
              className="btn-sm"
              disabled={action.pending || (early && reason.trim().length < 20)}
              onClick={async () => {
                const done = await action.run({
                  intent: "phase-release-batch",
                  phase,
                  reason,
                  control_ids: chosen.map((row) => row.controlId),
                });
                if (
                  done.ok &&
                  typeof done.body === "object" &&
                  done.body !== null
                ) {
                  const answer = done.body as {
                    released?: number;
                    outcomes?: Array<{
                      released: boolean;
                      control_ref: string;
                      detail: string;
                    }>;
                  };
                  const refused = (answer.outcomes ?? []).filter(
                    (item) =>
                      !item.released && item.detail !== "Already released.",
                  );
                  setOutcome(
                    `Released ${PHASE_SHORT[phase].toLowerCase()} for ${answer.released ?? 0}.` +
                      (refused.length > 0
                        ? ` Not released: ${refused.map((item) => `${item.control_ref} (${item.detail})`).join("; ")}`
                        : ""),
                  );
                  setSelected(new Set());
                  setReason("");
                }
              }}
            >
              Release {PHASE_SHORT[phase].toLowerCase()} for {chosen.length}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </button>
          </section>
        ) : null}
        {action.problem ? (
          <p className="pl-problem" role="alert">
            {action.problem}
          </p>
        ) : null}
        <div className="table-wrap">
          <table className="pl-table">
            <thead>
              <tr>
                <th scope="col" className="pl-col-check">
                  {can && ready.length > 0 ? (
                    <input
                      type="checkbox"
                      aria-label={`Select every control ready to release ${PHASE_SHORT[phase].toLowerCase()}`}
                      checked={ready.every((row) =>
                        selected.has(row.controlId),
                      )}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? new Set(ready.map((row) => row.controlId))
                            : new Set(),
                        )
                      }
                    />
                  ) : null}
                </th>
                <th scope="col">Control</th>
                {(["DESIGN", "INTERIM", "ROLLFORWARD"] as const).map((item) => (
                  <th scope="col" key={item}>
                    {PHASE_SHORT[item]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <PhaseLine
                  key={row.controlId}
                  ids={ids}
                  row={row}
                  phase={phase}
                  can={can}
                  selected={selected.has(row.controlId)}
                  onToggle={() => {
                    const next = new Set(selected);
                    if (next.has(row.controlId)) {
                      next.delete(row.controlId);
                    } else {
                      next.add(row.controlId);
                    }
                    setSelected(next);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function PhaseLine({
  ids,
  row,
  phase,
  can,
  selected,
  onToggle,
}: {
  ids: Ids;
  row: ControlPhases;
  phase: Released;
  can: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const target = phaseStatus(row, phase);
  return (
    <tr className={selected ? "is-selected" : undefined}>
      <td className="pl-col-check">
        {can && releasable(target) ? (
          <input
            type="checkbox"
            aria-label={`Select ${row.controlRef} to release ${PHASE_SHORT[phase].toLowerCase()}`}
            checked={selected}
            onChange={onToggle}
          />
        ) : null}
      </td>
      <td>
        <a
          className="pl-control"
          href={planningHref(ids.organizationId, ids.projectId, {
            section: ids.section,
            control: row.controlId,
          })}
        >
          <span className="pl-ref">{row.controlRef}</span>
          <span className="pl-title">{row.title}</span>
        </a>
        <span className="pl-sub">
          {implementationName(row.application, row.units) || "No system"}
        </span>
      </td>
      {row.phases.length > 0 &&
      row.phases.every((item) => item.step === "AWAITING_PLAN") ? (
        // One fact, said once: nothing is released before the test plan is approved.
        <td colSpan={3}>
          <span className="pill tone-neutral">Waiting for the test plan</span>
          <a
            className="text-link pl-plan-link"
            href={planningHref(ids.organizationId, ids.projectId, {
              section: ids.section,
              control: row.controlId,
            })}
          >
            Review the test plan
          </a>
        </td>
      ) : (
        (["DESIGN", "INTERIM", "ROLLFORWARD"] as const).map((item: Phase) => {
          const status = phaseStatus(row, item);
          return (
            <td key={item}>
              <StepPill status={status} />
              <StepNote status={status} />
            </td>
          );
        })
      )}
    </tr>
  );
}

/**
 * A control's evidence release on its test plan review, drawn like the control record's
 * audit progress: one segment per phase with where it stands beneath, and the one release
 * the reviewer can make next. A later phase can still be released early from its segment.
 */
export function PhaseStrip({
  ids,
  row,
  canRelease,
}: {
  ids: Ids;
  row: ControlPhases | undefined;
  canRelease: boolean;
}) {
  const action = useRelease(ids);
  const reasonId = useId();
  const [open, setOpen] = useState<Released | null>(null);
  const [reason, setReason] = useState("");
  if (row === undefined) {
    return null;
  }
  const target = open === null ? null : phaseStatus(row, open);
  const next = nextRelease(row.phases);
  const start = (phase: Phase) => {
    setOpen(phase as Released);
    setReason("");
  };
  return (
    <section
      className="pl-strip"
      aria-labelledby="pl-strip-title"
      aria-busy={action.pending}
    >
      <div className="pl-strip-head">
        <h2 id="pl-strip-title">Evidence release</h2>
        <p>
          {next === null
            ? row.phases.every(
                (status) =>
                  status.step === "RELEASED" ||
                  status.step === "COMPLETE" ||
                  status.step === "NOT_APPLICABLE",
              )
              ? "Every phase is released."
              : "Nothing can be released yet."
            : next.step === "READY"
              ? `${PHASE_SHORT[next.phase]} is ready to release.`
              : `${PHASE_SHORT[next.phase]} is next.`}
        </p>
        {canRelease && next !== null && open === null ? (
          <button
            type="button"
            className={
              next.step === "READY" ? "btn btn-sm" : "btn btn-secondary btn-sm"
            }
            disabled={action.pending}
            onClick={() => start(next.phase)}
          >
            {next.step === "READY"
              ? `Release ${PHASE_SHORT[next.phase].toLowerCase()}`
              : `Release ${PHASE_SHORT[next.phase].toLowerCase()} early`}
          </button>
        ) : null}
      </div>
      <ol className="pl-strip-track">
        {row.phases.map((status) => (
          <li
            key={status.phase}
            className={`is-${status.step.toLowerCase()}${status.early ? " is-early" : ""}`}
          >
            <span className="pl-strip-bar" aria-hidden="true" />
            <strong>{PHASE_SHORT[status.phase]}</strong>
            <small
              title={
                status.releasedAt
                  ? `${status.releasedBy ?? "Recorded"} · ${formatDate(status.releasedAt)}${status.early && status.reason ? ` · ${status.reason}` : ""}`
                  : undefined
              }
            >
              {phaseNote(status)}
            </small>
            {canRelease &&
            releasable(status) &&
            status !== next &&
            open === null ? (
              <button
                type="button"
                className="pl-strip-link"
                disabled={action.pending}
                onClick={() => start(status.phase)}
              >
                Release early
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      {open !== null && target !== null ? (
        <div className="pl-decide">
          <label htmlFor={reasonId}>
            {releaseIsEarly(target)
              ? `${target.waitingFor} Why release the ${PHASE_SHORT[open].toLowerCase()} phase now (required)`
              : "Reason (optional)"}
          </label>
          <textarea
            id={reasonId}
            rows={2}
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="pl-decide-buttons">
            <button
              type="button"
              className="btn-sm"
              disabled={
                action.pending ||
                (releaseIsEarly(target) && reason.trim().length < 20)
              }
              onClick={async () => {
                const done = await action.run({
                  intent: "phase-release",
                  control_id: row.controlId,
                  phase: open,
                  reason,
                });
                if (done.ok) {
                  setOpen(null);
                }
              }}
            >
              Release {PHASE_SHORT[open].toLowerCase()}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setOpen(null)}
            >
              Cancel
            </button>
            <span className="pl-sub">
              Releasing lets the phase's prepared requests go for approval.
              Nothing is sent.
            </span>
          </div>
        </div>
      ) : null}
      {action.problem ? (
        <p className="pl-problem" role="alert">
          {action.problem}
        </p>
      ) : null}
    </section>
  );
}
