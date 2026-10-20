"use client";

import { useMemo, useState } from "react";
import type { EngagementState } from "./engagement-model";
import type { PlanningPageState } from "./load-planning";
import { PlanningPage } from "./planning-view";
import {
  filterResults,
  filterReviews,
  nextWords,
  parseResultFilter,
  parseReviewFilter,
  phaseWords,
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
  TESTING_VIEWS,
  type TestingView,
  testingCounts,
  testingHref,
  VIEW_LABELS,
  VIEW_NOTES,
} from "./testing-hub-model";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string };

/** The Testing destination (M2b): Plans, Phases, Results and Review across every
 * control, each opening the guided control workspace for the detail. */
export function TestingPage({
  ids,
  projectName,
  view,
  planning,
  engagement,
  filter,
}: {
  ids: Ids;
  projectName: string;
  view: TestingView;
  planning: PlanningPageState | null;
  engagement: EngagementState;
  /** The results or review filter from the address (?filter=). */
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
  const counts = testingCounts({ results, reviews });
  const header = (
    <>
      <header className="page-header">
        <div>
          <p className="page-context">{projectName}</p>
          <div className="page-title">
            <h1>Testing</h1>
          </div>
          <p className="page-desc">{VIEW_NOTES[view]}</p>
        </div>
      </header>
      <nav className="tv-tabs" aria-label="Testing views">
        {TESTING_VIEWS.map((item) => (
          <a
            key={item}
            href={testingHref(ids.organizationId, ids.projectId, item)}
            aria-current={item === view ? "page" : undefined}
          >
            {VIEW_LABELS[item]}
            {item === "results" && engagement.controls !== null ? (
              <small>{counts.results}</small>
            ) : item === "review" && engagement.reviews !== null ? (
              <small>{counts.review}</small>
            ) : null}
          </a>
        ))}
      </nav>
    </>
  );
  if (view === "plans" || view === "phases") {
    return (
      <PlanningPage
        ids={{ ...ids, section: "testing" }}
        projectName={projectName}
        state={planning}
        header={header}
      />
    );
  }
  return (
    <div className="page pl-page">
      {header}
      {view === "results" ? (
        <ResultsView
          ids={ids}
          rows={results}
          loaded={engagement.controls !== null}
          filter={parseResultFilter(filter)}
        />
      ) : (
        <ReviewView
          ids={ids}
          rows={reviews}
          loaded={engagement.reviews !== null}
          filter={parseReviewFilter(filter)}
        />
      )}
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
    </section>
  );
}
