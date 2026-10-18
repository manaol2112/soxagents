import { AutoRefresh } from "./auto-refresh";
import { PreviewButton } from "./evidence-preview";
import { formatDate } from "./format";
import {
  RESULT_LABELS,
  RESULT_MARKS,
  RESULTS,
  SHEET_NOTICES,
  type SheetCell,
  type SheetItem,
  type SheetNotice,
  sheetHeadline,
  type TestSheet,
} from "./sheet-model";
import { UiIcon } from "./ui-icon";

const TONES = {
  neutral: "",
  info: "tone-info",
  success: "tone-success",
  warning: "tone-warning",
  danger: "tone-danger",
} as const;

const SEVERITY_LABELS: Record<string, string> = {
  CONTROL_DEFICIENCY: "Control deficiency",
  SIGNIFICANT_DEFICIENCY: "Significant deficiency",
  MATERIAL_WEAKNESS: "Material weakness",
};

type Ids = {
  organizationId: string;
  projectId: string;
  controlId: string;
};

function Hidden({
  ids,
  sheet,
  intent,
  version,
}: {
  ids: Ids;
  sheet: TestSheet;
  intent: string;
  version?: number;
}) {
  return (
    <>
      <input type="hidden" name="organization_id" value={ids.organizationId} />
      <input type="hidden" name="project_id" value={ids.projectId} />
      <input type="hidden" name="control_id" value={ids.controlId} />
      <input type="hidden" name="sheet_id" value={sheet.id} />
      <input type="hidden" name="intent" value={intent} />
      {version !== undefined ? (
        <input type="hidden" name="version" value={version} />
      ) : null}
    </>
  );
}

