"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AgentBot } from "./agent-panel";
import {
  EVIDENCE_KIND_LABELS,
  EVIDENCE_KINDS,
  type EvidenceKind,
} from "./analysis-model";
import { AutoRefresh } from "./auto-refresh";
import type { ControlFiles } from "./engagement-model";
import { FileChanges } from "./evidence-change";
import {
  addableItems,
  instanceFor,
  interimPopulationOf,
  kindLabel,
  type ReadState,
  readableReason,
  type SuggestionAction,
  sampleSize,
  sizeChoices,
  stepsOf,
  suggestionFor,
  type WalkthroughInstance,
  walkthroughItemOf,
} from "./evidence-dialog-model";
import type { EvidenceFinding } from "./evidence-findings-model";
import { findingsForFile } from "./evidence-findings-model";
import { useFindingsAction } from "./evidence-findings-view";
import { RequestUpload } from "./evidence-intake";
import {
  insightOf,
  type NavItem,
  navigatorOf,
  phaseOfItem,
  uploadTargetOf,
} from "./evidence-intelligence-model";
import {
  Analysis,
  citationsOf,
  Details,
  FileBadge,
  Trace,
} from "./evidence-intelligence-view";
import type { EvidenceMappingRun } from "./evidence-mapping-model";
import type { EvidencePlan } from "./evidence-plan-model";
import { Problem, usePlanAction } from "./evidence-plan-view";
import { EvidenceViewer, PreviewButton } from "./evidence-preview";
import type { EvidenceCitation } from "./evidence-preview-model";
import { formatBytes, formatDate } from "./format";
import { DataTable } from "./population-table";
import { RecordDialog } from "./record-dialog";
import type { ControlTest } from "./testing-model";
import { type IconName, UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };

/** Adding evidence to an item (the item may be chosen in the dialog), or reviewing a
 * file already added. */
export type DialogOpen =
  | { mode: "add"; itemId: string | null }
  | { mode: "review"; fileId: string };

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

