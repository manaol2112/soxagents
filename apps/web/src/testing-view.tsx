import { formatDate } from "./format";
import {
  type ControlTest,
  type PopulationCheck,
  type Sample,
  shownColumns,
  TEST_NOTICES,
  type TestNotice,
} from "./testing-model";
import { UiIcon } from "./ui-icon";

const CHECK_TONE: Record<
  PopulationCheck["result"],
  { label: string; tone: string }
> = {
  OK: { label: "Pass", tone: "tone-success" },
  ISSUE: { label: "Issue", tone: "tone-danger" },
  INFO: { label: "Note", tone: "" },
};
const CHECK_LABELS: Record<string, string> = {
  rows: "Completeness",
  read: "Reading",
  key: "Unique items",
  period: "Period",
};
const SELECTION_LABELS = {
  RANDOM: "Random",
  HAPHAZARD: "Haphazard",
  TARGETED: "Targeted",
};

type Identity = {
  organizationId: string;
  projectId: string;
  controlId: string;
};

function Hidden({ identity }: { identity: Identity }) {
  return (
    <>
      <input
        type="hidden"
        name="organization_id"
        value={identity.organizationId}
      />
      <input type="hidden" name="project_id" value={identity.projectId} />
      <input type="hidden" name="control_id" value={identity.controlId} />
    </>
  );
}

