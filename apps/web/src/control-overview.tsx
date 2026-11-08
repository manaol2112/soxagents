"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import type { RailAction } from "./control-rail-model";
import {
  ATTRIBUTE_STATUS_LABELS,
  type AttributeLine,
  FILE_STATUS_LABELS,
  type FileStatus,
  PHASE_TAGS,
  phaseCounts,
} from "./control-tabs-model";
import { FileBadge } from "./file-badge";
import { formatBytes } from "./format";
import { UiIcon } from "./ui-icon";

export type OverviewFile = {
  id: string;
  name: string;
  kind: string;
  sizeBytes: number;
  status: FileStatus;
  href: string;
};

/** The activities shown before View all. */
const FIRST_ACTIVITIES = 5;

/**
 * A control's Overview tab, laid out as the product owner's reference (2 November
 * 2026): the next action when it is the viewer's, the control in one row, its activities
 * by phase, each attribute's evidence state, its evidence, and the agent's insight, whose
 * row opens the viewer's next actions and the agent's note. Everything here is read from
 * the records; each part opens the tab where it is worked.
 */
export function ControlOverview({
  next,
  notes,
  summary,
  attributes,
  attributesHref,
  procedures,
  proceduresHref,
  files,
  evidenceHref,
  insight,
  insightTone = "neutral",
  actions,
  askHref,
}: {
  /** The viewer's next action, when there is one. */
  next: { title: string; detail: string; href: string; button: string } | null;
  /** The agent's note and what is outstanding, under the insight. */
  notes: ReactNode;
  summary: {
    objective: string;
    type: string;
    frequency: string;
    owner: string;
    keyControl: boolean;
    editHref: string | null;
  };
  attributes: AttributeLine[];
  attributesHref: string;
  procedures: ReadonlyArray<{ code: string; text: string; phase: string }>;
  /** Where the procedures are read and edited: the test plan. */
  proceduresHref: string;
  files: OverviewFile[];
  evidenceHref: string;
  insight: string;
  insightTone?: "good" | "warn" | "neutral";
  actions: RailAction[];
  askHref: string;
}) {
  const phases = phaseCounts(procedures);
  const [phase, setPhase] = useState<string | null>(phases[0]?.phase ?? null);
  const [all, setAll] = useState(false);
  const [details, setDetails] = useState(false);
  const inPhase = procedures.filter(
    (item) => phase === null || item.phase === phase,
  );
  const listed = all ? inPhase : inPhase.slice(0, FIRST_ACTIVITIES);
  return (
    <div className="ov">
      {next !== null ? (
        <section className="ov-next" aria-labelledby="ov-next-label">
          <UiIcon name="sparkles" size={22} />
          <span id="ov-next-label" className="ov-next-label">
            Next action
          </span>
          <strong className="ov-next-title">{next.title}</strong>
          {next.detail !== "" ? (
            <span className="ov-next-detail">{next.detail}</span>
          ) : null}
          <a className="btn ov-next-go" href={next.href}>
            {next.button}
            <UiIcon name="arrow" size={14} />
          </a>
        </section>
      ) : null}

      <div className="ov-grid">
        <div className="ov-col">
          <section className="ov-card" aria-labelledby="ov-summary">
            <header className="ov-head">
              <h2 id="ov-summary">
                <UiIcon name="layers" size={20} />
                Control summary
              </h2>
              {summary.editHref !== null ? (
                <a className="btn-secondary btn-sm" href={summary.editHref}>
                  <UiIcon name="compose" size={13} />
                  Edit
                </a>
              ) : null}
            </header>
            <dl className="ov-summary">
              <div className="ov-summary-objective">
                <dt>Control objective</dt>
                <dd>
                  {summary.objective !== ""
                    ? summary.objective
                    : "Not recorded yet. The planning agent drafts it with the test plan."}
                </dd>
              </div>
              <div>
                <dt>Control type</dt>
                <dd>
                  <span className="ov-chip is-blue">{summary.type || "—"}</span>
                </dd>
              </div>
              <div>
                <dt>Frequency</dt>
                <dd>
                  <span className="ov-chip is-blue">
                    {summary.frequency || "—"}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Control owner</dt>
                <dd className="ov-plain">{summary.owner || "Not assigned"}</dd>
              </div>
              <div>
                <dt>Key control</dt>
                <dd>
                  <span
                    className={`ov-chip ${summary.keyControl ? "is-blue" : "is-quiet"}`}
                  >
                    {summary.keyControl ? "Yes" : "No"}
                  </span>
                </dd>
              </div>
            </dl>
          </section>

          <section className="ov-card" aria-labelledby="ov-activities">
            <header className="ov-head">
              <h2 id="ov-activities">
                <UiIcon name="list" size={20} />
                Control activities ({procedures.length})
              </h2>
              {phases.length > 1 ? (
                <fieldset className="ov-phases">
                  <legend className="sr-only">
                    Show activities for a phase
                  </legend>
                  {phases.map((entry) => (
                    <button
                      key={entry.phase}
                      type="button"
                      className={phase === entry.phase ? "is-on" : undefined}
                      aria-pressed={phase === entry.phase}
                      onClick={() => {
                        setPhase(entry.phase);
                        setAll(false);
                      }}
                    >
                      {PHASE_TAGS[entry.phase] ?? entry.phase} ({entry.count})
                    </button>
                  ))}
                </fieldset>
              ) : null}
            </header>
            {procedures.length === 0 ? (
              <p className="ov-empty">
                No test procedures yet. They come with the test plan on Design
                &amp; Implementation.
              </p>
            ) : (
              <ol className="ov-rows">
                {listed.map((item, index) => (
                  <li key={item.code || index}>
                    <span className="ov-num">{index + 1}</span>
                    <span className="ov-row-text">{item.text}</span>
                    <Link
                      className="ov-row-open"
                      href={proceduresHref}
                      scroll={false}
                      aria-label={`Open activity ${index + 1} in the test plan`}
                    >
                      <UiIcon name="chevron" size={14} />
                    </Link>
                  </li>
                ))}
              </ol>
            )}
            {procedures.length > FIRST_ACTIVITIES ? (
              all ? (
                <button
                  type="button"
                  className="ov-link ov-more ov-details"
                  onClick={() => {
                    setAll(false);
                    setPhase(phases[0]?.phase ?? null);
                  }}
                >
                  Show fewer
                </button>
              ) : (
                <button
                  type="button"
                  className="ov-link ov-more ov-details"
                  onClick={() => {
                    setAll(true);
                    setPhase(null);
                  }}
                >
                  View all {procedures.length} activities
                  <UiIcon name="arrow" size={14} />
                </button>
              )
            ) : null}
          </section>
        </div>

        <div className="ov-col">
          <section className="ov-card" aria-labelledby="ov-attributes">
            <header className="ov-head">
              <h2 id="ov-attributes">
                <UiIcon name="file" size={20} />
                Control attributes ({attributes.length})
              </h2>
              <Link className="ov-link" href={attributesHref} scroll={false}>
                View all
              </Link>
            </header>
            {attributes.length === 0 ? (
              <p className="ov-empty">
                No attributes yet. The planning agent proposes them with the
                test plan.
              </p>
            ) : (
              <ul className="ov-attrs">
                {attributes.map((line) => (
                  <li key={line.code}>
                    <span className="ov-code">{line.code}</span>
                    <span className="ov-attr-text">{line.text}</span>
                    <span
                      className={`ov-status is-${line.status.toLowerCase()}`}
                    >
                      <UiIcon
                        name={
                          line.status === "READY"
                            ? "check"
                            : line.status === "EXCEPTION"
                              ? "risk"
                              : "clock"
                        }
                        size={12}
                      />
                      {ATTRIBUTE_STATUS_LABELS[line.status]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ov-card" aria-labelledby="ov-evidence">
            <header className="ov-head">
              <h2 id="ov-evidence">
                <UiIcon name="file" size={20} />
                Evidence ({files.length})
              </h2>
              <Link className="ov-link" href={evidenceHref} scroll={false}>
                View all
              </Link>
            </header>
            {files.length === 0 ? (
              <p className="ov-empty">No evidence received yet.</p>
            ) : (
              <ul className="ov-files">
                {files.slice(0, 4).map((file) => (
                  <li key={file.id}>
                    <FileBadge name={file.name} />
                    <span className="ov-file-text">
                      <Link
                        className="ov-file-name"
                        href={file.href}
                        scroll={false}
                        title={file.name}
                      >
                        {file.name}
                      </Link>
                      <small>
                        {[
                          file.kind,
                          file.sizeBytes > 0 ? formatBytes(file.sizeBytes) : "",
                        ]
                          .filter((part) => part !== "")
                          .join(" · ")}
                      </small>
                    </span>
                    <span
                      className={`ov-status is-${file.status.toLowerCase()}`}
                    >
                      <UiIcon
                        name={file.status === "VERIFIED" ? "check" : "target"}
                        size={12}
                      />
                      {FILE_STATUS_LABELS[file.status]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {files.length > 4 ? (
              <Link
                className="ov-link ov-more"
                href={evidenceHref}
                scroll={false}
              >
                {files.length - 4} more on Evidence
              </Link>
            ) : null}
          </section>

          <section
            className="ov-card ov-insights"
            aria-labelledby="ov-insights"
          >
            <header className="ov-head">
              <h2 id="ov-insights">
                <UiIcon name="sparkles" size={20} />
                AI insights
              </h2>
              <a className="ov-link" href={askHref}>
                Ask the agent
              </a>
            </header>
            <button
              type="button"
              className={`ov-insight-row is-${insightTone}`}
              aria-expanded={details}
              aria-controls="ov-insight-details"
              onClick={() => setDetails((now) => !now)}
            >
              <UiIcon
                name={
                  insightTone === "good"
                    ? "check"
                    : insightTone === "warn"
                      ? "risk"
                      : "info"
                }
                size={16}
              />
              <span>
                {insight !== ""
                  ? insight
                  : "Nothing waits on you for this control."}
              </span>
              <UiIcon name="chevron" size={16} />
            </button>
            {details ? (
              <div id="ov-insight-details" className="ov-insight-details">
                {actions.length > 0 ? (
                  <ul className="ov-actions">
                    {actions.slice(0, 4).map((action) => (
                      <li key={action.key}>
                        <a href={action.href}>
                          <span>
                            <strong>{action.label}</strong>
                            {action.detail !== "" ? (
                              <small>{action.detail}</small>
                            ) : null}
                          </span>
                          <UiIcon name="arrow" size={13} />
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ov-empty">
                    Nothing waits on you for this control.
                  </p>
                )}
                {notes}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
