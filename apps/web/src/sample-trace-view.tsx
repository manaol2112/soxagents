"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { formatDate } from "./format";
import { DataTable } from "./population-table";
import {
  daysWords,
  parseTrace,
  type Trace,
  type TraceFile,
  traceHeading,
  traceProblem,
} from "./sample-trace-model";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };

/** An item's trace, read when its card shows and again when its files change; the latest
 * answer wins. */
export function useSampleTrace(
  ids: Ids,
  requirementId: string,
  on: boolean,
  filesKey: string,
): [Trace | null, (trace: Trace) => void, boolean] {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!on) {
      return;
    }
    let current = true;
    const query = new URLSearchParams({
      organization: ids.organizationId,
      project: ids.projectId,
      control: ids.controlId,
      requirement: requirementId,
      files: filesKey,
    });
    fetch(`/workspace/sample-trace?${query}`)
      .then((response) => response.json())
      .then((body: { status?: unknown; result?: unknown }) => {
        if (!current) {
          return;
        }
        const parsed = body.status === 200 ? parseTrace(body.result) : null;
        setTrace(parsed);
        setFailed(parsed === null);
      })
      .catch(() => {
        if (current) {
          setFailed(true);
        }
      });
    return () => {
      current = false;
    };
  }, [
    on,
    ids.organizationId,
    ids.projectId,
    ids.controlId,
    requirementId,
    filesKey,
  ]);
  return [trace, setTrace, failed];
}

const STATE_MARK: Record<
  TraceFile["state"],
  { icon: "check" | "risk" | "info"; tone: string }
> = {
  FOUND: { icon: "check", tone: "is-ok" },
  NAMED: { icon: "check", tone: "is-ok" },
  NOT_FOUND: { icon: "risk", tone: "is-warn" },
  SEVERAL: { icon: "risk", tone: "is-warn" },
  NOT_NAMED: { icon: "risk", tone: "is-warn" },
  GENERAL: { icon: "info", tone: "is-quiet" },
  READING: { icon: "info", tone: "is-quiet" },
  UNREADABLE: { icon: "risk", tone: "is-warn" },
};

const ROLE_WORDS: Record<string, string> = {
  EVENT: "Event",
  REMOVAL: "Removed",
  ACTIVITY: "Last activity",
  OPENED: "Opened",
  CLOSED: "Closed",
};

/**
 * The sample of one on a design item's card (product owner, 31 October 2026): the sample
 * the agent recognized in the evidence, with its reasons, to confirm or replace; the
 * likely samples to pick from when nothing settles it; and, once there is a sample, each
 * file's part in the trace with the dates against the event and the control's limit.
 * Confirming records the sample and raises what the trace observed as findings; it never
 * accepts the item.
 */
