"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import {
  APPLICABILITY_LABELS,
  type Applicability,
  CATEGORIES,
  CHANGE_KINDS,
  CONTROL_TYPE_LABELS,
  type EvidencePlan,
  groupByCategory,
  JUDGEABLE,
  NECESSITY_LABELS,
  PHASE_LABELS,
  PHASE_STATE_EXPLAINED,
  PHASE_STATE_TONES,
  type Phase,
  PLAN_STATUS_LABELS,
  type PlanPhase,
  type PlanRequirement,
  POPULATION_LABELS,
  PROPOSAL_LABELS,
  planProblem,
  type RequirementFile,
  requirementStatus,
  shownRequirements,
} from "./evidence-plan-model";
import { formatDate } from "./format";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };

/** One call to the evidence plan route; refreshes the page when it succeeds. */
export function usePlanAction(ids: Ids) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState("");
  async function run(
    label: string,
    fields: Record<string, unknown>,
  ): Promise<boolean> {
    setBusy(label);
    setProblem(null);
    let status = 0;
    let detail = "";
    let answer = "";
    try {
      const response = await fetch("/workspace/evidence-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          control_id: ids.controlId,
          ...fields,
        }),
      });
      const body = (await response.json()) as {
        status?: unknown;
        detail?: unknown;
        plan?: { note?: unknown } | null;
      };
      status = typeof body.status === "number" ? body.status : 0;
      detail = typeof body.detail === "string" ? body.detail : "";
      answer = typeof body.plan?.note === "string" ? body.plan.note : "";
    } catch {
      status = 0;
    }
    setBusy("");
    const message = planProblem(status, detail);
    setProblem(message);
    setNote(answer);
    if (message === null) {
      startTransition(() => router.refresh());
    }
    return message === null;
  }
  return { run, busy, pending: pending || busy !== "", problem, note };
}

export function Problem({ text }: { text: string | null }) {
  return text === null ? null : (
    <p className="cc-problem" role="alert">
      {text}
    </p>
  );
}

export function phasePeriod(phase: PlanPhase): string {
  if (phase.periodStart === null || phase.periodEnd === null) {
    return phase.phase === "DESIGN" ? "The control as currently designed" : "";
  }
  return `${formatDate(phase.periodStart)} to ${formatDate(phase.periodEnd)}`;
}

// One phase

/**
 * The evidence plan for one testing phase: whether it applies and why, what it tests,
 * and the evidence it needs, grouped by category, each item with its reason and where
 * it stands. A phase with no requests says why: not needed, not planned yet, waiting for
 * a condition, or waiting for an answer.
 */