/** The control's test sheet: every item against every attribute, then the sign-off. */
export function TestSheetCard({
  sheet,
  notice,
  ids,
  canAct,
}: {
  sheet: TestSheet | null;
  notice: SheetNotice | null;
  ids: Ids;
  canAct: boolean;
}) {
  if (sheet === null) {
    return (
      <section className="card sheet-card" id="test-sheet">
        <div className="card-body">
          <p className="sheet-empty">
            <UiIcon name="table" size={16} />
            <span>
              The test sheet opens when the samples are approved, or, for an
              automated control, when its evidence is read. The tester then
              tests each item against the control's attributes.
            </span>
          </p>
        </div>
      </section>
    );
  }
  const headline = sheetHeadline(sheet);
  const open = sheet.status === "OPEN" && canAct;
  const linkable = sheet.placements.filter(
    (entry) => entry.placement !== "EXCLUDED",
  );
  const unplaced = sheet.placements.filter(
    (entry) => entry.placement === "UNPLACED",
  );
  const aside = sheet.placements.filter(
    (entry) => entry.placement === "EXCLUDED",
  );
  return (
    <section
      className="card sheet-card"
      id="test-sheet"
      aria-label="Test sheet"
    >
      {sheet.running ? <AutoRefresh /> : null}
      {sheet.waitingNote !== "" ? (
        <p className="sheet-waiting" role="status">
          <UiIcon name="clock" size={14} />
          <span>
            {sheet.waitingNote} The tester runs again once the control is ready.
          </span>
        </p>
      ) : null}
      <header className="sheet-head">
        <div>
          <h3>Test sheet</h3>
          <p>
            {sheet.method === "TEST_OF_ONE"
              ? "Tested once"
              : `${sheet.counts.items} sample${sheet.counts.items === 1 ? "" : "s"}`}
            {" · "}
            {sheet.counts.tested} of {sheet.counts.items} tested
            {sheet.counts.exceptions > 0
              ? ` · ${sheet.counts.exceptions} with exceptions`
              : ""}
            {sheet.counts.noEvidence > 0
              ? ` · ${sheet.counts.noEvidence} waiting for evidence`
              : ""}
          </p>
        </div>
        <span className={`pill pill-dot ${TONES[headline.tone]}`}>
          {sheet.running ? (
            <span className="spinner small" aria-hidden="true" />
          ) : null}
          {headline.label}
        </span>
      </header>
      {notice !== null ? (
        <p
          className={`banner ${notice === "sheet-blocked" || notice === "sheet-invalid" ? "banner-warning" : ""}`}
          role="status"
        >
          <UiIcon name="info" size={15} />
          <span>{SHEET_NOTICES[notice]}</span>
        </p>
      ) : null}
      <SignOffBar sheet={sheet} ids={ids} canAct={canAct} />
      <ol className="attribute-legend" aria-label="Test attributes">
        {sheet.attributes.map((attribute, index) => (
          <li key={attribute}>
            <span className="attr-key">A{index + 1}</span>
            <span>{attribute}</span>
          </li>
        ))}
      </ol>
      <div className="grid-scroll">
        <table className="table data-grid sheet-grid">
          <thead>
            <tr>
              <th scope="col" className="col-pos">
                #
              </th>
              <th scope="col" className="col-item">
                {sheet.method === "TEST_OF_ONE" ? "Item" : "Sample"}
              </th>
              <th scope="col" className="col-evidence">
                Evidence
              </th>
              {sheet.attributes.map((attribute, index) => (
                <th
                  key={attribute}
                  scope="col"
                  className="col-attr"
                  title={attribute}
                >
                  A{index + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                sheet={sheet}
                ids={ids}
                open={open}
                linkable={linkable}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="sheet-key" aria-hidden="true">
        {RESULTS.map((result) => (
          <span key={result}>
            <span className={`mark mark-${result.toLowerCase()}`}>
              {RESULT_MARKS[result]}
            </span>{" "}
            {RESULT_LABELS[result]}
          </span>
        ))}
        <span>
          <span className="mark mark-pass has-sources">✓</span> Cites the
          evidence it relied on
        </span>
        <span>
          <span className="mark mark-pass is-overridden">✓</span> Set by a
          person
        </span>
      </p>
      {unplaced.length > 0 ? (
        <div className="sheet-block">
          <h4>
            Files the tester could not place
            <span className="view-count">{unplaced.length}</span>
          </h4>
          <ul className="unplaced-list">
            {unplaced.map((entry) => (
              <li key={entry.fileId}>
                <span className="unplaced-name">
                  <strong>{entry.fileName}</strong>
                  <small>{entry.reason}</small>
                </span>
                {open ? (
                  <span className="unplaced-actions">
                    <form
                      autoComplete="off"
                      method="post"
                      action="/workspace/test-sheets"
                      className="inline-form"
                    >
                      <Hidden ids={ids} sheet={sheet} intent="link" />
                      <input
                        type="hidden"
                        name="file_id"
                        value={entry.fileId}
                      />
                      <label
                        className="sr-only"
                        htmlFor={`place-${entry.fileId}`}
                      >
                        Sample for {entry.fileName}
                      </label>
                      <select
                        id={`place-${entry.fileId}`}
                        name="item_id"
                        required
                        defaultValue=""
                      >
                        <option value="" disabled>
                          Choose a sample
                        </option>
                        {sheet.items.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="btn-sm">
                        Link
                      </button>
                    </form>
                    <form
                      autoComplete="off"
                      method="post"
                      action="/workspace/test-sheets"
                    >
                      <Hidden ids={ids} sheet={sheet} intent="exclude" />
                      <input
                        type="hidden"
                        name="file_id"
                        value={entry.fileId}
                      />
                      <input
                        type="hidden"
                        name="reason"
                        value="Not test evidence."
                      />
                      <button type="submit" className="btn-ghost btn-sm">
                        Not test evidence
                      </button>
                    </form>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {aside.length > 0 ? (
        <details className="sheet-block sheet-aside">
          <summary>
            Set aside, not test evidence{" "}
            <span className="view-count">{aside.length}</span>
          </summary>
          <ul className="unplaced-list">
            {aside.map((entry) => (
              <li key={entry.fileId}>
                <span className="unplaced-name">
                  <strong>{entry.fileName}</strong>
                  <small>
                    {entry.reason}
                    {entry.placedBy === "AGENT"
                      ? " · by the tester"
                      : " · by a person"}
                  </small>
                </span>
                {open ? (
                  <form
                    autoComplete="off"
                    method="post"
                    action="/workspace/test-sheets"
                  >
                    <Hidden ids={ids} sheet={sheet} intent="include" />
                    <input type="hidden" name="file_id" value={entry.fileId} />
                    <button type="submit" className="btn-ghost btn-sm">
                      Use as evidence
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <ProposalCard sheet={sheet} ids={ids} canAct={canAct} />
    </section>
  );
}

function SignOffBar({
  sheet,
  ids,
  canAct,
}: {
  sheet: TestSheet;
  ids: Ids;
  canAct: boolean;
}) {
  if (sheet.status === "SIGNED_OFF") {
    return (
      <div
        className={`signoff-bar is-signed ${sheet.conclusion === "EFFECTIVE" ? "is-effective" : "is-failed"}`}
      >
        <UiIcon
          name={sheet.conclusion === "EFFECTIVE" ? "check" : "risk"}
          size={16}
        />
        <div>
          <strong>
            {sheet.conclusion === "EFFECTIVE"
              ? "Operating effectively: no exceptions"
              : "Not operating effectively: exceptions found"}
          </strong>
          <small>
            Signed off by {sheet.signedBy ?? "a person"}
            {sheet.signedAt !== null ? ` on ${formatDate(sheet.signedAt)}` : ""}
            {sheet.signoffNote !== "" ? ` · ${sheet.signoffNote}` : ""}.
            Independent review comes next.
          </small>
        </div>
        {canAct && sheet.proposalStatus !== "LOGGED" ? (
          <details className="row-menu">
            <summary className="btn btn-ghost btn-sm">Reopen</summary>
            <form
              autoComplete="off"
              method="post"
              action="/workspace/test-sheets"
              className="row-menu-panel"
            >
              <Hidden
                ids={ids}
                sheet={sheet}
                intent="reopen"
                version={sheet.version}
              />
              <label>
                Why reopen it
                <input name="reason" required minLength={3} maxLength={500} />
              </label>
              <button type="submit" className="btn-sm">
                Reopen the sheet
              </button>
            </form>
          </details>
        ) : null}
      </div>
    );
  }
  const ready = sheet.proposedConclusion !== "INCOMPLETE" && !sheet.running;
  return (
    <div className="signoff-bar">
      <div>
        <strong>
          {ready
            ? sheet.proposedConclusion === "EFFECTIVE"
              ? "Every item passed. Sign off to conclude: operating effectively."
              : "Exceptions confirmed. Sign off to conclude: not operating effectively. A deficiency is drafted for you."
            : "Not ready to sign off"}
        </strong>
        {!ready ? (
          <small>
            {sheet.running
              ? "The tester is still testing."
              : sheet.blocking.join(" · ")}
          </small>
        ) : (
          <small>
            The conclusion follows the results, with zero tolerance.
          </small>
        )}
      </div>
      {canAct ? (
        <div className="signoff-actions">
          <form
            autoComplete="off"
            method="post"
            action="/workspace/test-sheets"
          >
            <Hidden
              ids={ids}
              sheet={sheet}
              intent="retest"
              version={sheet.version}
            />
            <button
              type="submit"
              className="btn-secondary btn-sm"
              disabled={sheet.running}
            >
              <UiIcon name="sparkles" size={13} /> Test again
            </button>
          </form>
          <form
            autoComplete="off"
            method="post"
            action="/workspace/test-sheets"
            className="inline-form"
          >
            <Hidden
              ids={ids}
              sheet={sheet}
              intent="sign-off"
              version={sheet.version}
            />
            <label className="sr-only" htmlFor={`note-${sheet.id}`}>
              Sign-off note
            </label>
            <input
              id={`note-${sheet.id}`}
              name="note"
              maxLength={1000}
              placeholder="Note (optional)"
              disabled={!ready}
            />
            <button type="submit" className="btn-sm" disabled={!ready}>
              <UiIcon name="check" size={13} /> Sign off testing
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function ItemRow({
  item,
  sheet,
  ids,
  open,
  linkable,
}: {
  item: SheetItem;
  sheet: TestSheet;
  ids: Ids;
  open: boolean;
  linkable: TestSheet["placements"];
}) {
  const others = linkable.filter(
    (entry) => !item.files.some((file) => file.id === entry.fileId),
  );
  const exception = item.cells.some((cell) => cell.final === "EXCEPTION");
  return (
    <tr className={exception ? "has-exception" : undefined}>
      <td className="col-pos num">{item.position}</td>
      <td className="col-item">
        <strong className="mono">{item.label}</strong>
        {item.detail.length > 0 ? (
          <small
            title={item.detail.map((d) => `${d.column}: ${d.value}`).join("\n")}
          >
            {item.detail
              .slice(1, 3)
              .map((d) => d.value)
              .filter(Boolean)
              .join(" · ")}
          </small>
        ) : null}
        {item.note !== "" ? (
          <small className="item-note">{item.note}</small>
        ) : null}
      </td>
      <td className="col-evidence">
        {item.files.length === 0 ? (
          <span className="pill pill-dot tone-warning">No evidence yet</span>
        ) : (
          <ul className="file-chips">
            {item.files.map((file) => (
              <li key={file.id}>
                <PreviewButton
                  organizationId={ids.organizationId}
                  projectId={ids.projectId}
                  files={item.files}
                  citations={item.cells.flatMap((cell) => cell.citations)}
                  startFileId={file.id}
                  title={`${item.label}: the evidence tested`}
                  className="chip-link"
                  label={<span title={file.fileName}>{file.fileName}</span>}
                />
                {open ? (
                  <form
                    autoComplete="off"
                    method="post"
                    action="/workspace/test-sheets"
                  >
                    <Hidden ids={ids} sheet={sheet} intent="unlink" />
                    <input type="hidden" name="file_id" value={file.id} />
                    <input type="hidden" name="item_id" value={item.id} />
                    <button
                      type="submit"
                      className="chip-x"
                      aria-label={`Take ${file.fileName} off ${item.label}`}
                    >
                      <UiIcon name="x" size={10} />
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {open && others.length > 0 ? (
          <details className="row-menu">
            <summary className="text-link is-plain link-file">
              + Link a file
            </summary>
            <form
              autoComplete="off"
              method="post"
              action="/workspace/test-sheets"
              className="row-menu-panel"
            >
              <Hidden ids={ids} sheet={sheet} intent="link" />
              <input type="hidden" name="item_id" value={item.id} />
              <label>
                File
                <select name="file_id" required defaultValue="">
                  <option value="" disabled>
                    Choose a file
                  </option>
                  {others.map((entry) => (
                    <option key={entry.fileId} value={entry.fileId}>
                      {entry.fileName}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="btn-sm">
                Link to {item.label}
              </button>
            </form>
          </details>
        ) : null}
      </td>
      {item.cells.map((cell) => (
        <td key={cell.index} className="col-attr">
          <Cell cell={cell} item={item} sheet={sheet} ids={ids} open={open} />
        </td>
      ))}
    </tr>
  );
}

function Cell({
  cell,
  item,
  sheet,
  ids,
  open,
}: {
  cell: SheetCell;
  item: SheetItem;
  sheet: TestSheet;
  ids: Ids;
  open: boolean;
}) {
  if (item.state === "NO_EVIDENCE") {
    return <span className="mark mark-empty">—</span>;
  }
  if (item.state === "WAITING" || cell.final === null) {
    return (
      <span className="mark mark-waiting" title="Being tested">
        …
      </span>
    );
  }
  const final = cell.final;
  const overridden = cell.overriddenBy !== null;
  return (
    <details className="cell-pop">
      <summary
        className={`mark mark-${final.toLowerCase()}${overridden ? " is-overridden" : ""}${cell.citations.length > 0 ? " has-sources" : ""}`}
        title={`${RESULT_LABELS[final]}: ${cell.overrideReason || cell.note}`}
      >
        {RESULT_MARKS[final]}
      </summary>
      <div className="cell-panel">
        <p className="cell-heading">
          <strong>
            {item.label} · A{cell.index + 1}
          </strong>
          <span>{sheet.attributes[cell.index]}</span>
        </p>
        <p>
          <span className="cell-label">Tester</span>
          {cell.proposed !== null ? RESULT_LABELS[cell.proposed] : "No result"}
          {cell.note !== "" ? `: ${cell.note}` : ""}
        </p>
        {cell.citations.length > 0 ? (
          <div className="cell-sources">
            <span className="cell-label">Relied on</span>
            <ol>
              {cell.citations.map((citation, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: citations keep their order.
                <li key={index}>
                  <span>
                    {citation.fileName}
                    {citation.location !== "" ? ` · ${citation.location}` : ""}
                  </span>
                  <q>{citation.quote}</q>
                </li>
              ))}
            </ol>
            <PreviewButton
              organizationId={ids.organizationId}
              projectId={ids.projectId}
              files={item.files}
              citations={cell.citations}
              title={`${item.label} · A${cell.index + 1}: ${sheet.attributes[cell.index] ?? ""}`}
              className="btn-secondary btn-sm"
              label="Open with highlights"
            />
          </div>
        ) : item.files.length > 0 && cell.proposed !== null ? (
          <p className="form-hint">
            No highlights for this result. Test again to have the tester cite
            the evidence it relied on.
          </p>
        ) : null}
        {overridden ? (
          <p>
            <span className="cell-label">{cell.overriddenBy}</span>
            {RESULT_LABELS[final]}: {cell.overrideReason}
          </p>
        ) : null}
        {open ? (
          <form
            autoComplete="off"
            method="post"
            action="/workspace/test-sheets"
            className="cell-form"
          >
            <Hidden
              ids={ids}
              sheet={sheet}
              intent="override"
              version={item.version}
            />
            <input type="hidden" name="item_id" value={item.id} />
            <input type="hidden" name="index" value={cell.index} />
            <label>
              Result
              <select name="result" defaultValue={final}>
                {RESULTS.map((result) => (
                  <option key={result} value={result}>
                    {RESULT_LABELS[result]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reason
              <textarea
                name="reason"
                required
                minLength={3}
                maxLength={500}
                rows={2}
                placeholder="What you saw in the evidence"
              />
            </label>
            <button type="submit" className="btn-sm">
              Save result
            </button>
          </form>
        ) : null}
      </div>
    </details>
  );
}

function ProposalCard({
  sheet,
  ids,
  canAct,
}: {
  sheet: TestSheet;
  ids: Ids;
  canAct: boolean;
}) {
  const proposal = sheet.proposal;
  if (proposal === null || sheet.proposalStatus === "NONE") {
    return null;
  }
  if (sheet.proposalStatus === "LOGGED") {
    return (
      <p className="proposal-done">
        <UiIcon name="check" size={14} /> Logged as{" "}
        <strong>{sheet.deficiencyReference}</strong> in the deficiency register.
      </p>
    );
  }
  if (sheet.proposalStatus === "DISMISSED") {
    return (
      <p className="proposal-done">
        <UiIcon name="x" size={14} /> The proposed deficiency was dismissed:{" "}
        {sheet.proposalReason}
      </p>
    );
  }
  return (
    <div className="proposal-card">
      <header>
        <UiIcon name="risk" size={16} />
        <div>
          <strong>Proposed deficiency</strong>
          <small>
            Drafted by the tester from the exceptions. Edit it, then log it, or
            dismiss it with a reason.
          </small>
        </div>
      </header>
      {canAct ? (
        <>
          <form
            autoComplete="off"
            method="post"
            action="/workspace/test-sheets"
            className="proposal-form"
          >
            <Hidden
              ids={ids}
              sheet={sheet}
              intent="log"
              version={sheet.version}
            />
            <label>
              Title
              <input
                name="title"
                defaultValue={proposal.title}
                maxLength={200}
                required
              />
            </label>
            <label>
              Condition
              <textarea
                name="condition"
                defaultValue={proposal.condition}
                rows={4}
              />
            </label>
            <label>
              Criteria
              <textarea
                name="criteria"
                defaultValue={proposal.criteria}
                rows={3}
              />
            </label>
            <label>
              Cause
              <textarea name="cause" defaultValue={proposal.cause} rows={2} />
            </label>
            <label>
              Effect
              <textarea name="effect" defaultValue={proposal.effect} rows={2} />
            </label>
            <label>
              Severity
              <select name="severity" defaultValue={proposal.severity}>
                {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                    {value === proposal.severity ? " (suggested)" : ""}
                  </option>
                ))}
              </select>
              <small className="form-hint">
                {proposal.severityReason} A significant deficiency or material
                weakness still needs the reviewer.
              </small>
            </label>
            <button type="submit" className="btn-sm">
              Log the deficiency
            </button>
          </form>
          <details className="row-menu">
            <summary className="btn btn-ghost btn-sm">Dismiss</summary>
            <form
              autoComplete="off"
              method="post"
              action="/workspace/test-sheets"
              className="row-menu-panel"
            >
              <Hidden
                ids={ids}
                sheet={sheet}
                intent="dismiss"
                version={sheet.version}
              />
              <label>
                Why it is not a deficiency
                <input name="reason" required minLength={3} maxLength={500} />
              </label>
              <button type="submit" className="btn-danger btn-sm">
                Dismiss
              </button>
            </form>
          </details>
        </>
      ) : (
        <p className="proposal-text">{proposal.condition}</p>
      )}
    </div>
  );
}
