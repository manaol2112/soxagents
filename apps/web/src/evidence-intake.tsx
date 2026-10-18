"use client";

import { useRouter } from "next/navigation";
import { type DragEvent, useEffect, useRef, useState } from "react";

import { planUploads } from "./evidence-model";
import { formatBytes } from "./format";
import { UiIcon } from "./ui-icon";

const AT_ONCE = 3;

type Picked = { file: File; path: string };
type ItemState = "queued" | "sending" | "done" | "duplicate" | "failed";
type Item = {
  key: string;
  name: string;
  folder: string;
  size: number;
  state: ItemState;
};

/** Every file in a dropped folder, with its path inside the folder. */
async function walk(entry: FileSystemEntry, into: Picked[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    into.push({ file, path: entry.fullPath.replace(/^\//, "") });
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // A directory reader hands out entries in batches until it returns none.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (batch.length === 0) {
        break;
      }
      for (const child of batch) {
        await walk(child, into);
      }
    }
  }
}

/** Uploading picked files, three at a time, with each file's progress. */
function useUpload(
  organizationId: string,
  projectId: string,
  requestId?: string,
) {
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [skipped, setSkipped] = useState<
    Array<{ name: string; reason: string }>
  >([]);
  const [running, setRunning] = useState(false);

  const send = async (picked: Picked[]) => {
    if (picked.length === 0 || running) {
      return;
    }
    const plan = planUploads(
      picked.map((entry) => ({ path: entry.path, size: entry.file.size })),
    );
    const batch = crypto.randomUUID();
    const queue: Item[] = plan.accepted.map((entry) => ({
      key: `${batch}-${entry.index}`,
      name: entry.name,
      folder: entry.folder,
      size: entry.size,
      state: "queued",
    }));
    setItems(queue);
    setSkipped(plan.skipped);
    if (queue.length === 0) {
      return;
    }
    setRunning(true);
    const mark = (index: number, state: ItemState) =>
      setItems((current) =>
        current.map((item, position) =>
          position === index ? { ...item, state } : item,
        ),
      );
    let next = 0;
    const worker = async () => {
      while (next < plan.accepted.length) {
        const position = next;
        next += 1;
        const entry = plan.accepted[position];
        const source = entry === undefined ? undefined : picked[entry.index];
        if (entry === undefined || source === undefined) {
          continue;
        }
        mark(position, "sending");
        const query = new URLSearchParams({
          organization: organizationId,
          project: projectId,
          batch,
          name: entry.name,
          path: entry.folder,
        });
        if (requestId !== undefined) {
          query.set("request", requestId);
        }
        try {
          const response = await fetch(`/workspace/evidence-uploads?${query}`, {
            method: "POST",
            headers: {
              "content-type": source.file.type || "application/octet-stream",
            },
            body: source.file,
          });
          const body = (await response.json().catch(() => ({}))) as {
            duplicate?: boolean;
          };
          mark(
            position,
            !response.ok ? "failed" : body.duplicate ? "duplicate" : "done",
          );
        } catch {
          mark(position, "failed");
        }
      }
    };
    await Promise.all(Array.from({ length: AT_ONCE }, worker));
    setRunning(false);
    // The register catches up, and keeps refreshing while the agents read.
    router.refresh();
  };

  const onDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setOver(false);
    const picked: Picked[] = [];
    const entries = [...event.dataTransfer.items]
      .map((item) => item.webkitGetAsEntry())
      .filter((entry): entry is FileSystemEntry => entry !== null);
    if (entries.length > 0) {
      for (const entry of entries) {
        await walk(entry, picked);
      }
    } else {
      for (const file of event.dataTransfer.files) {
        picked.push({ file, path: file.name });
      }
    }
    void send(picked);
  };

  const fromInput = (input: HTMLInputElement | null) => {
    const files = [...(input?.files ?? [])];
    void send(
      files.map((file) => ({
        file,
        path: file.webkitRelativePath || file.name,
      })),
    );
    if (input !== null) {
      input.value = "";
    }
  };

  const total = items.length;
  const finished = items.filter(
    (item) => item.state !== "queued" && item.state !== "sending",
  ).length;
  const failed = items.filter((item) => item.state === "failed").length;
  const repeated = items.filter((item) => item.state === "duplicate").length;
  const bytes = items.reduce((sum, item) => sum + item.size, 0);
  const folders = new Set(items.map((item) => item.folder).filter(Boolean))
    .size;

  return {
    items,
    skipped,
    running,
    over,
    setOver,
    onDrop,
    fromInput,
    total,
    finished,
    failed,
    repeated,
    bytes,
    folders,
  };
}

