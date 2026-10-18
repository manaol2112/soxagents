import {
  type AnalysisNotice,
  type AttributeTest,
  CONCLUSION_LABELS,
  CONCLUSIONS,
  type Conclusion,
  type Coverage,
  EVIDENCE_KIND_LABELS,
  EVIDENCE_KINDS,
  type EvidenceAnalysis,
  type EvidenceReview,
  type EvidenceSettings,
  REVIEW_CHECK_LABELS,
  type ReviewCheck,
  readingLabel,
} from "./analysis-model";
import { formatDate } from "./format";
import { UiIcon } from "./ui-icon";

export const ANALYSIS_NOTICES: Record<AnalysisNotice, string> = {
  classified:
    "Evidence kind confirmed. The request status did not change; mark it received when it is complete.",
  reading:
    "The evidence coordinator is reading the file again. Refresh in a moment to see it.",
  "analysis-changed":
    "That file's reading changed, is still in progress, or is already confirmed. Refresh to see its current state.",
  "ocr-saved": "Setting saved. It applies to files read from now on.",
  "ocr-changed": "This setting changed. Refresh and try again.",
  denied: "Your role cannot change this.",
  invalid: "Check the fields and try again.",
  unavailable: "That could not be saved. Try again.",
  "signed-off":
    "Review signed off. It is in the audit trail, and the request status did not change.",
  "review-changed":
    "That review changed or is already signed off, or an override is missing its reason. Refresh and try again.",
};

const CONCLUSION_TONE: Record<Conclusion, string> = {
  NO_EXCEPTION: "tone-success",
  EXCEPTION: "tone-danger",
  CANNOT_CONCLUDE: "tone-warning",
};
const CHECK_TONE: Record<
  ReviewCheck["result"],
  { label: string; tone: string }
> = {
  OK: { label: "OK", tone: "tone-success" },
  ISSUE: { label: "Issue", tone: "tone-danger" },
  UNCLEAR: { label: "Unclear", tone: "" },
};
const ATTRIBUTE_TONE: Record<
  AttributeTest["result"],
  { label: string; tone: string }
> = {
  PASS: { label: "Pass", tone: "tone-success" },
  EXCEPTION: { label: "Exception", tone: "tone-danger" },
  NOT_DETERMINABLE: { label: "Not determinable", tone: "" },
};

const COVERAGE: Record<Coverage, { label: string; tone: string }> = {
  COVERED: { label: "Covered", tone: "tone-success" },
  PARTIAL: { label: "Partly covered", tone: "tone-warning" },
  NOT_COVERED: { label: "Not covered", tone: "" },
};

/** What the evidence coordinator read from one stored file. Untrusted content. */
/** Where a form in the panel returns to: the page's tab, open file, and filters. */
function KeepFields({ keep }: { keep: Record<string, string> }) {
  return (
    <>
      {Object.entries(keep).map(([key, value]) => (
        <input key={key} type="hidden" name={`keep_${key}`} value={value} />
      ))}
    </>
  );
}

