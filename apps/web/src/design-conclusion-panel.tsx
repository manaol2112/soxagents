"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState, useTransition } from "react";
import {
  BASIS_WORDS,
  CONCLUSION_WORDS,
  conclusionHead,
  DESIGN_CONCLUSION_NOTICES,
  type DesignConclusion,
  type DesignConclusionNotice,
  type DesignSignoff,
  exceptionLine,
  holdsBelow,
  parseDesignConclusionNotice,
  VERDICT_LABELS,
} from "./design-conclusion-model";
import {
  conclusionHref,
  designWorkpaperQuery,
  parseDesignWorkpaper,
  recordedLine,
} from "./design-workpaper-model";
import { formatDate } from "./format";
import { RichText } from "./rich-text";
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

/** The conclusion's text as section 7 shows it: one read of the D&I workpaper through
 * the views' own route, stopped when the step goes, and again when the preparer's
 * conclusion changes. `null` while it is read; `false` where it could not be. */
function useConclusionText(
  ids: { organizationId: string; projectId: string; controlId: string },
  again: string,
  wanted: boolean,
): string | null | false {
  const [text, setText] = useState<string | null | false>(null);
  const query = designWorkpaperQuery(ids);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `again` is what asks for another read.
  useEffect(() => {
    if (!wanted) {
      return;
    }
    const control = new AbortController();
    let current = true;
    setText(null);
    (async () => {
      let read: string | false = false;
      try {
        const response = await fetch(`/workspace/design-workpaper?${query}`, {
          cache: "no-store",
          signal: control.signal,
        });
        const body = (await response.json()) as {
          status?: unknown;
          result?: unknown;
        };
        const paper =
          body.status === 200 ? parseDesignWorkpaper(body.result) : null;
        read = paper === null ? false : paper.conclusion.text;
      } catch {
        read = false;
      }
      if (current) {
        setText(read);
      }
    })();
    return () => {
      current = false;
      control.abort();
    };
  }, [query, again, wanted]);
  return text;
}

/**
 * Step 05, the D&I conclusion (product owner, 8 November 2026): the verdict the records
 * support, what it rests on, and the reviewer's sign-off that clears OE (or ends it). The
 * sign-off saves in the background and shows as signed only once the server confirms it;
 * without scripts the form posts and redirects back to this step.
 *
 * While an exception a person recorded holds the sign-off (section 10.15, item 5 of
 * docs/evidence-assurance.md) the card says so in place of the verdict: "Exception
 * recorded: not ready to sign", the server's own sentence(s) as the reason and what the
 * preparer does next; never that a verdict awaits the reviewer, and never the green of
 * an effective verdict. Every word of the card is the model's
 * (design-conclusion-model.conclusionHead).
 *
 * D&I Conclusion and Review (product owner, 15 November 2026; docs/design-workpaper.md,
 * sections 3.5 and 3.6): the preparer concludes in section 7 of D&I Assessment, and this
 * step is the reviewer's. It shows, read-only and first, the preparer's conclusion (its
 * words, basis and reason) and the conclusion's text exactly as section 7 shows it, then
 * what the sign-off rests on, then the sign-off of that conclusion. Nothing is edited
 * here: the conclusion has one editor, in section 7.
 */
