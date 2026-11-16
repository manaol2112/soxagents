"use client";

import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useEffect,
  useId,
  useState,
  useTransition,
} from "react";
import {
  BASIS_WORDS,
  CONCLUSION_WORDS,
  conclusionHead,
  DESIGN_CONCLUSION_NOTICES,
  type DesignConclusion,
  type DesignConclusionNotice,
  type DesignSignoff,
  designConclusionRefusal,
  exceptionLine,
  holdsBelow,
  outOfDateNext,
  parseDesignConclusionNotice,
  signableKind,
  standingKind,
  VERDICT_LABELS,
} from "./design-conclusion-model";
import {
  conclusionHref,
  designWorkpaperQuery,
  parseDesignWorkpaper,
  recordedLine,
} from "./design-workpaper-model";
import { formatDate } from "./format";
import { ReviewNotesLine } from "./review-notes";
import { notesHref } from "./review-notes-model";
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
 * the views' own route, stopped when the step goes, and again whenever `again` changes:
 * the preparer's conclusion, the sign-off's status, or the workpaper's status or
 * prepared version (the text is rewritten only by preparing another version, and the
 * reviewer signs the version shown). `null` while it is read, and until the read for
 * what is shown now has answered: a text read for an earlier version is never shown
 * beside a later one. `false` where it could not be read; `retry` reads it again. */
