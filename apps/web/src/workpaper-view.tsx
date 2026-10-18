import { AutoRefresh } from "./auto-refresh";
import { formatDate } from "./format";
import { type SheetTab, SheetTabs } from "./sheet-tabs";
import { UiIcon } from "./ui-icon";
import {
  rowsToText,
  SOURCE_LABELS,
  WORKPAPER_NOTICES,
  type Workpaper,
  type WorkpaperNotice,
  type WorkpaperSection,
  type WorkpaperTab,
  workpaperTabs,
} from "./workpaper-model";

type Ids = { organizationId: string; projectId: string; controlId: string };

function Hidden({
  ids,
  paper,
  intent,
  version,
}: {
  ids: Ids;
  paper?: Workpaper;
  intent: string;
  version?: number;
}) {
  return (
    <>
      <input type="hidden" name="organization_id" value={ids.organizationId} />
      <input type="hidden" name="project_id" value={ids.projectId} />
      <input type="hidden" name="control_id" value={ids.controlId} />
      <input type="hidden" name="intent" value={intent} />
      {paper !== undefined ? (
        <input type="hidden" name="workpaper_id" value={paper.id} />
      ) : null}
      {version !== undefined ? (
        <input type="hidden" name="version" value={version} />
      ) : null}
    </>
  );
}

/** The control's whole workbook: every tab of both records, as one download. */
function bookHref(ids: Ids): string {
  const params = new URLSearchParams({
    organization: ids.organizationId,
    project: ids.projectId,
    control: ids.controlId,
  });
  return `/workspace/workpapers/export?${params.toString()}`;
}

function exportHref(ids: Ids, paper?: Workpaper): string {
  // One workbook: every tab of the control's records, as one download.
  const params = new URLSearchParams({
    organization: ids.organizationId,
    project: ids.projectId,
  });
  if (paper !== undefined) {
    params.set("workpaper", paper.id);
  }
  return `/workspace/workpapers/export?${params.toString()}`;
}

/**
 * A control's workpaper: one workbook with a design tab and the testing tabs (interim and
 * roll-forward), drafted from the records and evidence, edited, and prepared. The design
 * tab is one record; the testing tabs share another, prepared together.
 */
export function WorkpapersTab({
  papers: all,
  notice,
  ids,
  canAct,
  viewing,
  stage,
  initial,
  hasInput,
}: {
  papers: Workpaper[] | null;
  notice: WorkpaperNotice | null;
  ids: Ids;
  canAct: boolean;
  viewing: { id: string; version: number } | null;
  /** Show only the design record, or only the testing record. */
  stage?: Workpaper["stage"] | undefined;
  /** The template tab to open first: "interim" or "rollforward". */
  initial?: string | undefined;
  /** Whether the agent has anything to draft from: read evidence or signed-off testing. */
  hasInput?: boolean | undefined;
}) {
  const papers =
    all === null || stage === undefined
      ? all
      : all.filter((paper) => paper.stage === stage);
  const drafting = (papers ?? []).some((paper) => paper.drafting);
  return (
    <div className="workpapers">
      {drafting ? <AutoRefresh /> : null}
      {notice !== null ? (
        <p
          className={`banner ${notice === "wp-blocked" || notice === "wp-invalid" ? "banner-warning" : ""}`}
          role="status"
        >
          <UiIcon name="info" size={15} />
          <span>{WORKPAPER_NOTICES[notice]}</span>
        </p>
      ) : null}
      <header className="wp-bar">
        <div>
          <strong>Workpaper</strong>
          <small>
            One workbook: design, interim testing, and roll-forward tabs, filled
            from the records and the evidence. The agent drafts the narratives
            with citations; you edit, then prepare the design tab and the
            testing tabs.
          </small>
        </div>
        {canAct ? (
          <form autoComplete="off" method="post" action="/workspace/workpapers">
            <Hidden ids={ids} intent="draft" />
            <button
              type="submit"
              className="btn-sm"
              disabled={drafting || hasInput === false}
              title={
                hasInput === false
                  ? "The agent drafts once evidence has been read or the testing is signed off."
                  : undefined
              }
            >
              <UiIcon name="sparkles" size={13} />{" "}
              {(papers ?? []).length === 0
                ? "Draft the workpaper"
                : "Draft again"}
            </button>
          </form>
        ) : null}
      </header>
      {hasInput === false ? (
        <p className="wp-waiting" role="status">
          <UiIcon name="clock" size={14} />
          <span>
            Waiting for evidence. The agent drafts the narratives once evidence
            has been read or the testing is signed off; the header fields are
            filled from the records meanwhile.
          </span>
        </p>
      ) : null}
      {papers === null ? (
        <p className="form-hint">
          The workpapers could not be loaded. Refresh to try again.
        </p>
      ) : papers.length === 0 ? (
        <p className="sheet-empty">
          <UiIcon name="table" size={16} />
          <span>
            {stage === "DESIGN"
              ? "No design workpaper yet. Draft it and the agent writes the walkthrough from the evidence."
              : "No workpaper yet. The testing tabs open when the control's testing is signed off, or draft the whole workbook now."}
          </span>
        </p>
      ) : (
        <WorkpaperBook
          papers={papers}
          ids={ids}
          canAct={canAct}
          viewing={viewing}
          initial={initial}
        />
      )}
    </div>
  );
}

