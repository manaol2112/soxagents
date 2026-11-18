"use client";

import { useState } from "react";
import { AnalysisPanel } from "./analysis-view";
import type { ControlFiles } from "./engagement-model";
import type { WalkthroughInstance } from "./evidence-dialog-model";
import {
  type EvidenceFinding,
  SENDABLE_STATUSES,
} from "./evidence-findings-model";
import {
  FindingRecords,
  FollowUpComposer,
  type useFindingsAction,
} from "./evidence-findings-view";
import {
  COVERAGE_STATE_LABELS,
  COVERAGE_STATE_TONES,
  type FileInsight,
  type Finding,
  followUpNote,
  type NavItem,
} from "./evidence-intelligence-model";
import type { EvidenceMappingRun } from "./evidence-mapping-model";
import { Problem, type usePlanAction } from "./evidence-plan-view";
import type { EvidenceCitation } from "./evidence-preview-model";
import { formatBytes, formatDate } from "./format";
import type { ControlTest } from "./testing-model";
import { type IconName, UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };

/** The records the workspace reads beside the plan, from the page that holds them. */
export type Intelligence = {
  register: ControlFiles | null;
  mapping: EvidenceMappingRun | null;
  attributes: ReadonlyArray<{ code: string; text: string }>;
  controlTitle: string;
  askHref: string;
  focusFile: string | null;
  /** Opens the dialog on Add evidence on arrival (a link's ?ev=add). */
  openAdd?: boolean;
  /** The control's findings on record (increment 2); null before the API answered. */
  findings: EvidenceFinding[] | null;
  /** The control's sample plans, for the evidence dialog (31 October 2026). */
  tests?: ControlTest[] | null;
  /** The walkthrough instances picked for the control's design items. */
  instances?: WalkthroughInstance[] | null;
};

const KIND_ICON: Record<Finding["kind"], IconName> = {
  GAP: "help",
  PARTIAL: "info",
  NOT_COVERED: "x",
  MISSING: "search",
  CONFLICT: "risk",
  CONCERN: "shield",
  REVIEW: "info",
};

const SOURCE_WORDS: Record<Finding["source"], string> = {
  READER: "The evidence reader",
  MAPPING: "The evidence mapping",
  REVIEW: "The screenshot review",
};

export function citationsOf(
  insight: FileInsight,
  focused: EvidenceCitation | null,
): EvidenceCitation[] {
  const list = [...insight.citations];
  if (focused !== null && !list.some((item) => item.quote === focused.quote)) {
    list.push(focused);
  }
  return list;
}

export { FileBadge } from "./file-badge";

