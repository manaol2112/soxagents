"use client";

import { type ReactNode, useEffect, useState } from "react";
import { FileChanges } from "./evidence-change";
import { RequestUpload } from "./evidence-intake";
import type { RequirementFile } from "./evidence-plan-model";
import {
  type EvidencePlan,
  PHASE_LABELS,
  PROPOSAL_LABELS,
  planAwaitsApproval,
} from "./evidence-plan-model";
import type { FileForm, FileLine } from "./evidence-plan-view";
import {
  PlanDetails,
  PlannerActions,
  Problem,
  phasePeriod,
  RequirementRow,
  usePlanAction,
} from "./evidence-plan-view";
import { PreviewButton } from "./evidence-preview";
import {
  EVIDENCE_VIEWS,
  type EvidenceSummary,
  type EvidenceView,
  evidenceTotal,
  evidenceViewOf,
  type HeldFile,
  linkableFiles,
  liveRequirements,
  type Proposal,
  phaseDigest,
  placedFiles,
  type RequestRow,
  requestsByPhase,
  requirementGroups,
} from "./evidence-workspace-model";
import { planningHref } from "./planning-model";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };

/**
 * The control's evidence on one page, without tabs: what the evidence reader proposes for a
 * person to decide, then one card by phase. Each phase shows its request once (where it
 * stands, Review, Add evidence) and the items it asks for, each with its own state; a
 * request for no planned phase, the files received, and the planning basis close the card.
 * Before the plan is approved the requests and files stand on their own. A link to a view
 * (?ev=, ?request=, or the older #ev- hash) opens its fold.
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
  applications = [],
  system = null,
}: {
  ids: Ids;
  plan: EvidencePlan | null;
  canAct: boolean;
  summary: EvidenceSummary;
  proposals: Proposal[];
  /** The view and the request the address names (?ev=, ?request=). */
  focus: { view: string | null; request: string | null };
  files: HeldFile[];
  /** The control's requests, shown with their actions: those of each phase (rendered on
   * the server, by requestsByPhase), those of no planned phase, and all of them. */
  requests: {
    rows: RequestRow[];
    byPhase: Record<string, ReactNode>;
    other: ReactNode;
    all: ReactNode;
    /** Above the evidence: the request opened for review, and why uploads are held. */
    head: ReactNode;
  };
  library: ReactNode;
  rcmItems: string[];
  /** The control's applications, for a file whose application is not known. */
  applications?: Array<{ id: string; name: string }>;
  /** The application of this instance of the control, if it is one application's. */
  system?: string | null;
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
  const basis =
    plan !== null && plan.status !== "NOT_PLANNED" ? (
      <EvidenceFold
        title="Planning basis"
        line="Why each phase applies, missing information, and changes to the control"
        open={wanted === "plan"}
        id="ev-plan"
        quiet
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
    ) : null;
  // The phases card carries the requests and the basis; before the plan is approved they
  // stand on their own.
  const phasesShown =
    plan !== null && plan.status !== "NOT_PLANNED" && !planAwaitsApproval(plan);
  const grouped = requestsByPhase(
    requests.rows,
    (plan?.phases ?? []).map((phase) => phase.phase),
  );
  const requestLine =
    r.total === 0
      ? "None yet"
      : [
          `${r.answered} of ${r.total} answered`,
          r.drafted > 0 ? `${r.drafted} drafted` : "",
          r.approval > 0 ? `${r.approval} awaiting approval` : "",
          r.overdue > 0 ? `${r.overdue} overdue` : "",
        ]
          .filter((part) => part !== "")
          .join(" · ");
  // Files the items show are listed under them, with their actions; the fold holds the rest.
  const placed = files.filter((file) => placedFiles(plan).has(file.id)).length;
  const filesRow = (
    <EvidenceFold
      title="Files received"
      line={
        f.total === 0
          ? "Nothing received yet"
          : [
              `${f.total} received`,
              placed === 0
                ? ""
                : placed === files.length
                  ? "all under their evidence items"
                  : `${files.length - placed} not under an item`,
              f.reading > 0 ? `${f.reading} being read` : "",
              f.failed > 0 ? `${f.failed} unreadable` : "",
            ]
              .filter((part) => part !== "")
              .join(" · ")
      }
      open={wanted === "files"}
      id="ev-files"
      quiet
    >
      {library}
    </EvidenceFold>
  );
  // The phase that holds the request a link names opens on it.
  const focusPhase =
    focus.request === null
      ? null
      : (requests.rows.find((row) => row.id === focus.request)?.phase ?? null);
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
      {requests.head}
      <RequirementsView
        ids={ids}
        plan={plan}
        canAct={canAct}
        files={files}
        applications={applications}
        system={system}
        openPhase={focusPhase}
        requestsFor={(phase) => requests.byPhase[phase] ?? null}
        tail={
          phasesShown ? (
            <>
              {grouped.other.length > 0 ? (
                <EvidenceFold
                  title="Other requests"
                  line={`${grouped.other.length} follow-up or sample request${grouped.other.length === 1 ? "" : "s"}`}
                  open={
                    wanted === "requests" &&
                    focusPhase !== null &&
                    grouped.other.some((row) => row.id === focus.request)
                  }
                  id="ev-requests"
                >
                  {requests.other}
                </EvidenceFold>
              ) : null}
              {filesRow}
              {basis}
            </>
          ) : null
        }
      />
      {phasesShown ? null : (
        <section className="ew-card" aria-labelledby="ew-requests-title">
          <header className="ew-card-head">
            <h3 id="ew-requests-title">Requests and files</h3>
          </header>
          <EvidenceFold
            title="Requests"
            line={requestLine}
            open={wanted === "requests"}
            id="ev-requests"
          >
            {requests.all}
          </EvidenceFold>
          {filesRow}
          {basis}
        </section>
      )}
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
  quiet = false,
  children,
}: {
  title: string;
  line: string;
  open: boolean;
  id: string;
  /** Reference rather than work: shown in a lighter voice. */
  quiet?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className={`ew-row${quiet ? " is-quiet" : ""}`}
      id={id}
      open={open || undefined}
    >
      <summary>
        <strong className="ew-row-title">{title}</strong>
        <span className="ew-row-line">{line}</span>
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

/**
 * A file on an evidence item's line: its name opens the preview; Download, Replace file,
 * Withdraw, and the application are in the item's one menu, and the form one opens shows
 * under the line. Nothing is deleted: a withdrawn or replaced file stays on record. A file
 * whose application is not known says so, and that opens the choice. A file serving two
 * items carries the same actions on each.
 */
function fileLine(
  ids: Ids,
  file: RequirementFile,
  held: HeldFile | undefined,
  canAct: boolean,
  applications: Array<{ id: string; name: string }>,
  form: FileForm | null,
  setForm: (form: FileForm | null) => void,
): FileLine {
  const unknown =
    canAct && held?.applicationUnknown === true && applications.length > 1;
  const blocked = held?.blocked ?? null;
  const changes = canAct && held !== undefined;
  return {
    name: (
      <PreviewButton
        organizationId={ids.organizationId}
        projectId={ids.projectId}
        files={[{ id: file.fileId, fileName: file.name }]}
        label={file.name}
        className="ep-file-name ep-file-open"
      />
    ),
    flag:
      unknown && form !== "application" ? (
        <button
          type="button"
          className="ep-file-flag"
          onClick={() => setForm("application")}
        >
          Application not set
        </button>
      ) : null,
    actions: [
      {
        label: "Download",
        href: `/workspace/evidence-files/${file.fileId}?organization=${ids.organizationId}&project=${ids.projectId}`,
      },
      ...(unknown
        ? [
            {
              label: "Set the application",
              onSelect: () => setForm("application"),
            },
          ]
        : []),
      ...(changes
        ? [
            {
              label: "Replace file",
              unavailable: blocked,
              onSelect: () => setForm("replace"),
            },
            {
              label: "Withdraw",
              danger: true,
              unavailable: blocked,
              onSelect: () => setForm("withdraw"),
            },
          ]
        : []),
    ],
    form:
      (form === "replace" || form === "withdraw") && held !== undefined ? (
        <div className="ep-file-form">
          <FileChanges
            organizationId={ids.organizationId}
            projectId={ids.projectId}
            fileId={file.fileId}
            fileName={file.name}
            blocked={blocked}
            controlId={ids.controlId}
            start={form}
            onCancel={() => setForm(null)}
          />
        </div>
      ) : form === "application" ? (
        <form
          autoComplete="off"
          method="post"
          action="/workspace/evidence-application"
          className="ep-file-form ep-file-app"
        >
          <input
            type="hidden"
            name="organization_id"
            value={ids.organizationId}
          />
          <input type="hidden" name="project_id" value={ids.projectId} />
          <input type="hidden" name="control_id" value={ids.controlId} />
          <input type="hidden" name="file_id" value={file.fileId} />
          <label htmlFor={`ep-app-${file.fileId}`}>Application it shows</label>
          <select
            id={`ep-app-${file.fileId}`}
            name="application"
            defaultValue=""
            required
          >
            <option value="" disabled>
              Choose the application
            </option>
            {applications.map((app) => (
              <option key={app.id} value={app.id}>
                {app.name}
              </option>
            ))}
            <option value="ALL">All applications (such as a policy)</option>
          </select>
          <button type="submit" className="btn-sm">
            Save
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => setForm(null)}
          >
            Cancel
          </button>
        </form>
      ) : null,
  };
}

