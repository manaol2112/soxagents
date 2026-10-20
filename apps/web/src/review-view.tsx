import { AutoRefresh } from "./auto-refresh";
import { type Automation, executionOf } from "./execution-model";
import { formatDate } from "./format";
import {
  type ControlReview,
  NOTE_STATUS_LABEL,
  type NoteSeverity,
  openNotes,
  REVIEW_NOTICES,
  type ReviewNote,
  type ReviewNotice,
  SEVERITY_LABEL,
  TARGET_LABEL,
} from "./review-model";
import type { TestSheet } from "./sheet-model";
import { UiIcon } from "./ui-icon";
import { Banner } from "./workspace-view";

type Ids = { organizationId: string; projectId: string; controlId: string };

const SEVERITY_TONE: Record<NoteSeverity, string> = {
  MUST_FIX: "tone-danger",
  SHOULD_FIX: "tone-warning",
  OBSERVATION: "",
};

function Hidden({
  ids,
  review,
  intent,
  noteId,
}: {
  ids: Ids;
  review: ControlReview;
  intent: string;
  noteId?: string;
}) {
  return (
    <>
      <input type="hidden" name="organization_id" value={ids.organizationId} />
      <input type="hidden" name="project_id" value={ids.projectId} />
      <input type="hidden" name="control_id" value={ids.controlId} />
      <input type="hidden" name="review_id" value={review.id} />
      <input type="hidden" name="version" value={review.version} />
      <input type="hidden" name="intent" value={intent} />
      {noteId !== undefined ? (
        <input type="hidden" name="note_id" value={noteId} />
      ) : null}
    </>
  );
}

/** The control's independent review: the agent's re-performance, the notes, and the
 * reviewer's sign-off. */
