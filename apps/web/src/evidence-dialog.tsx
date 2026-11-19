"use client";

import { useState } from "react";
import { AgentBot } from "./agent-panel";
import { AutoRefresh } from "./auto-refresh";
import type { ControlFiles } from "./engagement-model";
import {
  type AboutContext,
  Classification,
  ConfidencePill,
  FileData,
  FileFindings,
  Instance,
  PopulationChecks,
  Samples,
  useFileAbout,
  WithdrawForm,
} from "./evidence-about";
import {
  addableItems,
  stepsOf,
  type WalkthroughInstance,
} from "./evidence-dialog-model";
import type { EvidenceFinding } from "./evidence-findings-model";
import { FILE_ACTION_LABELS } from "./evidence-impact-model";
import { RequestUpload } from "./evidence-intake";
import {
  insightOf,
  type NavItem,
  uploadTargetOf,
} from "./evidence-intelligence-model";
import { citationsOf, Details, FileBadge } from "./evidence-intelligence-view";
import type { EvidenceMappingRun } from "./evidence-mapping-model";
import { AnnotatedFile, PreviewButton } from "./evidence-opener";
import type { EvidencePlan } from "./evidence-plan-model";
import type { EvidenceCitation } from "./evidence-preview-model";
import { formatBytes, formatDate } from "./format";
import { RecordDialog } from "./record-dialog";
import type { ControlTest } from "./testing-model";
import { type IconName, UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };

/** Adding evidence to an item (the item may be chosen in the dialog). Changed 14 November
 * 2026 (docs/evidence-annotations.md, section 5b). Old: a second mode, "review", opened a
 * file already added in this dialog (its file list, Preview, Data and Details tabs, and
 * the "AI classification" side). New: an existing file opens in the one viewer
 * (AnnotatedDialog), its reviewer's content under "About this file" (evidence-about.tsx);
 * this dialog only adds evidence, and shows what it took with the same pieces. */
export type DialogOpen = { mode: "add"; itemId: string | null };

type Tab = "preview" | "data" | "details";

/** The document tile's mark by file type, as the reference draws it. */
const DOC_KIND: Record<string, string> = {
  pdf: "PDF",
  doc: "DOC",
  docx: "DOC",
  xls: "XLS",
  xlsx: "XLS",
  csv: "XLS",
  png: "IMG",
  jpg: "IMG",
  jpeg: "IMG",
};
const DOC_MARK: Record<string, string> = {
  PDF: "PDF",
  DOC: "W",
  XLS: "X",
  IMG: "IMG",
  FILE: "FILE",
};