export function DesignConclusionPanel({
  ids,
  conclusion,
  notice,
  assessmentHref,
  evidenceHref = null,
}: {
  ids: { organizationId: string; projectId: string; controlId: string };
  conclusion: DesignConclusion | null;
  notice: DesignConclusionNotice | null;
  assessmentHref: string;
  /** D&I Evidence, where a tickmark is changed; null where the step is not linked. */
  evidenceHref?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pressed, setPressed] = useState<"sign" | "reopen" | null>(null);
  const [shown, setShown] = useState<DesignConclusionNotice | null>(notice);
  // Read only where there is a conclusion to show it with.
  const text = useConclusionText(
    ids,
    `${conclusion?.choice?.id ?? ""}:${conclusion?.status ?? ""}`,
    conclusion !== null &&
      (conclusion.choice !== null || conclusion.signed?.conclusion != null),
  );

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
  // The card's head, as the model words it: the verdict, or the exception that holds
  // the sign-off with the server's sentence(s) and what the preparer does next.
  const head = conclusionHead(conclusion);
  // What else holds the sign-off, every sentence whole: the viewer's own reason, then
  // each the server gives that the card does not already say.
  const holds = holdsBelow(conclusion);
  const earlier = conclusion.history.filter((item) => item.reopenedAt !== null);
  // Section 3.6: the reviewer signs the preparer's conclusion that stands, never "Not
  // concluded".
  const choice = conclusion.choice;
  const signed = conclusion.signed;
  const signable =
    choice === null || choice.kind === "NOT_CONCLUDED" ? null : choice.kind;
  const signs =
    conclusion.canSign && signable !== null && paper?.preparedVersion != null;
  // What the step says first: the conclusion recorded (or signed). An answer from before
  // section 3.6 names none, and its verdict is read as before.
  const named = choice !== null || signed?.conclusion != null;
  const before36 =
    conclusion.proposedConclusion === null && choice === null && !named;
  const section7 = conclusionHref(assessmentHref);
  const preparerSide =
    conclusion.viewerPrepared || !conclusion.viewerIsReviewer;

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

      <div className={`dc-verdict is-${head.tone}`}>
        <div className="dc-verdict-head">
          <h3 id="dc-heading">{head.heading}</h3>
          <span className={`dc-status is-${head.statusTone}`}>
            {head.statusTone === "excepted" ? (
              <UiIcon name="risk" size={12} />
            ) : null}
            {head.status}
          </span>
        </div>
        {named || before36 ? (
          <p className="dc-verdict-word">{head.word}</p>
        ) : (
          <p className="dc-none">
            The preparer has not recorded a conclusion yet.{" "}
            <a href={section7}>Open section 7 in D&amp;I Assessment</a>
          </p>
        )}
        {choice !== null ? (
          <div className="dc-chosen">
            <p className="dc-recorded">{recordedLine(choice)}</p>
            {choice.basis !== null ? (
              <p>
                <b>Not effective in:</b> {BASIS_WORDS[choice.basis]}
              </p>
            ) : null}
            {choice.reason !== "" ? (
              <p>
                <b>Reason.</b> {choice.reason}
              </p>
            ) : null}
          </div>
        ) : null}
        {named ? (
          // The text exactly as section 7 shows it, read-only.
          <div className="dc-text">
            <h4>Conclusion, as written in section 7</h4>
            {text === null ? (
              <p className="dc-quiet">Reading the conclusion…</p>
            ) : text === false ? (
              <p className="dc-quiet">
                The conclusion's text could not be read. Open section 7 in
                D&amp;I Assessment to read it.
              </p>
            ) : text === "" ? (
              <p className="dc-quiet">No conclusion is written yet.</p>
            ) : (
              <RichText text={text} />
            )}
          </div>
        ) : null}
        {named && preparerSide ? (
          <p className="dc-edit-where">
            <a href={section7}>Edit the conclusion in D&amp;I Assessment</a>
          </p>
        ) : null}
        {head.reasons.length > 0 ? (
          // An exception a person recorded holds the sign-off: the server's sentence(s),
          // whole, then what the preparer does next. Nothing here says a verdict waits
          // to be signed.
          <div className="dc-excepted" role="note">
            {head.reasons.map((text) => (
              <p key={text}>{text}</p>
            ))}
            <p className="dc-excepted-next">
              {head.next}
              {evidenceHref !== null ? (
                <>
                  {" "}
                  <a href={evidenceHref}>Open D&amp;I Evidence</a>
                </>
              ) : null}
            </p>
          </div>
        ) : (
          <p className="dc-effect">{head.effect}</p>
        )}
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
          {conclusion.exceptions.length > 0 ? (
            <div>
              <dt>Exceptions recorded</dt>
              <dd>
                <ul className="dc-list">
                  {conclusion.exceptions.map((item) => (
                    <li key={`${item.requirementId}:${item.attributeId}`}>
                      <strong>{exceptionLine(item, formatDate)}</strong>
                      {item.reason !== "" ? (
                        <span className="dc-note">{item.reason}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
          {signed !== null ? (
            <div>
              <dt>Signed off</dt>
              <dd>
                {signed.signedBy || "A reviewer"} on{" "}
                {formatDate(signed.signedAt)}
                {/* The conclusion is said once, above; the sign-off names it only where
                    it signed another (the preparer's changed since). */}
                {signed.conclusion !== null &&
                choice !== null &&
                signed.conclusion !== choice.kind
                  ? ` · signed as “${CONCLUSION_WORDS[signed.conclusion]}”`
                  : before36
                    ? ` · ${VERDICT_LABELS[signed.verdict]}`
                    : ""}{" "}
                · workpaper version {signed.workpaperVersion}
                {signed.note !== "" ? (
                  <span className="dc-note">{signed.note}</span>
                ) : null}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      {conclusion.status === "OUT_OF_DATE" ? (
        <div className="banner banner-warning" role="note">
          <UiIcon name="risk" size={16} />
          {/* Every reason the server gives, each whole on its own line: it names what
              changed, and none is joined into or cut by another. */}
          <div className="dc-outdated">
            <p>The sign-off no longer holds:</p>
            <ul>
              {conclusion.outOfDate.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <p>OE waits until a reviewer signs off again.</p>
          </div>
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
          <input type="hidden" name="conclusion" value={signable ?? ""} />
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
                : `Sign off: ${signable === null ? "" : CONCLUSION_WORDS[signable]}`}
            </button>
            <span className="form-hint">
              You sign the preparer's conclusion. A different one is theirs to
              record: reopen the design workpaper for them to change it.
            </span>
          </div>
        </form>
      ) : null}
      {holds.length > 0 ? (
        <div className="dc-blocked" role="note">
          {holds.map((text) => (
            <p key={text}>{text}</p>
          ))}
        </div>
      ) : null}

      {signed !== null && conclusion.viewerIsReviewer ? (
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
                <strong>
                  {item.conclusion !== null
                    ? CONCLUSION_WORDS[item.conclusion]
                    : VERDICT_LABELS[item.verdict]}
                </strong>{" "}
                · signed by {item.signedBy || "a reviewer"} on{" "}
                {formatDate(item.signedAt)} · workpaper version{" "}
                {item.workpaperVersion}
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
