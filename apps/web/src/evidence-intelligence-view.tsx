"use client";

import { useEffect, useId, useMemo, useState } from "react";

import { AddEvidenceMenu } from "./add-evidence-menu";
import { AgentBot } from "./agent-panel";
import { AnalysisPanel } from "./analysis-view";
import { AutoRefresh } from "./auto-refresh";
import { askAbout } from "./control-rail-model";
import type { ControlFiles } from "./engagement-model";
import { FileChanges } from "./evidence-change";
import {
  type EvidenceFinding,
  findingsForFile,
  SENDABLE_STATUSES,
} from "./evidence-findings-model";
import {
  FindingRecords,
  FollowUpComposer,
  useFindingsAction,
} from "./evidence-findings-view";
import { RequestUpload } from "./evidence-intake";
import {
  COVERAGE_STATE_LABELS,
  COVERAGE_STATE_TONES,
  type FileInsight,
  type Finding,
  fileMeta,
  filterNavigator,
  firstFile,
  followUpNote,
  insightOf,
  type NavFile,
  type NavItem,
  navigatorFiles,
  navigatorOf,
  phaseCounts,
} from "./evidence-intelligence-model";
import type { EvidenceMappingRun } from "./evidence-mapping-model";
import type { EvidencePlan, Phase } from "./evidence-plan-model";
import { requirementStatus } from "./evidence-plan-model";
import { Problem, usePlanAction } from "./evidence-plan-view";
import { EvidenceViewer } from "./evidence-preview";
import type { EvidenceCitation } from "./evidence-preview-model";
import { fileQuery } from "./evidence-preview-model";
import { type HeldFile, linkableFiles } from "./evidence-workspace-model";
import { formatBytes, formatDate } from "./format";
import { choosable, type PolicyEvidence } from "./policy-evidence-model";
import { RowMenu } from "./row-menu";
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
  /** The control's findings on record (increment 2); null before the API answered. */
  findings: EvidenceFinding[] | null;
};

type Tab = "analysis" | "details" | "trace";

const TABS: Array<[Tab, string, IconName]> = [
  ["analysis", "AI analysis", "sparkles"],
  ["details", "Details", "file"],
  ["trace", "Traceability", "flow"],
];

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

/**
 * The Evidence Intelligence Workspace (docs/evidence-intelligence.md, increment 1): the
 * control's evidence in three panels. Left, the items by phase with their files and the
 * drop zone; centre, the document; right, what the agent found for it, its details, and
 * its trace to the approved attributes. Below, the questions to ask the agent. Every
 * figure and passage here is read from the records; the decisions (accept, follow up,
 * insufficient) go through the existing sufficiency endpoint.
 */