/** An item takes no more evidence once accepted, set aside, or its request cancelled. */
const NO_UPLOAD: readonly string[] = [
  "ACCEPTED",
  "CANCELLED",
  "NOT_APPLICABLE",
  "REMOVED",
];

/** The evidence items by phase, each phase folded to one line unless something in it
 * waits on a person; each item one line until it does. */
function RequirementsView({
  ids,
  plan,
  canAct,
  files,
  applications,
  system,
  openPhase,
  requestsFor,
  tail,
}: {
  ids: Ids;
  plan: EvidencePlan | null;
  canAct: boolean;
  files: HeldFile[];
  applications: Array<{ id: string; name: string }>;
  /** The application of this instance of the control. */
  system: string | null;
  /** The phase to open: the one holding the request a link names. */
  openPhase: string | null;
  /** The phase's request, where it stands and its actions, above its items. */
  requestsFor: (phase: string) => ReactNode;
  /** The card's last rows: other requests, the files, the planning basis. */
  tail: ReactNode;
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
  const groups = requirementGroups(plan, "all", "all");
  const digests = groups.map(({ phase, items }) => phaseDigest(phase, items));
  return (
    <section
      className="ew-card ew-reqs"
      aria-labelledby="ew-phases-title"
      aria-busy={action.pending}
    >
      <header className="ew-card-head">
        <h3 id="ew-phases-title">Evidence by phase</h3>
        <span
          className={`ew-card-meta${digests.some((item) => item.waiting > 0) ? " is-waiting" : ""}`}
        >
          {evidenceTotal(digests)}
        </span>
      </header>
      {groups.map(({ phase, items }, index) => {
        const digest = digests[index] ?? phaseDigest(phase, items);
        const span = phasePeriod(phase);
        const applies = phase.applicability !== "NOT_APPLICABLE";
        const share =
          digest.total === 0 ? 0 : (digest.accepted / digest.total) * 100;
        return (
          <details
            key={phase.phase}
            className={`ew-phase-fold${applies ? "" : " is-quiet"}`}
            open={
              (applies && digest.waiting > 0) || openPhase === phase.phase
                ? true
                : undefined
            }
          >
            <summary>
              <span className="ew-phase-name">
                <strong>{PHASE_LABELS[phase.phase]}</strong>
                {span !== "" ? <small>{span}</small> : null}
              </span>
              {applies && digest.total > 0 ? (
                <span className="ew-meter" aria-hidden="true">
                  <span style={{ width: `${share}%` }} />
                </span>
              ) : (
                <span />
              )}
              <span
                className={`ew-phase-line${digest.waiting > 0 ? " is-waiting" : ""}`}
              >
                {digest.line}
              </span>
              <UiIcon name="chevron" size={14} />
            </summary>
            {requestsFor(phase.phase)}
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
                    upload={
                      canAct &&
                      item.requestId !== null &&
                      !NO_UPLOAD.includes(item.state) ? (
                        <RequestUpload
                          organizationId={ids.organizationId}
                          projectId={ids.projectId}
                          requestId={item.requestId}
                          requirementId={item.id}
                          label={item.title}
                          // A policy or procedure may govern several systems: the
                          // person says which, and it serves the item on each.
                          systems={
                            item.categories.includes("PROCESS_DOCUMENTATION")
                              ? applications
                              : []
                          }
                          system={system}
                        />
                      ) : null
                    }
                    fileLine={(file, form, setForm) =>
                      fileLine(
                        ids,
                        file,
                        files.find((held) => held.id === file.fileId),
                        canAct,
                        applications,
                        form,
                        setForm,
                      )
                    }
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
      {tail}
      {action.note ? <p className="cc-note">{action.note}</p> : null}
      <Problem text={action.problem} />
    </section>
  );
}