/** The workbook: the design record's tab, then the testing record's tabs. */
function WorkpaperBook({
  papers,
  ids,
  canAct,
  viewing,
  initial: wanted,
}: {
  papers: Workpaper[];
  ids: Ids;
  canAct: boolean;
  viewing: { id: string; version: number } | null;
  initial?: string | undefined;
}) {
  const ordered = [...papers].sort((a, b) =>
    a.stage === b.stage ? 0 : a.stage === "DESIGN" ? -1 : 1,
  );
  const tabs: SheetTab[] = [];
  let initial: string | undefined =
    wanted === undefined
      ? undefined
      : ordered
          .flatMap((paper) =>
            workpaperTabs(paper).map(
              (tab) =>
                [tab.key, `${paper.stage.toLowerCase()}:${tab.key}`] as const,
            ),
          )
          .find(([key]) => key === wanted)?.[1];
  for (const paper of ordered) {
    const old =
      viewing !== null &&
      viewing.id === paper.id &&
      viewing.version !== paper.currentVersion;
    for (const tab of workpaperTabs(paper)) {
      const key = `${paper.stage.toLowerCase()}:${tab.key}`;
      if (
        viewing !== null &&
        viewing.id === paper.id &&
        initial === undefined
      ) {
        initial = key;
      }
      tabs.push({
        key,
        title: tab.title,
        note: paper.drafting
          ? "Drafting…"
          : paper.status === "PREPARED"
            ? "Prepared"
            : paper.currentVersion === 0
              ? "Not drafted"
              : "Draft",
        tone: paper.drafting
          ? "tone-info"
          : paper.status === "PREPARED"
            ? "tone-success"
            : "",
        content: (
          <WorkpaperCard
            paper={paper}
            tab={tab}
            ids={ids}
            canAct={canAct}
            old={old}
          />
        ),
      });
    }
  }
  const first = ordered[0];
  return (
    <section className="card wp-book" aria-label="Workpaper">
      <header className="wp-book-head">
        <div>
          <p className="wp-stage">
            {first?.kind ? kindLabel(first.kind) : "Workpaper"}
          </p>
          <h3>
            <span className="mono">
              {first?.reference.replace(/-(TOD|TOE)$/, "") || "Drafting…"}
            </span>{" "}
            {first?.templateTitle}
          </h3>
        </div>
        <a className="btn btn-secondary btn-sm" href={bookHref(ids)}>
          <UiIcon name="table" size={13} /> Download the workbook
        </a>
      </header>
      <SheetTabs tabs={tabs} initial={initial} label="Workpaper tabs" />
    </section>
  );
}

