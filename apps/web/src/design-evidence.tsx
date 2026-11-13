"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useId,
  useState,
  useTransition,
} from "react";
import { HeldPicker, PolicyPicker } from "./add-evidence-menu";
import { AutoRefresh } from "./auto-refresh";
import { ControlSend } from "./control-send";
import type { ActivityItem } from "./control-workspace-model";
import {
  type EvidenceList,
  type EvidenceRow,
  evidenceActivity,
  fileMeta,
  type MenuKey,
  REQUESTS_CHANGED_EVENT,
  rowMenu,
} from "./design-evidence-model";
import {
  AttributesDialog,
  RequestDialog,
  useRequestAction,
} from "./design-requests";
import type { RequestRow as RequestsRow } from "./design-requests-model";
import {
  type AttributeLine,
  assuranceProblem,
  type CheckAction,
  type FileCheck,
  offeredAction,
} from "./evidence-assurance-model";
import { centerHref, DEFAULT_QUERY } from "./evidence-center-model";
import { type DialogOpen, EvidenceDialog } from "./evidence-dialog";
import {
  type EvidenceFinding,
  SENDABLE_STATUSES,
} from "./evidence-findings-model";
import {
  FindingRecords,
  FollowUpComposer,
  useFindingsAction,
} from "./evidence-findings-view";
import { evidenceHref } from "./evidence-flow";
import { RequestUpload } from "./evidence-intake";
import type { Intelligence } from "./evidence-intelligence-view";
import type {
  EvidencePlan,
  PlanRequirement,
  RequirementFile,
} from "./evidence-plan-model";
import {
  type Action,
  type FileForm,
  Problem,
  usePlanAction,
} from "./evidence-plan-view";
import { PreviewButton } from "./evidence-preview";
import { formatOf, wordingOf } from "./evidence-requests-model";
import type { HeldFile } from "./evidence-workspace-model";
import { linkableFiles } from "./evidence-workspace-model";
import { fileLine } from "./evidence-workspace-view";
import { formatDate } from "./format";
import { LocalTime } from "./local-time";
import {
  choosable,
  type PolicyEvidence,
  proposalsFor,
  stillChecking,
} from "./policy-evidence-model";
import {
  CheckingPolicies,
  PolicyOnFile,
  usePolicyEvidence,
} from "./policy-on-file";
import { RowMenu, type RowMenuItem } from "./row-menu";
import { tracesSample } from "./sample-trace-model";
import { SampleTrace, useSampleTrace } from "./sample-trace-view";
import { type IconName, UiIcon } from "./ui-icon";

type Ids = {
  organizationId: string;
  projectId: string;
  controlId: string;
  /** The workflow step the file forms post from, so the page comes back to it. */
  step?: string | null;
};

/** Why nothing is offered right after an upload: rows may have moved to another
 * request, so the plan is read again first. */
const LOCKED = "The list is being read again after the upload. One moment.";

type ListDialog =
  | { mode: "add" }
  | { mode: "edit"; row: RequestsRow }
  | { mode: "attributes"; row: RequestsRow };

/** What a person is asked to say before a judgment or a change is recorded. */
type Asking =
  | { kind: "FOLLOW_UP_REQUIRED" | "INSUFFICIENT" | "NOT_REVIEWED" | "WAIVE" }
  | { kind: "UNLINK"; file: RequirementFile };

const MENU_ICONS: Record<MenuKey, IconName> = {
  edit: "compose",
  attributes: "tag",
  upload: "upload",
  policy: "file",
  held: "layers",
  "follow-up": "message",
  insufficient: "risk",
  waive: "minus",
  restore: "retry",
  reopen: "retry",
  delete: "trash",
};

/**
 * "Check again" on a file whose check failed or is out of date
 * (docs/evidence-assurance.md): one call, as the list's other actions make theirs.
 * Success is said only once the server has answered, and the checks are then read again
 * in place (no reload; open rows and filters stay). A refusal because the check changed
 * under the person (409) reads them again too.
 */
function useAssuranceAction(ids: Ids) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  async function run(fileId: string): Promise<boolean> {
    setBusy(fileId);
    setProblem(null);
    let status = 0;
    let detail = "";
    try {
      const response = await fetch("/workspace/evidence-assurance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          control_id: ids.controlId,
          intent: "rerun",
          file_id: fileId,
        }),
      });
      const body = (await response.json()) as {
        status?: unknown;
        detail?: unknown;
      };
      status = typeof body.status === "number" ? body.status : 0;
      detail = typeof body.detail === "string" ? body.detail : "";
    } catch {
      status = 0;
    }
    setBusy("");
    const message = assuranceProblem(status, detail);
    setProblem(message);
    if (message === null || status === 409) {
      startTransition(() => router.refresh());
    }
    return message === null;
  }
  return { run, busy, pending: pending || busy !== "", problem };
}

/** A row as the pre-release list's dialogs read it (edit, change attributes). */
function asRequest(row: EvidenceRow): RequestsRow {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    description: row.description,
    shows: "",
    kind: row.kind,
    icon: row.icon,
    line: row.kind,
    origin: "AGENT",
    originLine: "",
    letters: row.letters,
    attributeIds: row.attributeIds,
    addresses: row.addresses,
    state: "ACCEPTED",
    change: null,
    acceptedBy: null,
    acceptedAt: null,
    procedureIds: row.procedureIds,
  };
}

/**
 * The D&I Evidence step once its requests are drafted (product owner, 12 November 2026:
 * "Just simplify this where the user can easily edit the request, add another evidence
 * request, and can easily upload any evidence that was received. Still keep the option to
 * send out the request to the process owners."). The one list of before, continued: who
 * the requests go to and whether they went, then one row per request with the attributes
 * it addresses, where it stands, Upload, and its menu; a row opens to its wording, the
 * evidence that came back, what the agent read in it, and Accept. Sending opens the same
 * review and confirmation as before (ControlSend); nothing shows as sent, uploaded or
 * accepted until the server confirms it. The step's frame carries the status, the one
 * decision line and the agent's line, so none of that is repeated here.
 */
