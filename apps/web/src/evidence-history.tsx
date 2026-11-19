"use client";

import { useEffect, useRef, useState } from "react";
import {
  type FileHistoryBody,
  fileHistory,
  type HistoryLine,
  historyDates,
  historyHref,
  historyLines,
  historyReadHref,
  parseFileHistory,
} from "./evidence-impact-model";
import type { WithdrawnFile } from "./evidence-model";

type Ids = { organizationId: string; projectId: string };

type Read =
  | { status: "loading" }
  | { status: "ready"; body: FileHistoryBody }
  | { status: "failed" };

/** The file's history from the server, read once the section is shown (never on page
 * load), and kept while the viewer stays on the file; an answer for another file is
 * dropped. Null until it is asked for. */
function useFileHistory(
  ids: Ids,
  fileId: string,
  shown: boolean,
): { read: Read | null; retry: () => void } {
  const [read, setRead] = useState<{ fileId: string; read: Read } | null>(null);
  // A person's "Try again": a new attempt for the same file.
  const [attempt, setAttempt] = useState(0);
  // The read under way or done, by file and attempt: the effect depends only on what
  // asks for a read, never on the read's own state (18 November 2026: it listed whether
  // the file was known, so setting the loading state aborted its own request).
  const started = useRef("");
  const { organizationId, projectId } = ids;
  useEffect(() => {
    if (!shown) {
      return;
    }
    const key = `${fileId}:${attempt}`;
    if (started.current === key) {
      return;
    }
    started.current = key;
    const abort = new AbortController();
    let finished = false;
    setRead({ fileId, read: { status: "loading" } });
    void (async () => {
      let next: Read = { status: "failed" };
      try {
        const response = await fetch(
          historyReadHref({ organizationId, projectId }, fileId),
          { cache: "no-store", signal: abort.signal },
        );
        const body = (await response.json()) as { history?: unknown };
        const history = parseFileHistory(body.history);
        if (history !== null && history.fileId === fileId) {
          next = { status: "ready", body: history };
        }
      } catch {
        next = { status: "failed" };
      }
      // The last ask's answer only: one for another file or attempt is dropped.
      if (!abort.signal.aborted) {
        finished = true;
        setRead({ fileId, read: next });
      }
    })();
    return () => {
      abort.abort();
      // Left before its answer (another file, or the effect run again): asked again.
      if (!finished && started.current === key) {
        started.current = "";
      }
    };
  }, [shown, attempt, fileId, organizationId, projectId]);
  return {
    read: read !== null && read.fileId === fileId ? read.read : null,
    // The section, still shown, reads it again.
    retry: () => setAttempt((value) => value + 1),
  };
}

function Lines({ ids, lines }: { ids: Ids; lines: readonly HistoryLine[] }) {
  const dates = historyDates(lines);
  return (
    <ol className="ea-history" aria-label="The file's history, oldest first">
      {lines.map((line, index) => (
        <li key={line.key}>
          <span className="ea-history-what">
            <strong>{line.label}</strong>
            {line.item !== null ? <> {line.item}</> : null}
            {line.file !== null && line.relation === null ? (
              <>
                {" "}
                <a
                  className="text-link is-plain"
                  href={historyHref(ids, line.file)}
                >
                  {line.file.name}
                </a>
              </>
            ) : null}
          </span>
          <small>
            {/* One date rule on the screen: a file's dates as its facts, the Evidence
                Library and the Withdrawn list say them (formatDate, the UTC date),
                never the browser's local time beside them, with the UTC time where two
                lines share a date (18 November 2026). */}
            <time dateTime={line.at}>{dates[index]}</time>
          </small>
          {/* Who, on a line of its own: an address breaks only between its words, never
              mid-word beside the date (E1 design review, round 5). */}
          {line.by !== "" ? (
            <small className="ea-history-by">by {line.by}</small>
          ) : null}
          {line.file !== null && line.relation !== null ? (
            <small className="ea-history-version">
              {line.relation}{" "}
              <a
                className="text-link is-plain"
                href={historyHref(ids, line.file)}
              >
                {line.file.name}
              </a>
            </small>
          ) : null}
          {line.why !== null ? (
            <small className="ea-history-why">{line.why}</small>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * A file's history in the viewer (E1): how it came in and the version it replaced, each
 * withdrawal and restoration in order with who, when and why, what replaced it, and each
 * link to an evidence item and its removal; the other versions linked to where they are
 * kept. Read from the server when the section is shown; while it is read, a line says so,
 * and should it fail, what the register holds is shown with a line saying it is partial.
 */
export function FileHistory({
  ids,
  file,
  shown,
  withdrawn,
  source,
}: {
  ids: Ids;
  file: { id: string; createdAt: string | null; addedBy: string };
  /** The section is open: the history is read. */
  shown: boolean;
  /** The register's withdrawn files: the fallback's source, and where a version is. */
  withdrawn: readonly WithdrawnFile[];
  source?: "UPLOAD" | "MAILBOX" | undefined;
}) {
  const { read, retry } = useFileHistory(ids, file.id, shown);
  if (read === null) {
    return null;
  }
  if (read.status === "loading") {
    return (
      <p className="ea-history-note" role="status">
        <span className="spinner small" aria-hidden="true" /> Loading the file's
        history…
      </p>
    );
  }
  if (read.status === "ready") {
    const lines = historyLines(
      read.body,
      new Set(withdrawn.map((entry) => entry.id)),
    );
    return lines.length === 0 ? (
      <p className="ea-history-note">No history is recorded for this file.</p>
    ) : (
      <Lines ids={ids} lines={lines} />
    );
  }
  const fallback = fileHistory(
    { ...file, ...(source === undefined ? {} : { source }) },
    withdrawn,
  );
  return (
    <>
      <p className="ea-history-note" role="status">
        Part of the history could not be loaded.{" "}
        <button type="button" className="btn-ghost btn-sm" onClick={retry}>
          Try again
        </button>
      </p>
      {fallback.length > 0 ? <Lines ids={ids} lines={fallback} /> : null}
    </>
  );
}