/** A control's test plan: the population checks, the selection, and approval. */
export function TestPlanCard({
  test,
  notice,
  organizationId,
  projectId,
  controlId,
  canAct,
  sampled,
  blocked = null,
}: {
  test: ControlTest | null;
  notice: TestNotice | null;
  organizationId: string;
  projectId: string;
  controlId: string;
  canAct: boolean;
  sampled: boolean;
  /** Why the samples cannot be approved yet, such as a narrative not confirmed. */
  blocked?: string | null;
}) {
  const identity = { organizationId, projectId, controlId };
  if (test === null) {
    return (
      <div className="test-plan">
        {notice !== null ? (
          <p className="test-notice">{TEST_NOTICES[notice]}</p>
        ) : null}
        <p className="form-hint">
          {sampled
            ? "No population yet. When the control owner's population file is stored, the tester checks it and proposes samples for you to approve."
            : "This control is tested once from its configuration, so no samples are selected."}
        </p>
      </div>
    );
  }
  const editable = canAct && test.status === "PROPOSED";
  return (
    <div className="test-plan">
      {notice !== null ? (
        <p className="test-notice">{TEST_NOTICES[notice]}</p>
      ) : null}
      <div className="action-bar">
        <div className="action-bar-text">
          <span
            className={`pill pill-dot ${test.status === "APPROVED" ? "tone-success" : "tone-warning"}`}
          >
            {test.status === "APPROVED"
              ? "Samples approved"
              : "Awaiting your approval"}
          </span>
          <span>
            <strong>{test.samples.length}</strong> of{" "}
            {test.frameRows.toLocaleString("en-US")} items ·{" "}
            {test.populationFileName} · seed{" "}
            <span className="mono">{test.seed}</span>
          </span>
        </div>
        {editable ? (
          <div className="action-bar-buttons">
            <form
              autoComplete="off"
              method="post"
              action="/workspace/control-tests"
            >
              <Hidden identity={identity} />
              <input type="hidden" name="intent" value="propose" />
              <input
                type="hidden"
                name="evidence_file_id"
                value={test.populationFileId}
              />
              <button type="submit" className="btn-secondary">
                Draw again
              </button>
            </form>
            {blocked === null ? (
              <form
                autoComplete="off"
                method="post"
                action="/workspace/control-tests"
              >
                <Hidden identity={identity} />
                <input type="hidden" name="intent" value="approve" />
                <input type="hidden" name="test_id" value={test.id} />
                <input type="hidden" name="version" value={test.version} />
                <button type="submit">
                  <UiIcon name="check" size={14} /> Approve samples
                </button>
              </form>
            ) : (
              <p className="action-bar-note test-gate">
                <UiIcon name="info" size={14} /> {blocked}
              </p>
            )}
          </div>
        ) : test.status === "APPROVED" ? (
          <p className="action-bar-note">
            Approved by {test.approvedBy ?? "a team member"}
            {test.approvedAt !== null
              ? ` on ${formatDate(test.approvedAt)}`
              : ""}
            {test.sampleRequestId !== null
              ? ` · sample request ${(test.sampleRequestStatus ?? "draft").toLowerCase().replaceAll("_", " ")}`
              : ""}
          </p>
        ) : null}
      </div>
      <p className="test-explanation">{test.explanation}</p>
      <h3 className="section-label">Population checks</h3>
      <table className="table data-grid checks-grid">
        <tbody>
          {test.checks.map((check) => (
            <tr key={check.check}>
              <td className="col-check">
                {CHECK_LABELS[check.check] ?? check.check}
              </td>
              <td className="col-result">
                <span className={`pill ${CHECK_TONE[check.result].tone}`}>
                  {CHECK_TONE[check.result].label}
                </span>
              </td>
              <td className="cell-wrap">{check.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="section-label">
        Selected samples
        <small>
          Approving drafts the sample evidence request. It goes out only after
          the usual approval.
        </small>
      </h3>
      <SampleGrid test={test} identity={identity} editable={editable} />
    </div>
  );
}

function SampleGrid({
  test,
  identity,
  editable,
}: {
  test: ControlTest;
  identity: Identity;
  editable: boolean;
}) {
  const shown = shownColumns(test, 4);
  return (
    <div className="grid-scroll">
      <table className="table data-grid sample-grid">
        <thead>
          <tr>
            <th scope="col" className="col-num">
              #
            </th>
            <th scope="col" className="col-num">
              Row
            </th>
            <th scope="col">{test.keyColumn || "Item"}</th>
            {shown.map((index) => (
              <th key={index} scope="col">
                {test.columns[index]}
              </th>
            ))}
            <th scope="col">Selection</th>
            {editable ? (
              <th scope="col" className="col-action">
                <span className="sr-only">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {test.samples.map((sample) => (
            <tr key={sample.position}>
              <td className="col-num">{sample.position}</td>
              <td className="col-num cell-muted">{sample.rowNumber}</td>
              <td className="mono">{sample.keyValue || "—"}</td>
              {shown.map((index) => (
                <td key={index}>{sample.rowValues[index] || "—"}</td>
              ))}
              <td>
                {sample.selection === "RANDOM" ? (
                  <span className="cell-muted">Random</span>
                ) : (
                  <span
                    className="pill tone-info"
                    title={`${sample.replacedBy ?? "A team member"}: ${sample.reason}`}
                  >
                    {SELECTION_LABELS[sample.selection]}
                  </span>
                )}
              </td>
              {editable ? (
                <td className="col-action">
                  <ReplaceMenu
                    test={test}
                    sample={sample}
                    identity={identity}
                  />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReplaceMenu({
  test,
  sample,
  identity,
}: {
  test: ControlTest;
  sample: Sample;
  identity: Identity;
}) {
  return (
    <details className="row-menu">
      <summary className="btn btn-secondary btn-sm">Replace</summary>
      <form
        autoComplete="off"
        method="post"
        action="/workspace/control-tests"
        className="row-menu-panel"
      >
        <Hidden identity={identity} />
        <input type="hidden" name="intent" value="replace" />
        <input type="hidden" name="test_id" value={test.id} />
        <input type="hidden" name="version" value={test.version} />
        <input type="hidden" name="position" value={sample.position} />
        <strong>
          Replace sample {sample.position}
          {sample.keyValue ? ` (${sample.keyValue})` : ""}
        </strong>
        <label>
          <span>Population row</span>
          <input
            type="number"
            name="row_number"
            min={1}
            max={test.populationRows}
            required
          />
        </label>
        <label>
          <span>Selection</span>
          <select name="selection" defaultValue="TARGETED">
            <option value="TARGETED">Targeted</option>
            <option value="HAPHAZARD">Haphazard</option>
          </select>
        </label>
        <label>
          <span>Reason</span>
          <input
            type="text"
            name="reason"
            minLength={3}
            maxLength={500}
            required
          />
        </label>
        <button type="submit" className="btn-sm">
          Replace sample
        </button>
      </form>
    </details>
  );
}
