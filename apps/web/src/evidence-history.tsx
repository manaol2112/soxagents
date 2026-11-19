"use client";

import { useEffect, useState } from "react";
import {
  type FileHistoryBody,
  fileHistory,
  type HistoryLine,
  historyHref,
  historyLines,
  historyReadHref,
  parseFileHistory,
} from "./evidence-impact-model";
import type { WithdrawnFile } from "./evidence-model";
import { formatBytes } from "./format";
import { LocalTime } from "./local-time";

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
  const { organizationId, projectId } = ids;
  const known = read !== null && read.fileId === fileId;
  useEffect(() => {
    if (!shown || known) {
      return;
    }
    const abort = new AbortController();
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
      if (!abort.signal.aborted) {
        setRead({ fileId, read: next });
      }
    })();
    return () => abort.abort();
  }, [shown, known, fileId, organizationId, projectId]);
  return {
    read: read !== null && read.fileId === fileId ? read.read : null,
    // Forgets the failed read: the section, still shown, reads it again.
    retry: () => setRead(null),
  };
}

function Lines({ ids, lines }: { ids: Ids; lines: readonly HistoryLine[] }) {
  return (
    <ol className="ea-history" aria-label="The file's history, oldest first">
      {lines.map((line) => (
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
            <LocalTime at={line.at} />
            {line.by !== "" ? ` by ${line.by}` : ""}
            {line.sizeBytes !== null ? ` · ${formatBytes(line.sizeBytes)}` : ""}
          </small>
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
        The full history could not be loaded. What the register holds is shown.{" "}
        <button type="button" className="btn-ghost btn-sm" onClick={retry}>
          Try again
        </button>
      </p>
      {fallback.length > 0 ? <Lines ids={ids} lines={fallback} /> : null}
    </>
  );
}
