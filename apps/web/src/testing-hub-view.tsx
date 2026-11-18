"use client";

import { type ReactNode, useMemo, useState } from "react";
import type { EngagementState } from "./engagement-model";
import type { PlanningPageState } from "./load-planning";
import { PlanningPage } from "./planning-view";
import {
  filterResults,
  filterReviews,
  nextWords,
  PLANNING_TAB_LABELS,
  PLANNING_TABS,
  type PlanningTab,
  parseResultFilter,
  parseReviewFilter,
  phaseWords,
  planningTabHref,
  RESULT_FILTER_LABELS,
  RESULT_FILTERS,
  REVIEW_FILTER_LABELS,
  REVIEW_FILTERS,
  type ResultFilter,
  type ResultRow,
  type ReviewFilter,
  type ReviewRow,
  resultCounts,
  resultRows,
  reviewRows,
  testingHref,
  VIEW_NOTES,
} from "./testing-hub-model";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string };

/** A destination's header: the engagement, its title, what it is for, and its tabs. */
function DestinationHeader({
  projectName,
  title,
  note,
  tabs = null,
}: {
  projectName: string;
  title: string;
  note: string;
  tabs?: ReactNode;
}) {
  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-context">{projectName}</p>
          <div className="page-title">
            <h1>{title}</h1>
          </div>
          <p className="page-desc">{note}</p>
        </div>
      </header>
      {tabs}
    </>
  );
}

/**
 * Planning (decided by the product owner on 25 October 2026, the audit's third step): each
 * control's test plan prepared by the agent and approved by a person, and the release by
 * phase.
 */
export function PlanningDestination({
  ids,
  projectName,
  tab,
  planning,
}: {
  ids: Ids;
  projectName: string;
  tab: PlanningTab;
  planning: PlanningPageState | null;
}) {
  const header = (
    <DestinationHeader
      projectName={projectName}
      title="Planning"
      note={PLANNING_NOTES[tab]}
      tabs={
        <nav className="tv-tabs" aria-label="Planning views">
          {PLANNING_TABS.map((item) => (
            <a
              key={item}
              href={planningTabHref(ids.organizationId, ids.projectId, item)}
              aria-current={item === tab ? "page" : undefined}
            >
              {PLANNING_TAB_LABELS[item]}
            </a>
          ))}
        </nav>
      }
    />
  );
  return (
    <PlanningPage
      ids={{ ...ids, section: "planning" }}
      projectName={projectName}
      state={planning}
      header={header}
    />
  );
}

const PLANNING_NOTES: Record<PlanningTab, string> = {
  plans: VIEW_NOTES.plans,
  phases: VIEW_NOTES.phases,
};

/** Testing (the audit's fifth step): where each control's testing stands, with its
 * result and the step that moves it. */
export function TestingPage({
  ids,
  projectName,
  engagement,
  filter,
}: {
  ids: Ids;
  projectName: string;
  engagement: EngagementState;
  /** The results filter from the address (?filter=). */
  filter: string | null;
}) {
  const results = useMemo(
    () =>
      resultRows({
        controls: engagement.controls,
        sheets: engagement.sheets,
        rounds: engagement.rounds,
        automation: engagement.automation ?? null,
        organizationId: ids.organizationId,
        projectId: ids.projectId,
      }),
    [engagement, ids.organizationId, ids.projectId],
  );
  return (
    <div className="page pl-page">
      <DestinationHeader
        projectName={projectName}
        title="Testing"
        note={VIEW_NOTES.results}
      />
      <ResultsView
        ids={ids}
        rows={results}
        loaded={engagement.controls !== null}
        filter={parseResultFilter(filter)}
      />
    </div>
  );
}

/** Review (the audit's last step): the independent reviews, their notes,
 * re-performance and sign-off. */
export function ReviewPage({
  ids,
  projectName,
  engagement,
  filter,
}: {
  ids: Ids;
  projectName: string;
  engagement: EngagementState;
  /** The review filter from the address (?filter=). */
  filter: string | null;
}) {
  const reviews = useMemo(
    () =>
      reviewRows({
        reviews: engagement.reviews,
        queue: engagement.work ?? null,
        organizationId: ids.organizationId,
        projectId: ids.projectId,
      }),
    [engagement, ids.organizationId, ids.projectId],
  );
  return (
    <div className="page pl-page">
      <DestinationHeader
        projectName={projectName}
        title="Review"
        note={VIEW_NOTES.review}
      />
      <ReviewView
        ids={ids}
        rows={reviews}
        loaded={engagement.reviews !== null}
        filter={parseReviewFilter(filter)}
      />
    </div>
  );
}