export function Analysis({
  insight,
  items,
  canAct,
  action,
  picked,
  onPick,
  onShow,
  focused,
  records,
  findingsAction,
  pickedRecords,
  onPickRecord,
  controlRef,
  controlTitle,
}: {
  insight: FileInsight;
  items: NavItem[];
  canAct: boolean;
  action: ReturnType<typeof usePlanAction>;
  picked: Set<string>;
  onPick: (key: string, on: boolean) => void;
  onShow: (citation: EvidenceCitation | null) => void;
  focused: EvidenceCitation | null;
  /** The findings on record for this file; null before the API answered, and then the
   * findings derived from the records stand in. */
  records: EvidenceFinding[] | null;
  findingsAction: ReturnType<typeof useFindingsAction>;
  pickedRecords: Set<string>;
  onPickRecord: (id: string, on: boolean) => void;
  controlRef: string;
  controlTitle: string;
}) {
  const [opened, setOpened] = useState<string | null>(null);
  // With findings on record, the derived list keeps only what no record covers (the
  // screenshot review's issues); the records carry the reader's and the mapping's.
  const derived =
    records === null
      ? insight.findings
      : insight.findings.filter((finding) => finding.source === "REVIEW");
  const sendable =
    records === null
      ? []
      : records.filter((finding) => SENDABLE_STATUSES.includes(finding.status));
  const toSend =
    pickedRecords.size > 0
      ? sendable.filter((finding) => pickedRecords.has(finding.id))
      : sendable;
  const total = derived.length + (records?.length ?? 0);
  // Findings on record that wait on a person lead the next action: what came back
  // (ANSWERED) first, then what the agents propose.
  const answered = (records ?? []).filter(
    (f) => f.status === "ANSWERED",
  ).length;
  const proposed = (records ?? []).filter(
    (f) => f.status === "PROPOSED",
  ).length;
  const next =
    answered > 0
      ? {
          title: `Decide what the owner's reply resolves (${answered})`,
          detail:
            "A reply or a later file reached these findings. Resolve, accept the clarification, or ask for more.",
        }
      : proposed > 0
        ? {
            title: `Review ${proposed} finding${proposed === 1 ? "" : "s"} the agent proposes`,
            detail:
              "Accept the ones worth raising, edit their questions, or dismiss them; then send the follow-up in one message.",
          }
        : insight.next;
  const waiting = insight.coverage.rows
    .map((row) =>
      items.find((item) => item.requirement.id === row.requirementId),
    )
    .filter((item): item is NavItem => item?.waits === true);
  const chosen = insight.findings.filter((finding) => picked.has(finding.key));
  const prefill =
    toSend.length > 0
      ? toSend
          .map((finding) => finding.question || finding.title)
          .join("; ")
          .slice(0, 1000)
      : followUpNote(chosen.length > 0 ? chosen : insight.findings);
  return (
    <>
      <div className={`ei-status is-${insight.status.tone}`} role="status">
        <span className="ei-status-mark" aria-hidden="true">
          <UiIcon
            name={
              insight.status.state === "ready"
                ? "check"
                : insight.status.state === "reading"
                  ? "clock"
                  : insight.status.state === "failed"
                    ? "risk"
                    : "info"
            }
            size={16}
          />
        </span>
        <div>
          <strong>{insight.status.label}</strong>
          <p>{insight.status.detail}</p>
        </div>
      </div>

      <section className="ei-block ei-next" aria-label="What to do next">
        <span className="ei-kicker">What to do next</span>
        <strong>{next.title}</strong>
        <p>{next.detail}</p>
        {canAct && waiting.length > 0 ? (
          <DecisionBar
            items={waiting}
            action={action}
            prefill={prefill}
            picked={toSend.length > 0 ? toSend.length : chosen.length}
          />
        ) : null}
      </section>

      {insight.summary !== "" ? (
        <section className="ei-block ei-summary" aria-label="Summary">
          <span className="ei-block-icon" aria-hidden="true">
            <UiIcon name="sparkles" size={15} />
          </span>
          <div>
            <span className="ei-kicker">Summary</span>
            <p>{insight.summary}</p>
            <small>
              {[
                insight.readBy,
                insight.period !== "" ? `Period shown: ${insight.period}` : "",
              ]
                .filter((part) => part !== "")
                .join(" · ")}
            </small>
          </div>
        </section>
      ) : null}

      <section className="ei-block" aria-label="Requirement coverage">
        <header className="ei-block-head">
          <span className="ei-kicker">Requirement coverage</span>
          {insight.coverage.total > 0 ? (
            <span
              className="ei-denominator"
              title="Items of the plan this file was read against"
            >
              {insight.coverage.supported} of {insight.coverage.total} supported
            </span>
          ) : null}
        </header>
        {insight.coverage.total === 0 ? (
          <p className="ei-quiet">
            This file serves no item of the plan yet. Link it to the item it
            answers from the item's Add evidence menu.
          </p>
        ) : (
          <ul className="ei-coverage">
            {insight.coverage.rows.map((row) => (
              <li key={row.requirementId}>
                <span className={`pill ${COVERAGE_STATE_TONES[row.state]}`}>
                  {COVERAGE_STATE_LABELS[row.state]}
                </span>
                <div>
                  <strong>{row.title}</strong>
                  {row.note !== "" ? <small>{row.note}</small> : null}
                  {row.decidedLabel !== "" ? (
                    <em>Judged: {row.decidedLabel}</em>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ei-block" aria-label="Key findings">
        <header className="ei-block-head">
          <span className="ei-kicker">Key findings</span>
          <span className="ei-count">{total}</span>
        </header>
        {total === 0 ? (
          <p className="ei-quiet">
            {insight.status.state === "ready"
              ? "Nothing to raise from this file."
              : "Findings appear once the file has been read."}
          </p>
        ) : null}
        {records !== null && records.length > 0 ? (
          <FindingRecords
            findings={records}
            canAct={canAct}
            action={findingsAction}
            picked={pickedRecords}
            onPick={onPickRecord}
            onShow={onShow}
            focused={focused}
          />
        ) : null}
        {canAct && insight.file.requestId !== null ? (
          <FollowUpComposer
            findings={toSend}
            requestId={insight.file.requestId}
            controlRef={controlRef}
            controlTitle={controlTitle}
            action={findingsAction}
            onSent={() => {
              for (const finding of toSend) {
                onPickRecord(finding.id, false);
              }
            }}
          />
        ) : null}
        {derived.length === 0 ? null : (
          <ul className="ei-findings">
            {derived.map((finding) => {
              const isOpen = opened === finding.key;
              const here =
                finding.citation !== null && focused === finding.citation;
              return (
                <li
                  key={finding.key}
                  className={`is-${finding.tone}${isOpen ? " is-open" : ""}${here ? " is-here" : ""}`}
                >
                  <div className="ei-finding">
                    <button
                      type="button"
                      className="ei-finding-main"
                      aria-expanded={isOpen}
                      onClick={() => {
                        setOpened(isOpen ? null : finding.key);
                        onShow(finding.citation);
                      }}
                    >
                      <span className="ei-finding-mark" aria-hidden="true">
                        <UiIcon name={KIND_ICON[finding.kind]} size={14} />
                      </span>
                      <span className="ei-finding-text">
                        <strong>{finding.title}</strong>
                        <small>{finding.observation}</small>
                      </span>
                      {finding.citation !== null ? (
                        <span className="ei-where">
                          <UiIcon name="search" size={11} />
                          {whereOf(finding.citation)}
                        </span>
                      ) : (
                        <span className="ei-where is-none">
                          Not located in the file
                        </span>
                      )}
                    </button>
                    {canAct && waiting.length > 0 ? (
                      <label className="ei-pick">
                        <input
                          type="checkbox"
                          checked={picked.has(finding.key)}
                          onChange={(event) =>
                            onPick(finding.key, event.target.checked)
                          }
                        />
                        <span className="sr-only">
                          Include in the follow-up
                        </span>
                      </label>
                    ) : null}
                  </div>
                  {isOpen ? (
                    <div className="ei-finding-more">
                      <p>
                        <strong>Next:</strong> {finding.next}
                      </p>
                      <p>
                        {SOURCE_WORDS[finding.source]}
                        {finding.attribute !== ""
                          ? ` · attribute ${finding.attribute}`
                          : ""}
                        {finding.requirementTitle !== ""
                          ? ` · ${finding.requirementTitle}`
                          : ""}
                      </p>
                      {finding.citation !== null ? (
                        <blockquote>“{finding.citation.quote}”</blockquote>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {insight.supports.length > 0 ? (
          <details className="ei-supports">
            <summary>
              <UiIcon name="check" size={13} />
              {insight.supports.length} point
              {insight.supports.length === 1 ? "" : "s"} this file supports
              <UiIcon name="chevron" size={13} />
            </summary>
            <ul>
              {insight.supports.map((support) => (
                <li key={support.key}>
                  {support.citation !== null ? (
                    <button
                      type="button"
                      className="ei-passage"
                      onClick={() => onShow(support.citation)}
                    >
                      <strong>{support.title}</strong>
                      <small>
                        {whereOf(support.citation)}: “{support.note}”
                      </small>
                    </button>
                  ) : (
                    <span className="ei-passage is-plain">
                      <strong>{support.title}</strong>
                      {support.note !== "" ? (
                        <small>{support.note}</small>
                      ) : null}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
    </>
  );
}

/** Where a passage sits, in the record's words. */
function whereOf(citation: EvidenceCitation): string {
  if (citation.location !== "") {
    return citation.location;
  }
  return citation.page !== null ? `Page ${citation.page}` : "In the file";
}

/** Accept, follow up or insufficient on the item the file serves and that waits on a
 * person: the same sufficiency decision as the item's own row. */
function DecisionBar({
  items,
  action,
  prefill,
  picked,
}: {
  items: NavItem[];
  action: ReturnType<typeof usePlanAction>;
  prefill: string;
  picked: number;
}) {
  const [asking, setAsking] = useState<
    "FOLLOW_UP_REQUIRED" | "INSUFFICIENT" | null
  >(null);
  const [itemId, setItemId] = useState(items[0]?.requirement.id ?? "");
  const [note, setNote] = useState("");
  const item =
    items.find((entry) => entry.requirement.id === itemId) ?? items[0] ?? null;
  if (item === null) {
    return null;
  }
  const requirement = item.requirement;
  const decide = (sufficiency: string, words = "") =>
    action.run(`judge-${requirement.id}`, {
      intent: "sufficiency",
      requirement_id: requirement.id,
      sufficiency,
      note: words,
      version: requirement.version,
    });
  return (
    <div className="ei-decide">
      {items.length > 1 ? (
        <label className="ei-decide-item">
          <span>Item</span>
          <select
            value={requirement.id}
            onChange={(event) => setItemId(event.target.value)}
          >
            {items.map((entry) => (
              <option key={entry.requirement.id} value={entry.requirement.id}>
                {entry.requirement.title}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="ei-decide-item">
          <span>Item</span> {requirement.title}
        </p>
      )}
      {asking === null ? (
        <div className="ei-decide-buttons">
          <button
            type="button"
            className="btn btn-sm"
            disabled={action.pending}
            onClick={() => void decide("ACCEPTED")}
          >
            <UiIcon name="check" size={14} />
            Accept
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={action.pending}
            onClick={() => {
              setAsking("FOLLOW_UP_REQUIRED");
              setNote(prefill);
            }}
          >
            Follow up{picked > 0 ? ` (${picked})` : ""}
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={action.pending}
            onClick={() => {
              setAsking("INSUFFICIENT");
              setNote("");
            }}
          >
            Insufficient
          </button>
        </div>
      ) : (
        <form
          className="ei-decide-form"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            void decide(asking, note).then((ok) => {
              if (ok) {
                setAsking(null);
              }
            });
          }}
        >
          <label>
            <span>
              {asking === "FOLLOW_UP_REQUIRED"
                ? "What to ask the control owner"
                : "What is missing"}
            </span>
            <textarea
              value={note}
              maxLength={1000}
              rows={3}
              required
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className="ei-decide-buttons">
            <button
              type="submit"
              className="btn btn-sm"
              disabled={action.pending}
            >
              {asking === "FOLLOW_UP_REQUIRED"
                ? "Record the follow-up"
                : "Mark insufficient"}
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setAsking(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      <Problem text={action.problem} />
      {action.note !== null && action.note !== "" ? (
        <p className="ei-decide-note" role="status">
          {action.note}
        </p>
      ) : null}
    </div>
  );
}

export function Details({
  insight,
  ids,
  canAct,
}: {
  insight: FileInsight;
  ids: Ids;
  canAct: boolean;
}) {
  const { file, analysis } = insight;
  return (
    <>
      <dl className="ei-facts">
        <div>
          <dt>Added</dt>
          <dd>
            {file.createdAt !== null
              ? `${formatDate(file.createdAt)}${file.addedBy !== "" ? ` by ${file.addedBy}` : ""}`
              : "Not on this control's register"}
          </dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{file.sizeBytes !== null ? formatBytes(file.sizeBytes) : "—"}</dd>
        </div>
        <div>
          <dt>Kind</dt>
          <dd>{insight.kindLabel ?? "Not read yet"}</dd>
        </div>
        <div>
          <dt>Read</dt>
          <dd>
            {insight.readBy !== "" ? insight.readBy : "No reading on record"}
            {analysis?.pages
              ? ` · ${analysis.pages} page${analysis.pages === 1 ? "" : "s"}`
              : analysis?.rows
                ? ` · ${analysis.rows.toLocaleString("en-US")} rows`
                : ""}
          </dd>
        </div>
        <div>
          <dt>Serves</dt>
          <dd>
            {insight.coverage.rows.length === 0
              ? "No item yet"
              : insight.coverage.rows.map((row) => row.title).join("; ")}
          </dd>
        </div>
      </dl>
      <AnalysisPanel
        analysis={analysis}
        review={insight.review}
        organizationId={ids.organizationId}
        projectId={ids.projectId}
        canAct={canAct}
        keep={{ control: ids.controlId, step: "request" }}
      />
    </>
  );
}

export function Trace({
  insight,
  ids,
  onShow,
  focused,
}: {
  insight: FileInsight;
  ids: Ids;
  onShow: (citation: EvidenceCitation | null) => void;
  focused: EvidenceCitation | null;
}) {
  const testHref = `?${new URLSearchParams({
    organization: ids.organizationId,
    project: ids.projectId,
    section: "controls",
    control: ids.controlId,
    step: "test",
  }).toString()}`;
  if (insight.mapping === null) {
    return (
      <div className="ei-trace-empty">
        <p>
          No evidence mapping is on record for this control. Once the test plan
          is approved, <strong>Map evidence</strong> on the Test step reads the
          approved attributes and locates, in each file, the passages that bear
          on them.
        </p>
        <a className="btn-secondary btn-sm" href={testHref}>
          Open the Test step
          <UiIcon name="arrow" size={14} />
        </a>
      </div>
    );
  }
  return (
    <>
      <p className={`ei-trace-head${insight.mapping.stale ? " is-stale" : ""}`}>
        Mapped at plan revision {insight.mapping.revision}
        {insight.mapping.stale
          ? ` · out of date: ${insight.mapping.reasons.join(" ")}`
          : ""}
      </p>
      <ul className="ei-trace">
        {insight.trace.map((row) => (
          <li
            key={row.code}
            className={row.references.length > 0 ? "is-cited" : undefined}
          >
            <div className="ei-trace-row">
              <span className={`cw-mapping-status is-${row.tone}`}>
                {row.label}
              </span>
              <div>
                <strong>{row.code}</strong> {row.attribute}
              </div>
            </div>
            {row.references.length > 0 ? (
              <ul className="ei-trace-refs">
                {row.references.map((citation) => (
                  <li
                    key={`${row.code}-${citation.page ?? ""}-${citation.quote.slice(0, 40)}`}
                  >
                    <button
                      type="button"
                      className={`ei-passage${focused === citation ? " is-on" : ""}`}
                      onClick={() => onShow(citation)}
                    >
                      <small>{whereOf(citation)}</small>
                      <span>“{citation.quote}”</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <small className="ei-trace-none">No passage from this file</small>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
