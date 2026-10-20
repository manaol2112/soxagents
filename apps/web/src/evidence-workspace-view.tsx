"use client";

import { type ReactNode, useEffect, useState } from "react";

import {
  type EvidencePlan,
  PHASE_LABELS,
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
  EVIDENCE_VIEWS,
  type EvidenceSummary,
  type EvidenceView,
  evidenceViewOf,
  type HeldFile,
  linkableFiles,
  liveRequirements,
  type Proposal,
  phaseDigest,
  requirementGroups,
} from "./evidence-workspace-model";
import { planningHref } from "./planning-model";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };

/**
 * The control's evidence on one page, without tabs: what the evidence reader proposes for a
 * person to decide, then the evidence items by phase, each phase folded to one line unless
 * something in it waits on a person; the requests, the files, and the planning basis fold
 * below. A link to a view (?ev=, ?request=, or the older #ev- hash) opens its fold. Where
 * the evidence stands and the next action are on the record's summary; the plan is
 * reviewed on the Test plans page.
 */
export function EvidenceWorkspace({
  ids,
  plan,
  canAct,
  summary,
  proposals,
  files,
  requests,
  library,
  rcmItems,
  focus,
}: {
  ids: Ids;
  plan: EvidencePlan | null;
  canAct: boolean;
  summary: EvidenceSummary;
  proposals: Proposal[];
  /** The view and the request the address names (?ev=, ?request=). */
  focus: { view: string | null; request: string | null };
  files: HeldFile[];
  requests: ReactNode;
  library: ReactNode;
  rcmItems: string[];
}) {
  const [wanted, setWanted] = useState<EvidenceView>(
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
    const hash = window.location.hash.replace("#ev-", "");
    const found = EVIDENCE_VIEWS.find((key) => key === hash);
    if (found !== undefined) {
      setWanted(found);
    }
  }, [focus.view, focus.request]);
  const r = summary.requests;
  const f = summary.files;
  return (
    <div className="ew">
      <ReaderProposals
        ids={ids}
        canAct={canAct}
        proposals={proposals}
        onReview={(id) =>
          document
            .getElementById(`req-${id}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" })
        }
      />
      <RequirementsView ids={ids} plan={plan} canAct={canAct} files={files} />
      <EvidenceFold
        title="Requests"
        line={
          r.total === 0
            ? "None yet"
            : [
                `${r.answered} of ${r.total} answered`,
                r.drafted > 0 ? `${r.drafted} drafted` : "",
                r.approval > 0 ? `${r.approval} awaiting approval` : "",
                r.overdue > 0 ? `${r.overdue} overdue` : "",
              ]
                .filter((part) => part !== "")
                .join(" · ")
        }
        open={wanted === "requests"}
        id="ev-requests"
      >
        {requests}
      </EvidenceFold>
      <EvidenceFold
        title="Files"
        line={
          f.total === 0
            ? "Nothing received yet"
            : [
                `${f.total} received`,
                f.reading > 0 ? `${f.reading} being read` : "",
                f.failed > 0 ? `${f.failed} unreadable` : "",
              ]
                .filter((part) => part !== "")
                .join(" · ")
        }
        open={wanted === "files"}
        id="ev-files"
      >
        {library}
      </EvidenceFold>
      {plan !== null && plan.status !== "NOT_PLANNED" ? (
        <EvidenceFold
          title="Planning basis"
          line="Why each phase applies, missing information, and changes to the control"
          open={wanted === "plan"}
          id="ev-plan"
        >
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
        </EvidenceFold>
      ) : null}
    </div>
  );
}

/** A part of the evidence folded to its title and one line; it opens on request, or when
 * a link points to it. */
function EvidenceFold({
  title,
  line,
  open,
  id,
  children,
}: {
  title: string;
  line: string;
  open: boolean;
  id: string;
  children: ReactNode;
}) {
  return (
    <details className="cw-fold ew-fold" id={id} open={open || undefined}>
      <summary>
        <span>
          <strong>{title}</strong>
          <small>{line}</small>
        </span>
        <UiIcon name="chevron" size={14} />
      </summary>
      <div className="ew-fold-body">{children}</div>
    </details>
  );
}

/**
 * What the evidence reader proposes for each item that arrived, for a person to judge.
 * Shown only while a proposal waits; an item is accepted only when a person accepts it.
 */
function ReaderProposals({
  ids,
  canAct,
  proposals,
  onReview,
}: {
  ids: Ids;
  canAct: boolean;
  proposals: Proposal[];
  onReview: (requirementId: string) => void;
}) {
  const action = usePlanAction(ids);
  if (proposals.length === 0) {
    return null;
  }
  return (
    <section className="cw-plain ew-proposals" aria-busy={action.pending}>
      <h2>
        To judge: what the evidence reader proposes
        <span className="cw-count-pill">{proposals.length}</span>
      </h2>
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
        Proposals from what the reader found in each file. An item is accepted
        only when you accept it.
      </p>
      <Problem text={action.problem} />
    </section>
  );
}

/** The evidence items by phase, each phase folded to one line unless something in it
 * waits on a person; each item one line until it does. */
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
  if (plan === null || plan.status === "NOT_PLANNED") {
    return (
      <div className="ew-proposed">
        <p className="ep-explain">
          The evidence for this control has not been planned yet. The evidence
          planner works out what each phase needs and why.
        </p>
        {canAct ? (
          <PlannerActions ids={ids} plan={plan} approve={false} />
        ) : null}
      </div>
    );
  }
  // A plan that waits for approval is read and approved on the Test plans page, with the
  // rest of the test plan; nothing is requested until then.
  if (planAwaitsApproval(plan)) {
    return (
      <div className="ew-proposed">
        <div>
          <strong>
            {plan.status === "CHANGES_PROPOSED"
              ? "Changes to the evidence plan await a decision"
              : plan.status === "CHANGES_REQUESTED"
                ? "The reviewer asked for changes to the plan"
                : "The evidence plan awaits approval"}
          </strong>
          <p>
            The {liveRequirements(plan).length} planned evidence items are
            reviewed with the test plan. Nothing is requested until the plan is
            approved; the requests are drafted then.
          </p>
        </div>
        <a
          className="btn btn-secondary"
          href={planningHref(ids.organizationId, ids.projectId, {
            control: ids.controlId,
            tab: "evidence",
          })}
        >
          Review the test plan
          <UiIcon name="arrow" size={14} />
        </a>
      </div>
    );
  }
  return (
    <section
      className="ew-reqs"
      aria-label="Evidence"
      aria-busy={action.pending}
    >
      {requirementGroups(plan, "all", "all").map(({ phase, items }) => {
        const digest = phaseDigest(phase, items);
        const span = phasePeriod(phase);
        const applies = phase.applicability !== "NOT_APPLICABLE";
        return (
          <details
            key={phase.phase}
            className="ew-phase-fold"
            open={applies && digest.waiting > 0 ? true : undefined}
          >
            <summary>
              <span className="ew-phase-name">
                <strong>{PHASE_LABELS[phase.phase]}</strong>
                {span !== "" ? <small>{span}</small> : null}
              </span>
              <span
                className={`ew-phase-line${digest.waiting > 0 ? " is-waiting" : ""}`}
              >
                {digest.line}
              </span>
              <UiIcon name="chevron" size={14} />
            </summary>
            {!applies ? (
              <p className="form-hint">Not applicable: {phase.rationale}</p>
            ) : phase.applicability === "CONDITIONAL" && phase.condition ? (
              <p className="form-hint">Requested when: {phase.condition}</p>
            ) : phase.applicability === "PENDING" && phase.openQuestion ? (
              <p className="form-hint">To decide: {phase.openQuestion}</p>
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
                    compact
                  />
                ))}
              </ul>
            ) : applies ? (
              <p className="cc-empty ep-empty">
                No evidence is planned for this phase yet.
              </p>
            ) : null}
          </details>
        );
      })}
      {action.note ? <p className="cc-note">{action.note}</p> : null}
      <Problem text={action.problem} />
    </section>
  );
}