export function ReviewTab({
  review,
  sheet,
  notice,
  ids,
  canAct,
  automation = null,
}: {
  review: ControlReview | null;
  sheet: TestSheet | null;
  notice: ReviewNotice | null;
  ids: Ids;
  canAct: boolean;
  /** Whether an agent worker will pick up a queued re-performance (M1d). */
  automation?: Automation | null;
}) {
  if (review === null) {
    return (
      <section className="card sheet-card" id="control-review">
        <div className="card-body">
          <p className="sheet-empty">
            <UiIcon name="shield" size={16} />
            <span>
              The independent review opens when the testing is signed off and
              the effectiveness workpaper is prepared. The reviewer agent then
              re-performs the testing from the evidence and proposes review
              notes for the engagement reviewer to decide.
            </span>
          </p>
        </div>
      </section>
    );
  }
  const waiting = openNotes(review);
  const relaxed = !review.independenceRequired;
  const decides = canAct && review.viewerIsReviewer && review.status === "OPEN";
  const answers = canAct && review.status === "OPEN";
  const itemLabel = (note: ReviewNote): string => {
    const item = sheet?.items.find((entry) => entry.id === note.itemId);
    return item === undefined ? "" : item.label;
  };
  const sorted = [...review.notes].sort(
    (a, b) => rank(a.status) - rank(b.status) || a.number - b.number,
  );
  return (
    <section className="card sheet-card review-card" id="control-review">
      {review.reperforming ? <AutoRefresh /> : null}
      {relaxed ? (
        <p className="banner banner-warning" role="note">
          <UiIcon name="risk" size={15} />
          <span>
            Independence checks are off for this workspace, so the person who
            tested the work can also review and sign it off. Use this for
            development only.
          </span>
        </p>
      ) : null}
      <header className="sheet-head">
        <div>
          <h3>Independent review</h3>
          <p>
            {review.status === "SIGNED_OFF"
              ? `Signed off by ${review.signedBy ?? "the reviewer"} on ${formatDate(review.signedAt ?? "")}`
              : review.reperforming
                ? "The reviewer agent is re-performing the testing"
                : review.reperformedAt === null
                  ? "Not re-performed yet"
                  : `Re-performed ${formatDate(review.reperformedAt)} · ${
                      review.reperformSource === "MODEL"
                        ? "the reviewer agent re-performed each result"
                        : "standard checks only"
                    }`}
            {waiting.length > 0
              ? ` · ${waiting.length} note${waiting.length === 1 ? "" : "s"} open`
              : review.notes.length > 0
                ? " · every note cleared"
                : ""}
          </p>
        </div>
        <span
          className={`pill pill-dot ${
            review.status === "SIGNED_OFF"
              ? "tone-success"
              : waiting.length > 0
                ? "tone-warning"
                : ""
          }`}
        >
          {review.reperforming ? (
            <span className="spinner small" aria-hidden="true" />
          ) : null}
          {review.status === "SIGNED_OFF"
            ? "Reviewed"
            : review.reperforming
              ? executionOf({
                  agent: "reviewer",
                  run: review.reperformState,
                  automation,
                }).state === "UNAVAILABLE"
                ? "Re-performance queued · automation unavailable"
                : "Re-performing"
              : waiting.length > 0
                ? "Notes open"
                : "Ready to sign off"}
        </span>
      </header>
      {notice !== null ? (
        <Banner
          tone={
            notice === "review-blocked" ||
            notice === "review-denied" ||
            notice === "review-invalid" ||
            notice === "review-unavailable"
              ? "warning"
              : "info"
          }
        >
          {REVIEW_NOTICES[notice]}
        </Banner>
      ) : null}
      {review.reperformNote !== "" ? (
        <Banner tone="info">{review.reperformNote}</Banner>
      ) : null}
      <div className="card-body review-body">
        <dl className="review-facts">
          <div>
            <dt>Testing</dt>
            <dd>
              {review.sheetStatus === "SIGNED_OFF"
                ? `Signed off by ${review.sheetSignedBy ?? "a person"}`
                : "Not signed off"}
            </dd>
          </div>
          {review.workpapers.map((paper) => (
            <div key={paper.id}>
              <dt>
                {paper.stage === "DESIGN"
                  ? "Design workpaper"
                  : "Effectiveness workpaper"}
              </dt>
              <dd>
                {paper.status === "PREPARED"
                  ? `Prepared by ${paper.preparedBy ?? "a person"}`
                  : "Draft"}
              </dd>
            </div>
          ))}
          <div>
            <dt>Reviewer</dt>
            <dd>
              {review.viewerIsReviewer
                ? review.viewerPrepared && review.independenceRequired
                  ? "You prepared this work; another reviewer signs it off"
                  : "You"
                : "A team member with the reviewer role"}
            </dd>
          </div>
        </dl>
        {sorted.length === 0 ? (
          <p className="form-hint">
            {review.reperforming
              ? "Notes appear when the re-performance finishes."
              : "No review notes."}
          </p>
        ) : (
          <ol className="review-notes">
            {sorted.map((note) => (
              <li
                key={note.id}
                className={`review-note is-${note.status.toLowerCase()}`}
              >
                <div className="review-note-head">
                  <span className="mono">#{note.number}</span>
                  <span className={`pill ${SEVERITY_TONE[note.severity]}`}>
                    {SEVERITY_LABEL[note.severity]}
                  </span>
                  <span className="cell-muted">
                    {TARGET_LABEL[note.targetKind]}
                    {note.itemId !== null && itemLabel(note) !== ""
                      ? ` · ${itemLabel(note)}`
                      : ""}
                    {note.indexes.length > 0
                      ? ` · attribute ${note.indexes.map(letter).join(", ")}`
                      : ""}
                  </span>
                  <span className="review-note-status">
                    {NOTE_STATUS_LABEL[note.status]}
                  </span>
                </div>
                <p className="review-note-text">{note.text}</p>
                {note.citations.length > 0 ? (
                  <ul className="review-citations">
                    {note.citations.map((citation) => (
                      <li key={`${citation.fileId}-${citation.quote}`}>
                        <UiIcon name="copy" size={12} />
                        <span>
                          <strong>{citation.fileName}</strong>
                          {citation.location !== ""
                            ? ` · ${citation.location}`
                            : ""}
                          {": "}
                          <q>{citation.quote}</q>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="review-note-meta">
                  {note.raisedBy === "AGENT"
                    ? "Raised by the reviewer agent"
                    : `Raised by ${note.raisedByName ?? "a reviewer"}`}{" "}
                  {formatDate(note.raisedAt)}
                  {note.decidedByName !== null
                    ? ` · ${note.status === "DISMISSED" ? "Dismissed" : "Accepted"} by ${note.decidedByName}${
                        note.decisionReason !== ""
                          ? `: ${note.decisionReason}`
                          : ""
                      }`
                    : ""}
                  {note.reopened.length > 0
                    ? ` · ${reopenedText(note.reopened)}`
                    : ""}
                </p>
                {note.response !== "" ? (
                  <p className="review-note-response">
                    <strong>
                      {note.respondedByName ?? "The preparer"} answered
                    </strong>{" "}
                    {note.response}
                  </p>
                ) : null}
                {note.status === "CLEARED" ? (
                  <p className="review-note-meta">
                    Cleared by {note.clearedByName ?? "the reviewer"}{" "}
                    {formatDate(note.clearedAt ?? "")}
                    {note.clearReason !== "" ? `: ${note.clearReason}` : ""}
                  </p>
                ) : null}
                {note.status === "OPEN" && note.clearReason !== "" ? (
                  <p className="review-note-meta">
                    Returned: {note.clearReason}
                  </p>
                ) : null}
                {decides && note.status === "PROPOSED" ? (
                  <div className="review-actions">
                    <form
                      autoComplete="off"
                      method="post"
                      action="/workspace/reviews"
                    >
                      <Hidden
                        ids={ids}
                        review={review}
                        intent="accept"
                        noteId={note.id}
                      />
                      <button type="submit" className="btn-sm">
                        Accept
                      </button>
                    </form>
                    <form
                      autoComplete="off"
                      method="post"
                      action="/workspace/reviews"
                    >
                      <Hidden
                        ids={ids}
                        review={review}
                        intent="dismiss"
                        noteId={note.id}
                      />
                      <input
                        name="reason"
                        required
                        minLength={3}
                        maxLength={500}
                        placeholder="Why it does not apply"
                      />
                      <button type="submit" className="btn-secondary btn-sm">
                        Dismiss
                      </button>
                    </form>
                  </div>
                ) : null}
                {answers && note.status === "OPEN" ? (
                  <form
                    autoComplete="off"
                    method="post"
                    action="/workspace/reviews"
                    className="review-actions"
                  >
                    <Hidden
                      ids={ids}
                      review={review}
                      intent="respond"
                      noteId={note.id}
                    />
                    <input
                      name="text"
                      required
                      minLength={3}
                      maxLength={2000}
                      placeholder="What was done about it"
                    />
                    <button type="submit" className="btn-sm">
                      Answer
                    </button>
                  </form>
                ) : null}
                {decides &&
                (note.status === "RESPONDED" || note.status === "OPEN") ? (
                  <div className="review-actions">
                    <form
                      autoComplete="off"
                      method="post"
                      action="/workspace/reviews"
                    >
                      <Hidden
                        ids={ids}
                        review={review}
                        intent="clear"
                        noteId={note.id}
                      />
                      <input
                        name="reason"
                        maxLength={500}
                        placeholder="Optional note"
                      />
                      <button type="submit" className="btn-sm">
                        Clear
                      </button>
                    </form>
                    {note.status === "RESPONDED" ? (
                      <form
                        autoComplete="off"
                        method="post"
                        action="/workspace/reviews"
                      >
                        <Hidden
                          ids={ids}
                          review={review}
                          intent="return"
                          noteId={note.id}
                        />
                        <input
                          name="reason"
                          required
                          minLength={3}
                          maxLength={500}
                          placeholder="What is still missing"
                        />
                        <button type="submit" className="btn-secondary btn-sm">
                          Return
                        </button>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {decides ? (
          <form
            autoComplete="off"
            method="post"
            action="/workspace/reviews"
            className="review-raise"
          >
            <Hidden ids={ids} review={review} intent="note" />
            <h4>Raise a note</h4>
            <div className="review-raise-fields">
              <label>
                About
                <select name="target_kind" defaultValue="GENERAL">
                  <option value="GENERAL">General</option>
                  <option value="RESULT">A test result</option>
                  <option value="SAMPLE">The sample</option>
                  <option value="WORKPAPER">A workpaper</option>
                  <option value="DEFICIENCY">The deficiency</option>
                </select>
              </label>
              <label>
                Item
                <select name="item_id" defaultValue="">
                  <option value="">Not an item</option>
                  {(sheet?.items ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Workpaper
                <select name="workpaper_id" defaultValue="">
                  <option value="">Not a workpaper</option>
                  {review.workpapers.map((paper) => (
                    <option key={paper.id} value={paper.id}>
                      {paper.stage === "DESIGN"
                        ? "Design and walkthrough"
                        : "Operating effectiveness"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Severity
                <select name="severity" defaultValue="SHOULD_FIX">
                  <option value="MUST_FIX">Must fix (reopens the work)</option>
                  <option value="SHOULD_FIX">Should fix</option>
                  <option value="OBSERVATION">Observation</option>
                </select>
              </label>
            </div>
            <textarea
              name="text"
              required
              minLength={3}
              maxLength={2000}
              rows={2}
              placeholder="What must change, or be confirmed, and why"
            />
            <div className="form-actions">
              <button type="submit" className="btn-sm">
                Raise note
              </button>
            </div>
          </form>
        ) : null}
      </div>
      <footer className="review-foot">
        {review.status === "OPEN" ? (
          <>
            {review.blocking.length > 0 ? (
              <p className="form-hint">
                Before sign-off: {review.blocking.join("; ")}.
              </p>
            ) : null}
            {answers ? (
              <form
                autoComplete="off"
                method="post"
                action="/workspace/reviews"
              >
                <Hidden ids={ids} review={review} intent="reperform" />
                <button
                  type="submit"
                  className="btn-secondary btn-sm"
                  disabled={review.reperforming}
                >
                  Re-perform
                </button>
              </form>
            ) : null}
            {decides &&
            (!review.viewerPrepared || !review.independenceRequired) ? (
              <form
                autoComplete="off"
                method="post"
                action="/workspace/reviews"
                className="review-signoff"
              >
                <Hidden ids={ids} review={review} intent="sign-off" />
                <input
                  name="text"
                  maxLength={1000}
                  placeholder="Sign-off note (optional)"
                />
                <button
                  type="submit"
                  className="btn-sm"
                  disabled={review.blocking.length > 0}
                >
                  Sign off the review
                </button>
              </form>
            ) : null}
          </>
        ) : (
          <>
            {review.signoffNote !== "" ? (
              <p className="form-hint">{review.signoffNote}</p>
            ) : null}
            {decides === false && canAct && review.viewerIsReviewer ? (
              <form
                autoComplete="off"
                method="post"
                action="/workspace/reviews"
                className="review-signoff"
              >
                <Hidden ids={ids} review={review} intent="reopen" />
                <input
                  name="reason"
                  required
                  minLength={3}
                  maxLength={500}
                  placeholder="Why the review is reopened"
                />
                <button type="submit" className="btn-secondary btn-sm">
                  Reopen the review
                </button>
              </form>
            ) : null}
          </>
        )}
      </footer>
    </section>
  );
}

function rank(status: ReviewNote["status"]): number {
  return [
    "PROPOSED",
    "OPEN",
    "RESPONDED",
    "CLEARED",
    "DISMISSED",
    "WITHDRAWN",
  ].indexOf(status);
}

function letter(index: number): string {
  return index >= 0 && index < 26
    ? String.fromCharCode(65 + index)
    : `${index + 1}`;
}

function reopenedText(reopened: string[]): string {
  const parts = reopened.map((entry) =>
    entry === "SHEET"
      ? "reopened the test sheet"
      : entry.startsWith("WORKPAPER:")
        ? "reopened the workpaper"
        : entry,
  );
  return parts.join(", ");
}
