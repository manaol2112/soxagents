"use client";

import { type ReactNode, useEffect, useId, useState } from "react";

import type { AgentLane } from "./control-workspace-model";
import {
  type EvidenceAction,
  evidenceHref,
  primaryAction,
  waitingWords,
} from "./evidence-flow";
import {
  APPLICABILITY_LABELS,
  type EvidencePlan,
  PHASE_LABELS,
  PHASE_STATE_TONES,
  PHASES,
  type Phase,
  PLAN_STATUS_LABELS,
  PROPOSAL_LABELS,
  planAwaitsApproval,
} from "./evidence-plan-model";
import {
  PlanDetails,
  PlannerActions,
  Problem,
  phasePeriod,
  RequirementRow,
  usePlanAction,
} from "./evidence-plan-view";
import {
  EVIDENCE_VIEW_LABELS,
  EVIDENCE_VIEWS,
  type EvidenceSummary,
  type EvidenceView,
  evidenceViewOf,
  focusPhase,
  type HeldFile,
  linkableFiles,
  liveRequirements,
  PHASE_NAMES,
  type Proposal,
  type RequirementStatusFilter,
  requirementGroups,
  STATUS_FILTER_LABELS,
} from "./evidence-workspace-model";
import { formatDate } from "./format";
import { planningHref } from "./planning-model";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };

const join = (parts: Array<string | false>) =>
  parts
    .filter((part): part is string => part !== false && part !== "")
    .join(" · ");

/**
 * The control's evidence as one workspace: where it stands, what the agents did and
 * propose for a person to decide, and the requirements, requests, files, and plan, one
 * view at a time. The requests and files views come rendered from the server.
 */