export function SampleTrace({
  ids,
  requirementId,
  trace,
  failed,
  canAct,
  onTrace,
}: {
  ids: Ids;
  requirementId: string;
  trace: Trace | null;
  failed: boolean;
  canAct: boolean;
  onTrace: (trace: Trace) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);

  if (failed) {
    return (
      <section className="st-card" aria-label="Sample trace">
        <p className="st-quiet">The sample trace could not be loaded.</p>
      </section>
    );
  }
  if (trace === null) {
    return (
      <section className="st-card is-loading" aria-label="Sample trace">
        <p className="st-quiet" role="status">
          <span className="spinner small" aria-hidden="true" />
          Tracing the sample across the files
        </p>
      </section>
    );
  }
  if (trace.status === "NO_LISTING" && trace.subject === null) {
    return null;
  }

  async function settle(
    key: string,
    fileId: string,
    rowNumber: number,
    proposed: boolean,
    success: string,
  ) {
    setBusy(key);
    setProblem(null);
    setDone(null);
    let status = 0;
    let detail = "";
    let result: unknown = null;
    try {
      const response = await fetch("/workspace/sample-trace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          control_id: ids.controlId,
          requirement_id: requirementId,
          file_id: fileId,
          row_number: rowNumber,
          proposed,
        }),
      });
      const body = (await response.json()) as {
        status?: unknown;
        detail?: unknown;
        result?: unknown;
      };
      status = typeof body.status === "number" ? body.status : 0;
      detail = typeof body.detail === "string" ? body.detail : "";
      result = body.result;
    } catch {
      status = 0;
    }
    setBusy(null);
    const parsed = status === 200 ? parseTrace(result) : null;
    if (parsed === null) {
      setProblem(traceProblem(status === 200 ? 0 : status, detail));
      return;
    }
    // Shown only once the server has recorded the sample; the findings it raised and the
    // item's pills come with the refresh.
    onTrace(parsed);
    setPicking(null);
    setDone(success);
    startTransition(() => router.refresh());
  }

  const subject = trace.subject;
  const raised = trace.observations.filter((each) => each.recorded).length;
  const listing = picking ?? trace.listings[0]?.fileId ?? null;

  return (
    <section
      className={`st-card is-${trace.status.toLowerCase()}${trace.ready ? " is-ready" : ""}`}
      aria-label="Sample trace"
    >
      <header className="st-head">
        <span className="st-mark" aria-hidden="true">
          <UiIcon
            name={trace.status === "CONFIRMED" ? "target" : "sparkles"}
            size={15}
          />
        </span>
        <span className="st-head-text">
          <strong>{traceHeading(trace)}</strong>
          {trace.status === "PROPOSED" ? (
            <small>Agent proposal · confirm before it is used</small>
          ) : trace.status === "CONFIRMED" && subject !== null ? (
            <small>
              {subject.origin === "CONFIRMED"
                ? "Proposed by the agent, confirmed"
                : "Picked"}
              {subject.confirmedBy ? ` by ${subject.confirmedBy}` : ""}
              {subject.confirmedAt
                ? ` on ${formatDate(subject.confirmedAt)}`
                : ""}
            </small>
          ) : trace.status === "CHOOSE" ? (
            <small>
              {trace.candidates.length > 0
                ? "The files name more than one. Pick the one this item walks through."
                : "No file names the sample. Pick it from the listing."}
            </small>
          ) : null}
        </span>
      </header>

      {done !== null ? (
        <p className="ep-done" role="status">
          <UiIcon name="check" size={14} />
          <span>{done}</span>
        </p>
      ) : null}

      {subject !== null ? (
        <div className="st-subject">
          <span className="st-avatar" aria-hidden="true">
            <UiIcon name={trace.noun === "ticket" ? "tag" : "user"} size={16} />
          </span>
          <span className="st-subject-text">
            <strong>{subject.label}</strong>
            <small>
              {subject.fileName}, row {subject.rowNumber}
            </small>
          </span>
          {canAct && trace.status === "PROPOSED" ? (
            <span className="st-subject-actions">
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy !== null}
                onClick={() =>
                  settle(
                    "confirm",
                    subject.fileId,
                    subject.rowNumber,
                    true,
                    `${subject.label} confirmed as the sample.`,
                  )
                }
              >
                {busy === "confirm" ? (
                  <span className="spinner small" aria-hidden="true" />
                ) : (
                  <UiIcon name="check" size={14} />
                )}
                {busy === "confirm" ? "Confirming…" : "Confirm sample"}
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busy !== null}
                onClick={() => setPicking(listing)}
              >
                Pick another
              </button>
            </span>
          ) : canAct && trace.status === "CONFIRMED" && picking === null ? (
            <button
              type="button"
              className="btn-ghost btn-sm st-change"
              onClick={() => setPicking(listing)}
            >
              Change
            </button>
          ) : null}
        </div>
      ) : null}

      {trace.status === "PROPOSED" && trace.reasons.length > 0 ? (
        <ul className="st-reasons">
          {trace.reasons.slice(0, 3).map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {trace.status === "CHOOSE" && trace.candidates.length > 0 ? (
        <ul className="st-candidates">
          {trace.candidates.map((candidate) => (
            <li key={`${candidate.fileId}-${candidate.rowNumber}`}>
              <span>
                <strong>{candidate.label}</strong>
                <small>
                  {candidate.reason ||
                    `${candidate.fileName}, row ${candidate.rowNumber}`}
                </small>
              </span>
              {canAct ? (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={busy !== null}
                  onClick={() =>
                    settle(
                      `pick-${candidate.rowNumber}`,
                      candidate.fileId,
                      candidate.rowNumber,
                      false,
                      `${candidate.label} recorded as the sample.`,
                    )
                  }
                >
                  {busy === `pick-${candidate.rowNumber}` ? (
                    <span className="spinner small" aria-hidden="true" />
                  ) : null}
                  This one
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canAct &&
      trace.status === "CHOOSE" &&
      picking === null &&
      listing !== null ? (
        <button
          type="button"
          className="btn-ghost btn-sm st-search"
          onClick={() => setPicking(listing)}
        >
          <UiIcon name="search" size={14} />
          Search the listing
        </button>
      ) : null}

      {canAct && picking !== null ? (
        <div className="st-picker">
          {trace.listings.length > 1 ? (
            <label className="st-picker-file">
              <span>Listing</span>
              <select
                value={picking}
                onChange={(event) => setPicking(event.target.value)}
              >
                {trace.listings.map((each) => (
                  <option key={each.fileId} value={each.fileId}>
                    {each.fileName} ({each.rows.toLocaleString()} rows)
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <DataTable
            key={picking}
            ids={ids}
            fileId={picking}
            picking
            chosenRow={null}
            busy={busy !== null}
            onPick={(row) =>
              settle(
                "pick",
                picking,
                row,
                false,
                `Row ${row} recorded as the sample.`,
              )
            }
            onCancel={() => setPicking(null)}
          />
        </div>
      ) : null}

      {problem !== null ? (
        <p className="change-problem" role="alert">
          {problem}
        </p>
      ) : null}

      {subject !== null && trace.files.length > 0 ? (
        <ol className="st-files">
          {trace.files.map((file) => {
            // A file whose date runs over the limit is a point, whatever else it shows.
            const mark = file.dates.some((when) => when.over)
              ? STATE_MARK.NOT_FOUND
              : STATE_MARK[file.state];
            return (
              <li key={file.fileId} className={mark.tone}>
                <span className="st-file-mark" aria-hidden="true">
                  <UiIcon name={mark.icon} size={13} />
                </span>
                <span className="st-file-text">
                  <strong title={file.fileName}>
                    {file.system || file.fileName}
                  </strong>
                  <small>
                    {file.system ? `${file.fileName} · ` : ""}
                    {file.summary}
                  </small>
                  {file.dates.length > 0 ? (
                    <span className="st-dates">
                      {file.dates.map((when) => (
                        <span
                          key={`${when.label}-${when.date}`}
                          className={`st-date${when.over ? " is-over" : ""}`}
                        >
                          <em>{when.label || ROLE_WORDS[when.role]}</em>{" "}
                          {formatDate(when.date)}
                          {when.role !== "EVENT" && when.days !== null ? (
                            <small>
                              {" "}
                              · {daysWords(when.days)}
                              {when.over && trace.limitDays !== null
                                ? ` (limit ${trace.limitDays})`
                                : ""}
                            </small>
                          ) : null}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}

      {subject !== null && trace.observations.length > 0 ? (
        <div className="st-points">
          <p className="st-points-title">
            {trace.observations.length} point
            {trace.observations.length === 1 ? "" : "s"} to settle
            <small>
              {trace.status === "CONFIRMED"
                ? raised === trace.observations.length
                  ? " · raised as findings with a drafted follow-up"
                  : ` · ${raised} raised as findings`
                : " · raised as findings when the sample is confirmed"}
            </small>
          </p>
          <ul>
            {trace.observations.map((observation) => (
              <li key={`${observation.kind}-${observation.fileId}`}>
                {observation.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {trace.ready ? (
        <p className="st-ready">
          <UiIcon name="check" size={14} />
          Every file traces the sample within the limit. Accept the item once
          nothing else it asks for is missing.
        </p>
      ) : null}
    </section>
  );
}
