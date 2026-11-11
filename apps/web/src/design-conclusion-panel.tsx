"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import {
  DESIGN_CONCLUSION_NOTICES,
  type DesignConclusion,
  type DesignConclusionNotice,
  type DesignSignoff,
  parseDesignConclusionNotice,
  signBlockedReason,
  VERDICT_LABELS,
} from "./design-conclusion-model";
import { formatDate } from "./format";
import { UiIcon } from "./ui-icon";

const FAILED: readonly DesignConclusionNotice[] = [
  "dc-blocked",
  "dc-denied",
  "dc-invalid",
  "dc-trial-ended",
  "dc-unavailable",
];

const REOPENED_FROM: Record<
  NonNullable<DesignSignoff["reopenedFrom"]>,
  string
> = {
  PERSON: "Reopened by a reviewer",
  WORKPAPER: "Reopened with the design workpaper",
  SUPERSEDED: "Superseded by a later sign-off",
};

/**
 * Step 05, the D&I conclusion (product owner, 8 November 2026): the verdict the records
 * support, what it rests on, and the reviewer's sign-off that clears OE (or ends it). The
 * sign-off saves in the background and shows as signed only once the server confirms it;
 * without scripts the form posts and redirects back to this step.
 */
export function DesignConclusionPanel({
  ids,
  conclusion,
  notice,
  assessmentHref,
}: {
  ids: { organizationId: string; projectId: string; controlId: string };
  conclusion: DesignConclusion | null;
  notice: DesignConclusionNotice | null;
  assessmentHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pressed, setPressed] = useState<"sign" | "reopen" | null>(null);
  const [shown, setShown] = useState<DesignConclusionNotice | null>(notice);

  if (conclusion === null) {
    return (
      <p className="cs-empty">
        The D&amp;I conclusion could not be loaded. Refresh the page to try
        again.
      </p>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const intent = data.get("intent") === "reopen" ? "reopen" : "sign";
    setPressed(intent);
    setShown(null);
    startTransition(async () => {
      let result: DesignConclusionNotice = "dc-unavailable";
      try {
        const response = await fetch("/workspace/design-conclusions", {
          method: "POST",
          body: data,
          headers: { "x-dc-fetch": "1" },
        });
        const body = (await response.json()) as { notice?: unknown };
        result =
          parseDesignConclusionNotice(
            typeof body.notice === "string" ? body.notice : null,
          ) ?? "dc-unavailable";
      } catch {
        result = "dc-unavailable";
      }
      setShown(result);
      router.refresh();
    });
  }

  const hidden = (
    <>
      <input type="hidden" name="organization_id" value={ids.organizationId} />
      <input type="hidden" name="project_id" value={ids.projectId} />
      <input type="hidden" name="control_id" value={ids.controlId} />
    </>
  );
  const paper = conclusion.workpaper;
  const verdict =
    conclusion.status === "SIGNED_OFF"
      ? (conclusion.signed?.verdict ?? null)
      : conclusion.proposed;
  const blocked = signBlockedReason(conclusion);
  const earlier = conclusion.history.filter((item) => item.reopenedAt !== null);
  const signs =
    conclusion.canSign &&
    conclusion.proposed !== null &&
    paper?.preparedVersion != null;

  return (
    <section className="dc" aria-labelledby="dc-heading">
      {shown !== null ? (
        <p
          className={`banner ${FAILED.includes(shown) ? "banner-warning" : ""}`}
          role="status"
        >
          <UiIcon name={FAILED.includes(shown) ? "risk" : "info"} size={16} />
          <span>{DESIGN_CONCLUSION_NOTICES[shown]}</span>
        </p>
      ) : null}

      <div className={`dc-verdict is-${(verdict ?? "none").toLowerCase()}`}>
        <div className="dc-verdict-head">
          <h3 id="dc-heading">
            {conclusion.status === "SIGNED_OFF"
              ? "D&I conclusion"
              : conclusion.status === "NOT_READY"
                ? "D&I conclusion"
                : "Proposed D&I conclusion"}
          </h3>
          <span className={`dc-status is-${conclusion.status.toLowerCase()}`}>
            {conclusion.status === "SIGNED_OFF"
              ? "Signed off"
              : conclusion.status === "OUT_OF_DATE"
                ? "Out of date"
                : conclusion.status === "TO_SIGN"
                  ? "Awaiting reviewer sign-off"
                  : "Not ready"}
          </span>
        </div>
        <p className="dc-verdict-word">
          {verdict === null ? "Not concluded" : VERDICT_LABELS[verdict]}
        </p>
        <p className="dc-effect">
          {verdict === "NOT_EFFECTIVE"
            ? "OE is not performed. The control concludes not effective on the design deficiency, which goes to remediation; D&I is assessed again before OE."
            : verdict === "EFFECTIVE"
              ? conclusion.status === "SIGNED_OFF"
                ? "OE evidence and testing are cleared to proceed."
                : "Once signed off, OE evidence and testing are cleared to proceed."
              : "OE evidence and testing wait for a signed-off effective D&I conclusion."}
        </p>
        <dl className="dc-basis">
          <div>
            <dt>Design workpaper</dt>
            <dd>
              {paper === null ? (
                "Not started"
              ) : paper.status === "PREPARED" ? (
                <>
                  Prepared by {paper.preparedBy || "a team member"}
                  {paper.preparedVersion !== null
                    ? ` · version ${paper.preparedVersion}`
                    : ""}
                </>
              ) : (
                "Draft, not prepared"
              )}{" "}
              <a href={assessmentHref}>Open D&amp;I Assessment</a>
            </dd>
          </div>
          <div>
            <dt>Design deficiencies</dt>
            <dd>
              {conclusion.deficiencies.length === 0 ? (
                "None logged"
              ) : (
                <ul className="dc-list">
                  {conclusion.deficiencies.map((item) => (
                    <li key={item.reference}>
                      <strong>{item.reference}</strong> {item.title}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
          {conclusion.signed !== null ? (
            <div>
              <dt>Signed off</dt>
              <dd>
                {conclusion.signed.signedBy || "A reviewer"} on{" "}
                {formatDate(conclusion.signed.signedAt)} ·{" "}
                {VERDICT_LABELS[conclusion.signed.verdict]} · workpaper version{" "}
                {conclusion.signed.workpaperVersion}
                {conclusion.signed.note !== "" ? (
                  <span className="dc-note">{conclusion.signed.note}</span>
                ) : null}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      {conclusion.status === "OUT_OF_DATE" ? (
        <div className="banner banner-warning" role="note">
          <UiIcon name="risk" size={16} />
          <span>
            The sign-off no longer holds: {conclusion.outOfDate.join("; ")}. OE
            waits until a reviewer signs off again.
          </span>
        </div>
      ) : null}

      {signs ? (
        <form
          autoComplete="off"
          method="post"
          action="/workspace/design-conclusions"
          className="dc-form"
          onSubmit={submit}
          aria-busy={pending}
        >
          {hidden}
          <input type="hidden" name="intent" value="sign" />
          <input
            type="hidden"
            name="verdict"
            value={conclusion.proposed ?? ""}
          />
          <input
            type="hidden"
            name="workpaper_version"
            value={String(paper?.preparedVersion ?? "")}
          />
          <label className="dc-field">
            <span>Sign-off note (optional)</span>
            <textarea
              name="note"
              rows={2}
              maxLength={1000}
              disabled={pending}
              placeholder="What was reviewed, for the record"
            />
          </label>
          <div className="dc-actions">
            <button type="submit" disabled={pending}>
              {pending && pressed === "sign"
                ? "Signing off…"
                : `Sign off: ${VERDICT_LABELS[conclusion.proposed ?? "EFFECTIVE"]}`}
            </button>
            <span className="form-hint">
              A different verdict is recorded as a design deficiency, or by
              reopening the design workpaper.
            </span>
          </div>
        </form>
      ) : blocked !== null ? (
        <p className="dc-blocked">{blocked}</p>
      ) : null}

      {conclusion.signed !== null && conclusion.viewerIsReviewer ? (
        <details className="dc-reopen">
          <summary>Reopen the D&amp;I conclusion</summary>
          <form
            autoComplete="off"
            method="post"
            action="/workspace/design-conclusions"
            className="dc-form"
            onSubmit={submit}
            aria-busy={pending}
          >
            {hidden}
            <input type="hidden" name="intent" value="reopen" />
            <label className="dc-field">
              <span>Reason</span>
              <textarea
                name="reason"
                rows={2}
                required
                minLength={10}
                maxLength={500}
                disabled={pending}
                placeholder="Why the conclusion is reopened"
              />
            </label>
            <div className="dc-actions">
              <button
                type="submit"
                className="btn-secondary"
                disabled={pending}
              >
                {pending && pressed === "reopen" ? "Reopening…" : "Reopen"}
              </button>
              <span className="form-hint">
                OE waits until the conclusion is signed off again.
              </span>
            </div>
          </form>
        </details>
      ) : null}

      {earlier.length > 0 ? (
        <details className="dc-history">
          <summary>Earlier sign-offs ({earlier.length})</summary>
          <ol>
            {earlier.map((item) => (
              <li key={item.id}>
                <strong>{VERDICT_LABELS[item.verdict]}</strong> · signed by{" "}
                {item.signedBy || "a reviewer"} on {formatDate(item.signedAt)} ·
                workpaper version {item.workpaperVersion}
                <span className="dc-note">
                  {item.reopenedFrom !== null
                    ? REOPENED_FROM[item.reopenedFrom]
                    : "Reopened"}
                  {item.reopenedAt !== null
                    ? ` on ${formatDate(item.reopenedAt)}`
                    : ""}
                  {item.reopenReason !== "" ? `: ${item.reopenReason}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