export function EvidenceDialog({
  open,
  onClose,
  ids,
  plan,
  register,
  mapping,
  attributes,
  controlRef,
  canAct,
  findings,
  tests,
  instances,
}: {
  open: DialogOpen;
  onClose: () => void;
  ids: Ids;
  plan: EvidencePlan;
  register: ControlFiles | null;
  mapping: EvidenceMappingRun | null;
  attributes: ReadonlyArray<{ code: string; text: string }>;
  controlRef: string;
  canAct: boolean;
  findings: EvidenceFinding[] | null;
  tests: ControlTest[] | null;
  instances: WalkthroughInstance[] | null;
}) {
  const context: AboutContext = {
    ids,
    plan,
    register,
    mapping,
    attributes,
    controlRef,
    canAct,
    findings,
    tests,
    instances,
  };
  const [fileId, setFileId] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>("preview");
  const about = useFileAbout(context, fileId, {
    onPickStart: () => setTab("data"),
    onUploadInstance: (next) => {
      setItemId(next);
      setFileId(null);
      setTab("preview");
    },
  });
  const { phases, items, insight, analysis, read, table, test, instance } =
    about;
  const [itemId, setItemId] = useState<string | null>(
    () =>
      open.itemId ?? uploadTargetOf(phases, null, null)?.requirement.id ?? null,
  );
  const [focused, setFocused] = useState<EvidenceCitation | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [withdrawn, setWithdrawn] = useState<string | null>(null);
  const [addingMore, setAddingMore] = useState(false);
  // Where the Preview puts the file's own actions (download the annotated copy).
  const [notesSlot, setNotesSlot] = useState<HTMLElement | null>(null);

  const item = items.find((entry) => entry.requirement.id === itemId) ?? null;
  const citations = insight === null ? [] : citationsOf(insight, focused);
  const steps = stepsOf({
    phase: about.phase,
    fileOpen: fileId !== null,
    read,
    routed: about.routed !== null || test?.status === "APPROVED",
  });
  const files = [...new Set(fileId === null ? added : [fileId, ...added])];

  // The open file, as its card says it.
  const docEntry = insight;
  const docName = docEntry?.file.fileName ?? "Uploaded file";
  const docStatus = (docEntry?.analysis?.status ?? "PENDING") as string;
  const docExt = docName.includes(".")
    ? (docName.split(".").pop() ?? "").toUpperCase().slice(0, 5)
    : "";
  const docKind = DOC_KIND[docExt.toLowerCase()] ?? "FILE";
  const docSize =
    docEntry?.file.sizeBytes != null
      ? formatBytes(docEntry.file.sizeBytes)
      : "";
  const docDate = docEntry?.file.createdAt
    ? formatDate(docEntry.file.createdAt)
    : "";
  const docMeta = [docSize, docDate].filter((part) => part !== "").join(" • ");
  const withdrawForm = (each: string, name: string) => (
    <WithdrawForm
      context={context}
      fileId={each}
      fileName={name}
      onCancel={() => setWithdrawing(null)}
      onDone={(message) => {
        setWithdrawing(null);
        setAdded((current) => current.filter((entry) => entry !== each));
        if (fileId === each) {
          setFileId(null);
        }
        setWithdrawn(message);
      }}
    />
  );

  return (
    <RecordDialog
      eyebrow={controlRef}
      title="Add evidence"
      description="Upload your evidence and the agent classifies it and helps you use it in testing."
      closeHref=""
      className="ed-dialog"
      onClose={onClose}
    >
      {read === "reading" ? <AutoRefresh seconds={3} /> : null}
      <ol className="ed-steps" aria-label="Progress">
        {steps.map((step, index) => (
          <li key={step.step} className={`is-${step.state}`}>
            <span className="ed-step-mark" aria-hidden="true">
              {step.state === "done" ? (
                <UiIcon name="check" size={14} />
              ) : (
                index + 1
              )}
            </span>
            <span className="ed-step-copy">
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </span>
          </li>
        ))}
      </ol>
      <div className="ed">
        <div className="ed-main">
          {fileId === null ? (
            <section className="ed-upload-card" aria-label="Upload">
              {/* A withdrawal, confirmed by the server: first in the card, in view even when
                  the dialog returns to its empty state. */}
              {withdrawn !== null ? (
                <p className="ep-done" role="status">
                  <UiIcon name="check" size={14} />
                  <span>{withdrawn}</span>
                </p>
              ) : null}
              <UploadFor
                phases={addableItems(phases)}
                itemId={itemId}
                locked={fileId !== null}
                onPick={(next) => {
                  setItemId(next);
                  setFileId(null);
                }}
              />
              {canAct &&
              item !== null &&
              item.requirement.requestId !== null ? (
                <RequestUpload
                  organizationId={ids.organizationId}
                  projectId={ids.projectId}
                  requestId={item.requirement.requestId}
                  requirementId={item.requirement.id}
                  label={item.requirement.title}
                  variant="dialog"
                  target="Supports PDF, DOCX, XLSX, CSV, PNG and JPG, up to 25 MB each"
                  onUploaded={(uploaded) => {
                    setAdded((current) => [...uploaded, ...current]);
                    setFileId(uploaded[0] ?? null);
                    setTab("preview");
                    about.setRouted(null);
                    about.setSize(null);
                    setWithdrawn(null);
                  }}
                />
              ) : item !== null && item.requirement.requestId === null ? (
                <p className="ed-quiet">
                  Evidence is added once this item is requested.
                </p>
              ) : null}
              {files.length === 0 ? <AfterUpload /> : null}
            </section>
          ) : (
            // A file in hand (product owner's reference, 31 October 2026): the file, where
            // it goes, and its viewer; the drop zone opens again only to add another file.
            <section className="ed-doc" aria-label="The file">
              {withdrawn !== null ? (
                <p className="ep-done" role="status">
                  <UiIcon name="check" size={14} />
                  <span>{withdrawn}</span>
                </p>
              ) : null}
              <p className={`ed-doc-status is-${docStatus.toLowerCase()}`}>
                {docStatus === "READY" ? (
                  <span className="ed-doc-status-mark" aria-hidden="true">
                    <UiIcon name="check" size={14} />
                  </span>
                ) : docStatus === "FAILED" ? (
                  <UiIcon name="risk" size={18} />
                ) : (
                  <span className="spinner small" aria-hidden="true" />
                )}
                {docStatus === "READY"
                  ? "Document uploaded"
                  : docStatus === "FAILED"
                    ? "The document could not be read"
                    : "Reading the document"}
              </p>
              <div className="ed-doc-row">
                <span className="ed-doc-icon" aria-hidden="true">
                  <UiIcon name="file" size={18} />
                </span>
                <span className="ed-doc-name">
                  <span className="ed-doc-title">
                    <strong title={docName}>{docName}</strong>
                    {docExt !== "" ? <em>{docExt}</em> : null}
                  </span>
                  <small>{docMeta}</small>
                </span>
                {insight !== null ? (
                  <span
                    className="ed-doc-views"
                    role="tablist"
                    aria-label="File views"
                  >
                    {(
                      [
                        ["preview", "Preview", "eye"],
                        [
                          "data",
                          analysis?.rows != null
                            ? `Data (${analysis.rows.toLocaleString()} rows)`
                            : "Data",
                          "table",
                        ],
                        ["details", "Details", "info"],
                      ] as Array<[Tab, string, IconName]>
                    )
                      .filter(([key]) => key !== "data" || table)
                      .map(([key, label, icon]) => (
                        <button
                          key={key}
                          type="button"
                          role="tab"
                          aria-selected={tab === key}
                          className={tab === key ? "is-on" : undefined}
                          onClick={() => setTab(key)}
                        >
                          <UiIcon name={icon} size={15} />
                          {label}
                        </button>
                      ))}
                  </span>
                ) : null}
              </div>
              <div className="ed-doc-tile">
                <span
                  className={`ed-doc-art kind-${docKind.toLowerCase()}`}
                  aria-hidden="true"
                >
                  <em>{DOC_MARK[docKind] ?? docKind}</em>
                </span>
                <span className="ed-doc-tile-text">
                  <strong title={docName}>{docName}</strong>
                  {docSize !== "" ? <small>{docSize}</small> : null}
                  {docDate !== "" ? <small>{docDate}</small> : null}
                </span>
                <span className="ed-doc-tile-side">
                  <span className={`ed-doc-pill is-${docStatus.toLowerCase()}`}>
                    {docStatus === "READY" ? (
                      <UiIcon name="check" size={12} />
                    ) : null}
                    {docStatus === "READY"
                      ? "File uploaded"
                      : docStatus === "FAILED"
                        ? "Not readable"
                        : "Being read"}
                  </span>
                  {canAct ? (
                    <button
                      type="button"
                      className="ed-file-remove"
                      // Withdrawn from the engagement, kept on record: the form says
                      // first where the file is used (E1). Discarding an upload is not
                      // offered yet.
                      aria-label={`Withdraw ${docName} from the engagement`}
                      title={FILE_ACTION_LABELS.WITHDRAW}
                      onClick={() =>
                        setWithdrawing(withdrawing === fileId ? null : fileId)
                      }
                    >
                      <UiIcon name="trash" size={16} />
                    </button>
                  ) : null}
                </span>
              </div>
              {withdrawing === fileId ? withdrawForm(fileId, docName) : null}
              <hr className="ed-doc-rule" />
              <UploadFor
                phases={addableItems(phases)}
                itemId={itemId}
                locked
                onPick={() => undefined}
              />
              <div className={`ed-doc-ready is-${docStatus.toLowerCase()}`}>
                <span className="ed-doc-ready-icon" aria-hidden="true">
                  <UiIcon name="file" size={26} />
                  {docStatus === "READY" ? (
                    <span>
                      <UiIcon name="check" size={11} />
                    </span>
                  ) : null}
                </span>
                <span>
                  <strong>
                    {docStatus === "READY"
                      ? "Document is ready for review"
                      : docStatus === "FAILED"
                        ? "The document could not be read"
                        : "The agent is reading the document"}
                  </strong>
                  <small>
                    {docStatus === "READY"
                      ? "The file has been uploaded and analyzed. The agent's findings are ready to review, with the next step beside them."
                      : docStatus === "FAILED"
                        ? "Replace it with a readable copy, or withdraw it."
                        : "Its type, what it shows, and the next step appear here once the reading is done."}
                  </small>
                </span>
              </div>
              {canAct &&
              item !== null &&
              item.requirement.requestId !== null ? (
                addingMore ? (
                  <RequestUpload
                    organizationId={ids.organizationId}
                    projectId={ids.projectId}
                    requestId={item.requirement.requestId}
                    requirementId={item.requirement.id}
                    label={item.requirement.title}
                    variant="panel"
                    onUploaded={(uploaded) => {
                      setAdded((current) => [...uploaded, ...current]);
                      setFileId(uploaded[0] ?? null);
                      setTab("preview");
                      about.setRouted(null);
                      about.setSize(null);
                      setWithdrawn(null);
                      setAddingMore(false);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="btn-ghost btn-sm ed-doc-add"
                    onClick={() => setAddingMore(true)}
                  >
                    <UiIcon name="plus" size={14} />
                    Add another file for this item
                  </button>
                )
              ) : null}
            </section>
          )}

          {files.length > 1 ? (
            <ul className="ed-files is-compact" aria-label="Files added">
              {files.map((each) => {
                const entry = insightOf(
                  each,
                  phases,
                  register,
                  mapping,
                  attributes,
                  controlRef,
                );
                const name = entry?.file.fileName ?? "Uploaded file";
                const status = entry?.analysis?.status ?? "PENDING";
                return (
                  <li key={each}>
                    <div
                      className={`ed-file${each === fileId ? " is-on" : ""}`}
                    >
                      <button
                        type="button"
                        className="ed-file-open"
                        aria-current={each === fileId ? "true" : undefined}
                        onClick={() => {
                          setFileId(each);
                          about.setRouted(null);
                          setTab("preview");
                          about.setSize(null);
                        }}
                      >
                        <FileBadge name={name} small />
                        <span className="ed-file-text">
                          <strong title={name}>{name}</strong>
                        </span>
                      </button>
                      <span
                        className={`ed-file-state is-${status.toLowerCase()}`}
                        title={
                          status === "READY"
                            ? "Read and classified"
                            : status === "FAILED"
                              ? "Could not be read"
                              : "Being read"
                        }
                      >
                        {status === "READY" ? (
                          <UiIcon name="check" size={13} />
                        ) : status === "FAILED" ? (
                          <UiIcon name="risk" size={13} />
                        ) : (
                          <span className="spinner small" aria-hidden="true" />
                        )}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {fileId !== null && insight !== null ? (
            <section className="ed-view">
              <header className="ed-view-head">
                <FileBadge name={insight.file.fileName} small />
                <span>
                  <strong title={insight.file.fileName}>
                    {insight.file.fileName}
                  </strong>
                  <small>{docMeta}</small>
                </span>
                <span className="ed-view-notes" ref={setNotesSlot} />
                <PreviewButton
                  organizationId={ids.organizationId}
                  projectId={ids.projectId}
                  files={[
                    { id: insight.file.id, fileName: insight.file.fileName },
                  ]}
                  citations={citations}
                  label={<UiIcon name="expand" size={16} />}
                  className="ed-view-expand"
                />
              </header>
              <div className="ed-tab-body">
                {tab === "preview" ? (
                  table ? (
                    <FileData
                      about={about}
                      context={context}
                      fileId={insight.file.id}
                      compact
                      onAll={() => setTab("data")}
                    />
                  ) : (
                    // The one evidence viewer (docs/evidence-annotations.md, section
                    // 5a), with the passages cited in the file.
                    <AnnotatedFile
                      key={`${insight.file.id}-${analysis?.status ?? ""}-${analysis?.version ?? 0}`}
                      organizationId={ids.organizationId}
                      projectId={ids.projectId}
                      file={{
                        id: insight.file.id,
                        fileName: insight.file.fileName,
                      }}
                      citations={citations}
                      focused={focused}
                      headSlot={notesSlot}
                    />
                  )
                ) : tab === "data" ? (
                  <FileData
                    about={about}
                    context={context}
                    fileId={insight.file.id}
                  />
                ) : (
                  <div className="ed-details">
                    <Details insight={insight} ids={ids} canAct={canAct} />
                    <PopulationChecks test={test} />
                    <Samples test={test} />
                    <Instance instance={instance} />
                    <FileFindings
                      about={about}
                      context={context}
                      onShow={(citation) => {
                        setFocused(citation);
                        setTab("preview");
                      }}
                      focused={focused}
                    />
                  </div>
                )}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="ed-side" aria-label="AI classification">
          <header className="ed-side-head">
            <span className="ed-side-icon" aria-hidden="true">
              <UiIcon name="sparkles" size={20} />
            </span>
            <h3>AI classification</h3>
            <ConfidencePill about={about} />
          </header>

          {fileId === null ? (
            <AgentCapabilities controlRef={controlRef} />
          ) : (
            <Classification
              about={about}
              canAct={canAct}
              onFindings={() => setTab("details")}
              findingsIn=" in Details"
            />
          )}
        </aside>
      </div>
    </RecordDialog>
  );
}

/** Which item the evidence is for, and its phase: above the drop zone, chosen while
 * nothing is uploaded, then stated, so where a file goes is never in doubt. */
function UploadFor({
  phases,
  itemId,
  locked,
  onPick,
}: {
  phases: Array<{ label: string; items: NavItem[] }>;
  itemId: string | null;
  locked: boolean;
  onPick: (itemId: string) => void;
}) {
  const current = phases.find((entry) =>
    entry.items.some((item) => item.requirement.id === itemId),
  );
  const title =
    current?.items.find((item) => item.requirement.id === itemId)?.requirement
      .title ?? "";
  return (
    <div className="ed-upload-for">
      <span className="ed-upload-for-label">Upload for</span>
      {locked ? (
        <strong>{title}</strong>
      ) : (
        <select
          aria-label="The evidence item the files are for"
          value={itemId ?? ""}
          onChange={(event) => onPick(event.target.value)}
        >
          {itemId === null ? <option value="">Choose an item</option> : null}
          {phases.map((entry) => (
            <optgroup key={entry.label} label={entry.label}>
              {entry.items.map((item) => (
                <option key={item.requirement.id} value={item.requirement.id}>
                  {item.requirement.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
      {current !== undefined ? (
        <span className="ed-phase-pill">
          <UiIcon name="file" size={14} />
          {current.label}
        </span>
      ) : null}
    </div>
  );
}

/** Before a file is added: what the agent does with it once it arrives. */
function AfterUpload() {
  const steps: Array<[IconName, string, string, string]> = [
    [
      "search",
      "Classify the evidence",
      "Identify the document type and extract key information.",
      "is-blue",
    ],
    [
      "file",
      "Preview and extract",
      "Show a preview and pull the details relevant for testing.",
      "is-purple",
    ],
    [
      "layers",
      "Suggest next steps",
      "Recommend how to use it in testing or keep it in D&I.",
      "is-green",
    ],
  ];
  return (
    <>
      <section className="ed-after" aria-label="What happens after upload">
        <header>
          <strong>What happens after upload?</strong>
          <span>
            <UiIcon name="sparkles" size={14} />
            The agent analyzes your file and:
          </span>
        </header>
        <ul>
          {steps.map(([icon, title, detail, tone]) => (
            <li key={title}>
              <span className={`ed-round-icon ${tone}`} aria-hidden="true">
                <UiIcon name={icon} size={18} />
              </span>
              <span>
                <strong>{title}</strong>
                <small>{detail}</small>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section
        className="ed-after is-preview"
        aria-label="Preview after upload"
      >
        <header>
          <strong>Preview opens automatically after upload</strong>
          <span>
            <UiIcon name="eye" size={14} />
            You review and confirm the classification before routing.
          </span>
        </header>
        <div className="ed-skeleton" aria-hidden="true">
          <span className="ed-skeleton-doc">
            <UiIcon name="file" size={34} />
          </span>
          <span className="ed-skeleton-lines">
            <i />
            <i />
            <i />
            <b />
          </span>
        </div>
      </section>
    </>
  );
}

/** Before a file is added, the agent's side says what it does with one. */
function AgentCapabilities({ controlRef }: { controlRef: string }) {
  const rows: Array<[IconName, string, string, string]> = [
    [
      "file",
      "Identifies the document type",
      "Policy, procedure, population, ticket, screenshot, sample or other evidence.",
      "is-blue",
    ],
    [
      "search",
      "Extracts key information",
      "Finds dates, system, owner and the content relevant to your test.",
      "is-purple",
    ],
    [
      "check",
      "Suggests next steps",
      "Recommends how to use the evidence in testing or keep it in D&I.",
      "is-green",
    ],
    [
      "chart",
      "Handles population files",
      "For a population, asks you to confirm the type and choose a sample size, or to pick a sample of one when uploaded into Design & Implementation.",
      "is-orange",
    ],
  ];
  return (
    <>
      <p className="ed-side-intro">
        The agent reads your file and identifies what kind of evidence it is,
        what it shows, and how it can be used in testing.
      </p>
      <ul className="ed-capabilities">
        {rows.map(([icon, title, detail, tone]) => (
          <li key={title}>
            <span
              className={`ed-round-icon is-large ${tone}`}
              aria-hidden="true"
            >
              <UiIcon name={icon} size={20} />
            </span>
            <span>
              <strong>{title}</strong>
              <small>{detail}</small>
            </span>
          </li>
        ))}
      </ul>
      <section className="ed-built-for" aria-label="Built for audit testing">
        <span className="ed-built-bot">
          <AgentBot size={44} label="Evidence Agent" />
        </span>
        <span>
          <strong>Built for audit testing</strong>
          <small>
            Uses your control context ({controlRef}) to classify evidence and
            suggest the most relevant next steps.
          </small>
        </span>
      </section>
    </>
  );
}
