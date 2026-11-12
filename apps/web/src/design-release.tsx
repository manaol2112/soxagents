"use client";

import Link from "next/link";
import { type ReactNode, useId, useState } from "react";
import {
  checkMark,
  earlyRelease,
  itemsHeading,
  type ReleaseView,
} from "./design-release-model";
import { useRelease } from "./phases-view";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string };

/**
 * The D&I Evidence step's one decision (product owner, 11 November 2026), in the frame's
 * decision row: the title and its one-line reason with the one action, then what the
 * release rests on as inline checks. Ready: Release. Not ready: the step that resolves it,
 * with an early release (and its recorded reason) in a quiet row on request. What will be
 * requested is the work area's (DesignReleaseItems). Success shows only once the server
 * has recorded the release; the page's data then refreshes in place.
 */
export function DesignReleaseCard({
  ids,
  controlId,
  view,
  canRelease,
  stepHrefs,
}: {
  ids: Ids;
  controlId: string;
  view: ReleaseView;
  canRelease: boolean;
  /** The address of each step's panel, by its key. */
  stepHrefs: Readonly<Record<string, string>>;
}) {
  const action = useRelease(ids);
  const titleId = useId();
  const reasonId = useId();
  const hintId = useId();
  const [released, setReleased] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  if (released) {
    return (
      <section className="dr is-done" role="status">
        <span className="dr-done-mark" aria-hidden="true">
          <UiIcon name="check" size={14} />
        </span>
        <div className="dr-text">
          <h3>D&amp;I evidence released</h3>
          <p>Its requests are drafted below, each waiting for approval.</p>
        </div>
      </section>
    );
  }
  if (view.mode === "hidden") {
    return null;
  }
  const ready = view.mode === "ready";
  const early = earlyRelease({
    mode: view.mode,
    canRelease,
    reason,
    pending: action.pending,
  });
  async function release(withReason: string) {
    const done = await action.run({
      intent: "phase-release",
      control_id: controlId,
      phase: "DESIGN",
      reason: withReason,
    });
    if (done.ok) {
      setReleased(true);
    }
  }
  return (
    <section
      className={`dr is-${view.mode}`}
      aria-labelledby={titleId}
      aria-busy={action.pending}
    >
      <div className="dr-row">
        <div className="dr-text">
          <h3 id={titleId}>{view.title}</h3>
          <p>{view.lead}</p>
        </div>
        <div className="dr-acts">
          {ready ? (
            canRelease ? (
              <button
                type="button"
                className="btn btn-primary"
                aria-describedby={titleId}
                disabled={action.pending}
                onClick={() => release("")}
              >
                {action.pending ? "Releasing…" : "Release"}
              </button>
            ) : null
          ) : view.resolve !== null ? (
            <Link
              className="btn btn-primary"
              href={stepHrefs[view.resolve.step] ?? "#"}
              scroll={false}
            >
              {view.resolve.label}
              <UiIcon name="arrow" size={14} />
            </Link>
          ) : null}
        </div>
      </div>

      <ul className="dr-checks" aria-label="What the release rests on">
        {view.checks.map((check) => {
          const mark = checkMark(check);
          return (
            <li
              key={check.key}
              className={`is-${mark.mark}`}
              title={check.detail !== "" ? check.detail : undefined}
            >
              <span className="dr-check" aria-hidden="true">
                {mark.mark === "done" ? (
                  <UiIcon name="check" size={13} />
                ) : null}
              </span>
              <span aria-hidden="true">{check.label}</span>
              <span className="sr-only">{mark.spoken}</span>
            </li>
          );
        })}
      </ul>

      {early.offered ? (
        <details
          className="dr-early"
          open={asking}
          onToggle={(event) => {
            const open = event.currentTarget.open;
            setAsking(open);
            if (!open) {
              setReason("");
            }
          }}
        >
          <summary>
            <span>
              <strong>{early.summary}</strong>
              <small>{early.line}</small>
            </span>
            <UiIcon name="chevron" size={13} />
          </summary>
          {asking ? (
            <div className="dr-reason" id={reasonId}>
              <label htmlFor={`${reasonId}-text`}>
                Why release it before it is ready?
              </label>
              <textarea
                id={`${reasonId}-text`}
                rows={2}
                maxLength={1000}
                value={reason}
                aria-describedby={hintId}
                // biome-ignore lint/a11y/noAutofocus: opened by the person's own click on "Release early instead"
                autoFocus
                onChange={(event) => setReason(event.target.value)}
              />
              <p className="dr-hint" id={hintId}>
                {early.hint}
              </p>
              <div className="dr-reason-acts">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={!early.enabled}
                  onClick={() => release(reason)}
                >
                  {action.pending ? "Releasing…" : "Release early"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setAsking(false);
                    setReason("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </details>
      ) : null}

      {canRelease ? null : (
        <p className="dr-note">
          An Owner, Admin or Project Manager releases the D&amp;I evidence.
        </p>
      )}
      {action.problem !== null ? (
        <p className="dr-problem" role="alert">
          {action.problem}
        </p>
      ) : null}
    </section>
  );
}

/**
 * What the D&I release will request (product owner, 11 November 2026), at the top of the
 * D&I Evidence step's work area: one list, each item with its kind, what it shows and the
 * attributes it evidences; then, as quiet rows on request, the attributes it is tested
 * against and the optional governing documents. Hidden once released: the requests list
 * takes over.
 */
export function DesignReleaseItems({
  view,
  owner,
  documents,
}: {
  view: ReleaseView;
  /** Who the requests go to (the control's owner), or "" when not known. */
  owner: string;
  /** The optional governing documents, folded: their one line and their setup. */
  documents?: { line: string; body: ReactNode };
}) {
  const titleId = useId();
  if (view.mode === "hidden") {
    return null;
  }
  const heading = itemsHeading(view, owner);
  return (
    <section className="dr-plan" aria-labelledby={titleId}>
      <header className="dr-plan-head">
        <h4 id={titleId} className="stp-section-title dr-section-title">
          {heading.title}
        </h4>
        {heading.note !== "" ? (
          <span className="dr-plan-note">{heading.note}</span>
        ) : null}
      </header>
      {view.items.length > 0 ? (
        <ul className="dr-items">
          {view.items.map((item) => (
            <li key={item.id}>
              <span className="dr-tile" aria-hidden="true">
                <UiIcon name={item.icon} size={16} />
              </span>
              <span className="dr-item-text">
                <strong>{item.title}</strong>
                <small>{item.line}</small>
              </span>
              {item.tests.length > 0 ? (
                <span
                  className="dr-tests"
                  title={`Evidences attribute${item.tests.length === 1 ? "" : "s"} ${item.tests.join(", ")}`}
                >
                  <span className="sr-only">Evidences attributes </span>
                  {item.tests.map((letter) => (
                    <span key={letter} className="dr-code">
                      {letter}
                    </span>
                  ))}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="dr-empty">
          No D&amp;I evidence is planned yet. The planner plans it from the
          understanding.
        </p>
      )}
      {view.attributes.length > 0 || documents !== undefined ? (
        <div className="dr-more">
          {view.attributes.length > 0 ? (
            <details className="dr-fold">
              <summary>
                <span>
                  <strong>
                    Tested against {view.attributes.length} attribute
                    {view.attributes.length === 1 ? "" : "s"}
                  </strong>
                  {view.sources !== "" ? (
                    <small>From {view.sources}</small>
                  ) : null}
                </span>
                <UiIcon name="chevron" size={13} />
              </summary>
              <ol className="dr-attrs">
                {view.attributes.map((item) => (
                  <li key={item.letter}>
                    <span className="dr-code">{item.letter}</span>
                    <span className="dr-attr-text">{item.text}</span>
                    <small>{item.source}</small>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
          {documents !== undefined ? (
            <details className="dr-fold">
              <summary>
                <span>
                  <strong>Governing documents</strong>
                  <small>{documents.line}</small>
                </span>
                <UiIcon name="chevron" size={13} />
              </summary>
              <div className="dr-fold-body">{documents.body}</div>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