function useConclusionText(
  ids: { organizationId: string; projectId: string; controlId: string },
  again: string,
  wanted: boolean,
): { text: string | null | false; retry: () => void } {
  const [read, setRead] = useState<{
    key: string;
    text: string | false;
  } | null>(null);
  const [tries, setTries] = useState(0);
  const query = designWorkpaperQuery(ids);
  const key = `${query}|${again}|${tries}`;
  useEffect(() => {
    if (!wanted) {
      return;
    }
    const control = new AbortController();
    let current = true;
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
        setRead({ key, text: read });
      }
    })();
    return () => {
      current = false;
      control.abort();
    };
  }, [query, key, wanted]);
  return {
    text: wanted && read !== null && read.key === key ? read.text : null,
    retry: () => setTries((n) => n + 1),
  };
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
  // The server's own sentence for a refusal, shown at once in place of the notice's.
  const [refusal, setRefusal] = useState("");
  const uid = useId();
  // The conclusion the step speaks of (section 3.6): the signed one while the sign-off
  // stands, otherwise the preparer's; null where none is recorded; undefined on a body
  // from before 3.6.
  const standing = conclusion === null ? undefined : standingKind(conclusion);
  const named = standing !== undefined && standing !== null;
  // Read only where there is a conclusion to show it with, and again whenever the
  // conclusion, the sign-off or the prepared version it would be signed at changes.
  const { text, retry } = useConclusionText(
    ids,
    [
      conclusion?.choice?.id ?? "",
      conclusion?.status ?? "",
      conclusion?.workpaper?.id ?? "",
      conclusion?.workpaper?.status ?? "",
      conclusion?.workpaper?.preparedVersion ?? "",
    ].join(":"),
    named,
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
    // The reviewer signs the text they can read: not while it is being read, and not
    // where it could not be.
    if (intent === "sign" && typeof text !== "string") {
      return;
    }
    setPressed(intent);
    setShown(null);
    setRefusal("");
    startTransition(async () => {
      let result: DesignConclusionNotice = "dc-unavailable";
      let detail = "";
      try {
        const response = await fetch("/workspace/design-conclusions", {
          method: "POST",
          body: data,
          headers: { "x-dc-fetch": "1" },
        });
        const body = (await response.json()) as {
          notice?: unknown;
          detail?: unknown;
        };
        result =
          parseDesignConclusionNotice(
            typeof body.notice === "string" ? body.notice : null,
          ) ?? "dc-unavailable";
        detail = typeof body.detail === "string" ? body.detail : "";
      } catch {
        result = "dc-unavailable";
      }
      // The server's sentence for a refusal is shown now, before the records are read
      // again: it says what to do, which the notice alone does not.
      setRefusal(designConclusionRefusal(intent, result, detail));
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
  // Section 3.6: the reviewer signs the preparer's conclusion that stands, named by its
  // kind and its id, never "Not concluded". With no standing conclusion there is nothing
  // to sign, and no button.
  const choice = conclusion.choice;
  const signed = conclusion.signed;
  const signable = choice === null ? null : signableKind(choice.kind);
  const signs =
    conclusion.canSign &&
    choice !== null &&
    signable !== null &&
    paper?.preparedVersion != null;
  // What the step says first: the conclusion that stands. An answer from before section
  // 3.6 names none, and its verdict is read as before; one that follows it and has none
  // recorded says so, with the way to section 7 (never the records' two-value proposal).
  const before36 = standing === undefined;
  const none = standing === null;
  const section7 = conclusionHref(assessmentHref);
  const preparerSide =
    conclusion.viewerPrepared ||
    conclusion.viewerRecorded ||
    !conclusion.viewerIsReviewer;
  // The sign-off waits for the text the reviewer signs: read, for the version shown.
  const textHold =
    text === null
      ? "Reading the conclusion…"
      : text === false
        ? "The conclusion could not be read: try again"
        : "";
  const signHoldId = `${uid}-sign-hold`;
  const failed = shown !== null && FAILED.includes(shown);

  return (
    <section className="dc" aria-labelledby="dc-heading">
      {shown !== null ? (
        <p
          className={`banner ${failed ? "banner-warning" : ""}`}
          role={failed ? "alert" : "status"}
        >
          <UiIcon name={failed ? "risk" : "info"} size={16} />
          <span>
            {refusal !== "" ? refusal : DESIGN_CONCLUSION_NOTICES[shown]}
          </span>
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
        <p className={`dc-verdict-word${none ? " is-none" : ""}`}>
          {head.word}
        </p>
        {none ? (
          // Always said where no conclusion stands, whatever else the card says.
          <p className="dc-none">
            The preparer has not recorded a conclusion yet.{" "}
            <a href={section7}>Open section 7 in D&amp;I Assessment</a>
          </p>
        ) : null}
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
                The conclusion's text could not be read.
                {/* One way to read it again: beside Sign off where the sign-off is
                    offered, here otherwise. */}
                {signs ? null : (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={retry}
                    >
                      Try again
                    </button>
                  </>
                )}
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
        ) : head.effect !== "" ? (
          <p className="dc-effect">{head.effect}</p>
        ) : null}
        <dl className="dc-basis">
          <div>
            {/* The two signatures in order (docs/design-workpaper.md, section 3.7):
                the preparer's, signed at the end of section 7, then the reviewer's,
                below. */}
            <dt>Preparer's sign-off</dt>
            <dd>
              {paper === null ? (
                "No design workpaper yet"
              ) : paper.status === "PREPARED" ? (
                <>
                  Signed by {paper.preparedBy || "a team member"}
                  {paper.preparedVersion !== null
                    ? ` · version ${paper.preparedVersion}`
                    : ""}
                </>
              ) : (
                "Not signed yet: the preparer signs at the end of section 7"
              )}{" "}
              <a href={conclusionHref(assessmentHref)}>Open section 7</a>
            </dd>
          </div>
          {/* The workpaper's review notes (docs/workpaper-review.md, section 6): how
              many are open and urgent, and the way to them. What holds the sign-off is
              the server's `blocking`, said below with the rest. */}
          <div>
            <dt>Review notes</dt>
            <dd>
              <ReviewNotesLine
                scope={
                  paper === null
                    ? null
                    : {
                        organizationId: ids.organizationId,
                        projectId: ids.projectId,
                        workpaperId: paper.id,
                      }
                }
                href={notesHref(assessmentHref)}
              />
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
              <dt>
                {conclusion.status === "SIGNED_OFF"
                  ? "Signed off"
                  : "Earlier sign-off"}
              </dt>
              <dd>
                {signed.signedBy || "A reviewer"} on{" "}
                {formatDate(signed.signedAt)}
                {/* The conclusion is said once, above; the sign-off names it only where
                    it signed another than the card says (the preparer's changed since,
                    or none stands now). */}
                {before36
                  ? ` · ${VERDICT_LABELS[signed.verdict]}`
                  : signed.conclusion !== null && signed.conclusion !== standing
                    ? ` · signed as “${CONCLUSION_WORDS[signed.conclusion]}”`
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
            <p>{outOfDateNext(conclusion)}</p>
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
          <input type="hidden" name="choice_id" value={choice?.id ?? ""} />
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
            {/* Off while the conclusion's text is read, and where it could not be: said
                beside it, and the button keeps its place in the tab order. */}
            <button
              type="submit"
              disabled={pending}
              aria-disabled={textHold !== "" ? "true" : undefined}
              aria-describedby={textHold !== "" ? signHoldId : undefined}
            >
              {pending && pressed === "sign"
                ? "Signing off…"
                : `Sign off: ${signable === null ? "" : CONCLUSION_WORDS[signable]}`}
            </button>
            {textHold !== "" ? (
              <span id={signHoldId} className="form-hint dc-sign-hold">
                {textHold}
                {text === false ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={retry}
                    >
                      Try again
                    </button>
                  </>
                ) : null}
              </span>
            ) : (
              <span className="form-hint">
                You sign the preparer's conclusion. A different one is theirs to
                record: reopen the design workpaper for them to change it.
              </span>
            )}
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
