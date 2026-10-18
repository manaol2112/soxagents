import { analysisFor, reviewFor } from "./analysis-model";
import { AnalysisPanel } from "./analysis-view";
import { FileChanges } from "./evidence-change";
import {
  CHANGE_NOTICES,
  changeBlocked,
  changeNoticeOk,
} from "./evidence-change-model";
import { EvidenceIntake } from "./evidence-intake";
import {
  agentStatus,
  applicationLabel,
  byControl,
  controlLabel,
  type EvidenceView,
  FILE_QUEUES,
  FILING_NOTICES,
  fileCounts,
  filedLabel,
  filterFiles,
  filterWithdrawn,
  REQUEST_STATUS,
  type RegisterControl,
  type RegisterFile,
  type Tone,
  uploadBlocked,
  type WithdrawnFile,
} from "./evidence-model";
import { PreviewButton } from "./evidence-preview";
import { formatBytes, formatDate } from "./format";
import type { ShellModel } from "./shell-model";
import { UiIcon } from "./ui-icon";
import { canRequestEvidence, type WorkflowState } from "./workflow-model";
import { Banner, EmptyState } from "./workspace-view";

type Ready = Extract<ShellModel, { status: "ready" }>;
type Keep = Record<string, string | null>;

const TONES: Record<Tone, string> = {
  neutral: "",
  info: "tone-info",
  success: "tone-success",
  warning: "tone-warning",
  danger: "tone-danger",
};

function href(model: Ready, keep: Keep): string {
  const params = new URLSearchParams({
    organization: model.organization.id,
    section: "evidence",
  });
  if (model.selectedProject !== null) {
    params.set("project", model.selectedProject.id);
  }
  for (const [key, value] of Object.entries(keep)) {
    if (value !== null && value !== "") {
      params.set(key, value);
    }
  }
  return `/?${params.toString()}`;
}

/** The kept view as hidden form fields: only the values that are set. */
function keepFields(keep: Keep): Record<string, string> {
  return Object.fromEntries(
    Object.entries(keep).filter(
      (entry): entry is [string, string] =>
        entry[1] !== null && entry[1] !== "",
    ),
  );
}

function keepOf(view: EvidenceView): Keep {
  return {
    queue: view.queue,
    q: view.query,
    group: view.group === "control" ? "control" : null,
  };
}

function fileIcon(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (["xlsx", "xls", "csv"].includes(extension)) {
    return "XLS";
  }
  if (
    ["png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff", "webp"].includes(
      extension,
    )
  ) {
    return "IMG";
  }
  if (extension === "pdf") {
    return "PDF";
  }
  if (["doc", "docx", "txt", "md", "rtf"].includes(extension)) {
    return "DOC";
  }
  if (["zip", "7z"].includes(extension)) {
    return "ZIP";
  }
  return "FILE";
}