export function AnalysisPanel({
  analysis,
  review = null,
  organizationId,
  projectId,
  canAct,
  keep = {},
}: {
  analysis: EvidenceAnalysis | null;
  review?: EvidenceReview | null;
  organizationId: string;
  projectId: string;
  canAct: boolean;
  keep?: Record<string, string>;
}) {
  if (analysis === null) {
    return null;
  }
  const hidden = (
    <>
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="analysis_id" value={analysis.id} />
      <input type="hidden" name="version" value={analysis.version} />
      <KeepFields keep={keep} />
    </>
  );
  if (analysis.status === "PENDING" || analysis.status === "WORKING") {
    return (
      <div className="analysis">
        <p className="analysis-head">
          <span className="pill pill-dot tone-info">Reading</span>
          <small>The evidence coordinator is reading this file.</small>
        </p>
      </div>
    );
  }
  if (analysis.status === "FAILED" || analysis.classification === null) {
    return (
      <div className="analysis">
        <p className="analysis-head">
          <span className="pill pill-dot tone-danger">Not read</span>
          <small>{analysis.note || "Reading the file did not finish."}</small>
        </p>
        {canAct ? (
          <form
            autoComplete="off"
            method="post"
            action="/workspace/evidence-analyses"
          >
            {hidden}
            <input type="hidden" name="intent" value="reanalyze" />
            <button type="submit" className="btn-secondary btn-sm">
              Read again
            </button>
          </form>
        ) : null}
      </div>
    );
  }
  const result = analysis.classification;
  const confirmed = analysis.confirmedKind;
  return (
    <div className="analysis">
      <p className="analysis-head">
        {confirmed !== null ? (
          <span className="pill pill-dot tone-success">
            {EVIDENCE_KIND_LABELS[confirmed]}
          </span>
        ) : (
          <span className="pill pill-dot tone-info">
            Suggested: {EVIDENCE_KIND_LABELS[result.kind]}
          </span>
        )}
        <small>
          {readingLabel(analysis)} ·{" "}
          {analysis.source === "MODEL" ? "Read by an agent" : "Standard checks"}{" "}
          · {result.confidence} confidence
        </small>
      </p>
      {result.summary !== "" ? (
        <p className="analysis-summary">{result.summary}</p>
      ) : null}
      {result.items.length > 0 ? (
        <ul className="coverage-list" aria-label="What the request asked for">
          {result.items.map((item) => (
            <li key={item.index}>
              <span className={`pill ${COVERAGE[item.coverage].tone}`}>
                {COVERAGE[item.coverage].label}
              </span>
              <span>
                <strong>{item.title || `Item ${item.index + 1}`}</strong>
                {item.note !== "" ? <small>{item.note}</small> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : analysis.requestId === null ? (
        <p className="analysis-note">
          The reply is not linked to a request, so coverage was not checked.
          Assign the reply, then read the file again.
        </p>
      ) : null}
      {result.gaps.length > 0 ? (
        <div className="analysis-gaps">
          <strong>To follow up</strong>
          <ul>
            {result.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.period !== "" || analysis.note !== "" ? (
        <p className="analysis-note">
          {[result.period, analysis.note]
            .filter((part) => part !== "")
            .join(" ")}
        </p>
      ) : null}
      <details className="reply-body">
        <summary>
          Why, and what was read
          {analysis.textLength > 0
            ? ` · ${analysis.textLength.toLocaleString("en-US")} characters`
            : ""}
        </summary>
        {result.reason !== "" ? (
          <p className="analysis-note">{result.reason}</p>
        ) : null}
        <p className="untrusted-note">
          <UiIcon name="info" size={13} /> Read from the client&apos;s file and
          shown as plain text.
          {analysis.redacted
            ? " Passwords and keys found in it were hidden."
            : ""}
          {analysis.excerpt.length < analysis.textLength
            ? " Only the start is shown."
            : ""}
          {analysis.truncated
            ? " Only the first part of this long file was read."
            : ""}
        </p>
        {analysis.excerpt !== "" ? (
          <pre className="untrusted-text">{analysis.excerpt}</pre>
        ) : null}
      </details>
      {confirmed !== null ? (
        <p className="analysis-note">
          Confirmed by {analysis.confirmedBy ?? "a team member"}
          {analysis.confirmedAt !== null
            ? ` on ${formatDate(analysis.confirmedAt)}`
            : ""}
          {analysis.confirmedNote !== "" ? `: ${analysis.confirmedNote}` : "."}
        </p>
      ) : null}
      {canAct ? (
        <div className="analysis-actions">
          <form
            autoComplete="off"
            method="post"
            action="/workspace/evidence-analyses"
            className="analysis-confirm"
          >
            {hidden}
            <input type="hidden" name="intent" value="confirm" />
            <label>
              <span className="sr-only">Evidence kind</span>
              <select name="kind" defaultValue={confirmed ?? result.kind}>
                {EVIDENCE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {EVIDENCE_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Note</span>
              <input
                type="text"
                name="note"
                maxLength={500}
                placeholder="Note (optional)"
                defaultValue={analysis.confirmedNote}
              />
            </label>
            <button type="submit" className="btn-sm">
              <UiIcon name="check" size={14} />{" "}
              {confirmed === null ? "Confirm kind" : "Update"}
            </button>
          </form>
          {(confirmed ?? result.kind) === "population" &&
          analysis.requestId !== null ? (
            <form
              autoComplete="off"
              method="post"
              action="/workspace/control-tests"
            >
              <input
                type="hidden"
                name="organization_id"
                value={organizationId}
              />
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="intent" value="propose" />
              <input
                type="hidden"
                name="evidence_file_id"
                value={analysis.fileId}
              />
              <button type="submit" className="btn-secondary btn-sm">
                Propose samples
              </button>
            </form>
          ) : null}
          {confirmed === null && review?.decision == null ? (
            <form
              autoComplete="off"
              method="post"
              action="/workspace/evidence-analyses"
            >
              {hidden}
              <input type="hidden" name="intent" value="reanalyze" />
              <button type="submit" className="btn-secondary btn-sm">
                Read again
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
      {review !== null ? (
        <ReviewSection
          review={review}
          organizationId={organizationId}
          projectId={projectId}
          canAct={canAct}
          keep={keep}
        />
      ) : null}
    </div>
  );
}

/** The tester's first pass on a screenshot, and the person's sign-off. */
function ReviewSection({
  review,
  organizationId,
  projectId,
  canAct,
  keep,
}: {
  review: EvidenceReview;
  organizationId: string;
  projectId: string;
  canAct: boolean;
  keep: Record<string, string>;
}) {
  const final = review.conclusion ?? review.proposed;
  return (
    <section className="review" aria-label="Agent first-pass review">
      <p className="analysis-head">
        <strong>Agent first-pass review</strong>
        {review.status === "NEEDS_PERSON" ? (
          <span className="pill pill-dot tone-warning">Needs a person</span>
        ) : null}
        <span className={`pill pill-dot ${CONCLUSION_TONE[final]}`}>
          {review.decision === null ? "Proposed: " : ""}
          {CONCLUSION_LABELS[final]}
        </span>
      </p>
      {review.feedback !== "" ? (
        <div className="review-feedback">
          <UiIcon name="info" size={14} />
          <p>{review.feedback}</p>
        </div>
      ) : null}
      <ul className="review-checks" aria-label="Evidence checks">
        {review.checks.map((check) => (
          <li key={check.check}>
            <span className={`pill ${CHECK_TONE[check.result].tone}`}>
              {CHECK_TONE[check.result].label}
            </span>
            <span>
              <strong>{REVIEW_CHECK_LABELS[check.check]}</strong>
              {check.note !== "" ? <small>{check.note}</small> : null}
            </span>
          </li>
        ))}
      </ul>
      {review.attributes.length > 0 ? (
        <div className="table-wrap">
          <table className="table review-table">
            <thead>
              <tr>
                <th scope="col">Test attribute</th>
                <th scope="col">Result</th>
                <th scope="col">Observed</th>
                <th scope="col">Expected</th>
              </tr>
            </thead>
            <tbody>
              {review.attributes.map((test) => (
                <tr key={test.index}>
                  <td>
                    {test.attribute}
                    {test.note !== "" ? (
                      <small className="cell-sub">{test.note}</small>
                    ) : null}
                  </td>
                  <td>
                    <span
                      className={`pill ${ATTRIBUTE_TONE[test.result].tone}`}
                    >
                      {ATTRIBUTE_TONE[test.result].label}
                    </span>
                  </td>
                  <td>{test.observed || "—"}</td>
                  <td>{test.expected || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="analysis-note">
          No test attributes are linked, so nothing was tested. Link the reply
          to the control's request to test it.
        </p>
      )}
      {review.followUpId !== null ? (
        <p className="analysis-note">
          <UiIcon name="mail" size={13} /> The agent drafted a follow-up to the
          control owner (
          {review.followUpStatus === "DRAFT"
            ? "draft"
            : (review.followUpStatus ?? "").toLowerCase().replaceAll("_", " ")}
          ). Review it in the request tracker. It goes out only after approval.
        </p>
      ) : null}
      {review.decision !== null ? (
        <p className="analysis-note">
          {review.decision === "ACCEPTED" ? "Accepted" : "Overridden"} by{" "}
          {review.decidedBy ?? "a team member"}
          {review.decidedAt !== null
            ? ` on ${formatDate(review.decidedAt)}`
            : ""}
          {review.decision === "OVERRIDDEN"
            ? ` (agent proposed ${CONCLUSION_LABELS[review.proposed].toLowerCase()})`
            : ""}
          {review.decisionNote !== "" ? `: ${review.decisionNote}` : "."}
        </p>
      ) : canAct ? (
        <form
          autoComplete="off"
          method="post"
          action="/workspace/evidence-analyses"
          className="review-signoff"
        >
          <input type="hidden" name="organization_id" value={organizationId} />
          <input type="hidden" name="project_id" value={projectId} />
          {/* The review's id travels in analysis_id; the decide route is per review. */}
          <input type="hidden" name="analysis_id" value={review.id} />
          <input type="hidden" name="version" value={review.version} />
          <input type="hidden" name="intent" value="decide" />
          <KeepFields keep={keep} />
          <fieldset>
            <legend>Your review</legend>
            <label className="choice">
              <input
                type="radio"
                name="decision"
                value="ACCEPTED"
                defaultChecked
              />
              <span>
                <strong>
                  Accept: {CONCLUSION_LABELS[review.proposed].toLowerCase()}
                </strong>
              </span>
            </label>
            <label className="choice">
              <input type="radio" name="decision" value="OVERRIDDEN" />
              <span>
                <strong>Override the agent</strong>
                <small>Choose the conclusion and give your reason.</small>
              </span>
            </label>
          </fieldset>
          <div className="analysis-confirm">
            <label>
              <span className="sr-only">Conclusion</span>
              <select name="conclusion" defaultValue={review.proposed}>
                {CONCLUSIONS.map((item) => (
                  <option key={item} value={item}>
                    {CONCLUSION_LABELS[item]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Reason</span>
              <input
                type="text"
                name="note"
                maxLength={1000}
                placeholder="Reason (needed to override)"
              />
            </label>
            <button type="submit" className="btn-sm">
              <UiIcon name="check" size={14} /> Sign off
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

/** The firm's choice of OCR engine. Owners and admins change it. */
export function EvidenceReadingCard({
  settings,
  organizationId,
  canManage,
}: {
  settings: EvidenceSettings | null;
  organizationId: string;
  canManage: boolean;
}) {
  return (
    <section className="card" aria-labelledby="evidence-reading-title">
      <div className="card-header">
        <div>
          <h2 id="evidence-reading-title">Evidence reading</h2>
          <p className="card-desc">
            How the evidence coordinator reads screenshots and scanned pages.
          </p>
        </div>
      </div>
      <div className="card-body">
        {settings === null ? (
          <p className="analysis-note">
            The evidence reading setting could not be loaded.
          </p>
        ) : (
          <>
            <ul className="reading-status">
              <li>
                <span
                  className={`pill pill-dot ${settings.localOcrAvailable ? "tone-success" : "tone-warning"}`}
                >
                  Local OCR{" "}
                  {settings.localOcrAvailable ? "installed" : "not installed"}
                </span>
              </li>
              <li>
                <span
                  className={`pill pill-dot ${settings.modelConfigured ? "tone-success" : ""}`}
                >
                  Model{" "}
                  {settings.modelConfigured ? "configured" : "not configured"}
                </span>
              </li>
            </ul>
            {canManage ? (
              <form
                autoComplete="off"
                method="post"
                action="/workspace/evidence-analyses"
                className="reading-form"
              >
                <input
                  type="hidden"
                  name="organization_id"
                  value={organizationId}
                />
                <input type="hidden" name="intent" value="ocr-engine" />
                <input type="hidden" name="version" value={settings.version} />
                <fieldset>
                  <legend>Who reads images</legend>
                  <label className="choice">
                    <input
                      type="radio"
                      name="ocr_engine"
                      value="LOCAL"
                      defaultChecked={settings.ocrEngine === "LOCAL"}
                    />
                    <span>
                      <strong>Read inside the workspace (recommended)</strong>
                      <small>
                        Text is read from images inside your workspace. Images
                        never leave the firm.
                      </small>
                    </span>
                  </label>
                  <label className="choice">
                    <input
                      type="radio"
                      name="ocr_engine"
                      value="MODEL"
                      defaultChecked={settings.ocrEngine === "MODEL"}
                    />
                    <span>
                      <strong>Read by the AI model</strong>
                      <small>
                        Screenshots and scanned pages are sent to the AI model
                        for more accurate reading, so client images leave the
                        firm. Reading inside the workspace is the fallback.
                      </small>
                    </span>
                  </label>
                </fieldset>
                <button type="submit" className="btn-sm">
                  Save
                </button>
              </form>
            ) : (
              <p className="analysis-note">
                {settings.ocrEngine === "MODEL"
                  ? "The AI model reads screenshots and scanned pages for this firm."
                  : "Screenshots and scanned pages are read inside the workspace and never leave the firm."}{" "}
                An owner or admin can change this.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