export function PhaseEvidencePlan({
  ids,
  plan,
  phase,
  canAct,
  showItems = true,
}: {
  ids: Ids;
  plan: EvidencePlan | null;
  phase: Phase;
  canAct: boolean;
  /** False where the items are listed elsewhere (the requirements view). */
  showItems?: boolean;
}) {
  const action = usePlanAction(ids);
  if (plan === null || plan.status === "NOT_PLANNED") {
    return (
      <div className="ep-phase" aria-busy={action.pending}>
        <p className="ep-state-line">
          <span className="cx-status">Not planned yet</span>
          <span>{PHASE_STATE_EXPLAINED.NOT_PLANNED}</span>
        </p>
        {canAct ? (
          <div className="ep-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={action.pending}
              onClick={() => action.run("generate", { intent: "generate" })}
            >
              <UiIcon name="sparkles" size={13} />
              {action.busy === "generate" ? "Planning…" : "Plan the evidence"}
            </button>
          </div>
        ) : null}
        <Problem text={action.problem} />
      </div>
    );
  }
  const current = plan.phases.find((item) => item.phase === phase);
  if (current === undefined) {
    return null;
  }
  const requirements = shownRequirements(current);
  const span = phasePeriod(current);
  return (
    <div className="ep-phase" aria-busy={action.pending}>
      <div className="ep-head">
        <span className="ep-chip">
          {current.applicability === null
            ? "Not decided"
            : APPLICABILITY_LABELS[current.applicability]}
        </span>
        <span className={`cx-status ${PHASE_STATE_TONES[current.state]}`}>
          {current.stateLabel}
        </span>
        {span !== "" ? <span className="ep-period">{span}</span> : null}
      </div>
      <p className="ep-explain">{PHASE_STATE_EXPLAINED[current.state]}</p>
      <div className="ep-why">
        <p>
          <span>Why</span>
          {current.rationale}
        </p>
        {current.applicability === "CONDITIONAL" && current.condition ? (
          <p>
            <span>Condition</span>
            {current.condition}
          </p>
        ) : null}
        {current.applicability === "PENDING" && current.openQuestion ? (
          <p>
            <span>Question</span>
            {current.openQuestion}
          </p>
        ) : null}
        {current.origin === "PERSON" ? (
          <p className="ep-by">
            Decided by {current.decidedBy ?? "a team member"}
          </p>
        ) : null}
      </div>
      {current.objectives.length > 0 || current.procedures.length > 0 ? (
        <details className="ep-more">
          <summary>Objectives and planned procedures</summary>
          <div className="ep-more-body">
            <div>
              <h4>Objectives</h4>
              <ul>
                {current.objectives.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Procedures</h4>
              <ul>
                {current.procedures.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </details>
      ) : null}
      {!showItems ? null : current.applicability === "NOT_APPLICABLE" ? (
        requirements.length > 0 ? (
          <p className="form-hint">
            Requested before the phase was found not to apply; kept on record.
          </p>
        ) : null
      ) : requirements.length === 0 ? (
        <p className="cc-empty ep-empty">
          No evidence is planned for this phase yet. Plan again, or add what it
          needs.
        </p>
      ) : null}
      {showItems && requirements.length > 0 ? (
        <div className="ep-groups">
          {groupByCategory(requirements).map((group) => (
            <section
              key={group.category}
              className="ep-group"
              aria-label={group.label}
            >
              <h4>
                {group.label}
                <span className="ep-count">{group.items.length}</span>
              </h4>
              <ul className="cc-list">
                {group.items.map((item) => (
                  <RequirementRow
                    key={item.id}
                    item={item}
                    canAct={canAct}
                    action={action}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
      {current.requests.length > 0 ? (
        <p className="ep-requests">
          <UiIcon name="mail" size={13} />
          <span>
            {current.requests.length === 1
              ? "Its request: "
              : `Its ${current.requests.length} requests: `}
            {current.requests
              .map(
                (request) =>
                  `${request.reference} (${request.status.replaceAll("_", " ").toLowerCase()})`,
              )
              .join(", ")}
          </span>
        </p>
      ) : null}
      {canAct ? <PhaseDecision phase={current} action={action} /> : null}
      {action.note ? <p className="cc-note">{action.note}</p> : null}
      <Problem text={action.problem} />
    </div>
  );
}

export type Action = ReturnType<typeof usePlanAction>;

const COVERAGE_WORDS: Record<
  NonNullable<RequirementFile["coverage"]>,
  string
> = {
  COVERED: "covers it",
  PARTIAL: "covers it in part",
  NOT_COVERED: "does not cover it",
};

type Asking =
  | { kind: "INSUFFICIENT" | "FOLLOW_UP_REQUIRED" | "WAIVE" | "LINK" }
  | { kind: "UNLINK"; file: RequirementFile };

/**
 * One requirement: what it asks for, the files that serve it (on its request, or linked
 * by a person with why), what the evidence reader found and proposes (marked as the
 * agent's), and a person's decision. Accepting is always a person's act.
 */
export function RequirementRow({
  item,
  canAct,
  action,
  linkable = [],
  proposed = false,
}: {
  item: PlanRequirement;
  canAct: boolean;
  action: Action;
  /** The control's files that do not serve it yet, to link. */
  linkable?: Array<{ id: string; name: string }>;
  /** Its plan waits for approval: the item is part of the proposal. */
  proposed?: boolean;
}) {
  const shown = requirementStatus(item.state, proposed);
  const id = useId();
  const [asking, setAsking] = useState<Asking | null>(null);
  const [words, setWords] = useState("");
  const [fileId, setFileId] = useState("");
  const judgeable = JUDGEABLE.includes(item.state);
  const open = item.state !== "NOT_APPLICABLE" && item.state !== "REMOVED";
  const assessed = item.files.length > 0;
  const proposal = item.assessment;
  // A person's judgment stands; the reader's proposal stays for the record.
  const decided =
    item.state === "ACCEPTED" ||
    item.state === "INSUFFICIENT" ||
    item.state === "FOLLOW_UP_REQUIRED";
  const ask = (next: Asking, prefill = "") => {
    setAsking(next);
    setWords(prefill);
    setFileId("");
  };
  return (
    <li
      id={`req-${item.id}`}
      className={`cc-item ep-item${item.needsReview ? " is-review" : ""}`}
    >
      <span className={`ep-dot ${shown.tone}`} aria-hidden="true" />
      <div className="cc-item-body">
        <p className="ep-title">
          <strong>{item.title}</strong>
          {item.necessity !== "REQUIRED" ? (
            <span className="cc-badge">{NECESSITY_LABELS[item.necessity]}</span>
          ) : null}
          {item.categories.map((category) => (
            <span key={category} className="cc-badge">
              {CATEGORIES.find(([key]) => key === category)?.[1] ?? category}
            </span>
          ))}
          {item.needsReview ? (
            <span className="cc-badge is-question">Needs review</span>
          ) : null}
        </p>
        <p className="cc-text">{item.description}</p>
        {assessed ? (
          <div className="ep-evidence">
            <ul className="ep-files">
              {item.files.map((file) => (
                <li key={file.fileId}>
                  <UiIcon name="file" size={13} />
                  <span className="ep-file-name">{file.name}</span>
                  <small>
                    {file.via === "LINK"
                      ? `linked by ${file.linkedBy ?? "a person"}`
                      : "on its request"}
                    {file.readStatus === "PENDING" ||
                    file.readStatus === "WORKING"
                      ? " · being read"
                      : file.readStatus === "FAILED"
                        ? " · could not be read"
                        : file.coverage !== null
                          ? ` · ${COVERAGE_WORDS[file.coverage]}${file.readBy === "RULES" ? " (by the rules)" : ""}`
                          : ""}
                    {file.period ? ` · ${file.period}` : ""}
                  </small>
                  {canAct && file.via === "LINK" && file.linkId !== null ? (
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={action.pending}
                      onClick={() => ask({ kind: "UNLINK", file })}
                    >
                      Unlink
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            <p
              className={`ep-assess is-${proposal.proposal.toLowerCase()}${decided ? " is-decided" : ""}`}
            >
              <span
                className="cw-ai"
                title="The evidence reader's proposal, not a decision"
              >
                AI
              </span>
              {proposal.proposal === "NONE" ? null : (
                <>
                  {decided ? "The reader proposed: " : null}
                  <strong>{PROPOSAL_LABELS[proposal.proposal]}.</strong>{" "}
                </>
              )}
              {proposal.reason}
            </p>
            {proposal.followUps.length > 0 ? (
              <ul className="ep-follow">
                {proposal.followUps.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {!assessed &&
        (item.state === "RECEIVED" ||
          item.state === "PARTIALLY_RECEIVED" ||
          item.state === "UNDER_REVIEW") ? (
          <p className="ep-note">
            Its request is marked received, but no file is linked to it. Add the
            file to the request, or link one the control already holds.
          </p>
        ) : null}
        {/* The reasoning and the request behind the item open on request, so the plan
            reads as what is needed and where it stands. */}
        <details className="ep-more">
          <summary>Why, period, and request</summary>
          <p className="cc-why">
            <span>Why</span>
            {item.rationale}
          </p>
          <p className="ep-meta">
            {item.periodLabel ? <span>Period: {item.periodLabel}</span> : null}
            {item.populationKind !== null ? (
              <span>
                {POPULATION_LABELS[item.populationKind] ?? item.populationKind}
              </span>
            ) : null}
            {item.dependsOnTitle !== null ? (
              <span>Waits for: {item.dependsOnTitle}</span>
            ) : null}
            {item.requestReference !== null ? (
              <span>
                {item.requestReference}
                {item.requestRecipient ? ` to ${item.requestRecipient}` : ""}
              </span>
            ) : null}
          </p>
          {item.attributes.length > 0 ? (
            <p className="ep-meta">
              <span>Supports: {item.attributes.join("; ")}</span>
            </p>
          ) : null}
          {item.sampleSelection ? (
            <p className="ep-meta">
              <span>Sample: {item.sampleSelection}</span>
            </p>
          ) : null}
          {item.coverageNote ? (
            <p className="ep-meta">{item.coverageNote}</p>
          ) : null}
          {item.files
            .filter((file) => file.via === "LINK" && file.reason !== "")
            .map((file) => (
              <p key={file.fileId} className="ep-meta">
                <span>
                  {file.name} serves it because: {file.reason}
                </span>
              </p>
            ))}
          {canAct && open && linkable.length > 0 && asking === null ? (
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={action.pending}
              onClick={() => ask({ kind: "LINK" })}
            >
              Use a file the control already holds
            </button>
          ) : null}
        </details>
        {item.sufficiencyNote ? (
          <p className="ep-note">
            {item.sufficiencyNote}
            {item.sufficiencyBy ? ` (${item.sufficiencyBy})` : ""}
          </p>
        ) : null}
        {item.state === "NOT_APPLICABLE" && item.waiveReason ? (
          <p className="ep-note">Not applicable: {item.waiveReason}</p>
        ) : null}
        {item.pendingChange !== null ? (
          <div className="ep-change">
            <p>
              <strong>Planning again proposes a change.</strong>{" "}
              {item.pendingChange.remove
                ? "It would take this item out of the plan."
                : `${item.pendingChange.title}: ${item.pendingChange.description}`}
            </p>
            {canAct ? (
              <span className="cc-actions">
                <button
                  type="button"
                  className="btn-sm"
                  disabled={action.pending}
                  onClick={() =>
                    action.run(`change-${item.id}`, {
                      intent: "change",
                      requirement_id: item.id,
                      decision: "ACCEPT",
                      version: item.version,
                    })
                  }
                >
                  Accept change
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={action.pending}
                  onClick={() =>
                    action.run(`change-${item.id}`, {
                      intent: "change",
                      requirement_id: item.id,
                      decision: "DISMISS",
                      version: item.version,
                    })
                  }
                >
                  Keep as is
                </button>
              </span>
            ) : null}
          </div>
        ) : null}
        {canAct && asking !== null ? (
          <form
            autoComplete="off"
            className="cc-inline ep-ask"
            onSubmit={async (event) => {
              event.preventDefault();
              const done =
                asking.kind === "WAIVE"
                  ? await action.run(`waive-${item.id}`, {
                      intent: "waive",
                      requirement_id: item.id,
                      reason: words,
                      version: item.version,
                    })
                  : asking.kind === "LINK"
                    ? await action.run(`link-${item.id}`, {
                        intent: "link",
                        requirement_id: item.id,
                        file_id: fileId,
                        reason: words,
                        version: item.version,
                      })
                    : asking.kind === "UNLINK"
                      ? await action.run(`unlink-${item.id}`, {
                          intent: "unlink",
                          requirement_id: item.id,
                          link_id: asking.file.linkId,
                          reason: words,
                          version: asking.file.linkVersion,
                        })
                      : await action.run(`judge-${item.id}`, {
                          intent: "sufficiency",
                          requirement_id: item.id,
                          sufficiency: asking.kind,
                          note: words,
                          version: item.version,
                        });
              if (done) {
                setAsking(null);
                setWords("");
              }
            }}
          >
            {asking.kind === "LINK" ? (
              <>
                <label className="sr-only" htmlFor={`${id}-file`}>
                  File
                </label>
                <select
                  id={`${id}-file`}
                  value={fileId}
                  onChange={(event) => setFileId(event.target.value)}
                >
                  <option value="">Choose a file</option>
                  {linkable.map((file) => (
                    <option key={file.id} value={file.id}>
                      {file.name}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            <label className="sr-only" htmlFor={`${id}-words`}>
              {asking.kind === "WAIVE"
                ? "Why it does not apply"
                : asking.kind === "LINK"
                  ? "Why the file serves it"
                  : asking.kind === "UNLINK"
                    ? "Why it no longer serves it"
                    : "What is missing"}
            </label>
            <input
              id={`${id}-words`}
              value={words}
              maxLength={
                asking.kind === "LINK" || asking.kind === "UNLINK" ? 500 : 1000
              }
              placeholder={
                asking.kind === "WAIVE"
                  ? "Why this does not apply (scope, control, or methodology)"
                  : asking.kind === "LINK"
                    ? "Why this file serves it, e.g. the procedure covers the whole year"
                    : asking.kind === "UNLINK"
                      ? `Why ${asking.file.name} no longer serves it`
                      : "What is missing or needs a follow-up"
              }
              onChange={(event) => setWords(event.target.value)}
            />
            <button
              type="submit"
              className="btn-sm"
              disabled={
                action.pending ||
                (asking.kind === "LINK" && fileId === "") ||
                words.trim().length < (asking.kind === "WAIVE" ? 10 : 3)
              }
            >
              {asking.kind === "LINK"
                ? "Link"
                : asking.kind === "UNLINK"
                  ? "Unlink"
                  : "Save"}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setAsking(null)}
            >
              Cancel
            </button>
          </form>
        ) : null}
      </div>
      <div className="ep-side">
        <span
          className={`cx-status ${shown.tone}`}
          title={shown.title || undefined}
        >
          {shown.label}
        </span>
        {canAct && asking === null ? (
          <span className="ep-buttons">
            {judgeable && item.state !== "ACCEPTED" ? (
              <button
                type="button"
                className="btn-sm"
                disabled={action.pending}
                onClick={() =>
                  action.run(`judge-${item.id}`, {
                    intent: "sufficiency",
                    requirement_id: item.id,
                    sufficiency: "ACCEPTED",
                    version: item.version,
                  })
                }
              >
                Accept
              </button>
            ) : null}
            {judgeable ? (
              <>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={action.pending}
                  onClick={() => ask({ kind: "INSUFFICIENT" })}
                >
                  Insufficient
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={action.pending}
                  onClick={() =>
                    ask(
                      { kind: "FOLLOW_UP_REQUIRED" },
                      proposal.followUps.join("; ").slice(0, 1000),
                    )
                  }
                >
                  Follow up
                </button>
              </>
            ) : null}
            {open && item.pendingChange === null ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={action.pending}
                onClick={() => ask({ kind: "WAIVE" })}
              >
                Mark not applicable
              </button>
            ) : null}
            {item.state === "NOT_APPLICABLE" ? (
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={action.pending}
                onClick={() =>
                  action.run(`restore-${item.id}`, {
                    intent: "restore",
                    requirement_id: item.id,
                    version: item.version,
                  })
                }
              >
                Restore
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function PhaseDecision({
  phase,
  action,
}: {
  phase: PlanPhase;
  action: Action;
}) {
  const id = useId();
  const [applicability, setApplicability] = useState<Applicability>(
    phase.applicability ?? "APPLICABLE",
  );
  const [rationale, setRationale] = useState("");
  const [condition, setCondition] = useState("");
  const [question, setQuestion] = useState("");
  const minimum = applicability === "NOT_APPLICABLE" ? 30 : 10;
  return (
    <details className="ep-decide">
      <summary>Change whether this phase applies</summary>
      <form
        autoComplete="off"
        className="ep-decide-form"
        onSubmit={async (event) => {
          event.preventDefault();
          await action.run(`phase-${phase.phase}`, {
            intent: "phase",
            phase: phase.phase,
            applicability,
            rationale,
            condition,
            open_question: question,
            version: phase.version,
          });
        }}
      >
        <label htmlFor={`${id}-applies`}>Decision</label>
        <select
          id={`${id}-applies`}
          value={applicability}
          onChange={(event) =>
            setApplicability(event.target.value as Applicability)
          }
        >
          {(Object.keys(APPLICABILITY_LABELS) as Applicability[]).map((key) => (
            <option key={key} value={key}>
              {APPLICABILITY_LABELS[key]}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-why`}>Reason</label>
        <textarea
          id={`${id}-why`}
          className="cc-reword"
          rows={2}
          maxLength={1500}
          value={rationale}
          placeholder={
            applicability === "NOT_APPLICABLE"
              ? "The scope, control, or methodology reason it does not apply. Missing evidence is not a reason."
              : "Why"
          }
          onChange={(event) => setRationale(event.target.value)}
        />
        {applicability === "CONDITIONAL" ? (
          <>
            <label htmlFor={`${id}-condition`}>Condition</label>
            <input
              id={`${id}-condition`}
              className="cc-reword"
              maxLength={500}
              value={condition}
              onChange={(event) => setCondition(event.target.value)}
            />
          </>
        ) : null}
        {applicability === "PENDING" ? (
          <>
            <label htmlFor={`${id}-question`}>Question to resolve</label>
            <input
              id={`${id}-question`}
              className="cc-reword"
              maxLength={500}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
          </>
        ) : null}
        <div className="ep-actions">
          <button
            type="submit"
            className="btn btn-secondary btn-sm"
            disabled={action.pending || rationale.trim().length < minimum}
          >
            Record decision
          </button>
          <span className="form-hint">
            Kept when the plan is generated again.
          </span>
        </div>
      </form>
    </details>
  );
}

// The whole plan

/**
 * The control's plan on its overview: what the planner understood, the three phases at
 * a glance, every evidence item across phases with filters, and the changes to the
 * control that the plan follows.
 */
/** The planner's two actions: plan again, and approve the plan (a person's decision
 * on the methodology; nothing is sent to the owner by it). */
export function PlannerActions({
  ids,
  plan,
  approve = true,
}: {
  ids: Ids;
  plan: EvidencePlan | null;
  /** The page leads with one Approve plan. Elsewhere these are the other actions. */
  approve?: boolean;
}) {
  const action = usePlanAction(ids);
  const commentId = useId();
  const [returning, setReturning] = useState(false);
  const [comment, setComment] = useState("");
  const planned = plan !== null && plan.status !== "NOT_PLANNED";
  const waiting = planned && (plan.pendingChanges > 0 || plan.pendingRevision);
  return (
    <span className="cc-actions" aria-busy={action.pending}>
      {approve && planned && plan.status !== "APPROVED" ? (
        <button
          type="button"
          className="btn-sm"
          disabled={action.pending || waiting}
          title={
            waiting
              ? "Accept or dismiss the proposed changes first."
              : undefined
          }
          onClick={() =>
            action.run("approve", { intent: "approve", version: plan.version })
          }
        >
          Approve plan
        </button>
      ) : null}
      {planned && plan.pendingRevision ? (
        <>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={action.pending}
            onClick={() =>
              action.run("revision", {
                intent: "revision",
                decision: "ACCEPT",
                version: plan.version,
              })
            }
          >
            Accept revised understanding
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={action.pending}
            onClick={() =>
              action.run("revision", {
                intent: "revision",
                decision: "DISMISS",
                version: plan.version,
              })
            }
          >
            Dismiss
          </button>
        </>
      ) : null}
      {planned && plan.status !== "CHANGES_REQUESTED" && !returning ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={action.pending}
          onClick={() => setReturning(true)}
        >
          Request changes
        </button>
      ) : null}
      {planned && returning ? (
        <span className="cc-inline-form">
          <label htmlFor={commentId} className="sr-only">
            What should change
          </label>
          <textarea
            id={commentId}
            rows={2}
            maxLength={4000}
            value={comment}
            placeholder="What should change in the plan"
            onChange={(event) => setComment(event.target.value)}
          />
          <button
            type="button"
            className="btn-sm"
            disabled={action.pending || comment.trim().length < 10}
            onClick={async () => {
              const done = await action.run("request-changes", {
                intent: "request-changes",
                comment,
                version: plan.version,
              });
              if (done) {
                setReturning(false);
                setComment("");
              }
            }}
          >
            Return plan
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={action.pending}
            onClick={() => setReturning(false)}
          >
            Cancel
          </button>
        </span>
      ) : null}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={action.pending}
        onClick={() => action.run("generate", { intent: "generate" })}
      >
        <UiIcon name="sparkles" size={13} />
        {action.busy === "generate"
          ? "Planning…"
          : planned
            ? "Plan again"
            : "Plan the evidence"}
      </button>
      {action.note && action.busy === "" ? (
        <span className="cc-note">{action.note}</span>
      ) : null}
      <Problem text={action.problem} />
    </span>
  );
}

/**
 * The plan behind the requirements: what the planner understood, what is missing or
 * unusual, each phase (whether it applies and why, its objectives and procedures, and
 * the form to change it), the changes recorded on the control, and the history.
 */
export function PlanDetails({
  ids,
  plan,
  canAct,
}: {
  ids: Ids;
  plan: EvidencePlan | null;
  canAct: boolean;
}) {
  const action = usePlanAction(ids);
  if (plan === null) {
    return null;
  }
  if (plan.status === "NOT_PLANNED") {
    return <p className="ep-explain">{PHASE_STATE_EXPLAINED.NOT_PLANNED}</p>;
  }
  return (
    <section
      className="ep-overview"
      aria-label="Evidence plan"
      aria-busy={action.pending}
    >
      <p className="ep-state-line">
        <span
          className={`cx-status ${plan.status === "APPROVED" ? "tone-success" : plan.status === "CHANGES_PROPOSED" ? "tone-warning" : ""}`}
        >
          {PLAN_STATUS_LABELS[plan.status]}
        </span>
        <span>
          {plan.source === "MODEL"
            ? "Planned by the agent"
            : "Planned by the rules"}
          {plan.generatedAt ? `, ${formatDate(plan.generatedAt)}` : ""}
          {plan.approvedBy ? `. Approved by ${plan.approvedBy}` : ""}
          {plan.controlType
            ? `. ${CONTROL_TYPE_LABELS[plan.controlType] ?? plan.controlType}`
            : ""}
        </span>
        {plan.provisional ? (
          <span className="cc-badge is-question">Provisional</span>
        ) : null}
      </p>
      {plan.summary ? <p className="cc-text">{plan.summary}</p> : null}
      {plan.note ? <p className="cc-note">{plan.note}</p> : null}
      <PlanList
        title="Missing information"
        items={plan.missingInformation}
        tone="is-question"
      />
      <PlanList
        title="Exceptions to the normal approach"
        items={plan.exceptions}
        tone="is-conflict"
      />
      <PlanList
        title="Needs a person's review"
        items={plan.approvalsRequired}
        tone="is-question"
      />
      {plan.phases.map((phase) => (
        <section
          key={phase.phase}
          className="ep-phase-detail"
          aria-label={PHASE_LABELS[phase.phase]}
        >
          <h4>{PHASE_LABELS[phase.phase]}</h4>
          <PhaseEvidencePlan
            ids={ids}
            plan={plan}
            phase={phase.phase}
            canAct={canAct}
            showItems={false}
          />
        </section>
      ))}
      <ControlChanges plan={plan} canAct={canAct} action={action} />
      {plan.runs.length > 0 ? (
        <details className="cc-history">
          <summary>Planning history ({plan.runs.length})</summary>
          <ul>
            {plan.runs.map((run) => (
              <li key={run.createdAt}>
                {formatDate(run.createdAt)}:{" "}
                {run.source === "MODEL" ? "the agent" : "the rules"}.{" "}
                {run.added + run.updated + run.flagged + run.removed === 0
                  ? "No change."
                  : `${run.added} added, ${run.updated} updated, ${run.flagged} for review, ${run.removed} removed.`}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <Problem text={action.problem} />
    </section>
  );
}

export function PlanList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: string;
}) {
  return items.length === 0 ? null : (
    <div className="ep-list">
      <h4>
        <span className={`cc-badge ${tone}`}>{items.length}</span>
        {title}
      </h4>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function ControlChanges({
  plan,
  canAct,
  action,
}: {
  plan: EvidencePlan;
  canAct: boolean;
  action: Action;
}) {
  const id = useId();
  const [kind, setKind] = useState<string>("CONFIGURATION");
  const [effectiveOn, setEffectiveOn] = useState("");
  const [description, setDescription] = useState("");
  return (
    <div className="ep-list">
      <h4>Changes to the control in the period</h4>
      {plan.changes.length === 0 ? (
        <p className="form-hint">
          None recorded. Record a change to its configuration, process, people,
          or systems, and the plan adds the evidence the affected period needs.
        </p>
      ) : (
        <ul>
          {plan.changes.map((change) => (
            <li key={change.id}>
              {formatDate(change.effectiveOn)}:{" "}
              {CHANGE_KINDS.find(([key]) => key === change.kind)?.[1] ??
                change.kind}
              . {change.description}
            </li>
          ))}
        </ul>
      )}
      {canAct ? (
        <details className="ep-decide">
          <summary>Record a change</summary>
          <form
            autoComplete="off"
            className="ep-decide-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                await action.run("control-change", {
                  intent: "control-change",
                  kind,
                  effective_on: effectiveOn,
                  description,
                })
              ) {
                setDescription("");
                setEffectiveOn("");
              }
            }}
          >
            <label htmlFor={`${id}-kind`}>What changed</label>
            <select
              id={`${id}-kind`}
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              {CHANGE_KINDS.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <label htmlFor={`${id}-date`}>Effective</label>
            <input
              id={`${id}-date`}
              type="date"
              value={effectiveOn}
              onChange={(event) => setEffectiveOn(event.target.value)}
            />
            <label htmlFor={`${id}-what`}>Description</label>
            <input
              id={`${id}-what`}
              className="cc-reword"
              maxLength={1000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <div className="ep-actions">
              <button
                type="submit"
                className="btn btn-secondary btn-sm"
                disabled={
                  action.pending ||
                  effectiveOn === "" ||
                  description.trim().length < 3
                }
              >
                {action.busy === "control-change"
                  ? "Planning…"
                  : "Record and plan again"}
              </button>
            </div>
          </form>
        </details>
      ) : null}
    </div>
  );
}