function kindLabel(kind: string): string {
  return (
    {
      ITGC: "IT general control",
      ITAC: "Application control",
      BUSINESS: "Business process control",
      KEY_REPORT: "Key report",
    }[kind] ?? "Workpaper"
  );
}

function WorkpaperCard({
  paper,
  tab,
  ids,
  canAct,
  old,
}: {
  paper: Workpaper;
  tab: WorkpaperTab & { sections: WorkpaperSection[] };
  ids: Ids;
  canAct: boolean;
  old: boolean;
}) {
  const editable =
    canAct && paper.status === "DRAFT" && !paper.drafting && !old;
  return (
    <article className="wp-card" aria-label={tab.reference || paper.reference}>
      <header className="wp-head">
        <div>
          <p className="wp-stage">{tab.title}</p>
          <h3>
            <span className="mono">
              {tab.reference || paper.reference || "Drafting…"}
            </span>{" "}
            {paper.stage === "EFFECTIVENESS"
              ? "Testing: prepared with the other testing tab"
              : "Design"}
          </h3>
          <p className="wp-meta">
            {paper.drafting ? (
              <span className="pill pill-dot tone-info">
                <span className="spinner small" aria-hidden="true" /> The agent
                is drafting
              </span>
            ) : paper.status === "PREPARED" ? (
              <span className="pill pill-dot tone-success">
                Prepared by {paper.preparedBy}
                {paper.preparedAt !== null
                  ? ` on ${formatDate(paper.preparedAt)}`
                  : ""}
              </span>
            ) : (
              <span className="pill pill-dot tone-warning">Draft</span>
            )}
            {paper.currentVersion > 0 ? (
              <span>
                Version {paper.shownVersion} of {paper.currentVersion}
                {old ? " · an earlier version" : ""}
              </span>
            ) : null}
            {paper.draftNote !== "" ? (
              <span className="wp-note">{paper.draftNote}</span>
            ) : null}
          </p>
        </div>
        <div className="wp-actions">
          {paper.currentVersion > 0 ? (
            <a
              className="btn btn-secondary btn-sm"
              href={exportHref(ids, paper)}
            >
              <UiIcon name="table" size={13} /> Download .xlsx
            </a>
          ) : null}
          {canAct &&
          paper.status === "DRAFT" &&
          paper.currentVersion > 0 &&
          !old ? (
            <form
              autoComplete="off"
              method="post"
              action="/workspace/workpapers"
              className="inline-form"
            >
              <Hidden
                ids={ids}
                paper={paper}
                intent="prepare"
                version={paper.version}
              />
              <button
                type="submit"
                className="btn-sm"
                disabled={paper.drafting}
              >
                <UiIcon name="check" size={13} /> Prepare
              </button>
            </form>
          ) : null}
          {canAct && paper.status === "PREPARED" ? (
            <details className="row-menu">
              <summary className="btn btn-ghost btn-sm">Reopen</summary>
              <form
                autoComplete="off"
                method="post"
                action="/workspace/workpapers"
                className="row-menu-panel"
              >
                <Hidden
                  ids={ids}
                  paper={paper}
                  intent="reopen"
                  version={paper.version}
                />
                <label>
                  Why reopen it
                  <input name="reason" required minLength={3} maxLength={500} />
                </label>
                <button type="submit" className="btn-sm">
                  Reopen
                </button>
              </form>
            </details>
          ) : null}
        </div>
      </header>
      {paper.versions.length > 1 ? (
        <details className="wp-versions">
          <summary>Version history ({paper.versions.length})</summary>
          <ol>
            {paper.versions.map((version) => (
              <li key={version.number}>
                <a
                  href={`/?organization=${ids.organizationId}&project=${ids.projectId}&section=controls&control=${ids.controlId}&tab=workpapers&wp=${paper.id}&wpversion=${version.number}`}
                  aria-current={
                    version.number === paper.shownVersion ? "true" : undefined
                  }
                >
                  Version {version.number}
                </a>
                <span>
                  {SOURCE_LABELS[version.source] ?? version.source}
                  {version.createdBy !== null ? ` · ${version.createdBy}` : ""}{" "}
                  · {formatDate(version.createdAt)}
                  {version.note !== "" ? ` · ${version.note}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      <div className="wp-sections workpaper-body">
        {tab.sections.map((section) => (
          <SectionView
            key={section.key}
            section={section}
            paper={paper}
            ids={ids}
            editable={editable}
          />
        ))}
      </div>
    </article>
  );
}

function SectionView({
  section,
  paper,
  ids,
  editable,
}: {
  section: WorkpaperSection;
  paper: Workpaper;
  ids: Ids;
  editable: boolean;
}) {
  const canEdit =
    editable && section.kind !== "fields" && section.key !== "sign-off";
  return (
    <section
      className={`wp-section workpaper-section source-${section.source.toLowerCase()} ${section.key.includes("sign-off") ? "is-signoff" : ""} ${section.kind === "fields" ? "is-fields" : ""}`}
    >
      <header>
        <h4>
          <span>{section.title}</span>
        </h4>
        <span className="wp-source">{SOURCE_LABELS[section.source]}</span>
      </header>
      {section.kind === "fields" ? (
        <dl className="workpaper-fields wp-fields">
          {section.fields.map((field) => (
            <div key={field.label}>
              <dt>{field.label}</dt>
              <dd>{field.value || "—"}</dd>
            </div>
          ))}
        </dl>
      ) : section.kind === "text" ? (
        <>
          <p className="wp-text">
            {section.text.split(/(\[\^\d{1,2}\])/).map((part, index) => {
              const cite = /^\[\^(\d{1,2})\]$/.exec(part);
              return cite !== null ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: parts of one text keep their order.
                <sup key={index} className="wp-cite">
                  {cite[1]}
                </sup>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: parts of one text keep their order.
                <span key={index}>{part}</span>
              );
            })}
          </p>
          {section.citations.length > 0 ? (
            <ol className="wp-sources">
              {section.citations.map((citation) => (
                <li key={citation.number}>
                  <span className="cite-num">{citation.number}</span>
                  <a
                    href={`/?organization=${ids.organizationId}&project=${ids.projectId}&section=evidence&file=${citation.fileId}`}
                  >
                    {citation.fileName}
                  </a>
                  {citation.location !== "" ? (
                    <small> · {citation.location}</small>
                  ) : null}
                  <q>{citation.quote}</q>
                </li>
              ))}
            </ol>
          ) : null}
        </>
      ) : (
        <div className="grid-scroll">
          <table className="workpaper-table wp-table">
            <thead>
              <tr>
                {section.columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows keep their order.
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td
                      // biome-ignore lint/suspicious/noArrayIndexKey: columns keep their order.
                      key={cellIndex}
                      className={
                        /^Exception/.test(cell) ? "is-exception" : undefined
                      }
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit ? (
        <details className="wp-edit">
          <summary>Edit</summary>
          <form autoComplete="off" method="post" action="/workspace/workpapers">
            <Hidden
              ids={ids}
              paper={paper}
              intent="edit"
              version={paper.currentVersion}
            />
            <input type="hidden" name="section" value={section.key} />
            <input type="hidden" name="kind" value={section.kind} />
            <input type="hidden" name="width" value={section.columns.length} />
            {section.guidance !== "" ? (
              <p className="form-hint">{section.guidance}</p>
            ) : null}
            <textarea
              name="value"
              rows={
                section.kind === "text"
                  ? 6
                  : Math.min(14, section.rows.length + 2)
              }
              defaultValue={
                section.kind === "text"
                  ? section.text
                  : rowsToText(section.rows)
              }
              aria-label={`${section.title} text`}
            />
            {section.kind === "table" ? (
              <p className="form-hint">
                One row per line. Separate cells with “|”:{" "}
                {section.columns.join(" | ")}.
              </p>
            ) : null}
            <button type="submit" className="btn-sm">
              Save as a new version
            </button>
          </form>
        </details>
      ) : null}
    </section>
  );
}