export function EvidenceIntelligence({
  ids,
  plan,
  register,
  mapping,
  attributes,
  controlRef,
  controlTitle,
  canAct,
  held,
  applications,
  system,
  policies,
  onPolicyDecided,
  askHref,
  focusFile,
  findings,
}: {
  ids: Ids;
  plan: EvidencePlan;
  register: ControlFiles | null;
  mapping: EvidenceMappingRun | null;
  /** The approved attributes in the mapping's order, for their codes. */
  attributes: ReadonlyArray<{ code: string; text: string }>;
  controlRef: string;
  controlTitle: string;
  canAct: boolean;
  held: HeldFile[];
  applications: Array<{ id: string; name: string }>;
  system: string | null;
  policies: PolicyEvidence;
  onPolicyDecided: () => void;
  /** The agent console, where a question about this control is asked. */
  askHref: string;
  /** The file a link names (?file=), opened on arrival. */
  focusFile: string | null;
  /** The control's findings on record (increment 2); null before the API answered. */
  findings: EvidenceFinding[] | null;
}) {
  const id = useId();
  const action = usePlanAction(ids);
  const findingsAction = useFindingsAction(ids);
  const [pickedRecords, setPickedRecords] = useState<Set<string>>(
    () => new Set(),
  );
  const phases = useMemo(() => navigatorOf(plan, register), [plan, register]);
  const [phase, setPhase] = useState<Phase | "all">("all");
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(typed), 150);
    return () => window.clearTimeout(timer);
  }, [typed]);
  const shown = useMemo(
    () => filterNavigator(phases, { phase, search }),
    [phases, phase, search],
  );
  const [selectedFile, setSelectedFile] = useState<string | null>(
    () => firstFile(phases, focusFile)?.id ?? null,
  );
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("analysis");
  const [focused, setFocused] = useState<EvidenceCitation | null>(null);
  const [changing, setChanging] = useState<"replace" | "withdraw" | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const all = navigatorFiles(phases);
  const file = all.find((entry) => entry.id === selectedFile) ?? null;
  const insight = useMemo(
    () =>
      file === null
        ? null
        : insightOf(file.id, phases, register, mapping, attributes, controlRef),
    [file, phases, register, mapping, attributes, controlRef],
  );
  // The item evidence is added for: the one chosen, else the open file's, else the first
  // that still needs evidence.
  const items = phases.flatMap((entry) => entry.items);
  const uploadItem =
    items.find((item) => item.requirement.id === selectedItem) ??
    items.find((item) => item.requirement.id === file?.requirementId) ??
    items.find(
      (item) => item.files.length === 0 && item.requirement.requestId !== null,
    ) ??
    items.find((item) => item.requirement.requestId !== null) ??
    null;
  const reading = all.some((entry) => entry.read === "reading");
  const counts = phaseCounts(phases);
  const query = fileQuery(ids.organizationId, ids.projectId);
  const heldFile = held.find((entry) => entry.id === file?.id) ?? null;
  const records =
    findings === null || file === null
      ? null
      : findingsForFile(findings, file.id);

  const open = (next: NavFile) => {
    setSelectedFile(next.id);
    setSelectedItem(next.requirementId);
    setFocused(null);
    setChanging(null);
    setPicked(new Set());
    setPickedRecords(new Set());
  };
  const show = (citation: EvidenceCitation | null) => {
    if (citation === null) {
      return;
    }
    if (citation.fileId !== selectedFile) {
      setSelectedFile(citation.fileId);
    }
    setFocused(citation);
  };
  const ask = (question: string) => {
    const url = new URL(askHref, window.location.origin);
    url.searchParams.set(
      "ask",
      askAbout(controlRef, controlTitle, question).slice(0, 1500),
    );
    window.location.assign(url.toString());
  };

  return (
    <section className="ei" aria-label="Evidence workspace">
      {reading ? <AutoRefresh /> : null}
      {/* Each sticky panel sits in its own cell, so it stays within its row and never
          slides over the assistant below (sticky is bounded by its containing block). */}
      <div className="ei-col ei-col-nav">
        <aside className="ei-nav" aria-label="Evidence navigator">
          <header className="ei-nav-head">
            <h3>Evidence for this control</h3>
            <span
              className="ei-count"
              title="Files on the items of this control"
            >
              {all.length}
            </span>
          </header>
          <div className="ei-phases" role="tablist" aria-label="Testing phase">
            {counts.map((entry) => (
              <button
                key={entry.phase}
                type="button"
                role="tab"
                aria-selected={phase === entry.phase}
                className={phase === entry.phase ? "is-on" : undefined}
                onClick={() => setPhase(entry.phase)}
              >
                {entry.label}
                <span className="ei-chip-count">{entry.files}</span>
                {entry.attention > 0 ? (
                  <span
                    className="ei-attention"
                    title={`${entry.attention} need${entry.attention === 1 ? "s" : ""} a person`}
                  >
                    {entry.attention}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <label className="ei-search">
            <UiIcon name="search" size={14} />
            <span className="sr-only">Search items and files</span>
            <input
              type="search"
              value={typed}
              placeholder="Search items and files…"
              onChange={(event) => setTyped(event.target.value)}
            />
          </label>
          {canAct && uploadItem?.requirement.requestId ? (
            <div className="ei-upload">
              <RequestUpload
                organizationId={ids.organizationId}
                projectId={ids.projectId}
                requestId={uploadItem.requirement.requestId}
                requirementId={uploadItem.requirement.id}
                label={uploadItem.requirement.title}
                variant="panel"
                systems={
                  uploadItem.requirement.categories.includes(
                    "PROCESS_DOCUMENTATION",
                  )
                    ? applications
                    : []
                }
                system={system}
                chooser={(pick, running) => (
                  <AddEvidenceMenu
                    ids={ids}
                    itemId={uploadItem.requirement.id}
                    itemTitle={uploadItem.requirement.title}
                    pick={pick}
                    running={running}
                    documents={choosable(policies, uploadItem.requirement.id)}
                    held={linkableFiles(uploadItem.requirement, held)}
                    onLink={(fileId, reason) =>
                      action.run(`link-${uploadItem.requirement.id}`, {
                        intent: "link",
                        requirement_id: uploadItem.requirement.id,
                        file_id: fileId,
                        reason,
                        version: uploadItem.requirement.version,
                      })
                    }
                    onFiled={onPolicyDecided}
                  />
                )}
              />
              <p className="ei-upload-for">
                For <strong>{uploadItem.requirement.title}</strong>. Choose
                another item below to change it.
              </p>
            </div>
          ) : null}
          {shown.length === 0 ? (
            <p className="ei-empty">
              {all.length === 0 && items.length === 0
                ? "No evidence is planned for this control yet."
                : "Nothing matches."}
            </p>
          ) : (
            shown.map((entry) => (
              <section
                key={entry.phase}
                className="ei-phase"
                aria-label={entry.label}
              >
                {phase === "all" ? (
                  <h4>
                    {entry.label}
                    <span>{entry.fileCount}</span>
                  </h4>
                ) : null}
                <ol className="ei-items">
                  {entry.items.map((item) => (
                    <NavItemRow
                      key={item.requirement.id}
                      item={item}
                      awaiting={false}
                      selectedFile={selectedFile}
                      chosen={
                        uploadItem?.requirement.id === item.requirement.id
                      }
                      onFile={open}
                      onItem={() => {
                        setSelectedItem(item.requirement.id);
                        const first = item.files[0];
                        if (first !== undefined && first.id !== selectedFile) {
                          open(first);
                        }
                      }}
                    />
                  ))}
                </ol>
              </section>
            ))
          )}
        </aside>
      </div>

      <section className="ei-doc" aria-label="Document">
        {file === null || insight === null ? (
          <div className="ei-doc-empty">
            <UiIcon name="file" size={28} />
            <strong>No file open</strong>
            <p>
              {all.length === 0
                ? "Upload evidence, or add a policy on file, and it is read against the request's items."
                : "Choose a file in the navigator to review it here."}
            </p>
          </div>
        ) : (
          <>
            <header className="ei-doc-head">
              <FileBadge name={file.fileName} />
              <div className="ei-doc-title">
                <strong title={file.fileName}>{file.fileName}</strong>
                <small>
                  {[
                    insight.kindLabel,
                    fileMeta(file, formatBytes, formatDate),
                    insight.analysis?.pages
                      ? `${insight.analysis.pages} page${insight.analysis.pages === 1 ? "" : "s"}`
                      : "",
                  ]
                    .filter((part) => part !== "" && part !== null)
                    .join(" · ")}
                </small>
              </div>
              <div className="ei-doc-tools">
                <a
                  className="btn-ghost btn-sm"
                  href={`/workspace/evidence-files/${file.id}?${query}`}
                >
                  <UiIcon name="upload" size={14} />
                  Download
                </a>
                {canAct && heldFile !== null && !heldFile.blocked ? (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    aria-expanded={changing === "replace"}
                    onClick={() =>
                      setChanging(changing === "replace" ? null : "replace")
                    }
                  >
                    <UiIcon name="retry" size={14} />
                    Replace
                  </button>
                ) : null}
                {canAct && heldFile !== null ? (
                  <RowMenu
                    label={`More for ${file.fileName}`}
                    items={[
                      {
                        label: "Withdraw the file",
                        icon: "x",
                        danger: true,
                        unavailable: heldFile.blocked ?? null,
                        onSelect: () => setChanging("withdraw"),
                      },
                      ...(file.requestId === null
                        ? []
                        : [
                            {
                              label: "Open the request",
                              icon: "mail" as const,
                              href: `?${new URLSearchParams({
                                organization: ids.organizationId,
                                project: ids.projectId,
                                section: "controls",
                                control: ids.controlId,
                                step: "request",
                                request: file.requestId,
                              }).toString()}`,
                            },
                          ]),
                    ]}
                  />
                ) : null}
              </div>
            </header>
            {changing !== null && heldFile !== null ? (
              <div className="ei-doc-change">
                <FileChanges
                  organizationId={ids.organizationId}
                  projectId={ids.projectId}
                  fileId={file.id}
                  fileName={file.fileName}
                  blocked={heldFile.blocked ?? null}
                  controlId={ids.controlId}
                  keep={{ step: "request" }}
                  start={changing}
                  onCancel={() => setChanging(null)}
                />
              </div>
            ) : null}
            <EvidenceViewer
              organizationId={ids.organizationId}
              projectId={ids.projectId}
              file={{ id: file.id, fileName: file.fileName }}
              citations={citationsOf(insight, focused)}
              focused={focused}
            />
          </>
        )}
      </section>

      <div className="ei-col ei-col-ai">
        <aside className="ei-ai" aria-label="AI evidence analysis">
          <div className="ei-tabs" role="tablist" aria-label="Analysis views">
            {TABS.map(([key, label, icon]) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`${id}-tab-${key}`}
                aria-selected={tab === key}
                aria-controls={`${id}-panel`}
                className={tab === key ? "is-on" : undefined}
                onClick={() => setTab(key)}
              >
                <UiIcon name={icon} size={14} />
                {label}
              </button>
            ))}
          </div>
          <div
            id={`${id}-panel`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-${tab}`}
            className="ei-panel"
          >
            {insight === null ? (
              <p className="ei-empty">
                Open a file to see what the agent found.
              </p>
            ) : tab === "analysis" ? (
              <Analysis
                insight={insight}
                items={items}
                canAct={canAct}
                action={action}
                picked={picked}
                onPick={(key, on) =>
                  setPicked((current) => {
                    const next = new Set(current);
                    if (on) {
                      next.add(key);
                    } else {
                      next.delete(key);
                    }
                    return next;
                  })
                }
                onShow={show}
                focused={focused}
                records={records}
                findingsAction={findingsAction}
                pickedRecords={pickedRecords}
                onPickRecord={(key, on) =>
                  setPickedRecords((current) => {
                    const next = new Set(current);
                    if (on) {
                      next.add(key);
                    } else {
                      next.delete(key);
                    }
                    return next;
                  })
                }
                controlRef={controlRef}
                controlTitle={controlTitle}
              />
            ) : tab === "details" ? (
              <Details insight={insight} ids={ids} canAct={canAct} />
            ) : (
              <Trace
                insight={insight}
                ids={ids}
                onShow={show}
                focused={focused}
              />
            )}
          </div>
        </aside>
      </div>

      <section className="ei-ask" aria-label="Ask the AI assistant">
        <span className="ei-ask-bot" aria-hidden="true">
          <AgentBot size={40} />
        </span>
        <div className="ei-ask-body">
          <div className="ei-ask-head">
            <strong>Ask the AI assistant</strong>
            <small>
              A question opens in the agent console with this control and its
              evidence in context.
            </small>
          </div>
          {insight !== null && insight.questions.length > 0 ? (
            <div className="ei-chips">
              {insight.questions.map((question) => (
                <button
                  key={question}
                  type="button"
                  className="ei-chip"
                  onClick={() => ask(question)}
                >
                  {question}
                </button>
              ))}
            </div>
          ) : null}
          <AskForm onAsk={ask} />
        </div>
      </section>
    </section>
  );
}

/** The citations the viewer marks: the file's passages on record, and the one focused
 * (it may come from a finding the mapping located). */
function citationsOf(
  insight: FileInsight,
  focused: EvidenceCitation | null,
): EvidenceCitation[] {
  const list = [...insight.citations];
  if (focused !== null && !list.some((item) => item.quote === focused.quote)) {
    list.push(focused);
  }
  return list;
}

function NavItemRow({
  item,
  awaiting,
  selectedFile,
  chosen,
  onFile,
  onItem,
}: {
  item: NavItem;
  awaiting: boolean;
  selectedFile: string | null;
  chosen: boolean;
  onFile: (file: NavFile) => void;
  onItem: () => void;
}) {
  const status = requirementStatus(item.requirement.state, awaiting);
  return (
    <li
      className={`ei-item${chosen ? " is-chosen" : ""}${item.waits ? " is-waiting" : ""}`}
    >
      <button
        type="button"
        className="ei-item-head"
        aria-pressed={chosen}
        onClick={onItem}
      >
        <span className="ei-item-title">{item.requirement.title}</span>
        <span className={`ei-state ${status.tone}`} title={status.title}>
          {status.label}
        </span>
      </button>
      {item.files.length === 0 ? (
        <p className="ei-none">No file yet</p>
      ) : (
        <ul className="ei-files">
          {item.files.map((file) => (
            <li key={file.id}>
              <button
                type="button"
                className={`ei-file${file.id === selectedFile ? " is-on" : ""}`}
                aria-current={file.id === selectedFile ? "true" : undefined}
                onClick={() => onFile(file)}
              >
                <FileBadge name={file.fileName} small />
                <span className="ei-file-text">
                  <span className="ei-file-name" title={file.fileName}>
                    {file.fileName}
                  </span>
                  <small>{fileMeta(file, formatBytes, formatDate)}</small>
                </span>
                <FileDot file={file} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Where the file stands, as one mark: read and covering, in part, not, reading, or
 * needing a person. The title says it in words. */
function FileDot({ file }: { file: NavFile }) {
  const [tone, title] =
    file.read === "reading"
      ? ["is-reading", "Being read"]
      : file.attention
        ? ["is-attention", "Needs a person"]
        : file.coverage === "COVERED"
          ? ["is-ok", "Covers the item"]
          : file.coverage === "PARTIAL"
            ? ["is-part", "Covers the item in part"]
            : file.coverage === "NOT_COVERED"
              ? ["is-no", "Does not cover the item"]
              : ["is-idle", "Not assessed"];
  return (
    <span className={`ei-dot ${tone}`} title={title}>
      <span className="sr-only">{title}</span>
    </span>
  );
}

const EXT_KIND: Record<string, string> = {
  pdf: "PDF",
  doc: "DOC",
  docx: "DOC",
  xls: "XLS",
  xlsx: "XLS",
  csv: "XLS",
  png: "IMG",
  jpg: "IMG",
  jpeg: "IMG",
  gif: "IMG",
  webp: "IMG",
  zip: "ZIP",
};

function FileBadge({ name, small = false }: { name: string; small?: boolean }) {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const kind = EXT_KIND[ext] ?? "FILE";
  return (
    <span
      className={`ei-badge kind-${kind.toLowerCase()}${small ? " is-small" : ""}`}
      aria-hidden="true"
    >
      {kind}
    </span>
  );
}

function Analysis({
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

function Details({
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

function Trace({
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

function AskForm({ onAsk }: { onAsk: (question: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="ei-ask-form"
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim() !== "") {
          onAsk(text);
        }
      }}
    >
      <input
        type="text"
        value={text}
        maxLength={1000}
        placeholder="Ask a question about this evidence or request follow-up from the client…"
        aria-label="Ask the AI assistant"
        onChange={(event) => setText(event.target.value)}
      />
      <button
        type="submit"
        className="btn"
        aria-label="Ask"
        disabled={text.trim() === ""}
      >
        <UiIcon name="arrow" size={14} />
      </button>
    </form>
  );
}