function Tone({ tone, children }: { tone: string; children: string }) {
  return <span className={`pill tone-${tone}`}>{children}</span>;
}

function ResultsView({
  ids,
  rows,
  loaded,
  filter,
}: {
  ids: Ids;
  rows: ResultRow[];
  loaded: boolean;
  filter: ResultFilter;
}) {
  const [search, setSearch] = useState("");
  const counts = resultCounts(rows);
  const shown = filterResults(rows, filter, search);
  if (!loaded) {
    return (
      <section className="card pl-empty">
        <h2>The controls could not be loaded</h2>
        <p>Wait a moment and refresh the page.</p>
      </section>
    );
  }
  return (
    <section className="card">
      <div className="tv-bar">
        <nav className="tv-chips" aria-label="Filter the results">
          {RESULT_FILTERS.map((key) => (
            <a
              key={key}
              href={testingHref(ids.organizationId, ids.projectId, "results", {
                filter: key === "all" ? "" : key,
              })}
              aria-current={key === filter ? "true" : undefined}
            >
              {RESULT_FILTER_LABELS[key]} <small>{counts[key]}</small>
            </a>
          ))}
        </nav>
        <input
          className="input tv-search"
          type="search"
          placeholder="Find a control"
          aria-label="Find a control"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {shown.length === 0 ? (
        <p className="tv-empty">No controls match.</p>
      ) : (
        <div className="tv-wrap">
          <table className="pl-table tv-table">
            <thead>
              <tr>
                <th scope="col">Control</th>
                <th scope="col">Testing</th>
                <th scope="col">Phase</th>
                <th scope="col">Result</th>
                <th scope="col">Next step</th>
                <th scope="col">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.controlId}>
                  <td>
                    <a className="tv-control" href={row.href}>
                      {row.controlRef}
                    </a>
                    <span className="tv-sub">{row.label}</span>
                  </td>
                  <td>
                    <Tone tone={row.tone}>{row.stateLabel}</Tone>
                  </td>
                  <td>{phaseWords(row.phase)}</td>
                  <td>
                    {row.result === "NOT_CONCLUDED"
                      ? "Not concluded"
                      : row.result === "EFFECTIVE"
                        ? `Effective${row.final ? " · final" : ""}`
                        : `Exceptions${row.final ? " · final" : ""}`}
                    {row.exceptions > 0 ? (
                      <span className="tv-sub">
                        {row.exceptions} exception
                        {row.exceptions === 1 ? "" : "s"} in the results
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span className="tv-next">{row.next || "—"}</span>
                    {row.next === "" ? null : (
                      <span className={`tv-sub ${row.yours ? "tv-mine" : ""}`}>
                        {nextWords(row)}
                      </span>
                    )}
                  </td>
                  <td>
                    <a
                      className="btn btn-sm btn-secondary"
                      href={row.href}
                      aria-label={`Open ${row.controlRef} in the control workspace`}
                    >
                      Open <UiIcon name="arrow" size={13} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shown.length === 0 ? null : (
        <ul className="tv-cards" aria-label="Results">
          {shown.map((row) => (
            <li key={row.controlId} className="tv-card">
              <div className="tv-card-head">
                <a className="tv-control" href={row.href}>
                  {row.controlRef}
                </a>
                <Tone tone={row.tone}>{row.stateLabel}</Tone>
              </div>
              <span className="tv-sub">{row.label}</span>
              {row.next === "" ? null : (
                <p className="tv-card-next">
                  {row.next}
                  <span className={`tv-sub ${row.yours ? "tv-mine" : ""}`}>
                    {nextWords(row)}
                  </span>
                </p>
              )}
              <div className="tv-card-foot">
                <details className="tv-more">
                  <summary>Details</summary>
                  <dl>
                    <dt>Phase</dt>
                    <dd>{phaseWords(row.phase)}</dd>
                    <dt>Result</dt>
                    <dd>
                      {row.result === "NOT_CONCLUDED"
                        ? "Not concluded"
                        : row.result === "EFFECTIVE"
                          ? `Effective${row.final ? " · final" : ""}`
                          : `Exceptions${row.final ? " · final" : ""}`}
                      {row.exceptions > 0
                        ? ` · ${row.exceptions} exception${row.exceptions === 1 ? "" : "s"} in the results`
                        : ""}
                    </dd>
                  </dl>
                </details>
                <a className="btn btn-sm btn-secondary" href={row.href}>
                  Open <UiIcon name="arrow" size={13} />
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReviewView({
  ids,
  rows,
  loaded,
  filter,
}: {
  ids: Ids;
  rows: ReviewRow[];
  loaded: boolean;
  filter: ReviewFilter;
}) {
  const [search, setSearch] = useState("");
  const shown = filterReviews(rows, filter, search);
  if (!loaded) {
    return (
      <section className="card pl-empty">
        <h2>The reviews could not be loaded</h2>
        <p>Wait a moment and refresh the page.</p>
      </section>
    );
  }
  return (
    <section className="card">
      <div className="tv-bar">
        <nav className="tv-chips" aria-label="Filter the reviews">
          {REVIEW_FILTERS.map((key) => (
            <a
              key={key}
              href={testingHref(ids.organizationId, ids.projectId, "review", {
                filter: key === "open" ? "" : key,
              })}
              aria-current={key === filter ? "true" : undefined}
            >
              {REVIEW_FILTER_LABELS[key]}{" "}
              <small>{filterReviews(rows, key).length}</small>
            </a>
          ))}
        </nav>
        <input
          className="input tv-search"
          type="search"
          placeholder="Find a control"
          aria-label="Find a control"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {shown.length === 0 ? (
        <p className="tv-empty">
          {rows.length === 0
            ? "No independent review has opened yet: one opens when a control's testing is signed off."
            : "No reviews match."}
        </p>
      ) : (
        <div className="tv-wrap">
          <table className="pl-table tv-table">
            <thead>
              <tr>
                <th scope="col">Control</th>
                <th scope="col">Review</th>
                <th scope="col">Round</th>
                <th scope="col">Notes open</th>
                <th scope="col">Next step</th>
                <th scope="col">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.reviewId}>
                  <td>
                    <a className="tv-control" href={row.href}>
                      {row.controlRef}
                    </a>
                    <span className="tv-sub">{row.label}</span>
                  </td>
                  <td>
                    <Tone tone={row.tone}>{row.stage}</Tone>
                    {row.status === "SIGNED_OFF" && row.signedBy !== null ? (
                      <span className="tv-sub">
                        By {row.signedBy}
                        {row.signedAt === null
                          ? ""
                          : ` on ${row.signedAt.slice(0, 10)}`}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {row.round === null ? "Interim" : phaseWords(row.round)}
                  </td>
                  <td>{row.openNotes}</td>
                  <td>
                    <span className="tv-next">{row.next || "—"}</span>
                    {row.next === "" ? null : (
                      <span className={`tv-sub ${row.mine ? "tv-mine" : ""}`}>
                        {row.owner}
                      </span>
                    )}
                  </td>
                  <td>
                    <a
                      className="btn btn-sm btn-secondary"
                      href={row.href}
                      aria-label={`Open the review of ${row.controlRef}`}
                    >
                      Open <UiIcon name="arrow" size={13} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shown.length === 0 ? null : (
        <ul className="tv-cards" aria-label="Reviews">
          {shown.map((row) => (
            <li key={row.reviewId} className="tv-card">
              <div className="tv-card-head">
                <a className="tv-control" href={row.href}>
                  {row.controlRef}
                </a>
                <Tone tone={row.tone}>{row.stage}</Tone>
              </div>
              <span className="tv-sub">{row.label}</span>
              {row.next === "" ? null : (
                <p className="tv-card-next">
                  {row.next}
                  <span className={`tv-sub ${row.mine ? "tv-mine" : ""}`}>
                    {row.owner}
                  </span>
                </p>
              )}
              <div className="tv-card-foot">
                <details className="tv-more">
                  <summary>Details</summary>
                  <dl>
                    <dt>Round</dt>
                    <dd>
                      {row.round === null ? "Interim" : phaseWords(row.round)}
                    </dd>
                    <dt>Notes open</dt>
                    <dd>{row.openNotes}</dd>
                    {row.status === "SIGNED_OFF" && row.signedBy !== null ? (
                      <>
                        <dt>Signed off</dt>
                        <dd>
                          By {row.signedBy}
                          {row.signedAt === null
                            ? ""
                            : ` on ${row.signedAt.slice(0, 10)}`}
                        </dd>
                      </>
                    ) : null}
                  </dl>
                </details>
                <a className="btn btn-sm btn-secondary" href={row.href}>
                  Open <UiIcon name="arrow" size={13} />
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