export function EvidenceWorkspace({
  ids,
  plan,
  canAct,
  summary,
  proposals,
  lanes,
  files,
  requests,
  library,
  rcmItems,
  actions,
  focus,
  tabHref,
}: {
  ids: Ids;
  plan: EvidencePlan | null;
  canAct: boolean;
  summary: EvidenceSummary;
  proposals: Proposal[];
  /** What the person does next on the evidence (evidence-flow.ts). */
  actions: EvidenceAction[];
  /** The view and the request the address names (?ev=, ?request=). */
  focus: { view: string | null; request: string | null };
  /** The Evidence tab's own address, for links to a record. */
  tabHref: string;
  /** The request drafter's and the evidence reader's rows (control-workspace-model). */
  lanes: AgentLane[];
  files: HeldFile[];
  requests: ReactNode;
  library: ReactNode;
  rcmItems: string[];
}) {
  // The address decides the view, so a link or a refresh opens the same place; an open
  // request is on the Requests view.
  const [view, setView] = useState<EvidenceView>(
    focus.request !== null
      ? "requests"
      : focus.view !== null
        ? evidenceViewOf(focus.view)
        : "requirements",
  );
  // Older links named the view in the hash: #ev-requests, #ev-files, #ev-plan.
  useEffect(() => {
    if (focus.view !== null || focus.request !== null) {
      return;
    }
    const wanted = window.location.hash.replace("#ev-", "");
    const found = EVIDENCE_VIEWS.find((key) => key === wanted);
    if (found !== undefined) {
      setView(found);
    }
  }, [focus.view, focus.request]);
  const counts: Record<EvidenceView, number | null> = {
    requirements: liveRequirements(plan).length,
    requests: summary.requests.total,
    files: summary.files.total,
    plan: null,
  };
  const choose = (next: EvidenceView) => {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set("ev", next);
    url.searchParams.delete("request");
    url.hash = "";
    window.history.replaceState(null, "", url.toString());
  };
  return (
    <div className="ew">
      <EvidenceNext
        ids={ids}
        plan={plan}
        actions={actions}
        tabHref={tabHref}
        canAct={canAct}
      />
      <EvidenceStrip summary={summary} proposed={planAwaitsApproval(plan)} />
      <EvidenceAgents
        ids={ids}
        plan={plan}
        canAct={canAct}
        lanes={lanes}
        proposals={proposals}
        actions={actions}
        onReview={(id) => {
          choose("requirements");
          window.setTimeout(
            () =>
              document
                .getElementById(`req-${id}`)
                ?.scrollIntoView({ behavior: "smooth", block: "center" }),
            50,
          );
        }}
      />
      <section className="ew-views" aria-label="Evidence">
        <div className="cw-seg ew-tabs" role="tablist">
          {EVIDENCE_VIEWS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              className={view === key ? "is-on" : undefined}
              onClick={() => choose(key)}
            >
              {EVIDENCE_VIEW_LABELS[key]}
              {counts[key] !== null ? (
                <span className="ew-count">{counts[key]}</span>
              ) : null}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="ew-panel">
          {view === "requirements" ? (
            <RequirementsView
              ids={ids}
              plan={plan}
              canAct={canAct}
              files={files}
            />
          ) : null}
          {view === "requests" ? requests : null}
          {view === "files" ? library : null}
          {view === "plan" ? (
            <>
              <PlanDetails ids={ids} plan={plan} canAct={canAct} />
              {rcmItems.length > 0 ? (
                <div className="ep-list">
                  <h4>Evidence named in the client's RCM</h4>
                  <ul>
                    {rcmItems.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}

/**
 * What the person does next on the evidence, first and plainly: the one action to take,
 * opening the record it is about, and the rest of what waits for them.
 */
function EvidenceNext({
  ids,
  plan: current,
  actions,
  tabHref,
  canAct,
}: {
  ids: Ids;
  plan: EvidencePlan | null;
  actions: EvidenceAction[];
  tabHref: string;
  canAct: boolean;
}) {
  const plan = usePlanAction(ids);
  const primary = primaryAction(actions);
  const rest = actions.filter(
    (action) => action.mine && action !== primary?.action,
  );
  const waiting = actions.filter((action) => !action.mine);
  if (primary === null && waiting.length === 0) {
    return null;
  }
  return (
    <section className="ew-next" aria-labelledby="ew-next-title">
      <div className="ew-next-main">
        <p className="ew-next-eyebrow" id="ew-next-title">
          {primary !== null ? "Needs you" : "Waiting on someone else"}
        </p>
        {primary !== null ? (
          <>
            <h3>{primary.action.title}</h3>
            <p>{primary.action.detail}</p>
          </>
        ) : (
          <>
            <h3>{waiting[0]?.title}</h3>
            <p>{waiting[0]?.detail}</p>
          </>
        )}
      </div>
      {primary !== null ? (
        <div className="ew-next-act">
          {primary.action.kind === "approve_plan" ? (
            canAct && current !== null ? (
              <span className="ew-next-buttons">
                <a
                  className="btn btn-secondary"
                  href={planningHref(ids.organizationId, ids.projectId, {
                    control: ids.controlId,
                  })}
                >
                  Review the test plan
                </a>
                <button
                  type="button"
                  className="btn"
                  disabled={plan.pending || current.pendingChanges > 0}
                  title={
                    current.pendingChanges > 0
                      ? "Accept or dismiss the proposed changes first."
                      : undefined
                  }
                  onClick={() =>
                    plan.run("approve", {
                      intent: "approve",
                      version: current.version,
                    })
                  }
                >
                  <UiIcon name="check" size={14} />
                  {plan.busy === "approve" ? "Approving…" : primary.label}
                </button>
              </span>
            ) : null
          ) : primary.action.kind === "plan" ? (
            canAct ? (
              <button
                type="button"
                className="btn"
                disabled={plan.pending}
                onClick={() => plan.run("generate", { intent: "generate" })}
              >
                <UiIcon name="sparkles" size={14} />
                {plan.busy === "generate" ? "Planning…" : primary.label}
              </button>
            ) : null
          ) : (
            <a
              className="btn"
              href={evidenceHref(tabHref, primary.action.target)}
            >
              {primary.label}
              <UiIcon name="arrow" size={14} />
            </a>
          )}
          <Problem text={plan.problem} />
        </div>
      ) : null}
      {rest.length > 0 ? (
        <ul className="ew-next-rest" aria-label="Also needs you">
          {rest.slice(0, 4).map((action) => (
            <li key={action.key}>
              <span>
                <strong>{action.title}</strong>
                <small>{action.detail}</small>
              </span>
              <a
                className="cw-open"
                href={evidenceHref(tabHref, action.target)}
              >
                Open
                <UiIcon name="arrow" size={13} />
              </a>
            </li>
          ))}
          {rest.length > 4 ? (
            <li className="ew-next-more">
              <small>{rest.length - 4} more, each on its request below.</small>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}

/** Where the evidence stands, in four figures: requirements, requests, files, blockers. */
function EvidenceStrip({
  summary,
  proposed,
}: {
  summary: EvidenceSummary;
  /** The plan waits for approval: its items are a proposal, nothing is requested. */
  proposed: boolean;
}) {
  const { requirements: q, requests: r, files: f, blockers } = summary;
  return (
    <div className="ew-strip">
      {proposed ? (
        <div className="ew-figure is-warn">
          <small>Evidence plan</small>
          <strong>
            {q.total}
            <span> items proposed</span>
          </strong>
          <span>Awaiting approval: nothing is requested yet</span>
        </div>
      ) : (
        <div className="ew-figure">
          <small>Evidence plan</small>
          <strong>
            {q.accepted}
            <span> / {q.total} accepted</span>
          </strong>
          <span>
            {join([
              q.toJudge > 0 && `${q.toJudge} to judge`,
              q.gaps > 0 && `${q.gaps} short`,
              q.withOwner > 0 && `${q.withOwner} with the owner`,
              q.unsent > 0 && `${q.unsent} not sent yet`,
              q.notRequested > 0 && `${q.notRequested} not requested yet`,
            ]) || (q.total === 0 ? "Not planned yet" : "All accepted")}
          </span>
        </div>
      )}
      <div className="ew-figure">
        <small>Requests</small>
        <strong>
          {r.answered}
          <span> / {r.total} answered</span>
        </strong>
        <span>
          {join([
            r.drafted > 0 && `${r.drafted} drafted`,
            r.approval > 0 && `${r.approval} awaiting approval`,
            r.approved > 0 && `${r.approved} approved, not sent`,
            r.out > 0 && `${r.out} with the owner`,
            r.overdue > 0 && `${r.overdue} overdue`,
          ]) || (r.total === 0 ? "None yet" : "All answered")}
        </span>
      </div>
      <div className="ew-figure">
        <small>Files</small>
        <strong>
          {f.total}
          <span> received</span>
        </strong>
        <span>
          {join([
            f.read > 0 && `${f.read} read`,
            f.reading > 0 && `${f.reading} being read`,
            f.failed > 0 && `${f.failed} unreadable`,
          ]) || "Nothing received yet"}
        </span>
      </div>
      <div className={`ew-figure${blockers.length > 0 ? " is-warn" : ""}`}>
        <small>Blockers</small>
        <strong>{blockers.length}</strong>
        <span title={blockers.join("\n") || undefined}>
          {blockers[0] ?? "Nothing holds the evidence up"}
          {blockers.length > 1 ? ` · ${blockers.length - 1} more` : ""}
        </span>
      </div>
    </div>
  );
}

const RUN_WORDS: Record<AgentLane["run"], string> = {
  running: "Running",
  queued: "Queued",
  stopped: "Stopped",
  idle: "",
};

/**
 * The agents on the evidence: the planner, the request drafter, and the evidence reader,
 * each with what it did and the person's decision it waits for; then what the reader
 * proposes for each item that arrived, for a person to judge.
 */
function EvidenceAgents({
  ids,
  plan,
  canAct,
  lanes,
  proposals,
  actions,
  onReview,
}: {
  ids: Ids;
  plan: EvidencePlan | null;
  canAct: boolean;
  lanes: AgentLane[];
  proposals: Proposal[];
  actions: EvidenceAction[];
  onReview: (requirementId: string) => void;
}) {
  const action = usePlanAction(ids);
  const planned = plan !== null && plan.status !== "NOT_PLANNED";
  const items = liveRequirements(plan).length;
  return (
    <section className="cw-roster ew-agents" aria-labelledby="ew-agents-title">
      <header className="cw-roster-head">
        <h2 className="cw-section-title" id="ew-agents-title">
          <UiIcon name="sparkles" size={14} />
          Agents on the evidence
        </h2>
        <p>{waitingWords(actions)}</p>
      </header>
      <ul className="cw-lanes">
        <li>
          <div className="cw-lane ew-lane">
            <span className="cw-lane-agent">
              <strong>Evidence planner</strong>
              <small>What each phase needs, and why</small>
            </span>
            <span className="cw-lane-output">
              {planned
                ? `${items} item${items === 1 ? "" : "s"} across ${plan.phases.filter((p) => p.applicability !== "NOT_APPLICABLE").length} phases, by the ${plan.source === "MODEL" ? "agent" : "rules"}${plan.generatedAt ? `, ${formatDate(plan.generatedAt)}` : ""}`
                : plan?.reconcile !== null && plan?.reconcile !== undefined
                  ? "Not planned: this control launched before evidence planning, and a request was drafted then"
                  : "Not planned yet"}
            </span>
            <span className="cw-lane-decision">
              {!planned ? (
                <small>None yet</small>
              ) : plan.status === "APPROVED" ? (
                <span className="cw-decided">
                  <UiIcon name="check" size={12} />
                  {plan.approvedAutomatically
                    ? "Took effect automatically: nothing needed a person's judgment"
                    : `Approved${plan.approvedBy ? ` by ${plan.approvedBy}` : ""}`}
                </span>
              ) : (
                <>
                  <span className="cw-owner">Preparer</span>
                  {plan.status === "CHANGES_PROPOSED"
                    ? `${plan.pendingChanges} proposed change${plan.pendingChanges === 1 ? "" : "s"} to decide, then approve`
                    : plan.attention.length > 0
                      ? `${plan.attention.length === 1 ? "One point needs" : `${plan.attention.length} points need`} your judgment, then approve the plan`
                      : `${PLAN_STATUS_LABELS[plan.status]}: approve the plan`}
                </>
              )}
            </span>
            <span className="ew-lane-actions" />
          </div>
        </li>
        {lanes.map((lane) => (
          <li key={lane.key}>
            <div className={`cw-lane ew-lane is-${lane.run}`}>
              <span className="cw-lane-agent">
                <strong>{lane.agent}</strong>
                <small>{lane.job}</small>
              </span>
              <span className="cw-lane-output">
                {lane.run !== "idle" ? (
                  <span className={`cw-run is-${lane.run}`}>
                    {lane.run === "running" ? (
                      <span className="cw-pulse" aria-hidden="true" />
                    ) : null}
                    {RUN_WORDS[lane.run]}
                  </span>
                ) : null}
                {lane.runNote !== "" ? <small>{lane.runNote}</small> : null}
                {lane.output !== "" ? lane.output : null}
                {lane.output === "" && lane.runNote === "" ? (
                  <small>{lane.waitsFor || "Nothing yet"}</small>
                ) : null}
              </span>
              <span className="cw-lane-decision">
                {lane.decision.state === "pending" ? (
                  <>
                    <span className="cw-owner">{lane.decision.owner}</span>
                    {lane.decision.text}
                  </>
                ) : lane.decision.state === "decided" ? (
                  <span className="cw-decided">
                    <UiIcon name="check" size={12} />
                    {lane.decision.text}
                  </span>
                ) : (
                  <small>None yet</small>
                )}
              </span>
              <span className="ew-lane-actions" />
            </div>
          </li>
        ))}
      </ul>
      {proposals.length > 0 ? (
        <div className="ew-proposals" aria-busy={action.pending}>
          <p className="cw-label">
            What the reader proposes
            <span>{proposals.length}</span>
          </p>
          <ul>
            {proposals.map(({ requirement, phaseLabel, assessment }) => (
              <li
                key={requirement.id}
                className={`is-${assessment.proposal.toLowerCase()}`}
              >
                <div className="ew-proposal-text">
                  <strong>
                    {phaseLabel}: {requirement.title}
                  </strong>
                  <span>
                    <span
                      className="cw-ai"
                      title="The evidence reader's proposal, not a decision"
                    >
                      AI
                    </span>{" "}
                    {PROPOSAL_LABELS[assessment.proposal]}. {assessment.reason}
                  </span>
                </div>
                <div className="cw-attention-actions">
                  {canAct && assessment.proposal === "SUFFICIENT" ? (
                    <button
                      type="button"
                      className="btn-sm"
                      disabled={action.pending}
                      onClick={() =>
                        action.run(`accept-${requirement.id}`, {
                          intent: "sufficiency",
                          requirement_id: requirement.id,
                          sufficiency: "ACCEPTED",
                          version: requirement.version,
                        })
                      }
                    >
                      {action.busy === `accept-${requirement.id}`
                        ? "Accepting…"
                        : "Accept"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="cw-open ew-link"
                    onClick={() => onReview(requirement.id)}
                  >
                    Review
                    <UiIcon name="arrow" size={13} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="cw-hint">
            Proposals from what the reader found in each file. An item is
            accepted only when you accept it.
          </p>
          <Problem text={action.problem} />
        </div>
      ) : null}
    </section>
  );
}

/** Every requirement across the phases, by phase, filtered by phase and status, each with
 * its files, the reader's view, and a person's decision. */
function RequirementsView({
  ids,
  plan,
  canAct,
  files,
}: {
  ids: Ids;
  plan: EvidencePlan | null;
  canAct: boolean;
  files: HeldFile[];
}) {
  const action = usePlanAction(ids);
  const id = useId();
  const [chosen, setChosen] = useState<Phase | null>(null);
  const phase = chosen ?? focusPhase(plan?.phases ?? []);
  const [status, setStatus] = useState<RequirementStatusFilter>("all");
  if (plan === null || plan.status === "NOT_PLANNED") {
    return (
      <p className="ep-explain">
        The evidence for this control has not been planned yet. The evidence
        planner works out what each phase needs and why; plan it from the agents
        above.
      </p>
    );
  }
  const groups = requirementGroups(plan, phase, status);
  const counts = (key: Phase) =>
    requirementGroups(plan, key, "all")[0]?.items.length ?? 0;
  const shown = groups.reduce((sum, group) => sum + group.items.length, 0);
  const proposed = planAwaitsApproval(plan);
  return (
    <div className="ew-reqs" aria-busy={action.pending}>
      {proposed ? (
        <div className="ew-proposed">
          <div>
            <strong>
              {plan.status === "CHANGES_PROPOSED"
                ? "Changes to the plan await your decision"
                : plan.status === "CHANGES_REQUESTED"
                  ? "The reviewer asked for changes to the plan"
                  : plan.attention.length > 0
                    ? "The planner left points for you to resolve"
                    : "Proposed plan, not approved yet"}
            </strong>
            {plan.attention.length > 0 ? (
              <ul className="ew-attention">
                {plan.attention.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
            <p>
              Nothing is requested until a reviewer approves this plan, with its
              attributes. The requests are drafted then.
              {plan.attention.length > 0
                ? " Resolve the points above in Planning basis or on the items below, then approve."
                : ""}
            </p>
          </div>
          {canAct ? (
            <PlannerActions ids={ids} plan={plan} approve={false} />
          ) : null}
        </div>
      ) : null}
      <div className="ew-filters">
        <fieldset className="cw-seg">
          <legend className="sr-only">Phase</legend>
          {PHASES.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={phase === key}
              className={phase === key ? "is-on" : undefined}
              onClick={() => setChosen(key)}
            >
              {PHASE_NAMES[key]}
              <span className="ew-count">{counts(key)}</span>
            </button>
          ))}
        </fieldset>
        <label className="cw-select">
          <span className="sr-only">Status</span>
          <select
            id={`${id}-status`}
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as RequirementStatusFilter)
            }
          >
            {(
              Object.keys(STATUS_FILTER_LABELS) as RequirementStatusFilter[]
            ).map((key) => (
              <option key={key} value={key}>
                {STATUS_FILTER_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {groups.map(({ phase: current, items }) => {
        const span = phasePeriod(current);
        return (
          <section
            key={current.phase}
            className="ew-phase"
            aria-label={PHASE_LABELS[current.phase]}
          >
            <header className="ew-phase-head">
              <h3>{PHASE_LABELS[current.phase]}</h3>
              <span className="ep-chip">
                {current.applicability === null
                  ? "Not decided"
                  : APPLICABILITY_LABELS[current.applicability]}
              </span>
              {proposed ? (
                <span className="cx-status">Proposed</span>
              ) : (
                <span
                  className={`cx-status ${PHASE_STATE_TONES[current.state]}`}
                >
                  {current.stateLabel}
                </span>
              )}
              {span !== "" ? <span className="ep-period">{span}</span> : null}
            </header>
            {current.applicability === "NOT_APPLICABLE" ? (
              <p className="form-hint">Not applicable: {current.rationale}</p>
            ) : current.applicability === "CONDITIONAL" && current.condition ? (
              <p className="form-hint">Requested when: {current.condition}</p>
            ) : current.applicability === "PENDING" && current.openQuestion ? (
              <p className="form-hint">To decide: {current.openQuestion}</p>
            ) : null}
            {items.length > 0 ? (
              <ul className="cc-list">
                {items.map((item) => (
                  <RequirementRow
                    key={item.id}
                    item={item}
                    canAct={canAct}
                    action={action}
                    linkable={linkableFiles(item, files)}
                    proposed={proposed}
                  />
                ))}
              </ul>
            ) : current.applicability !== "NOT_APPLICABLE" ? (
              <p className="cc-empty ep-empty">
                {status === "all"
                  ? "No evidence is planned for this phase yet."
                  : "Nothing in this phase matches."}
              </p>
            ) : null}
          </section>
        );
      })}
      {shown === 0 && status !== "all" ? (
        <p className="form-hint">No item matches this status.</p>
      ) : null}
      {action.note ? <p className="cc-note">{action.note}</p> : null}
      <Problem text={action.problem} />
    </div>
  );
}