export function DesignEvidence({
  ids,
  view,
  plan,
  canAct,
  files,
  applications,
  system,
  intelligence,
  controlRef,
  activity,
  head,
  library,
  otherFiles,
  documents,
  stepHref,
  focusView,
}: {
  ids: Ids;
  view: EvidenceList;
  plan: EvidencePlan;
  /** The person may change the control's plan and judge evidence. The server checks. */
  canAct: boolean;
  files: HeldFile[];
  applications: Array<{ id: string; name: string }>;
  system: string | null;
  intelligence: Intelligence;
  controlRef: string;
  activity: ActivityItem[] | null;
  /** Above the list: the request opened by its address (?request=), and why uploads
   * are held. */
  head: ReactNode;
  /** The control's files no request shows, with their actions. */
  library: ReactNode;
  /** How many files that is. */
  otherFiles: number;
  /** The optional governing documents, folded: their one line and their setup. */
  documents: { line: string; body: ReactNode };
  /** The step's own address: a request opens on it (?request=). */
  stepHref: string;
  /** The view a link names (?ev=): "files" opens the other files. */
  focusView: string | null;
}) {
  const id = useId();
  const router = useRouter();
  const action = usePlanAction(ids);
  const list = useRequestAction(ids);
  const policies = usePolicyEvidence(ids);
  const checks = useAssuranceAction(ids);
  const requirements = new Map(
    plan.phases
      .flatMap((phase) => phase.requirements)
      .map((item) => [item.id, item]),
  );
  // The rows the person opened or closed; until then the first that waits on them is open.
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null);
  const [dialog, setDialog] = useState<ListDialog | null>(null);
  const [done, setDone] = useState("");
  const [removed, setRemoved] = useState<{
    id: string;
    title: string;
    version: number;
  } | null>(null);
  // Evidence is added and reviewed in the evidence dialog, opened on a file a link names.
  const [evidence, setEvidence] = useState<DialogOpen | null>(() =>
    intelligence.focusFile != null
      ? { mode: "review", fileId: intelligence.focusFile }
      : intelligence.openAdd === true
        ? { mode: "add", itemId: null }
        : null,
  );
  const opened = chosen ?? new Set(view.open !== null ? [view.open] : []);
  const flip = (each: string) => {
    const next = new Set(opened);
    if (next.has(each)) {
      next.delete(each);
    } else {
      next.add(each);
    }
    setChosen(next);
  };
  const wording = new Map(view.attributes.map((item) => [item.id, item]));
  // An upload can move rows to another request (evidence in hand splits a request), so
  // after one nothing else is offered until the plan has been read again: the plan the
  // upload was made on is remembered, and the list is locked while it is still shown.
  const [settling, setSettling] = useState<EvidencePlan | null>(null);
  // The upload reads the plan again itself. Should that reading never arrive, the
  // lock lifts after a while rather than hold the list for good: the server still
  // refuses anything made on a request the row has left.
  useEffect(() => {
    if (settling === null) {
      return;
    }
    const timer = window.setTimeout(() => setSettling(null), 10000);
    return () => window.clearTimeout(timer);
  }, [settling]);
  const locked = action.pending || list.pending || settling === plan;
  // The review pane closed because the requests changed under it (evidence in hand
  // split one): the server's sentence is shown here, over the groups as they now are.
  const [changed, setChanged] = useState<string | null>(null);
  useEffect(() => {
    const onChanged = (event: Event) => {
      const said = (event as CustomEvent<unknown>).detail;
      if (typeof said === "string" && said !== "") {
        // Taken: the pane may close, the list shows why.
        event.preventDefault();
        setChanged(said);
      }
    };
    window.addEventListener(REQUESTS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(REQUESTS_CHANGED_EVENT, onChanged);
  }, []);
  const problem = action.problem ?? list.problem ?? checks.problem;
  const events = evidenceActivity(activity);

  async function remove(row: EvidenceRow) {
    setDone("");
    const ok = await list.run(`remove-${row.id}`, "planning", {
      intent: "evidence-remove",
      requirement_id: row.id,
      version: row.version,
    });
    if (ok) {
      setRemoved({ id: row.id, title: row.title, version: row.version + 1 });
    }
  }

  async function restore(item: { id: string; version: number }) {
    setDone("");
    const ok = await list.run(`restore-${item.id}`, "planning", {
      intent: "evidence-restore",
      requirement_id: item.id,
      version: item.version,
    });
    if (ok) {
      setRemoved(null);
      setDone("Request restored.");
    }
  }

  return (
    <section className="dq de" aria-label="D&I requests" aria-busy={locked}>
      {head}
      <div className="ta-bar de-bar">
        <h4 className="ta-section-title">{view.title}</h4>
        {canAct ? (
          <span className="ta-bar-acts">
            <button
              type="button"
              className="btn btn-ghost btn-sm ta-quiet"
              disabled={locked}
              onClick={() => setDialog({ mode: "add" })}
            >
              <UiIcon name="plus" size={13} />
              Add request
            </button>
            {/* Approved and sent here, through the same check, review and confirmation
                as before: shown only while requests wait to be sent. */}
            {view.send.show ? (
              <ControlSend ids={ids} handover={view.send.handover} />
            ) : null}
            {/* A file that fits no request yet is still added here, in the evidence
                dialog, where the agent says which request it serves. */}
            <RowMenu
              label="the D&I evidence"
              items={[
                {
                  label: "Add a file that fits no request",
                  icon: "upload",
                  unavailable: locked ? LOCKED : null,
                  onSelect: () => setEvidence({ mode: "add", itemId: null }),
                },
                {
                  label: "Open in the Evidence center",
                  icon: "inbox",
                  href: centerHref(ids, DEFAULT_QUERY, { q: controlRef }),
                },
              ]}
            />
          </span>
        ) : null}
      </div>
      <p className="ta-done" role="status">
        {done !== "" && problem === null ? (
          <>
            <UiIcon name="check" size={14} />
            {done}
          </>
        ) : null}
      </p>
      {removed !== null ? (
        <p className="pe-removed" role="status">
          <span>“{removed.title}” was deleted. It stays in the history.</span>
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={locked}
            onClick={() => void restore(removed)}
          >
            {list.busy === `restore-${removed.id}` ? "Restoring…" : "Undo"}
          </button>
        </p>
      ) : null}
      {action.note ? <p className="cc-note">{action.note}</p> : null}
      <Problem text={problem ?? changed} />

      {view.groups.map((group) => {
        const reviewHref =
          group.line.requestId === null
            ? null
            : evidenceHref(stepHref, {
                view: "requests",
                request: group.line.requestId,
              });
        return (
          <div className="de-card" key={group.key}>
            <div
              className={`de-delivery${group.line.quiet ? " is-quiet" : ""}`}
            >
              <UiIcon name={group.line.quiet ? "file" : "mail"} size={14} />
              {group.line.quiet ? (
                <span className="de-delivery-to">{group.line.status}</span>
              ) : (
                <>
                  <span className="de-delivery-to">
                    To <strong>{group.line.to}</strong>
                    {group.line.role !== "" ? ` · ${group.line.role}` : ""}
                    {group.line.due !== "" ? ` · ${group.line.due}` : ""}
                  </span>
                  <span
                    className={`de-delivery-status tone-${group.line.tone}`}
                  >
                    {group.line.status}
                  </span>
                </>
              )}
              {canAct && group.line.canChange && reviewHref !== null ? (
                <Link
                  className="de-change"
                  href={reviewHref}
                  scroll={false}
                  aria-label="Change the recipient and the due date"
                >
                  Change
                </Link>
              ) : null}
              {/* Approved and nothing went out, or the send failed: the request itself
                  holds the send the server allows, so the line opens it. */}
              {canAct && group.line.action !== null && reviewHref !== null ? (
                <Link
                  className="btn btn-secondary btn-sm"
                  href={reviewHref}
                  scroll={false}
                >
                  {group.line.action}
                </Link>
              ) : null}
              <RowMenu
                label={group.line.quiet ? "these requests" : "this request"}
                items={[
                  // Named for what it is: never "the email" for a draft or a hand-over.
                  ...(group.line.preview === "" || reviewHref === null
                    ? []
                    : [
                        {
                          label: group.line.preview,
                          icon: "eye" as const,
                          onSelect: () =>
                            router.push(reviewHref, { scroll: false }),
                        },
                      ]),
                  {
                    label: "Open in the Evidence center",
                    icon: "inbox" as const,
                    href: centerHref(ids, DEFAULT_QUERY, { q: controlRef }),
                  },
                ]}
              />
            </div>
            {group.rowIds.length === 0 ? (
              // A request no row travels in (a follow-up, a samples request): its line
              // above says where it stands; this says what it is.
              <p className="de-lone">{group.label}</p>
            ) : (
              <ul
                className="tar-list"
                aria-label={
                  view.groups.length === 1
                    ? "D&I requests"
                    : `D&I requests: ${group.line.quiet ? group.line.status : `to ${group.line.to}, ${group.line.status}`}`
                }
              >
                {group.rowIds.map((rowId) => {
                  const row = view.rows.find((each) => each.id === rowId);
                  if (row === undefined) {
                    return null;
                  }
                  const item = requirements.get(row.id);
                  return item === undefined ? null : (
                    <Row
                      key={row.id}
                      ids={ids}
                      row={row}
                      item={item}
                      open={opened.has(row.id)}
                      onToggle={() => flip(row.id)}
                      canAct={canAct}
                      action={action}
                      locked={locked}
                      onUploaded={() => setSettling(plan)}
                      files={files}
                      applications={applications}
                      system={system}
                      policies={policies.evidence}
                      onPolicyDecided={policies.reload}
                      wording={wording}
                      attributeCount={view.attributes.length}
                      onDialog={setEvidence}
                      findings={intelligence.findings ?? null}
                      controlRef={controlRef}
                      checks={checks}
                      onCoverage={() =>
                        document
                          .getElementById(`${id}-coverage`)
                          ?.scrollIntoView({ block: "center" })
                      }
                      onEdit={() =>
                        setDialog({ mode: "edit", row: asRequest(row) })
                      }
                      onAttributes={() =>
                        setDialog({ mode: "attributes", row: asRequest(row) })
                      }
                      onRemove={() => void remove(row)}
                      onDone={(note) => {
                        setRemoved(null);
                        setDone(note);
                      }}
                    />
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
      {view.rows.length === 0 ? (
        <p className="dr-empty">
          No D&amp;I request is on the list. Add one, then choose the attributes
          it addresses.
        </p>
      ) : null}

      {/* While the agent reads a file the list is read again, in place, so the row
          moves from Reading… to To review by itself; it stops when the reading ends. */}
      {view.rows.some((row) => row.reading > 0) ? (
        <AutoRefresh />
      ) : view.rows.some((row) => row.assurance?.working === true) ? (
        // The same while a file is checked against the attributes: two readings take
        // longer than one, so the list is read again less often and for longer.
        <AutoRefresh key="checks" seconds={5} limit={60} />
      ) : null}

      {view.coverage.length > 0 ? (
        <section className="dq-coverage" aria-labelledby={`${id}-coverage`}>
          <div className="dq-cov-head">
            <h4 className="ta-section-title" id={`${id}-coverage`}>
              Coverage
            </h4>
            <span className="dq-cov-line">{view.coverageLine}</span>
          </div>
          <ul className="dq-cov-chips">
            {view.coverage.map((chip) => (
              <li
                key={chip.attributeId}
                className={`dq-cov ${
                  chip.state === "EVIDENCED"
                    ? "is-covered"
                    : chip.state === "REQUESTED"
                      ? "is-requested"
                      : chip.state === "EXCEPTED"
                        ? "is-exception"
                        : "is-uncovered"
                }`}
                title={`${chip.label}. ${chip.text}${chip.reason !== "" ? ` Reason: ${chip.reason}` : ""}`}
              >
                <span className="sr-only">{chip.label}</span>
                <span className="dq-cov-letter" aria-hidden="true">
                  {chip.letter}
                </span>
                {chip.state === "EVIDENCED" ? (
                  <span className="dq-cov-state" aria-hidden="true">
                    <UiIcon name="check" size={12} />
                  </span>
                ) : chip.state === "REQUESTED" ? null : (
                  <span className="dq-cov-state" aria-hidden="true">
                    {chip.state === "EXCEPTED"
                      ? "Reason recorded"
                      : "Not addressed"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="dr-more">
        {/* The reason behind a "Reason recorded" chip, readable on request. */}
        {view.exceptions.length > 0 ? (
          <details className="dr-fold">
            <summary>
              <span>
                <strong>Not evidenced at D&amp;I</strong>
                <small>
                  {view.exceptions.length} attribute
                  {view.exceptions.length === 1 ? "" : "s"}, with the reason
                  recorded
                </small>
              </span>
              <UiIcon name="chevron" size={13} />
            </summary>
            <ul className="dq-reasons">
              {view.exceptions.map((item) => (
                <li key={item.attributeId}>
                  <span className="dr-code">{item.letter}</span>
                  <span className="dq-reason-text">
                    <span>{item.text}</span>
                    <q>{item.reason}</q>
                    <small>
                      {[
                        item.recordedBy,
                        item.recordedAt !== null
                          ? formatDate(item.recordedAt)
                          : "",
                      ]
                        .filter((part) => part !== "")
                        .join(" · ")}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {view.attributes.length > 0 ? (
          <details className="dr-fold">
            <summary>
              <span>
                <strong>
                  Tested against {view.attributes.length} attribute
                  {view.attributes.length === 1 ? "" : "s"}
                </strong>
                {view.sources !== "" ? (
                  <small>From {view.sources}</small>
                ) : null}
              </span>
              <UiIcon name="chevron" size={13} />
            </summary>
            <ol className="dr-attrs">
              {view.attributes.map((item) => (
                <li key={item.id}>
                  <span className="dr-code">{item.letter}</span>
                  <span className="dr-attr-text">{item.text}</span>
                  <small>{item.source}</small>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
        <details className="dr-fold">
          <summary>
            <span>
              <strong>Governing documents</strong>
              <small>{documents.line}</small>
            </span>
            <UiIcon name="chevron" size={13} />
          </summary>
          <div className="dr-fold-body">{documents.body}</div>
        </details>
        {/* Files of the control that no request shows (a file that arrived by email
            and is not filed yet, say): kept reachable, and only when there are any. */}
        {otherFiles > 0 || focusView === "files" ? (
          <details
            className="dr-fold"
            id="ev-files"
            open={focusView === "files" || undefined}
          >
            <summary>
              <span>
                <strong>Other files</strong>
                <small>
                  {otherFiles === 0 ? "None" : `${otherFiles} not on a request`}
                </small>
              </span>
              <UiIcon name="chevron" size={13} />
            </summary>
            <div className="dr-fold-body">{library}</div>
          </details>
        ) : null}
        {view.history.length > 0 ? (
          <details className="dr-fold">
            <summary>
              <span>
                <strong>History</strong>
                <small>
                  {view.history.length} deleted request
                  {view.history.length === 1 ? "" : "s"}
                </small>
              </span>
              <UiIcon name="chevron" size={13} />
            </summary>
            <ul className="dq-history">
              {view.history.map((item) => (
                <li key={item.id}>
                  <span className="dq-history-text">
                    <span>{item.title}</span>
                    <small>{item.kind} · Deleted</small>
                  </span>
                  {canAct ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={locked}
                      aria-label={`Restore ${item.title}`}
                      onClick={() => void restore(item)}
                    >
                      {list.busy === `restore-${item.id}`
                        ? "Restoring…"
                        : "Restore"}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <details className="dr-fold">
          <summary>
            <span>
              <strong>Activity</strong>
              <small>{view.activityLine}</small>
            </span>
            <UiIcon name="chevron" size={13} />
          </summary>
          <div className="dr-fold-body">
            {events.length === 0 ? (
              <p className="dr-empty">No activity on these requests yet.</p>
            ) : (
              <ol className="er-activity">
                {events.map((event) => (
                  <li key={event.id}>
                    <LocalTime at={event.at} />
                    <div>
                      <strong>{event.title}</strong>
                      <p className="er-sub">
                        {event.actor}
                        {event.detail ? ` · ${event.detail}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </details>
      </div>

      {dialog === null ? null : dialog.mode === "attributes" ? (
        <AttributesDialog
          key={dialog.row.id}
          ids={ids}
          row={dialog.row}
          attributes={view.attributes}
          onClose={() => setDialog(null)}
          onDone={(note) => {
            setDialog(null);
            setDone(note);
          }}
        />
      ) : (
        <RequestDialog
          key={dialog.mode === "add" ? "add" : dialog.row.id}
          ids={ids}
          row={dialog.mode === "edit" ? dialog.row : null}
          attributes={view.attributes}
          preset={[]}
          onClose={() => setDialog(null)}
          onDone={(note) => {
            setDialog(null);
            setRemoved(null);
            setDone(note);
          }}
        />
      )}
      {evidence !== null ? (
        <EvidenceDialog
          key={
            evidence.mode === "review"
              ? evidence.fileId
              : `add-${evidence.itemId ?? ""}`
          }
          open={evidence}
          onClose={() => setEvidence(null)}
          ids={ids}
          plan={plan}
          register={intelligence.register}
          mapping={intelligence.mapping}
          attributes={intelligence.attributes}
          controlRef={controlRef}
          canAct={canAct}
          findings={intelligence.findings}
          tests={intelligence.tests ?? null}
          instances={intelligence.instances ?? null}
        />
      ) : null}
    </section>
  );
}

/** One request: its line, its Upload and its menu; open, its wording and its evidence. */
function Row({
  ids,
  row,
  item,
  open,
  onToggle,
  canAct,
  action,
  locked,
  onUploaded,
  files,
  applications,
  system,
  policies,
  onPolicyDecided,
  wording,
  attributeCount,
  onDialog,
  findings,
  controlRef,
  checks,
  onCoverage,
  onEdit,
  onAttributes,
  onRemove,
  onDone,
}: {
  ids: Ids;
  row: EvidenceRow;
  item: PlanRequirement;
  open: boolean;
  onToggle: () => void;
  canAct: boolean;
  action: Action;
  locked: boolean;
  /** Files were added: the plan is read again before anything else is offered. */
  onUploaded: () => void;
  files: HeldFile[];
  applications: Array<{ id: string; name: string }>;
  system: string | null;
  policies: PolicyEvidence;
  onPolicyDecided: () => void;
  wording: ReadonlyMap<string, { letter: string; text: string }>;
  attributeCount: number;
  onDialog: (open: DialogOpen) => void;
  /** The control's evidence findings: an issue the check found is one of them. */
  findings: EvidenceFinding[] | null;
  controlRef: string;
  /** "Check again" on a file of the row. */
  checks: ReturnType<typeof useAssuranceAction>;
  /** Shows which attributes the requests cover (the coverage under the list). */
  onCoverage: () => void;
  onEdit: () => void;
  onAttributes: () => void;
  onRemove: () => void;
  /** Called once the server has confirmed, with what to say on the list. */
  onDone: (note: string) => void;
}) {
  const id = useId();
  const bodyId = `${id}-body`;
  const [asking, setAsking] = useState<Asking | null>(null);
  const [words, setWords] = useState("");
  const [picker, setPicker] = useState<"policy" | "held" | null>(null);
  const [fileForm, setFileForm] = useState<{
    fileId: string;
    form: FileForm;
  } | null>(null);
  // A change to one of its files, confirmed by the server.
  const [fileDone, setFileDone] = useState<string | null>(null);
  // The assurance chain's check of each file, and the findings its issues are.
  const assured = row.assurance;
  const findingsAction = useFindingsAction(ids);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const issueIds = new Set(
    (assured?.files ?? []).flatMap((check) =>
      check.attributes.flatMap((line) =>
        line.findingId === null ? [] : [line.findingId],
      ),
    ),
  );
  const toSend = (findings ?? []).filter(
    (finding) =>
      issueIds.has(finding.id) &&
      picked.has(finding.id) &&
      SENDABLE_STATUSES.includes(finding.status),
  );
  const held = linkableFiles(item, files);
  const documents = choosable(policies, item.id);
  const onFile = proposalsFor(policies, item.id);
  const uploads = canAct && row.uploadBlocked === null;
  // A design item that walks one instance through: its files are read together.
  const traced = open && item.files.length > 0 && tracesSample(item);
  const [trace, setTrace, traceFailed] = useSampleTrace(
    action.ids,
    item.id,
    traced,
    item.files
      .map(
        (file) =>
          `${file.fileId}:${file.readStatus === "PENDING" || file.readStatus === "WORKING" ? 1 : 0}`,
      )
      .join(","),
  );
  const ask = (next: Asking, prefill = "") => {
    setAsking(next);
    setWords(prefill);
    setPicker(null);
    if (!open) {
      onToggle();
    }
  };
  const followUp = () =>
    ask(
      { kind: "FOLLOW_UP_REQUIRED" },
      // The reader's own follow-up points start the text only where the chain has not
      // checked the row: they were never checked by a second reading.
      assured?.covered === true
        ? ""
        : item.assessment.followUps.join("; ").slice(0, 1000),
    );

  async function checkAgain(fileId: string) {
    if (await checks.run(fileId)) {
      onDone("The check was started again.");
    }
  }

  /** The one action that clears a hold, or runs a check again. */
  const actOn = (fileId: string, act: CheckAction) => {
    if (act.kind === "RERUN") {
      void checkAgain(fileId);
    } else if (act.kind === "REPLACE") {
      setFileForm({ fileId, form: "replace" });
      setFileDone(null);
    } else {
      // The file's type is confirmed, and a walkthrough instance picked, in the
      // evidence dialog.
      onDialog({ mode: "review", fileId });
    }
  };

  async function accept() {
    const ok = await action.run(`judge-${item.id}`, {
      intent: "sufficiency",
      requirement_id: item.id,
      sufficiency: "ACCEPTED",
      version: item.version,
    });
    if (ok) {
      onDone("Evidence accepted.");
    }
  }

  async function restore() {
    const ok = await action.run(`restore-${item.id}`, {
      intent: "restore",
      requirement_id: item.id,
      version: item.version,
    });
    if (ok) {
      onDone("Request restored.");
    }
  }

  async function submitAsk() {
    if (asking === null) {
      return;
    }
    const ok =
      asking.kind === "WAIVE"
        ? await action.run(`waive-${item.id}`, {
            intent: "waive",
            requirement_id: item.id,
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
    if (ok) {
      onDone(
        asking.kind === "WAIVE"
          ? "Marked not applicable."
          : asking.kind === "UNLINK"
            ? "File unlinked."
            : asking.kind === "NOT_REVIEWED"
              ? "Decision reopened."
              : asking.kind === "INSUFFICIENT"
                ? "Marked insufficient."
                : "Follow-up recorded.",
      );
      setAsking(null);
      setWords("");
    }
  }

  const menuFor = (pick: (() => void) | null): RowMenuItem[] => {
    const run: Record<MenuKey, () => void> = {
      edit: onEdit,
      attributes: onAttributes,
      upload: () => pick?.(),
      policy: () => {
        setPicker("policy");
        if (!open) {
          onToggle();
        }
      },
      held: () => {
        setPicker("held");
        if (!open) {
          onToggle();
        }
      },
      "follow-up": followUp,
      insufficient: () => ask({ kind: "INSUFFICIENT" }),
      waive: () => ask({ kind: "WAIVE" }),
      restore: () => void restore(),
      reopen: () => ask({ kind: "NOT_REVIEWED" }),
      delete: onRemove,
    };
    return rowMenu(row, {
      policies: documents.length,
      held: held.length,
      attributes: attributeCount,
    }).map((entry) => ({
      label: entry.label,
      icon: MENU_ICONS[entry.key],
      // After an upload nothing is offered until the plan is read again.
      unavailable: locked ? LOCKED : entry.unavailable,
      ...(entry.danger === true ? { danger: true } : {}),
      onSelect: run[entry.key],
    }));
  };

  const lines = new Map(
    item.files.map((file) => [
      file.fileId,
      fileLine(
        ids,
        file,
        files.find((each) => each.id === file.fileId),
        canAct,
        applications,
        fileForm?.fileId === file.fileId ? fileForm.form : null,
        (form, note) => {
          setFileForm(form === null ? null : { fileId: file.fileId, form });
          setFileDone(note ?? null);
        },
      ),
    ]),
  );
  const guide = wordingOf(item.description);
  const hasGuide =
    guide !== null || item.objective !== "" || item.rationale !== "";

  const content = (pick: (() => void) | null, running: boolean) => (
    <div className="de-grid">
      <button
        type="button"
        className="tar-head dq-head de-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className="dr-tile" aria-hidden="true">
          <UiIcon name={row.icon} size={16} />
        </span>
        <span className="tar-name">
          <span className="tar-text">{row.title}</span>
          <span className="tar-source">{row.sub}</span>
          {assured !== null && assured.states.length > 0 ? (
            <span className="de-states">
              {assured.states.map((group) => (
                <span
                  key={group.state}
                  className={`de-state tone-${group.tone}`}
                >
                  <UiIcon name={group.icon} size={12} />
                  {group.label}
                </span>
              ))}
            </span>
          ) : null}
        </span>
        <span className="dq-meta">
          <span className="dq-letters">
            <span className="sr-only">{`, ${row.addresses}, `}</span>
            {row.letters.length > 0 ? (
              row.attributeIds.map((attributeId) => {
                const attribute = wording.get(attributeId);
                return (
                  <span
                    key={attributeId}
                    className="dr-code"
                    aria-hidden="true"
                    title={
                      attribute !== undefined
                        ? `Addresses attribute ${attribute.letter}: ${attribute.text}`
                        : undefined
                    }
                  >
                    {attribute?.letter ?? ""}
                  </span>
                );
              })
            ) : (
              <span className="dq-none" aria-hidden="true">
                No attribute
              </span>
            )}
          </span>
          <span className={`tar-chip tone-${row.chip.tone}`}>
            {row.chip.label}
          </span>
        </span>
      </button>
      <span className="dq-menu de-acts">
        {uploads && pick !== null ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm de-upload"
            disabled={running || locked}
            aria-label={`Upload evidence for ${row.title}`}
            title="Choose files, or drop them on the row. They are evidence for this request only."
            onClick={pick}
          >
            {running ? (
              <span className="spinner small" aria-hidden="true" />
            ) : (
              <UiIcon name="upload" size={13} />
            )}
            <span className="de-upload-label">
              {running ? "Uploading…" : "Upload"}
            </span>
          </button>
        ) : null}
        {canAct ? <RowMenu label={row.title} items={menuFor(pick)} /> : null}
      </span>
      <button
        type="button"
        className="de-caret"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onToggle}
      >
        <UiIcon name="chevron" size={14} />
      </button>
      {open ? (
        <div className="tar-body de-body" id={bodyId}>
          {row.change !== null ? (
            <div className="dq-change">
              <p className="ta-why">
                <span className="tar-origin">
                  {row.change.remove
                    ? "The agent proposes removing this request."
                    : "The agent proposes a change to this request."}
                </span>{" "}
                It stays as it is until you accept the change.
              </p>
              {!row.change.remove && row.change.title !== "" ? (
                <p className="ta-replaces">
                  <span>Proposed title</span> {row.change.title}
                </p>
              ) : null}
              {!row.change.remove && row.change.description !== "" ? (
                <p className="ta-replaces">
                  <span>Proposed request</span> {row.change.description}
                </p>
              ) : null}
              {canAct ? (
                <div className="tc-row-acts">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={locked}
                    onClick={async () => {
                      if (
                        await action.run(`change-${item.id}`, {
                          intent: "change",
                          requirement_id: item.id,
                          decision: "ACCEPT",
                          version: item.version,
                        })
                      ) {
                        onDone("Change accepted.");
                      }
                    }}
                  >
                    Accept the change
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={locked}
                    onClick={async () => {
                      if (
                        await action.run(`change-${item.id}`, {
                          intent: "change",
                          requirement_id: item.id,
                          decision: "DISMISS",
                          version: item.version,
                        })
                      ) {
                        onDone("Kept as it was.");
                      }
                    }}
                  >
                    Keep as it is
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="tc is-flat">
            <dl className="tc-rules">
              <div>
                <dt>Request</dt>
                <dd>
                  {guide !== null
                    ? `${guide.lead}.`
                    : item.description || "Not stated"}
                  <span className="de-request-acts">
                    {hasGuide ? (
                      <details className="de-must">
                        <summary>
                          What it must show
                          <UiIcon name="chevron" size={12} />
                        </summary>
                        <div className="er-guide de-guide">
                          {guide !== null ? (
                            <>
                              <ul>
                                {guide.include.map((line) => (
                                  <li key={line}>{line}</li>
                                ))}
                              </ul>
                              {guide.completeness ? (
                                <p>
                                  <b>Complete when</b> {guide.completeness}
                                </p>
                              ) : null}
                              {guide.notSufficient ? (
                                <p>
                                  <b>Not sufficient</b> {guide.notSufficient}
                                </p>
                              ) : null}
                              {guide.alternatives.length > 0 ? (
                                <p>
                                  <b>If not available</b>{" "}
                                  {guide.alternatives.join("; ")}
                                </p>
                              ) : null}
                            </>
                          ) : item.objective !== "" ? (
                            <p>{item.objective}</p>
                          ) : null}
                          {item.sampleSelection ? (
                            <p>
                              <b>Samples</b> {item.sampleSelection}
                            </p>
                          ) : null}
                          {item.rationale !== "" ? (
                            <p className="er-sub">
                              <b>Why</b> {item.rationale}
                            </p>
                          ) : null}
                        </div>
                      </details>
                    ) : null}
                    {canAct && !row.sent && row.change === null ? (
                      <button
                        type="button"
                        className="de-link"
                        disabled={locked}
                        onClick={onEdit}
                      >
                        Edit
                      </button>
                    ) : null}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Addresses</dt>
                <dd>
                  {row.attributeIds.length === 0 ? (
                    "No attribute yet"
                  ) : (
                    <ul className="dq-addressed">
                      {row.attributeIds.map((attributeId) => {
                        const attribute = wording.get(attributeId);
                        return attribute === undefined ? null : (
                          <li key={attributeId}>
                            <span className="dr-code">{attribute.letter}</span>
                            <span>{attribute.text}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </dd>
              </div>
              <div>
                <dt>Format · period</dt>
                <dd>
                  {[formatOf(row.categories), row.period]
                    .filter((part) => part !== "")
                    .join(" · ")}
                </dd>
              </div>
              <div>
                <dt>Evidence</dt>
                <dd className="de-evidence">
                  {fileDone !== null ? (
                    <p className="ep-done" role="status">
                      <UiIcon name="check" size={14} />
                      <span>{fileDone}</span>
                    </p>
                  ) : null}
                  {item.files.length === 0 ? (
                    <p className="de-none">
                      {row.state === "NO_FILE"
                        ? "Its request is marked received, but no file serves this request. Upload the file, or use one the control already holds."
                        : row.uploadBlocked === null
                          ? "No file yet. Upload what you receive, or drop it on the row."
                          : "No file yet."}
                    </p>
                  ) : (
                    <ul className="de-files">
                      {item.files.map((file) => {
                        const line = lines.get(file.fileId);
                        const reading =
                          file.readStatus === "PENDING" ||
                          file.readStatus === "WORKING";
                        const meta = fileMeta(
                          files.find((each) => each.id === file.fileId),
                          file,
                        );
                        const fileMenu: RowMenuItem[] = [
                          ...(line?.actions ?? []),
                          ...(canAct &&
                          file.via === "LINK" &&
                          file.linkId !== null
                            ? [
                                {
                                  label: "Unlink from this request",
                                  onSelect: () => ask({ kind: "UNLINK", file }),
                                },
                              ]
                            : []),
                        ];
                        const check =
                          assured?.files.find(
                            (each) => each.fileId === file.fileId,
                          ) ?? null;
                        const onRegister = files.find(
                          (each) => each.id === file.fileId,
                        );
                        return (
                          <li
                            key={file.fileId}
                            className={`de-file${reading ? " is-reading" : ""}`}
                          >
                            <div className="de-file-main">
                              <UiIcon name="file" size={15} />
                              <span className="de-file-text">
                                <button
                                  type="button"
                                  className="ep-file-name ep-file-open"
                                  onClick={() =>
                                    onDialog({
                                      mode: "review",
                                      fileId: file.fileId,
                                    })
                                  }
                                >
                                  {file.name}
                                </button>
                                {meta !== "" ? <small>{meta}</small> : null}
                                {reading ? (
                                  <small className="ep-reading" role="status">
                                    Reading
                                    <span
                                      className="ep-dots"
                                      aria-hidden="true"
                                    >
                                      <i />
                                      <i />
                                      <i />
                                    </span>
                                  </small>
                                ) : file.readStatus === "FAILED" ? (
                                  <small>Could not be read</small>
                                ) : null}
                                {line?.flag ?? null}
                              </span>
                              {fileMenu.length > 0 ? (
                                <RowMenu label={file.name} items={fileMenu} />
                              ) : null}
                            </div>
                            {check !== null && !reading ? (
                              <CheckOfFile
                                ids={ids}
                                check={check}
                                fileName={file.name}
                                action={offeredAction(check.action, {
                                  canAct,
                                  replaceable:
                                    onRegister !== undefined &&
                                    (onRegister.blocked ?? null) === null,
                                })}
                                busy={checks.busy === file.fileId}
                                disabled={locked || checks.pending}
                                onAct={(act) => actOn(file.fileId, act)}
                                findings={findings}
                                findingsAction={findingsAction}
                                canAct={canAct}
                                picked={picked}
                                onPick={(findingId, on) =>
                                  setPicked((current) => {
                                    const next = new Set(current);
                                    if (on) {
                                      next.add(findingId);
                                    } else {
                                      next.delete(findingId);
                                    }
                                    return next;
                                  })
                                }
                              />
                            ) : null}
                            {line?.form ?? null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {traced ? (
                    <SampleTrace
                      ids={action.ids}
                      requirementId={item.id}
                      trace={trace}
                      failed={traceFailed}
                      canAct={canAct}
                      onTrace={setTrace}
                    />
                  ) : null}
                  {row.agent !== null && row.reading === 0 ? (
                    <div className="de-agent">
                      <UiIcon name="sparkles" size={14} />
                      <div>
                        <p>
                          <strong>{row.agent.lead}</strong> {row.agent.text}
                        </p>
                        {row.agent.followUps.length > 0 ? (
                          <ul className="ep-follow">
                            {row.agent.followUps.map((point) => (
                              <li key={point}>{point}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {item.passedOver.length > 0 ? (
                    <p className="ep-passed">
                      {item.passedOver.join(", ")} came in on its request, but
                      the reader found{" "}
                      {item.passedOver.length === 1 ? "it does" : "they do"} not
                      cover this request.
                      {canAct && held.length > 0
                        ? " Use it from the menu if it does."
                        : ""}
                    </p>
                  ) : null}
                  {row.note !== "" ? (
                    <p className="ep-note">{row.note}</p>
                  ) : null}
                  {stillChecking(policies, item) ? <CheckingPolicies /> : null}
                  {onFile.map((proposal) => (
                    <PolicyOnFile
                      key={proposal.id}
                      ids={ids}
                      proposal={proposal}
                      canAct={canAct}
                      onDecided={onPolicyDecided}
                      onMapping={onCoverage}
                    />
                  ))}
                  {picker === "policy" ? (
                    <PolicyPicker
                      ids={ids}
                      itemId={item.id}
                      documents={documents}
                      onCancel={() => setPicker(null)}
                      onFiled={() => {
                        setPicker(null);
                        onPolicyDecided();
                      }}
                    />
                  ) : null}
                  {picker === "held" ? (
                    <HeldPicker
                      held={held}
                      onCancel={() => setPicker(null)}
                      onLink={async (fileId, reason) => {
                        if (
                          await action.run(`link-${item.id}`, {
                            intent: "link",
                            requirement_id: item.id,
                            file_id: fileId,
                            reason,
                            version: item.version,
                          })
                        ) {
                          setPicker(null);
                          onDone("File added to the request.");
                        }
                      }}
                    />
                  ) : null}
                  {canAct && asking !== null ? (
                    <AskForm
                      asking={asking}
                      words={words}
                      busy={locked}
                      onWords={setWords}
                      onCancel={() => setAsking(null)}
                      onSubmit={() => void submitAsk()}
                    />
                  ) : null}
                  {/* The follow-up a person sends from the issues' findings they
                      ticked: the findings' own, as in the evidence dialog. */}
                  {canAct && item.requestId !== null ? (
                    <FollowUpComposer
                      findings={toSend}
                      requestId={item.requestId}
                      controlRef={controlRef}
                      controlTitle=""
                      action={findingsAction}
                      onSent={() => setPicked(new Set())}
                    />
                  ) : null}
                  {canAct && asking === null && row.canAccept ? (
                    <div className="de-accept">
                      {/* What accepting marks as evidenced, and what it leaves
                          open: it informs, and never holds the person back. */}
                      {assured !== null && assured.acceptNote !== "" ? (
                        <p className="de-accept-note">{assured.acceptNote}</p>
                      ) : null}
                      <div className="tc-row-acts">
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={locked}
                          onClick={() => void accept()}
                        >
                          {action.busy === `judge-${item.id}`
                            ? "Accepting…"
                            : "Accept"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={locked}
                          onClick={followUp}
                        >
                          Ask a follow-up
                        </button>
                      </div>
                    </div>
                  ) : null}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <li
      id={`req-${item.id}`}
      // While the list is locked (an upload just ended and the plan is being read
      // again) a drop is not taken: the row may travel in another request by now.
      onDropCapture={
        locked
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
            }
          : undefined
      }
      className={`tar de-row is-${row.state.toLowerCase()}${open ? " is-open" : ""}${row.aside ? " is-aside" : ""}`}
    >
      {uploads && item.requestId !== null ? (
        <RequestUpload
          organizationId={ids.organizationId}
          projectId={ids.projectId}
          requestId={item.requestId}
          requirementId={item.id}
          label={item.title}
          // A policy or procedure may govern several systems: the person says which.
          systems={
            item.categories.includes("PROCESS_DOCUMENTATION")
              ? applications
              : []
          }
          system={system}
          onUploaded={onUploaded}
          chooser={(pick, running) => content(pick, running)}
        />
      ) : (
        content(null, false)
      )}
    </li>
  );
}

/**
 * A file's check by the assurance chain (docs/evidence-assurance.md, section 7): one
 * quiet line while it works; held, failed or out of date, one line with the single
 * action that clears it; finished, each attribute with its state in words and a mark,
 * opening to what the two readings rest on, what is absent, and both readings side by
 * side where they do not agree. An issue is its evidence finding, with the finding's own
 * actions. Nothing of a check is shown before it finishes.
 */
function CheckOfFile({
  ids,
  check,
  fileName,
  action,
  busy,
  disabled,
  onAct,
  findings,
  findingsAction,
  canAct,
  picked,
  onPick,
}: {
  ids: Ids;
  check: FileCheck;
  fileName: string;
  /** The action as this person is offered it; null when there is none for them. */
  action: CheckAction | null;
  busy: boolean;
  disabled: boolean;
  onAct: (action: CheckAction) => void;
  findings: EvidenceFinding[] | null;
  findingsAction: ReturnType<typeof useFindingsAction>;
  canAct: boolean;
  picked: Set<string>;
  onPick: (findingId: string, on: boolean) => void;
}) {
  if (check.standing === "CHECKING") {
    return (
      <div className="de-check is-checking">
        <p className="de-check-line">
          <UiIcon name="sparkles" size={13} />
          <span className="ep-reading" role="status">
            {check.line}
            {check.stage !== "" ? ` · ${check.stage}` : ""}
            <span className="ep-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </span>
        </p>
      </div>
    );
  }
  if (check.standing !== "REVIEWED") {
    return (
      <div className={`de-check is-${check.standing.toLowerCase()}`}>
        <div className="de-check-line">
          <UiIcon
            name={check.standing === "HELD" ? "info" : "retry"}
            size={13}
          />
          <span>{check.line}</span>
          {action !== null ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={disabled}
              aria-label={`${action.label}: ${fileName}`}
              onClick={() => onAct(action)}
            >
              {busy ? "Starting…" : action.label}
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className="de-check is-reviewed">
      <p className="de-check-line">
        <UiIcon name="shield" size={13} />
        <span>
          {check.line}
          {check.readInPart !== null ? (
            <strong className="de-check-part"> {check.readInPart}</strong>
          ) : null}
        </span>
      </p>
      {check.attributes.length > 0 ? (
        <ul className="de-attrs">
          {check.attributes.map((line) => (
            <AttributeCheck
              key={line.key}
              ids={ids}
              line={line}
              fileId={check.fileId}
              fileName={fileName}
              finding={
                line.findingId === null
                  ? null
                  : ((findings ?? []).find(
                      (finding) => finding.id === line.findingId,
                    ) ?? null)
              }
              findingsAction={findingsAction}
              canAct={canAct}
              picked={picked}
              onPick={onPick}
            />
          ))}
        </ul>
      ) : null}
      {check.notAddressed.length > 0 ? (
        <p className="de-unaddressed">
          <span className="de-state tone-neutral">
            <UiIcon name="minus" size={12} />
            Not addressed by this file
          </span>
          {check.notAddressed.map((line) => (
            <span
              key={line.key}
              className="dr-code"
              title={[line.text, line.summary]
                .filter((part) => part !== "")
                .join(" ")}
            >
              {line.letter}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/** One attribute of a finished check: its letter, its state in words with a mark, and
 * one line on it; open, what the readings rest on. */
function AttributeCheck({
  ids,
  line,
  fileId,
  fileName,
  finding,
  findingsAction,
  canAct,
  picked,
  onPick,
}: {
  ids: Ids;
  line: AttributeLine;
  fileId: string;
  fileName: string;
  /** The evidence finding an issue is; null when it has none, or it was not read. */
  finding: EvidenceFinding | null;
  findingsAction: ReturnType<typeof useFindingsAction>;
  canAct: boolean;
  picked: Set<string>;
  onPick: (findingId: string, on: boolean) => void;
}) {
  return (
    <li className={`de-attr is-${line.state.toLowerCase()}`}>
      <details open={line.open || undefined}>
        <summary>
          <span className="dr-code" aria-hidden="true">
            {line.letter}
          </span>
          <span className="sr-only">{`Attribute ${line.letter}: `}</span>
          <span className={`de-state tone-${line.tone}`}>
            <UiIcon name={line.icon} size={12} />
            {line.label}
          </span>
          <span className="de-attr-summary">
            {line.summary !== "" ? line.summary : line.text}
          </span>
          <span className="de-attr-caret" aria-hidden="true">
            <UiIcon name="chevron" size={12} />
          </span>
        </summary>
        <div className="de-attr-body">
          {line.text !== "" && line.summary !== "" ? (
            <p className="de-attr-text">
              <span>Attribute {line.letter}</span> {line.text}
            </p>
          ) : null}
          {line.judgment !== null ? (
            <p className="de-judgment">{line.judgment}</p>
          ) : null}
          {line.readings.length > 0 ? (
            <div className="de-views">
              {line.readings.map((reading) => (
                <div key={reading.who} className="de-view">
                  <strong>{reading.who}</strong>
                  <span className="de-view-result">{reading.result}</span>
                  <p>
                    {reading.reason !== ""
                      ? reading.reason
                      : "It gave no reason."}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
          {finding !== null ? (
            // The issue is this finding: shown once, with the finding's own actions.
            <FindingRecords
              findings={[finding]}
              canAct={canAct}
              action={findingsAction}
              picked={picked}
              onPick={onPick}
              onShow={() => {}}
              focused={null}
            />
          ) : (
            <>
              {line.passages.length > 0 ? (
                <ul className="de-passages">
                  {line.passages.map((passage) => (
                    <li key={`${passage.location}-${passage.quote}`}>
                      <q>{passage.quote}</q>
                      <span className="de-where">
                        <span>
                          {passage.location !== ""
                            ? passage.location
                            : "In the file"}
                        </span>
                        {passage.fileId === fileId ? (
                          <PreviewButton
                            organizationId={ids.organizationId}
                            projectId={ids.projectId}
                            files={[{ id: fileId, fileName }]}
                            citations={[
                              {
                                fileId,
                                fileName,
                                quote: passage.quote,
                                found: true,
                                location: passage.location,
                                page: passage.page,
                                box: null,
                                label: line.letter,
                              },
                            ]}
                            sourcesTitle="What the readings rest on"
                            label="Open in the file"
                            className="de-link"
                          />
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {line.absent.length > 0 ? (
                <div className="de-absent">
                  <span>Not in the file</span>
                  <ul>
                    {line.absent.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {line.findingId !== null ? (
                <p className="de-absent">
                  The finding that records this issue could not be shown here.
                  Open the file to act on it.
                </p>
              ) : null}
            </>
          )}
        </div>
      </details>
    </li>
  );
}

const ASK_WORDS: Record<
  Asking["kind"],
  { label: string; placeholder: string; save: string; min: number; max: number }
> = {
  FOLLOW_UP_REQUIRED: {
    label: "What to ask the owner for",
    placeholder: "What is missing or needs a follow-up",
    save: "Record the follow-up",
    min: 3,
    max: 1000,
  },
  INSUFFICIENT: {
    label: "What is missing",
    placeholder: "Why the evidence is not sufficient",
    save: "Mark insufficient",
    min: 3,
    max: 1000,
  },
  NOT_REVIEWED: {
    label: "Why the decision is reopened",
    placeholder: "Why the decision is reopened",
    save: "Reopen",
    min: 3,
    max: 1000,
  },
  WAIVE: {
    label: "Why it does not apply",
    placeholder: "Why this does not apply (scope, control, or methodology)",
    save: "Mark not applicable",
    min: 10,
    max: 1000,
  },
  UNLINK: {
    label: "Why it no longer serves it",
    placeholder: "Why the file no longer serves this request",
    save: "Unlink",
    min: 3,
    max: 500,
  },
};

/** The few words a judgment or a change needs before it is recorded. What was typed
 * stays if the server refuses. */
function AskForm({
  asking,
  words,
  busy,
  onWords,
  onCancel,
  onSubmit,
}: {
  asking: Asking;
  words: string;
  busy: boolean;
  onWords: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const id = useId();
  const copy = ASK_WORDS[asking.kind];
  const ready = words.trim().length >= copy.min;
  return (
    <form
      autoComplete="off"
      className="de-ask"
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !busy) {
          onSubmit();
        }
      }}
    >
      <label htmlFor={`${id}-words`}>{copy.label}</label>
      <textarea
        id={`${id}-words`}
        value={words}
        rows={2}
        maxLength={copy.max}
        placeholder={copy.placeholder}
        // biome-ignore lint/a11y/noAutofocus: the form opens on the person's own choice of this action, and typing is its only step.
        autoFocus
        onChange={(event) => onWords(event.target.value)}
      />
      <span className="tc-row-acts">
        <button type="submit" className="btn btn-sm" disabled={!ready || busy}>
          {busy ? "Saving…" : copy.save}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </span>
    </form>
  );
}