/** The evidence files tab: the drop zone, the queues, the register, and the open file. */
export function EvidenceFiles({
  model,
  workflow,
  view,
}: {
  model: Ready;
  workflow: WorkflowState;
  view: EvidenceView;
}) {
  const project = model.selectedProject;
  const register = workflow.evidenceRegister;
  if (project === null) {
    return null;
  }
  const canAct =
    canRequestEvidence(model.organization.role) && project.status === "ACTIVE";
  if (register === null) {
    return (
      <section className="card">
        <div className="card-body">
          <Banner tone="warning">
            The evidence register could not be loaded. Refresh to try again.
          </Banner>
        </div>
      </section>
    );
  }
  const keep = keepOf(view);
  const blocked = uploadBlocked(project.status, model.organization.role);
  const searched = filterFiles(register.files, {
    queue: null,
    query: view.query,
  });
  const shown = filterFiles(register.files, view);
  const counts = fileCounts(register.files);
  const withdrawn = filterWithdrawn(register.withdrawn, view.query);
  const open = register.files.find((file) => file.id === view.file) ?? null;
  const groups =
    view.group === "control"
      ? byControl(shown)
      : [{ key: "all", label: "", detail: "", files: shown }];
  return (
    <>
      {workflow.filingNotice !== null ? (
        <Banner
          tone={
            workflow.filingNotice === "filed" ||
            workflow.filingNotice === "unfiled"
              ? "info"
              : "warning"
          }
        >
          {FILING_NOTICES[workflow.filingNotice]}
        </Banner>
      ) : null}
      {workflow.changeNotice !== null ? (
        <Banner
          tone={changeNoticeOk(workflow.changeNotice) ? "info" : "warning"}
        >
          {CHANGE_NOTICES[workflow.changeNotice]}
        </Banner>
      ) : null}
      {blocked !== null ? (
        <p className="upload-blocked" role="status">
          <UiIcon name="info" size={15} />
          <span>{blocked}</span>
        </p>
      ) : null}
      {canAct ? (
        <EvidenceIntake
          organizationId={model.organization.id}
          projectId={project.id}
        />
      ) : null}
      {counts.needsMatch > 0 && view.queue !== "needs_match" ? (
        <a
          className="match-callout"
          href={href(model, { ...keep, queue: "needs_match" })}
        >
          <UiIcon name="risk" size={15} />
          <span>
            <strong>
              {counts.needsMatch} file{counts.needsMatch === 1 ? "" : "s"} need
              {counts.needsMatch === 1 ? "s" : ""} a control
            </strong>{" "}
            The agent was not sure where they belong. Choose a control for each.
          </span>
          <UiIcon name="chevron" size={14} />
        </a>
      ) : null}
      <div className={`evidence-split${open !== null ? " has-panel" : ""}`}>
        <section className="card grid-card" aria-label="Evidence files">
          <nav className="view-tabs" aria-label="File queues">
            {FILE_QUEUES.map(([queue, label]) => {
              const count =
                queue === "withdrawn"
                  ? withdrawn.length
                  : searched.filter(
                      (file) =>
                        filterFiles([file], { queue, query: "" }).length > 0,
                    ).length;
              return (
                <a
                  key={label}
                  href={href(model, { ...keep, queue })}
                  aria-current={view.queue === queue ? "page" : undefined}
                  className={
                    queue === "needs_match" && count > 0
                      ? "is-alert"
                      : undefined
                  }
                >
                  {label}
                  <span className="view-count">{count}</span>
                </a>
              );
            })}
          </nav>
          <div className="grid-toolbar">
            <form
              autoComplete="off"
              method="get"
              action="/"
              className="grid-search"
            >
              <input
                type="hidden"
                name="organization"
                value={model.organization.id}
              />
              <input type="hidden" name="project" value={project.id} />
              <input type="hidden" name="section" value="evidence" />
              {view.queue !== null ? (
                <input type="hidden" name="queue" value={view.queue} />
              ) : null}
              {view.group === "control" ? (
                <input type="hidden" name="group" value="control" />
              ) : null}
              <label className="sr-only" htmlFor="evidence-search">
                Search evidence
              </label>
              <input
                id="evidence-search"
                name="q"
                type="search"
                defaultValue={view.query}
                placeholder="Search file, folder, control, or kind"
              />
            </form>
            <nav className="segmented" aria-label="Group files">
              <a
                href={href(model, { ...keep, group: null })}
                aria-current={view.group === "list" ? "page" : undefined}
              >
                List
              </a>
              <a
                href={href(model, { ...keep, group: "control" })}
                aria-current={view.group === "control" ? "page" : undefined}
              >
                Grouped by control
              </a>
            </nav>
            <span className="grid-count">
              {view.queue === "withdrawn"
                ? `${withdrawn.length} withdrawn`
                : `${shown.length} of ${register.files.length}`}
            </span>
          </div>
          {view.queue === "withdrawn" ? (
            <WithdrawnTable
              model={model}
              files={withdrawn}
              keep={keep}
              canAct={canAct}
            />
          ) : shown.length === 0 ? (
            <EmptyState
              icon="inbox"
              title={
                register.files.length === 0
                  ? "No evidence yet"
                  : view.queue === "needs_match"
                    ? "Every file is filed"
                    : "No files match"
              }
              detail={
                register.files.length === 0
                  ? "Drop the team's evidence folder above. Files that control owners email in appear here too."
                  : "Clear the search or choose another queue."
              }
            />
          ) : (
            <div className="grid-scroll">
              <table className="table data-grid is-fixed evidence-grid">
                <thead>
                  <tr>
                    <th scope="col">File</th>
                    <th scope="col" className="col-control">
                      Control
                    </th>
                    <th scope="col" className="col-request">
                      Request
                    </th>
                    <th scope="col" className="col-kind">
                      Kind
                    </th>
                    <th scope="col" className="col-agent">
                      Agent review
                    </th>
                    <th scope="col" className="col-added">
                      Added
                    </th>
                  </tr>
                </thead>
                {groups.map((group) => (
                  <tbody key={group.key}>
                    {group.label !== "" ? (
                      <tr className="group-row">
                        <th scope="colgroup" colSpan={6}>
                          <span>{group.label}</span>
                          <small>
                            {group.files.length} file
                            {group.files.length === 1 ? "" : "s"}
                            {group.detail !== "" ? ` · ${group.detail}` : ""}
                          </small>
                        </th>
                      </tr>
                    ) : null}
                    {group.files.map((file) => (
                      <FileRow
                        key={file.id}
                        model={model}
                        file={file}
                        keep={keep}
                        selected={file.id === view.file}
                        controls={register.controls}
                        canAct={canAct}
                      />
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          )}
        </section>
        {open !== null ? (
          <FilePanel
            model={model}
            workflow={workflow}
            file={open}
            keep={keep}
            controls={register.controls}
            canAct={canAct}
          />
        ) : null}
      </div>
    </>
  );
}

function FileRow({
  model,
  file,
  keep,
  selected,
  controls,
  canAct,
}: {
  model: Ready;
  file: RegisterFile;
  keep: Keep;
  selected: boolean;
  controls: readonly RegisterControl[];
  canAct: boolean;
}) {
  const agent = agentStatus(file);
  const request =
    file.request === null
      ? null
      : (REQUEST_STATUS[file.request.status] ?? null);
  const link = href(model, { ...keep, file: file.id });
  return (
    <tr
      className={`${selected ? "is-selected" : ""} state-${file.state.toLowerCase()}`}
    >
      <td>
        <a className="file-cell" href={link}>
          <span
            className={`file-badge kind-${fileIcon(file.fileName).toLowerCase()}`}
            aria-hidden="true"
          >
            {fileIcon(file.fileName)}
          </span>
          <span className="file-text">
            <strong title={file.fileName}>{file.fileName}</strong>
            <small title={file.folderPath}>
              {file.folderPath !== ""
                ? file.folderPath
                : file.source === "MAILBOX"
                  ? "Email attachment"
                  : "Uploaded"}
              {" · "}
              {formatBytes(file.sizeBytes)}
            </small>
          </span>
        </a>
      </td>
      <td className="col-control">
        {file.state === "READING" ? (
          <span className="cell-wait">
            <span className="spinner small" aria-hidden="true" /> Matching
          </span>
        ) : file.control !== null ? (
          <span className="control-cell">
            <span className="mono item-ref">{controlLabel(file.control)}</span>
            <small title={file.control.title}>{file.control.title}</small>
            {applicationLabel(file) !== "" ? (
              <span
                className={`app-tag${file.applicationScope === "UNKNOWN" ? " is-unknown" : ""}`}
              >
                {applicationLabel(file)}
              </span>
            ) : null}
            <span
              className={`filed-by is-${(file.filedBy ?? "").toLowerCase()}`}
            >
              {file.filedBy === "AGENT" ? (
                <UiIcon name="sparkles" size={11} />
              ) : null}
              {filedLabel(file)}
            </span>
          </span>
        ) : file.state === "NEEDS_MATCH" && canAct ? (
          <FilingForm
            model={model}
            file={file}
            keep={keep}
            controls={controls}
            compact
          />
        ) : (
          <span className="pill pill-dot tone-warning">
            {file.state === "NOT_LINKED"
              ? "Reply not matched"
              : "Needs a match"}
          </span>
        )}
      </td>
      <td className="col-request">
        {request !== null && file.request !== null ? (
          <span className="cell-stack">
            <span className={`pill pill-dot ${TONES[request.tone]}`}>
              {request.label}
            </span>
            {file.request.providedDirectly ? (
              <small className="cell-sub">Provided directly</small>
            ) : null}
          </span>
        ) : (
          <span className="cell-empty">—</span>
        )}
      </td>
      <td className="col-kind">
        {file.kindLabel !== null ? (
          <span className="cell-stack">
            <span>{file.kindLabel}</span>
            {file.kindConfirmed ? (
              <small className="cell-sub">Confirmed</small>
            ) : null}
          </span>
        ) : (
          <span className="cell-empty">—</span>
        )}
      </td>
      <td className="col-agent">
        <span className={`pill pill-dot ${TONES[agent.tone]}`}>
          {agent.label}
        </span>
      </td>
      <td className="col-added">
        <span className="cell-stack">
          <span className="num">{formatDate(file.createdAt)}</span>
          <small className="cell-sub" title={file.addedBy}>
            {file.source === "MAILBOX" ? "By email" : file.addedBy}
          </small>
        </span>
      </td>
    </tr>
  );
}

function FilingForm({
  model,
  file,
  keep,
  controls,
  compact = false,
}: {
  model: Ready;
  file: RegisterFile;
  keep: Keep;
  controls: readonly RegisterControl[];
  compact?: boolean;
}) {
  if (file.filingVersion === null) {
    return null;
  }
  const suggested = new Set(file.suggestions.map((item) => item.controlId));
  const others = controls.filter(
    (control) => !suggested.has(control.id) && control.id !== file.control?.id,
  );
  const first = file.suggestions.find(
    (item) => item.controlId !== file.control?.id,
  );
  return (
    <form
      autoComplete="off"
      method="post"
      action="/workspace/evidence-filing"
      className={compact ? "filing-form is-compact" : "filing-form"}
    >
      <input
        type="hidden"
        name="organization_id"
        value={model.organization.id}
      />
      <input
        type="hidden"
        name="project_id"
        value={model.selectedProject?.id ?? ""}
      />
      <input type="hidden" name="file_id" value={file.id} />
      <input type="hidden" name="version" value={file.filingVersion} />
      {Object.entries(keep).map(([key, value]) =>
        value === null || value === "" ? null : (
          <input key={key} type="hidden" name={key} value={value} />
        ),
      )}
      <label className="sr-only" htmlFor={`file-to-${file.id}`}>
        Control for {file.fileName}
      </label>
      <select
        id={`file-to-${file.id}`}
        name="control_id"
        defaultValue={first?.controlId ?? ""}
        required
      >
        <option value="" disabled>
          Choose a control
        </option>
        {file.suggestions.length > 0 ? (
          <optgroup label="Suggested by the agent">
            {file.suggestions
              .filter((item) => item.controlId !== file.control?.id)
              .map((item) => (
                <option key={item.controlId} value={item.controlId}>
                  {item.controlRef} · {item.title}
                </option>
              ))}
          </optgroup>
        ) : null}
        <optgroup label="All controls in scope">
          {others.map((control) => (
            <option key={control.id} value={control.id}>
              {controlLabel(control)} · {control.title}
            </option>
          ))}
        </optgroup>
      </select>
      <button type="submit" className="btn-sm">
        {file.control === null ? "File" : "Move"}
      </button>
    </form>
  );
}

function FilePanel({
  model,
  workflow,
  file,
  keep,
  controls,
  canAct,
}: {
  model: Ready;
  workflow: WorkflowState;
  file: RegisterFile;
  keep: Keep;
  controls: readonly RegisterControl[];
  canAct: boolean;
}) {
  const project = model.selectedProject;
  const analysis = analysisFor(workflow.evidenceAnalyses ?? [], file.id);
  const review = reviewFor(workflow.evidenceReviews ?? [], file.id);
  const request =
    file.request === null
      ? null
      : (REQUEST_STATUS[file.request.status] ?? null);
  const applications =
    controls.find((control) => control.id === file.control?.id)?.applications ??
    [];
  // Forms in the panel keep it open on the same file.
  const here = { ...keep, file: file.id };
  const movable =
    canAct &&
    file.source === "UPLOAD" &&
    file.state !== "READING" &&
    file.reviewDecision === null;
  return (
    <aside className="card file-panel" aria-label={`File ${file.fileName}`}>
      <header className="file-panel-head">
        <span
          className={`file-badge kind-${fileIcon(file.fileName).toLowerCase()}`}
          aria-hidden="true"
        >
          {fileIcon(file.fileName)}
        </span>
        <div>
          <h2 title={file.fileName}>{file.fileName}</h2>
          <p>
            {file.folderPath !== "" ? `${file.folderPath} · ` : ""}
            {formatBytes(file.sizeBytes)}
          </p>
        </div>
        <a className="panel-close" href={href(model, keep)} aria-label="Close">
          <UiIcon name="x" size={15} />
        </a>
      </header>
      <dl className="file-facts">
        <div>
          <dt>Added</dt>
          <dd>
            {formatDate(file.createdAt)} ·{" "}
            {file.source === "MAILBOX"
              ? "email attachment"
              : `uploaded by ${file.addedBy}`}
          </dd>
        </div>
        <div>
          <dt>Control</dt>
          <dd>
            {file.control !== null ? (
              <>
                <span className="mono item-ref">
                  {controlLabel(file.control)}
                </span>{" "}
                {file.control.title}
              </>
            ) : (
              "Not filed yet"
            )}
          </dd>
        </div>
        {applications.length > 1 ? (
          <div>
            <dt>Application</dt>
            <dd>
              {canAct ? (
                <form
                  autoComplete="off"
                  method="post"
                  action="/workspace/evidence-application"
                  className="inline-form app-form"
                >
                  <input
                    type="hidden"
                    name="organization_id"
                    value={model.organization.id}
                  />
                  <input
                    type="hidden"
                    name="project_id"
                    value={project?.id ?? ""}
                  />
                  <input type="hidden" name="file_id" value={file.id} />
                  <select
                    name="application"
                    aria-label="Application the file shows"
                    defaultValue={
                      file.applicationScope === "ALL"
                        ? "ALL"
                        : (file.application?.id ?? "")
                    }
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
                    <option value="ALL">All applications</option>
                  </select>
                  <button type="submit" className="btn-secondary btn-sm">
                    Save
                  </button>
                </form>
              ) : (
                applicationLabel(file) || "Not known"
              )}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Request</dt>
          <dd>
            {request !== null && file.request !== null ? (
              <>
                <span className={`pill pill-dot ${TONES[request.tone]}`}>
                  {request.label}
                </span>
                {file.request.providedDirectly ? (
                  <small className="cell-sub">
                    {" "}
                    Provided directly, not by email
                  </small>
                ) : null}
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>
      {file.source === "UPLOAD" ? (
        <section className="panel-block">
          <h3>Filing</h3>
          {file.state === "READING" ? (
            <p className="form-hint">
              The evidence coordinator is reading and matching this file.
            </p>
          ) : (
            <>
              <p className="filing-why">
                {file.filedBy !== null ? (
                  <strong>{filedLabel(file)}.</strong>
                ) : null}{" "}
                {file.matchReason}
              </p>
              {file.suggestions.length > 0 && file.state === "NEEDS_MATCH" ? (
                <ul className="suggestion-list">
                  {file.suggestions.map((item) => (
                    <li key={item.controlId}>
                      <span className="mono item-ref">{item.controlRef}</span>
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.reason}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
          {movable ? (
            <div className="filing-actions">
              <FilingForm
                model={model}
                file={file}
                keep={here}
                controls={controls}
              />
              {file.control !== null && file.filingVersion !== null ? (
                <div className="filing-secondary">
                  {file.filedBy === "AGENT" ? (
                    <form
                      autoComplete="off"
                      method="post"
                      action="/workspace/evidence-filing"
                    >
                      <FilingHidden model={model} file={file} keep={here} />
                      <input
                        type="hidden"
                        name="control_id"
                        value={file.control.id}
                      />
                      <button type="submit" className="btn-secondary btn-sm">
                        <UiIcon name="check" size={13} /> Confirm the agent's
                        filing
                      </button>
                    </form>
                  ) : null}
                  <form
                    autoComplete="off"
                    method="post"
                    action="/workspace/evidence-filing"
                  >
                    <FilingHidden model={model} file={file} keep={here} />
                    <input type="hidden" name="control_id" value="none" />
                    <button type="submit" className="btn-ghost btn-sm">
                      Take off this control
                    </button>
                  </form>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
      {canAct ? (
        <section className="panel-block">
          <h3>Replace or withdraw</h3>
          <FileChanges
            organizationId={model.organization.id}
            projectId={project?.id ?? ""}
            fileId={file.id}
            fileName={file.fileName}
            blocked={changeBlocked(file)}
            keep={keepFields(keep)}
          />
        </section>
      ) : null}
      <section className="panel-block">
        <h3>What the agent read</h3>
        {analysis === null ? (
          <p className="form-hint">Not read yet.</p>
        ) : (
          <AnalysisPanel
            analysis={analysis}
            review={review}
            organizationId={model.organization.id}
            projectId={project?.id ?? ""}
            canAct={canAct}
            keep={Object.fromEntries(
              Object.entries(here).filter(
                (entry): entry is [string, string] =>
                  entry[1] !== null && entry[1] !== "",
              ),
            )}
          />
        )}
      </section>
      <footer className="file-panel-foot">
        <PreviewButton
          organizationId={model.organization.id}
          projectId={project?.id ?? ""}
          files={[{ id: file.id, fileName: file.fileName }]}
          className="btn-sm"
          label="Preview"
        />
        <a
          className="btn btn-secondary btn-sm"
          href={`/workspace/evidence-files/${file.id}?organization=${model.organization.id}&project=${project?.id ?? ""}`}
        >
          Download
        </a>
        <span className="form-hint">
          Each download is checked against the original file.
        </span>
      </footer>
    </aside>
  );
}

function FilingHidden({
  model,
  file,
  keep,
}: {
  model: Ready;
  file: RegisterFile;
  keep: Keep;
}) {
  return (
    <>
      <input
        type="hidden"
        name="organization_id"
        value={model.organization.id}
      />
      <input
        type="hidden"
        name="project_id"
        value={model.selectedProject?.id ?? ""}
      />
      <input type="hidden" name="file_id" value={file.id} />
      <input type="hidden" name="version" value={file.filingVersion ?? ""} />
      {Object.entries(keep).map(([key, value]) =>
        value === null || value === "" ? null : (
          <input key={key} type="hidden" name={key} value={value} />
        ),
      )}
    </>
  );
}

/** Files a person withdrew: kept on record with the reason, and restorable unless replaced. */
function WithdrawnTable({
  model,
  files,
  keep,
  canAct,
}: {
  model: Ready;
  files: readonly WithdrawnFile[];
  keep: Keep;
  canAct: boolean;
}) {
  if (files.length === 0) {
    return (
      <EmptyState
        icon="inbox"
        title="Nothing withdrawn"
        detail="A file someone withdraws or replaces is kept here, with who did it and why."
      />
    );
  }
  return (
    <div className="grid-scroll">
      <table className="table data-grid is-fixed evidence-grid withdrawn-grid">
        <thead>
          <tr>
            <th scope="col">File</th>
            <th scope="col" className="col-control">
              Control
            </th>
            <th scope="col">Why it was withdrawn</th>
            <th scope="col" className="col-added">
              Withdrawn
            </th>
            <th scope="col" className="col-restore">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr key={file.id}>
              <td>
                <span className="file-cell">
                  <span
                    className={`file-badge kind-${fileIcon(file.fileName).toLowerCase()}`}
                    aria-hidden="true"
                  >
                    {fileIcon(file.fileName)}
                  </span>
                  <span className="file-text">
                    <strong title={file.fileName}>{file.fileName}</strong>
                    <small>
                      {file.folderPath !== "" ? `${file.folderPath} · ` : ""}
                      {formatBytes(file.sizeBytes)} ·{" "}
                      {file.source === "MAILBOX"
                        ? "by email"
                        : `added by ${file.addedBy}`}
                    </small>
                  </span>
                </span>
              </td>
              <td className="col-control">
                {file.control !== null ? (
                  <span className="mono item-ref">
                    {controlLabel(file.control)}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td>
                <span className="withdrawn-why">{file.reason}</span>
                {file.replacedBy !== null ? (
                  <small className="cell-sub">
                    Replaced by{" "}
                    <a
                      href={href(model, {
                        q: keep.q ?? null,
                        group: keep.group ?? null,
                        file: file.replacedBy,
                      })}
                    >
                      {file.replacedByName ?? "the newer version"}
                    </a>
                  </small>
                ) : null}
              </td>
              <td className="col-added">
                <span>{formatDate(file.withdrawnAt)}</span>
                <small className="cell-sub">by {file.withdrawnBy}</small>
              </td>
              <td className="col-restore">
                <span className="withdrawn-actions">
                  <a
                    className="btn btn-ghost btn-sm"
                    href={`/workspace/evidence-files/${file.id}?organization=${model.organization.id}&project=${model.selectedProject?.id ?? ""}`}
                  >
                    Download
                  </a>
                  {canAct && file.replacedBy === null ? (
                    <details className="row-menu">
                      <summary className="btn btn-secondary btn-sm">
                        Restore
                      </summary>
                      <form
                        autoComplete="off"
                        method="post"
                        action="/workspace/evidence-change"
                        className="row-menu-panel"
                      >
                        <input
                          type="hidden"
                          name="organization_id"
                          value={model.organization.id}
                        />
                        <input
                          type="hidden"
                          name="project_id"
                          value={model.selectedProject?.id ?? ""}
                        />
                        <input type="hidden" name="file_id" value={file.id} />
                        <input type="hidden" name="intent" value="restore" />
                        {Object.entries(keepFields(keep)).map(
                          ([key, value]) => (
                            <input
                              key={key}
                              type="hidden"
                              name={key}
                              value={value}
                            />
                          ),
                        )}
                        <label>
                          Why restore it
                          <input
                            name="reason"
                            required
                            minLength={3}
                            maxLength={500}
                          />
                        </label>
                        <button type="submit" className="btn-sm">
                          Restore
                        </button>
                      </form>
                    </details>
                  ) : null}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
