"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import {
  CONCLUSION_NOTICES,
  type ConclusionDeficiency,
  type ConclusionNotice,
  type ControlConclusion,
  PHASE_STATE_WORDS,
  parseConclusionNotice,
  ratingState,
  SEVERITIES,
  SEVERITY_LABELS,
  VERDICT_WORDS,
} from "./control-conclusion-model";
import { formatDate } from "./format";
import { UiIcon } from "./ui-icon";

const FAILED: readonly ConclusionNotice[] = [
  "cc-blocked",
  "cc-denied",
  "cc-invalid",
  "cc-trial-ended",
  "cc-unavailable",
];

type Ids = { organizationId: string; projectId: string; controlId: string };

/**
 * Step 09's work (B3): the conclusion the records support and why, the D&I and OE results it
 * rests on, and each deficiency rated by a person with the agent's suggestion pre-filled. A
 * rating saves in the background and shows as saved only once the server confirms it.
 */
export function ControlConclusionWork({
  ids,
  conclusion,
  notice,
}: {
  ids: Ids;
  conclusion: ControlConclusion;
  notice: ConclusionNotice | null;
}) {
  const [shown, setShown] = useState<ConclusionNotice | null>(notice);
  const verdict =
    conclusion.status === "FINAL" ? conclusion.final : conclusion.proposed;
  return (
    <div className="cc">
      {shown !== null ? (
        <p
          className={`banner ${FAILED.includes(shown) ? "banner-warning" : ""}`}
          role="status"
        >
          <UiIcon name={FAILED.includes(shown) ? "risk" : "info"} size={16} />
          <span>{CONCLUSION_NOTICES[shown]}</span>
        </p>
      ) : null}
      <div className={`cc-verdict is-${(verdict ?? "none").toLowerCase()}`}>
        <p className="cc-verdict-kicker">
          {conclusion.status === "FINAL"
            ? "Concluded at the independent review"
            : conclusion.status === "PROPOSED"
              ? "The agent's proposed conclusion"
              : "Not ready to conclude"}
        </p>
        <p className="cc-verdict-word">
          {verdict === null ? "Not concluded" : VERDICT_WORDS[verdict]}
        </p>
        {conclusion.status !== "FINAL" && conclusion.waiting.length > 0 ? (
          <p className="cc-waiting">
            Waits until {conclusion.waiting.join(", and ")}.
          </p>
        ) : null}
        {conclusion.reasons.length > 0 ? (
          <ul className="cc-reasons">
            {conclusion.reasons.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <h4 className="stp-subhead">What it rests on</h4>
      <ul className="stp-rows">
        <li>
          <span className="stp-row-main">
            <strong>D&amp;I conclusion</strong>
            <small>Design and implementation, signed off by a reviewer</small>
          </span>
          <span
            className={`stp-chip ${conclusion.design === "EFFECTIVE" ? "is-done" : conclusion.design === "NOT_EFFECTIVE" ? "is-blocked" : ""}`}
          >
            {conclusion.design === null
              ? "Not signed off"
              : VERDICT_WORDS[conclusion.design]}
          </span>
        </li>
        {conclusion.phases.map((phase) => (
          <li key={phase.phase}>
            <span className="stp-row-main">
              <strong>{phase.label}</strong>
              <small>
                {phase.retested
                  ? "Exceptions found; retested effective after remediation"
                  : PHASE_STATE_WORDS[phase.state]}
              </small>
            </span>
            <span
              className={`stp-chip ${phase.conclusion === "EFFECTIVE" ? "is-done" : phase.conclusion === "NOT_EFFECTIVE" ? "is-blocked" : ""}`}
            >
              {phase.conclusion !== null
                ? phase.retested
                  ? "Effective after retest"
                  : VERDICT_WORDS[phase.conclusion]
                : PHASE_STATE_WORDS[phase.state]}
            </span>
          </li>
        ))}
      </ul>

      <h4 className="stp-subhead">
        Deficiencies
        {conclusion.toRate > 0 ? ` · ${conclusion.toRate} to rate` : ""}
      </h4>
      {conclusion.deficiencies.length === 0 ? (
        <p className="stp-empty">No deficiency stands against this control.</p>
      ) : (
        <ul className="cc-deficiencies">
          {conclusion.deficiencies.map((item) => (
            <DeficiencyRating
              key={`${item.id}:${item.version}`}
              ids={ids}
              item={item}
              canRate={conclusion.canRate}
              onDone={setShown}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function DeficiencyRating({
  ids,
  item,
  canRate,
  onDone,
}: {
  ids: Ids;
  item: ConclusionDeficiency;
  canRate: boolean;
  onDone: (notice: ConclusionNotice) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const state = ratingState(item);
  // The agent's suggestion is the starting answer; a person keeps or changes it.
  const [severity, setSeverity] = useState(
    item.rated ? item.severity : item.suggested,
  );
  const [open, setOpen] = useState(!item.rated);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      let result: ConclusionNotice = "cc-unavailable";
      try {
        const response = await fetch("/workspace/control-conclusions", {
          method: "POST",
          body: data,
          headers: { "x-cc-fetch": "1" },
        });
        const body = (await response.json()) as { notice?: unknown };
        result =
          parseConclusionNotice(
            typeof body.notice === "string" ? body.notice : null,
          ) ?? "cc-unavailable";
      } catch {
        result = "cc-unavailable";
      }
      onDone(result);
      if (result === "cc-rated" || result === "cc-review") {
        setOpen(false);
      }
      router.refresh();
    });
  }
  return (
    <li className="cc-def">
      <div className="cc-def-head">
        <span className="stp-row-main">
          <strong>
            {item.reference} · {item.title}
          </strong>
          <small>
            {item.type === "DESIGN" ? "Design" : "Operating"} deficiency ·{" "}
            {item.status.replaceAll("_", " ").toLowerCase()}
          </small>
        </span>
        <span className={`stp-chip is-${state.tone}`}>{state.label}</span>
      </div>
      {!item.rated && item.pending !== null ? (
        <p className="cc-def-rating">
          Requested when logged: {SEVERITY_LABELS[item.pending]}, awaiting the
          reviewer. A rating answers the request.
        </p>
      ) : null}
      {item.rating !== null && !open ? (
        <p className="cc-def-rating">
          {SEVERITY_LABELS[item.rating.severity]}, rated by{" "}
          {item.rating.ratedBy} on {formatDate(item.rating.ratedAt)}:{" "}
          {item.rating.rationale}
        </p>
      ) : null}
      {canRate ? (
        open ? (
          <form
            autoComplete="off"
            method="post"
            action="/workspace/control-conclusions"
            className="cc-rate"
            onSubmit={submit}
            aria-busy={pending}
          >
            <input
              type="hidden"
              name="organization_id"
              value={ids.organizationId}
            />
            <input type="hidden" name="project_id" value={ids.projectId} />
            <input type="hidden" name="control_id" value={ids.controlId} />
            <input type="hidden" name="deficiency_id" value={item.id} />
            <input type="hidden" name="version" value={String(item.version)} />
            <p className="cc-suggest">
              <UiIcon name="sparkles" size={13} />
              <span>
                Suggested: <strong>{SEVERITY_LABELS[item.suggested]}</strong>.{" "}
                {item.suggestionReason}
              </span>
            </p>
            <fieldset className="cc-pills" disabled={pending}>
              <legend className="sr-only">Severity</legend>
              {SEVERITIES.map((option) => (
                <label
                  key={option}
                  className={`cc-pill${severity === option ? " is-on" : ""}`}
                >
                  <input
                    type="radio"
                    name="severity"
                    value={option}
                    checked={severity === option}
                    onChange={() => setSeverity(option)}
                  />
                  <span className="cc-pill-dot" aria-hidden="true" />
                  {SEVERITY_LABELS[option]}
                  {option === item.suggested ? (
                    <span className="cc-pill-tag">Suggested</span>
                  ) : null}
                </label>
              ))}
            </fieldset>
            <label className="dc-field">
              <span>Rationale</span>
              <textarea
                name="rationale"
                rows={2}
                required
                minLength={10}
                maxLength={1000}
                disabled={pending}
                defaultValue={item.rating?.rationale ?? item.suggestionReason}
              />
            </label>
            <div className="dc-actions">
              <button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save rating"}
              </button>
              {item.rated ? (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={pending}
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </button>
              ) : null}
              <span className="form-hint">
                A significant deficiency or material weakness takes effect once
                the reviewer approves it.
              </span>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="btn-secondary btn-sm cc-change"
            onClick={() => setOpen(true)}
          >
            Change rating
          </button>
        )
      ) : null}
    </li>
  );
}