export function EvidenceIntake({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const {
    items,
    skipped,
    running,
    over,
    setOver,
    onDrop,
    fromInput,
    total,
    finished,
    failed,
    repeated,
    bytes,
    folders,
  } = useUpload(organizationId, projectId);

  useEffect(() => {
    // React has no prop for folder picking; the attribute is standard in every browser.
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);

  return (
    <section className="intake" aria-label="Add evidence">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target for the mouse; keyboard users choose with the two buttons inside it. */}
      <div
        className={`dropzone${over ? " is-over" : ""}${running ? " is-busy" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => void onDrop(event)}
      >
        <span className="dropzone-icon" aria-hidden="true">
          <UiIcon name="upload" size={20} />
        </span>
        <div className="dropzone-text">
          <strong>Drop an evidence folder or files here</strong>
          <span>
            The evidence coordinator reads each file, matches it to its control,
            and files it. Files that cannot be matched with confidence are held
            in <em>Needs a match</em> for review. Up to 25 MB per file.
          </span>
        </div>
        <div className="dropzone-actions">
          <button
            type="button"
            className="btn-sm"
            disabled={running}
            onClick={() => folderInput.current?.click()}
          >
            <UiIcon name="inbox" size={14} /> Choose folder
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={running}
            onClick={() => filesInput.current?.click()}
          >
            Choose files
          </button>
        </div>
        <input
          ref={folderInput}
          type="file"
          multiple
          hidden
          aria-label="Choose an evidence folder"
          onChange={(event) => fromInput(event.currentTarget)}
        />
        <input
          ref={filesInput}
          type="file"
          multiple
          hidden
          aria-label="Choose evidence files"
          onChange={(event) => fromInput(event.currentTarget)}
        />
      </div>
      {total > 0 || skipped.length > 0 ? (
        <div className="intake-progress" aria-live="polite">
          <div className="intake-summary">
            <strong>
              {running
                ? `Uploading ${finished} of ${total}`
                : `${total - failed} of ${total} uploaded`}
            </strong>
            <span>
              {formatBytes(bytes)}
              {folders > 0
                ? ` · ${folders} folder${folders === 1 ? "" : "s"}`
                : ""}
              {repeated > 0 ? ` · ${repeated} already here` : ""}
              {failed > 0 ? ` · ${failed} failed` : ""}
              {skipped.length > 0 ? ` · ${skipped.length} skipped` : ""}
              {!running && total > 0
                ? " · the agents are reading and filing them"
                : ""}
            </span>
          </div>
          <span className="progress-track" aria-hidden="true">
            <span
              style={{
                width: `${total === 0 ? 100 : (finished / total) * 100}%`,
              }}
            />
          </span>
          <details className="intake-list">
            <summary>Show files</summary>
            <ul>
              {items.map((item) => (
                <li key={item.key} className={`is-${item.state}`}>
                  <span className="intake-state" aria-hidden="true">
                    {item.state === "sending" ? (
                      <span className="spinner small" />
                    ) : item.state === "failed" ? (
                      <UiIcon name="x" size={12} />
                    ) : item.state === "queued" ? null : (
                      <UiIcon name="check" size={12} />
                    )}
                  </span>
                  <span className="intake-name">
                    {item.folder !== "" ? <small>{item.folder}/</small> : null}
                    {item.name}
                  </span>
                  <span className="intake-note">
                    {item.state === "duplicate"
                      ? "Already uploaded"
                      : item.state === "failed"
                        ? "Not uploaded"
                        : formatBytes(item.size)}
                  </span>
                </li>
              ))}
              {skipped.map((item) => (
                <li key={`skip-${item.name}`} className="is-skipped">
                  <span className="intake-state" aria-hidden="true" />
                  <span className="intake-name">{item.name}</span>
                  <span className="intake-note">{item.reason}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : null}
    </section>
  );
}

/** Add evidence to one request: pick or drop files, filed to it without matching. */
export function RequestUpload({
  organizationId,
  projectId,
  requestId,
  label,
}: {
  organizationId: string;
  projectId: string;
  requestId: string;
  label: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const {
    running,
    over,
    setOver,
    onDrop,
    fromInput,
    total,
    finished,
    failed,
    repeated,
  } = useUpload(organizationId, projectId, requestId);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target for the mouse; the button inside picks files from the keyboard.
    <div
      className={`request-upload${over ? " is-over" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => void onDrop(event)}
    >
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={running}
        onClick={() => input.current?.click()}
        title="Choose files, or drop them here. They are filed to this request."
      >
        {running ? (
          <span className="spinner small" aria-hidden="true" />
        ) : (
          <UiIcon name="upload" size={13} />
        )}
        {running ? `Uploading ${finished} of ${total}` : "Add evidence"}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label={`Evidence files for ${label}`}
        onChange={(event) => fromInput(event.currentTarget)}
      />
      {!running && total > 0 ? (
        <small
          className={failed > 0 ? "upload-note is-failed" : "upload-note"}
          aria-live="polite"
        >
          {failed > 0
            ? `${failed} of ${total} not uploaded`
            : `${total - repeated} added${repeated > 0 ? ` · ${repeated} already here` : ""} · being read`}
        </small>
      ) : null}
    </div>
  );
}
