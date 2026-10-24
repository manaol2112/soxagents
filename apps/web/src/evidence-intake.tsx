"use client";

import { useRouter } from "next/navigation";
import { type DragEvent, useEffect, useRef, useState } from "react";
import { planUploads, systemsAnswer } from "./evidence-model";
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
  requirementId?: string,
  /** Hold picked files until the person says which systems they apply to. */
  hold = false,
) {
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [skipped, setSkipped] = useState<
    Array<{ name: string; reason: string }>
  >([]);
  const [running, setRunning] = useState(false);
  // Why the API refused a file, in its words: the first refusal of the last upload.
  const [refusal, setRefusal] = useState<string | null>(null);
  // Picked files waiting for the person's answer (hold).
  const [pending, setPending] = useState<Picked[] | null>(null);

  const send = async (picked: Picked[], applications?: string) => {
    if (picked.length === 0 || running) {
      return;
    }
    if (hold && applications === undefined) {
      setPending(picked);
      return;
    }
    setPending(null);
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
    setRefusal(null);
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
        if (requirementId !== undefined) {
          query.set("requirement", requirementId);
        }
        if (applications !== undefined) {
          query.set("applications", applications);
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
            detail?: unknown;
          };
          if (!response.ok && typeof body.detail === "string") {
            const said = body.detail;
            setRefusal((current) => current ?? said);
          }
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
    // What was added shows on its item, being read; this note goes after a moment,
    // unless something was not uploaded.
    window.setTimeout(() => {
      setItems((current) =>
        current.some((item) => item.state === "failed") ? current : [],
      );
    }, 5000);
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
    refusal,
    pending,
    confirm: (applications: string) =>
      pending === null ? undefined : void send(pending, applications),
    dismiss: () => setPending(null),
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
/**
 * Which of the control's systems a policy or procedure applies to, asked before it is
 * uploaded: all of them, or only those ticked. The answer is the person's, and the
 * evidence coordinator never changes it; the file then serves the same item on each.
 */
function SystemsQuestion({
  count,
  systems,
  system,
  onConfirm,
  onCancel,
}: {
  count: number;
  systems: Array<{ id: string; name: string }>;
  system: string | null;
  onConfirm: (applications: string) => void;
  onCancel: () => void;
}) {
  const [all, setAll] = useState(true);
  const [ticked, setTicked] = useState<string[]>(
    system !== null && systems.some((item) => item.id === system)
      ? [system]
      : [],
  );
  const answer = systemsAnswer(all, ticked);
  // Opens under its button toward the left, or toward the right where the left has no room.
  const box = useRef<HTMLDivElement>(null);
  const [toRight, setToRight] = useState(false);
  useEffect(() => {
    if ((box.current?.getBoundingClientRect().left ?? 0) < 8) {
      setToRight(true);
    }
  }, []);
  return (
    <div
      ref={box}
      className={`upload-systems${toRight ? " is-right" : ""}`}
      role="dialog"
      aria-label="Which systems it applies to"
    >
      <p className="upload-systems-title">
        Which systems does {count === 1 ? "this file" : `these ${count} files`}{" "}
        apply to?
      </p>
      <label className="upload-systems-choice">
        <input type="radio" checked={all} onChange={() => setAll(true)} />
        All systems
      </label>
      <label className="upload-systems-choice">
        <input type="radio" checked={!all} onChange={() => setAll(false)} />
        Only some
      </label>
      {all ? null : (
        <div className="upload-systems-list">
          {systems.map((item) => (
            <label key={item.id} className="upload-systems-choice">
              <input
                type="checkbox"
                checked={ticked.includes(item.id)}
                onChange={(event) => {
                  // Read now: React clears the event before the update runs.
                  const on = event.currentTarget.checked;
                  setTicked((current) =>
                    on
                      ? [...current, item.id]
                      : current.filter((id) => id !== item.id),
                  );
                }}
              />
              {item.name}
            </label>
          ))}
        </div>
      )}
      <div className="upload-systems-actions">
        <button
          type="button"
          className="btn-sm"
          disabled={answer === null}
          onClick={() => answer !== null && onConfirm(answer)}
        >
          Upload
        </button>
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function RequestUpload({
  organizationId,
  projectId,
  requestId,
  requirementId,
  label,
  variant = "row",
  systems = [],
  system = null,
}: {
  organizationId: string;
  projectId: string;
  requestId: string;
  /** One item of the request the files are for: they serve that item only. */
  requirementId?: string;
  label: string;
  /** For a policy or procedure of a control over several systems: the systems, so the
   * person says which ones it applies to before it is uploaded. */
  systems?: Array<{ id: string; name: string }>;
  /** The system of this item's control, ticked first when only some apply. */
  system?: string | null;
  /** A button in a table row, or a drop zone in a request's side panel. */
  variant?: "row" | "panel";
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
    refusal,
    pending,
    confirm,
    dismiss,
  } = useUpload(
    organizationId,
    projectId,
    requestId,
    requirementId,
    systems.length > 1,
  );
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target for the mouse; the button inside picks files from the keyboard.
    <div
      className={`request-upload${variant === "panel" ? " is-panel" : ""}${over ? " is-over" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => void onDrop(event)}
    >
      <button
        type="button"
        className={
          variant === "panel" ? "btn-secondary" : "btn-secondary btn-sm"
        }
        disabled={running}
        onClick={() => input.current?.click()}
        title={
          requirementId === undefined
            ? "Choose files, or drop them here. They are filed to this request."
            : "Choose files, or drop them here. They are evidence for this item only."
        }
      >
        {running ? (
          <span className="spinner small" aria-hidden="true" />
        ) : (
          <UiIcon name="upload" size={13} />
        )}
        {running
          ? `Uploading ${finished} of ${total}`
          : variant === "panel"
            ? "Choose files"
            : "Add evidence"}
      </button>
      {variant === "panel" && !running ? (
        <span className="request-upload-hint">or drop them here</span>
      ) : null}
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label={`Evidence files for ${label}`}
        onChange={(event) => fromInput(event.currentTarget)}
      />
      {pending !== null ? (
        <SystemsQuestion
          count={pending.length}
          systems={systems}
          system={system}
          onConfirm={confirm}
          onCancel={dismiss}
        />
      ) : null}
      {!running && total > 0 ? (
        <small
          className={failed > 0 ? "upload-note is-failed" : "upload-note"}
          aria-live="polite"
        >
          {failed > 0
            ? `${failed} of ${total} not uploaded${refusal !== null ? `: ${refusal.charAt(0).toUpperCase()}${refusal.slice(1)}.` : ""}`
            : `${total - repeated} added${repeated > 0 ? ` · ${repeated} already here` : ""} · being read`}
        </small>
      ) : null}
    </div>
  );
}