/** What the dialog's own calls answer, and what is in progress. */
function useDialogAction(ids: Ids) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  async function run(
    label: string,
    fields: Record<string, unknown>,
  ): Promise<boolean> {
    setBusy(label);
    setProblem(null);
    let status = 0;
    let detail = "";
    try {
      const response = await fetch("/workspace/evidence-dialog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          ...fields,
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
    if (status === 200) {
      // Success shows once the server has answered and the page holds the new state.
      startTransition(() => router.refresh());
      return true;
    }
    setProblem(
      status === 403
        ? "You do not have permission to do this on this engagement."
        : status === 409 && detail !== ""
          ? `${detail.charAt(0).toUpperCase()}${detail.slice(1)}.`
          : status === 422
            ? "That was not accepted. Check the choice and try again."
            : "The action did not complete. Try again in a moment.",
    );
    return false;
  }
  return { run, busy, pending, problem };
}

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
  const phases = useMemo(() => navigatorOf(plan, register), [plan, register]);
  const items = phases.flatMap((entry) => entry.items);
  const [fileId, setFileId] = useState<string | null>(
    open.mode === "review" ? open.fileId : null,
  );
  const [added, setAdded] = useState<string[]>([]);
  const [itemId, setItemId] = useState<string | null>(() =>
    open.mode === "add"
      ? (open.itemId ??
        uploadTargetOf(phases, null, null)?.requirement.id ??
        null)
      : (uploadTargetOf(phases, null, open.fileId)?.requirement.id ?? null),
  );
  const [tab, setTab] = useState<Tab>("preview");
  const [focused, setFocused] = useState<EvidenceCitation | null>(null);
  const [routed, setRouted] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [changingKind, setChangingKind] = useState(false);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [withdrawn, setWithdrawn] = useState<string | null>(null);
  const [addingMore, setAddingMore] = useState(false);
  const [size, setSize] = useState<number | null>(null);
  const dialog = useDialogAction(ids);
  const plan$ = usePlanAction(ids);
  const findingsAction = useFindingsAction(ids);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [pickedRecords, setPickedRecords] = useState<Set<string>>(
    () => new Set(),
  );

  const item = items.find((entry) => entry.requirement.id === itemId) ?? null;
  const insight =
    fileId === null
      ? null
      : insightOf(fileId, phases, register, mapping, attributes, controlRef);
  const fileItem =
    insight === null
      ? item
      : (items.find(
          (entry) => entry.requirement.id === insight.file.requirementId,
        ) ?? item);
  const phase = phaseOfItem(phases, fileItem?.requirement.id ?? null);
  const analysis = insight?.analysis ?? null;
  const read: ReadState =
    fileId === null
      ? "none"
      : analysis === null ||
          analysis.status === "PENDING" ||
          analysis.status === "WORKING"
        ? "reading"
        : analysis.status === "FAILED"
          ? "failed"
          : "ready";
  const kind: EvidenceKind | null =
    analysis?.confirmedKind ?? analysis?.classification?.kind ?? null;
  const table =
    analysis !== null && analysis.rows !== null && analysis.columns.length > 0;
  const population = read === "ready" && kind === "population" && table;
  const test =
    fileId === null
      ? null
      : ((tests ?? []).find((entry) => entry.populationFileId === fileId) ??
        null);
  const instance = fileId === null ? null : instanceFor(instances, fileId);
  const walkItem = walkthroughItemOf(phases, fileItem);
  const interimItem = interimPopulationOf(phases);
  const suggestion =
    phase === null
      ? null
      : suggestionFor({
          read,
          kind,
          confirmed: analysis?.confirmedKind != null,
          phase,
          itemTitle: fileItem?.requirement.title ?? "",
          table,
          interimPopulation: interimItem !== null,
          populationAccepted: fileItem?.requirement.state === "ACCEPTED",
          samples:
            test === null
              ? null
              : { status: test.status, count: test.samples.length },
          instance:
            instance === null
              ? null
              : { key: instance.keyValue, rowNumber: instance.rowNumber },
          linkedToInterim:
            interimItem?.files.some((file) => file.id === fileId) ?? false,
        });
  const steps = stepsOf({
    phase,
    fileOpen: fileId !== null,
    read,
    routed: routed !== null || test?.status === "APPROVED",
  });
  const records =
    findings === null || fileId === null
      ? null
      : findingsForFile(findings, fileId);
  const findingCount =
    (records?.length ?? 0) +
    (insight?.findings.filter((finding) => finding.source === "REVIEW")
      .length ?? 0);
  const chosenSize = size ?? test?.sampleSize ?? 1;
  const files = [...new Set(fileId === null ? added : [fileId, ...added])];

  // The open file, as its card says it.
  const docEntry =
    fileId === null
      ? null
      : insightOf(fileId, phases, register, mapping, attributes, controlRef);
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
    <div className="ed-withdraw">
      <FileChanges
        organizationId={ids.organizationId}
        projectId={ids.projectId}
        fileId={each}
        fileName={name}
        blocked={null}
        controlId={ids.controlId}
        keep={{ step: "request" }}
        start="withdraw"
        onCancel={() => setWithdrawing(null)}
        onDone={() => {
          setWithdrawing(null);
          setAdded((current) => current.filter((entry) => entry !== each));
          if (fileId === each) {
            setFileId(null);
          }
          setWithdrawn(
            `${name} was withdrawn. It is kept on record with who withdrew it, and can be restored.`,
          );
        }}
      />
    </div>
  );

  const confirm = (chosen: EvidenceKind) =>
    analysis === null
      ? Promise.resolve(false)
      : dialog.run("confirm", {
          intent: "confirm-kind",
          analysis_id: analysis.id,
          version: analysis.version,
          kind: chosen,
        });

  const act = async (action: SuggestionAction) => {
    if (action === "confirm-population") {
      await confirm("population");
    } else if (action === "confirm-kind" && kind !== null) {
      await confirm(kind);
    } else if (action === "change-kind") {
      setChangingKind(true);
    } else if (action === "pick-one") {
      setPicking(true);
      setTab("data");
    } else if (action === "route-interim" && interimItem !== null && fileId) {
      const ok = await plan$.run(`link-${interimItem.requirement.id}`, {
        intent: "link",
        requirement_id: interimItem.requirement.id,
        file_id: fileId,
        reason:
          "Routed from Design & Implementation as the population for interim testing.",
        version: interimItem.requirement.version,
      });
      if (ok) {
        setRouted("Linked to interim testing. Its samples are chosen there.");
      }
    } else if (action === "keep-design") {
      if (analysis?.confirmedKind == null) {
        await confirm("population");
      }
      setRouted("Kept in Design & Implementation.");
    } else if (action === "upload-instance" && walkItem !== null) {
      setItemId(walkItem.requirement.id);
      setFileId(null);
      setPicking(false);
      setTab("preview");
    } else if (action === "accept-population" && fileItem !== null) {
      await plan$.run(`judge-${fileItem.requirement.id}`, {
        intent: "sufficiency",
        requirement_id: fileItem.requirement.id,
        sufficiency: "ACCEPTED",
        note: "",
        version: fileItem.requirement.version,
      });
    } else if (action === "choose-samples" && fileId !== null) {
      await dialog.run("propose", {
        intent: "propose-samples",
        file_id: fileId,
        sample_size: chosenSize,
      });
    } else if (action === "approve-samples" && test !== null) {
      await dialog.run("approve", {
        intent: "approve-samples",
        test_id: test.id,
        version: test.version,
      });
    }
  };
  const actionLabel = (action: SuggestionAction, label: string) =>
    action === "choose-samples"
      ? `${label === "Draw again" ? "Draw again" : "Select"} ${chosenSize} sample${chosenSize === 1 ? "" : "s"}`
      : label;

  return (
    <RecordDialog
      eyebrow={controlRef}
      title={open.mode === "add" ? "Add evidence" : "Review evidence"}
      description={
        open.mode === "add"
          ? "Upload your evidence and the agent classifies it and helps you use it in testing."
          : "What the agent found in the file, and what to do with it."
      }
      closeHref=""
      className="ed-dialog"
      onClose={onClose}
    >
      {read === "reading" ? <AutoRefresh seconds={3} /> : null}
      <ol
        className="ed-steps"
        aria-label="Progress"
        hidden={open.mode === "review" || undefined}
      >
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
                    setRouted(null);
                    setSize(null);
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
                      aria-label={`Withdraw ${docName}`}
                      title="Withdraw the file"
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
                      setRouted(null);
                      setSize(null);
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
                          setRouted(null);
                          setTab("preview");
                          setSize(null);
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
                <PreviewButton
                  organizationId={ids.organizationId}
                  projectId={ids.projectId}
                  files={[
                    { id: insight.file.id, fileName: insight.file.fileName },
                  ]}
                  citations={citationsOf(insight, focused)}
                  label={<UiIcon name="expand" size={16} />}
                  className="ed-view-expand"
                />
              </header>
              <div className="ed-tab-body">
                {tab === "preview" ? (
                  table ? (
                    <DataTable
                      key={`${insight.file.id}-preview`}
                      ids={ids}
                      fileId={insight.file.id}
                      compact
                      picking={false}
                      chosenRow={instance?.rowNumber ?? null}
                      busy={false}
                      onPick={() => undefined}
                      onCancel={() => undefined}
                      onAll={() => setTab("data")}
                    />
                  ) : (
                    <EvidenceViewer
                      key={`${insight.file.id}-${analysis?.status ?? ""}-${analysis?.version ?? 0}`}
                      organizationId={ids.organizationId}
                      projectId={ids.projectId}
                      file={{
                        id: insight.file.id,
                        fileName: insight.file.fileName,
                      }}
                      citations={citationsOf(insight, focused)}
                      focused={focused}
                    />
                  )
                ) : tab === "data" ? (
                  <DataTable
                    key={`${insight.file.id}-data`}
                    ids={ids}
                    fileId={insight.file.id}
                    picking={picking && canAct && walkItem !== null}
                    chosenRow={instance?.rowNumber ?? null}
                    busy={dialog.busy === "pick"}
                    onPick={async (row) => {
                      if (walkItem === null) {
                        return;
                      }
                      const ok = await dialog.run("pick", {
                        intent: "pick-instance",
                        control_id: ids.controlId,
                        requirement_id: walkItem.requirement.id,
                        file_id: insight.file.id,
                        row_number: row,
                      });
                      if (ok) {
                        setPicking(false);
                      }
                    }}
                    onCancel={() => setPicking(false)}
                  />
                ) : (
                  <div className="ed-details">
                    <Details insight={insight} ids={ids} canAct={canAct} />
                    {test !== null && test.checks.length > 0 ? (
                      <section
                        className="ed-panel"
                        aria-label="Population checks"
                      >
                        <small className="ed-kicker">Population checks</small>
                        <ul className="ed-checks">
                          {test.checks.map((check) => (
                            <li
                              key={check.check}
                              className={`is-${check.result.toLowerCase()}`}
                            >
                              <UiIcon
                                name={
                                  check.result === "OK"
                                    ? "check"
                                    : check.result === "ISSUE"
                                      ? "risk"
                                      : "info"
                                }
                                size={13}
                              />
                              {check.detail}
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}
                    {test !== null && test.samples.length > 0 ? (
                      <section className="ed-panel" aria-label="Samples">
                        <small className="ed-kicker">
                          {test.status === "APPROVED"
                            ? "Approved samples"
                            : "Proposed samples"}{" "}
                          · {test.samples.length} of{" "}
                          {test.frameRows.toLocaleString()}
                        </small>
                        <ol className="ed-samples">
                          {test.samples.map((sample) => (
                            <li key={sample.position}>
                              <span>
                                {sample.keyValue || `Row ${sample.rowNumber}`}
                              </span>
                              <small>row {sample.rowNumber}</small>
                            </li>
                          ))}
                        </ol>
                      </section>
                    ) : null}
                    {instance !== null ? (
                      <section
                        className="ed-panel"
                        aria-label="Walkthrough instance"
                      >
                        <small className="ed-kicker">
                          Walkthrough instance
                        </small>
                        <dl className="ed-instance">
                          {instance.columns.slice(0, 8).map((column, index) => (
                            <div key={column}>
                              <dt>{column}</dt>
                              <dd>{instance.values[index] ?? ""}</dd>
                            </div>
                          ))}
                        </dl>
                        <small className="ed-quiet">
                          Row {instance.rowNumber}, picked by{" "}
                          {instance.selectedBy || "a person"}.
                        </small>
                      </section>
                    ) : null}
                    {read === "ready" ? (
                      <section
                        id="ed-findings"
                        className="ed-findings"
                        aria-label="Findings and coverage"
                      >
                        <Analysis
                          insight={insight}
                          items={items}
                          canAct={canAct}
                          action={plan$}
                          picked={picked}
                          onPick={(key, on) =>
                            setPicked((current) => toggle(current, key, on))
                          }
                          onShow={(citation) => {
                            setFocused(citation);
                            setTab("preview");
                          }}
                          focused={focused}
                          records={records}
                          findingsAction={findingsAction}
                          pickedRecords={pickedRecords}
                          onPickRecord={(key, on) =>
                            setPickedRecords((current) =>
                              toggle(current, key, on),
                            )
                          }
                          controlRef={controlRef}
                          controlTitle=""
                        />
                        <Trace
                          insight={insight}
                          ids={ids}
                          onShow={(citation) => {
                            setFocused(citation);
                            setTab("preview");
                          }}
                          focused={focused}
                        />
                      </section>
                    ) : null}
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
            {read === "ready" && analysis?.classification ? (
              <span
                className={`ed-confidence is-${analysis.confirmedKind != null ? "high" : analysis.classification.confidence}`}
              >
                {analysis.confirmedKind != null
                  ? "Confirmed"
                  : `${analysis.classification.confidence.charAt(0).toUpperCase()}${analysis.classification.confidence.slice(1)} confidence`}
              </span>
            ) : null}
          </header>

          {fileId === null ? (
            <AgentCapabilities controlRef={controlRef} />
          ) : (
            <>
              <div className="ed-fact">
                <span className="ed-fact-icon is-type" aria-hidden="true">
                  <UiIcon name={table ? "table" : "file"} size={20} />
                </span>
                <div>
                  <small>Detected file type</small>
                  <strong className="ed-fact-type">
                    {read === "ready"
                      ? kind === "population"
                        ? "Population"
                        : kindLabel(kind)
                      : read === "failed"
                        ? "Not read"
                        : "Reading the file…"}
                  </strong>
                </div>
              </div>
              {read === "ready" && analysis?.classification?.reason ? (
                <div className="ed-fact">
                  <span className="ed-fact-icon is-why" aria-hidden="true">
                    <UiIcon name="eye" size={18} />
                  </span>
                  <div>
                    <small>Why it was classified this way</small>
                    <p>{readableReason(analysis.classification.reason)}</p>
                  </div>
                </div>
              ) : null}

              {suggestion !== null ? (
                <section
                  className="ed-suggest"
                  aria-label="What the agent suggests"
                >
                  <div className="ed-suggest-head">
                    <span className="ed-suggest-icon" aria-hidden="true">
                      <UiIcon name="target" size={22} />
                    </span>
                    <div>
                      <strong>{routed ?? suggestion.title}</strong>
                      {routed === null ? <p>{suggestion.question}</p> : null}
                    </div>
                  </div>
                  {canAct &&
                  routed === null &&
                  suggestion.actions.length > 0 ? (
                    <div className="ed-suggest-actions">
                      {suggestion.actions.map((entry) => (
                        <button
                          key={entry.action}
                          type="button"
                          className={entry.primary ? "btn" : "btn-secondary"}
                          disabled={
                            dialog.busy !== "" ||
                            dialog.pending ||
                            plan$.pending
                          }
                          onClick={() => void act(entry.action)}
                        >
                          {actionLabel(entry.action, entry.label)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {read === "ready" && findingCount > 0 ? (
                    <button
                      type="button"
                      className="ed-findings-link"
                      onClick={() => setTab("details")}
                    >
                      Review {findingCount} finding
                      {findingCount === 1 ? "" : "s"} in Details
                    </button>
                  ) : null}
                  <Problem text={dialog.problem ?? plan$.problem} />
                </section>
              ) : null}

              {changingKind && analysis !== null && canAct ? (
                <form
                  className="ed-panel"
                  autoComplete="off"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const chosen = new FormData(event.currentTarget).get(
                      "kind",
                    );
                    const next = EVIDENCE_KINDS.find((each) => each === chosen);
                    if (next !== undefined && (await confirm(next))) {
                      setChangingKind(false);
                    }
                  }}
                >
                  <label>
                    <span>What the file is</span>
                    <select name="kind" defaultValue={kind ?? "other"}>
                      {EVIDENCE_KINDS.map((each) => (
                        <option key={each} value={each}>
                          {EVIDENCE_KIND_LABELS[each]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="ed-panel-actions">
                    <button type="submit" className="btn btn-sm">
                      Confirm the type
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => setChangingKind(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}

              {population && test?.status !== "APPROVED" ? (
                <SampleSize
                  planSize={test?.sampleSize ?? null}
                  design={phase === "DESIGN"}
                  value={chosenSize}
                  onChange={setSize}
                  disabled={!canAct}
                />
              ) : null}
            </>
          )}
        </aside>
      </div>
    </RecordDialog>
  );
}

function toggle(current: Set<string>, key: string, on: boolean): Set<string> {
  const next = new Set(current);
  if (on) {
    next.add(key);
  } else {
    next.delete(key);
  }
  return next;
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

/** How many samples to draw (the reference's "Select sample size"): a free choice (the
 * product owner's decision), with the test plan's own size beside it. A walkthrough in
 * design uses one instance. */
function SampleSize({
  planSize,
  design,
  value,
  onChange,
  disabled,
}: {
  planSize: number | null;
  design: boolean;
  value: number;
  onChange: (size: number) => void;
  disabled: boolean;
}) {
  const choices = sizeChoices(planSize);
  const [typed, setTyped] = useState("");
  const listed = choices.some((choice) => choice.size === value);
  return (
    <section className="ed-size" aria-label="Sample size">
      <div className="ed-size-head">
        <span className="ed-fact-icon is-size" aria-hidden="true">
          <UiIcon name="chart" size={18} />
        </span>
        <div>
          <strong>
            Select sample size (optional)
            <span
              className="ed-size-help"
              title={
                design
                  ? "A walkthrough in Design & Implementation uses one instance; larger samples are drawn in interim testing."
                  : "The agent selects the samples at random from the population, reproducibly. A person approves them before they are tested."
              }
            >
              <UiIcon name="info" size={14} />
            </span>
          </strong>
          <p>
            {design
              ? "The walkthrough is performed on one instance picked from the population."
              : `The agent randomly selects items from the population for testing.${planSize !== null ? ` The test plan sets ${planSize}.` : ""}`}
          </p>
        </div>
      </div>
      <div
        className="ed-size-choices"
        role="radiogroup"
        aria-label="Sample size"
      >
        {choices.map((choice) => {
          const off = disabled || (design && choice.size !== 1);
          return (
            // biome-ignore lint/a11y/useSemanticElements: a chip that reads as one choice of a group.
            <button
              key={choice.size}
              type="button"
              role="radio"
              aria-checked={value === choice.size}
              disabled={off}
              title={
                design && choice.size !== 1
                  ? "A walkthrough uses one instance."
                  : undefined
              }
              className={value === choice.size ? "is-on" : undefined}
              onClick={() => {
                onChange(choice.size);
                setTyped("");
              }}
            >
              <strong>{choice.size}</strong>
              <small>{choice.plan ? "Test plan" : choice.label}</small>
            </button>
          );
        })}
      </div>
      {design ? null : (
        <label className="ed-size-custom">
          <span>Or another number</span>
          <input
            inputMode="numeric"
            value={listed && typed === "" ? "" : typed || String(value)}
            placeholder="e.g. 25"
            disabled={disabled}
            onChange={(event) => {
              const text = event.target.value.replace(/[^0-9]/g, "");
              setTyped(text);
              const parsed = sampleSize(text);
              if (parsed !== null) {
                onChange(parsed);
              }
            }}
          />
        </label>
      )}
    </section>
  );
}
