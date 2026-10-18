"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  type Box,
  type EvidenceCitation,
  fileQuery,
  findSpan,
  markParts,
  pdfRuns,
  previewKind,
  readingBlocks,
} from "./evidence-preview-model";
import { UiIcon } from "./ui-icon";

type PreviewFile = { id: string; fileName: string };

type Props = {
  organizationId: string;
  projectId: string;
  files: PreviewFile[];
  citations?: EvidenceCitation[];
  /** The file to open on; the first cited file, else the first file. */
  startFileId?: string;
  title?: string;
  /** The heading of the cited passages beside the document. */
  sourcesTitle?: string;
  label: React.ReactNode;
  className?: string;
};

/** A button that opens the evidence preview, with the cited passages marked. */
export function PreviewButton(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={props.className ?? "btn-secondary btn-sm"}
        onClick={(event) => {
          // Inside a row that opens on click, the preview opens and the row stays as it is.
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {props.label}
      </button>
      {open ? (
        <PreviewDialog {...props} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

/** The evidence preview, for a caller that decides when it is open. */
export function EvidencePreview(
  props: Omit<Props, "label" | "className"> & {
    onClose: () => void;
  },
) {
  return <PreviewDialog {...props} label={null} />;
}

function PreviewDialog({
  organizationId,
  projectId,
  files,
  citations = [],
  startFileId,
  title,
  sourcesTitle = "What the tester relied on",
  onClose,
}: Props & { onClose: () => void }) {
  const first = startFileId ?? citations[0]?.fileId ?? files[0]?.id ?? "";
  const [fileId, setFileId] = useState(first);
  const [focus, setFocus] = useState<number | null>(
    citations.findIndex((item) => item.fileId === first) >= 0
      ? citations.findIndex((item) => item.fileId === first)
      : null,
  );
  const dialog = useRef<HTMLDivElement>(null);
  const file = files.find((item) => item.id === fileId) ?? files[0];
  const mine = citations.filter((item) => item.fileId === file?.id);
  const query = fileQuery(organizationId, projectId);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("has-dialog");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("has-dialog");
      previous?.focus();
    };
  }, [onClose]);

  const go = (index: number) => {
    const target = citations[index];
    if (target === undefined) {
      return;
    }
    setFileId(target.fileId);
    setFocus(index);
  };

  if (file === undefined) {
    return null;
  }
  const focused = focus === null ? null : (citations[focus] ?? null);
  // On the page itself, so no scrolling panel or transformed parent can clip it.
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: a click on the backdrop closes; Escape and the close button do too.
    <div
      className="preview-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialog}
        className="preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title ?? `Preview ${file.fileName}`}
        tabIndex={-1}
      >
        <header className="preview-head">
          <div>
            <p className="page-context">{title ?? "Evidence preview"}</p>
            <h2 title={file.fileName}>{file.fileName}</h2>
          </div>
          {files.length > 1 ? (
            <select
              aria-label="File"
              value={file.id}
              onChange={(event) => {
                setFileId(event.target.value);
                const index = citations.findIndex(
                  (item) => item.fileId === event.target.value,
                );
                setFocus(index >= 0 ? index : null);
              }}
            >
              {files.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.fileName}
                  {citations.some((c) => c.fileId === item.id)
                    ? ` (${citations.filter((c) => c.fileId === item.id).length} cited)`
                    : ""}
                </option>
              ))}
            </select>
          ) : null}
          <a
            className="btn btn-secondary btn-sm"
            href={`/workspace/evidence-files/${file.id}?${query}`}
          >
            Download
          </a>
          <button
            type="button"
            className="btn-ghost btn-sm preview-close"
            onClick={onClose}
            aria-label="Close preview"
          >
            <UiIcon name="x" size={16} />
          </button>
        </header>
        <div
          className={`preview-body ${citations.length > 0 ? "has-sources" : ""}`}
        >
          <div className="preview-stage">
            <Viewer
              key={file.id}
              file={file}
              query={query}
              citations={mine}
              focused={
                focused !== null && focused.fileId === file.id ? focused : null
              }
            />
          </div>
          {citations.length > 0 ? (
            <aside className="preview-sources" aria-label={sourcesTitle}>
              <div className="preview-sources-head">
                <strong>{sourcesTitle}</strong>
                <span className="preview-nav">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={focus === null || focus <= 0}
                    onClick={() => go((focus ?? 0) - 1)}
                    aria-label="Previous source"
                  >
                    <span className="icon-back" aria-hidden="true">
                      <UiIcon name="chevron" size={14} />
                    </span>
                  </button>
                  <span className="num">
                    {focus === null ? "–" : focus + 1} of {citations.length}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={focus !== null && focus >= citations.length - 1}
                    onClick={() => go(focus === null ? 0 : focus + 1)}
                    aria-label="Next source"
                  >
                    <UiIcon name="chevron" size={14} />
                  </button>
                </span>
              </div>
              <ol>
                {citations.map((item, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: citations keep their order.
                  <li key={`${item.fileId}-${index}`}>
                    <button
                      type="button"
                      className={`source-item ${focus === index ? "is-focused" : ""}`}
                      onClick={() => go(index)}
                    >
                      <span className="source-num">{index + 1}</span>
                      <span className="source-body">
                        <span className="source-meta">
                          {item.label !== "" ? (
                            <strong>{item.label}</strong>
                          ) : null}
                          <span>{item.fileName}</span>
                          {item.location !== "" ? (
                            <span>{item.location}</span>
                          ) : null}
                        </span>
                        <q>{item.quote}</q>
                        {!item.found ? (
                          <small>
                            Boxed on the image; the words were not read by OCR.
                          </small>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </aside>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Viewer({
  file,
  query,
  citations,
  focused,
}: {
  file: PreviewFile;
  query: string;
  citations: EvidenceCitation[];
  focused: EvidenceCitation | null;
}) {
  const kind = previewKind(file.fileName);
  if (kind === "pdf") {
    return (
      <PdfViewer
        url={`/workspace/evidence-files/${file.id}/preview?${query}`}
        citations={citations}
        focused={focused}
      />
    );
  }
  if (kind === "image") {
    return (
      <ImageViewer
        url={`/workspace/evidence-files/${file.id}/preview?${query}`}
        name={file.fileName}
        citations={citations}
        focused={focused}
      />
    );
  }
  return (
    <TextViewer
      url={`/workspace/evidence-files/${file.id}/reading?${query}`}
      citations={citations}
      focused={focused}
    />
  );
}

function Highlight({
  box,
  focused,
  number,
}: {
  box: Box;
  focused: boolean;
  number: number | null;
}) {
  return (
    <span
      className={`hl-box ${focused ? "is-focused" : ""}`}
      style={{
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * 100}%`,
        height: `${box.h * 100}%`,
      }}
      ref={(node) => {
        if (node !== null && focused) {
          node.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      }}
    >
      {number !== null ? <span className="hl-tag">{number}</span> : null}
    </span>
  );
}

function ImageViewer({
  url,
  name,
  citations,
  focused,
}: {
  url: string;
  name: string;
  citations: EvidenceCitation[];
  focused: EvidenceCitation | null;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <p className="preview-empty">
        This image could not be shown. Download it instead.
      </p>
    );
  }
  const boxed = citations.filter((item) => item.box !== null);
  return (
    <div className="image-stage">
      <div className="image-frame">
        {/* biome-ignore lint/performance/noImgElement: evidence bytes are shown as they are, never optimised. */}
        <img src={url} alt={name} onError={() => setFailed(true)} />
        {boxed.map((item, index) =>
          item.box !== null ? (
            <Highlight
              // biome-ignore lint/suspicious/noArrayIndexKey: citations keep their order.
              key={index}
              box={item.box}
              focused={item === focused}
              number={index + 1}
            />
          ) : null,
        )}
      </div>
      {citations.length > boxed.length ? (
        <p className="preview-note">
          {citations.length - boxed.length} cited passage
          {citations.length - boxed.length === 1 ? " is" : "s are"} listed on
          the right without a box on the image.
        </p>
      ) : null}
    </div>
  );
}

type PdfState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; pages: number };

function PdfViewer({
  url,
  citations,
  focused,
}: {
  url: string;
  citations: EvidenceCitation[];
  focused: EvidenceCitation | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  // biome-ignore lint/suspicious/noExplicitAny: pdf.js types load with the library.
  const doc = useRef<any>(null);
  const [state, setState] = useState<PdfState>({ status: "loading" });
  const [page, setPage] = useState(focused?.page ?? citations[0]?.page ?? 1);
  const [boxes, setBoxes] = useState<Array<{ box: Box; index: number }>>([]);
  const quotes = useMemo(
    () => citations.map((item, index) => ({ item, index })),
    [citations],
  );

  useEffect(() => {
    if (focused?.page != null) {
      setPage(focused.page);
    }
  }, [focused]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (pdfjs.GlobalWorkerOptions.workerPort === null) {
          pdfjs.GlobalWorkerOptions.workerPort = new Worker(
            new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
            { type: "module" },
          );
        }
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
          throw new Error("not available");
        }
        const data = new Uint8Array(await response.arrayBuffer());
        // Forms and scripts in the PDF are never run; only the page is drawn.
        const task = pdfjs.getDocument({ data, enableXfa: false });
        const loaded = await task.promise;
        if (cancelled) {
          await task.destroy();
          return;
        }
        doc.current = { pdfjs, loaded, task };
        setState({ status: "ready", pages: loaded.numPages });
      } catch {
        if (!cancelled) {
          setState({ status: "failed" });
        }
      }
    })();
    return () => {
      cancelled = true;
      doc.current?.task?.destroy();
      doc.current = null;
    };
  }, [url]);

  const render = useCallback(async () => {
    const current = doc.current;
    const target = canvas.current;
    if (current === null || target === null || state.status !== "ready") {
      return;
    }
    const { pdfjs, loaded } = current;
    const pdfPage = await loaded.getPage(
      Math.min(Math.max(page, 1), state.pages),
    );
    const width = holder.current?.clientWidth ?? 800;
    const base = pdfPage.getViewport({ scale: 1 });
    const scale = Math.min(2.5, Math.max(0.5, (width - 8) / base.width));
    const viewport = pdfPage.getViewport({ scale });
    const ratio = window.devicePixelRatio || 1;
    target.width = Math.floor(viewport.width * ratio);
    target.height = Math.floor(viewport.height * ratio);
    target.style.width = `${viewport.width}px`;
    target.style.height = `${viewport.height}px`;
    const context = target.getContext("2d");
    if (context === null) {
      return;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    await pdfPage.render({ canvas: target, canvasContext: context, viewport })
      .promise;
    // The cited passages on this page, as boxes over the text runs they cover.
    const text = await pdfPage.getTextContent();
    const runs = (
      text.items as Array<{
        str?: string;
        transform?: number[];
        width?: number;
      }>
    ).map((run) => ({
      str: typeof run.str === "string" ? run.str : "",
      transform: run.transform ?? [1, 0, 0, 1, 0, 0],
      width: run.width ?? 0,
    }));
    const found: Array<{ box: Box; index: number }> = [];
    for (const { item, index } of quotes) {
      if (item.page !== null && item.page !== page) {
        continue;
      }
      for (const at of pdfRuns(
        runs.map((run) => run.str),
        item.quote,
      )) {
        const run = runs[at];
        if (run === undefined) {
          continue;
        }
        const tx = pdfjs.Util.transform(
          viewport.transform,
          run.transform,
        ) as number[];
        const height = Math.hypot(tx[2] ?? 0, tx[3] ?? 0);
        const left = tx[4] ?? 0;
        const top = (tx[5] ?? 0) - height;
        found.push({
          index,
          box: {
            x: left / viewport.width,
            y: Math.max(0, top - 2) / viewport.height,
            w: Math.min(1, (run.width * scale + 4) / viewport.width),
            h: Math.min(1, (height + 4) / viewport.height),
          },
        });
      }
    }
    setBoxes(found);
  }, [page, quotes, state]);

  useEffect(() => {
    void render();
  }, [render]);

  if (state.status === "failed") {
    return (
      <p className="preview-empty">
        This PDF could not be shown. Download it instead.
      </p>
    );
  }
  return (
    <div className="pdf-stage" ref={holder}>
      {state.status === "ready" && state.pages > 1 ? (
        <div className="pdf-bar">
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous page
          </button>
          <span className="num">
            Page {page} of {state.pages}
          </span>
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={page >= state.pages}
            onClick={() => setPage(page + 1)}
          >
            Next page
          </button>
        </div>
      ) : null}
      {state.status === "loading" ? (
        <p className="preview-empty">
          <span className="spinner small" aria-hidden="true" /> Opening the PDF…
        </p>
      ) : null}
      <div className="pdf-page">
        <canvas ref={canvas} />
        {boxes.map((entry, position) => (
          <Highlight
            // biome-ignore lint/suspicious/noArrayIndexKey: boxes keep their order.
            key={position}
            box={entry.box}
            focused={citations[entry.index] === focused}
            number={
              boxes.findIndex((other) => other.index === entry.index) ===
              position
                ? entry.index + 1
                : null
            }
          />
        ))}
      </div>
    </div>
  );
}

function TextViewer({
  url,
  citations,
  focused,
}: {
  url: string;
  citations: EvidenceCitation[];
  focused: EvidenceCitation | null;
}) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(url, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body: { text?: unknown }) => {
        if (!cancelled) {
          setText(typeof body.text === "string" ? body.text : "");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  const focusRef = useCallback(
    (node: HTMLElement | null) => {
      if (node !== null && focused !== null) {
        node.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    },
    [focused],
  );
  if (failed) {
    return (
      <p className="preview-empty">
        The text of this file could not be loaded.
      </p>
    );
  }
  if (text === null) {
    return (
      <p className="preview-empty">
        <span className="spinner small" aria-hidden="true" /> Loading…
      </p>
    );
  }
  if (text.trim() === "") {
    return (
      <p className="preview-empty">
        Nothing was read from this file yet. Download it to look at it.
      </p>
    );
  }
  const quotes = citations.map((item) => item.quote);
  const isFocused = (part: string) =>
    focused !== null &&
    part.toLowerCase().includes(focused.quote.slice(0, 20).toLowerCase());
  const marked = (value: string) =>
    markParts(value, quotes).map((part, index) =>
      part.mark ? (
        <mark
          // biome-ignore lint/suspicious/noArrayIndexKey: parts keep their order.
          key={index}
          className={isFocused(part.text) ? "is-focused" : undefined}
          ref={isFocused(part.text) ? focusRef : undefined}
        >
          {part.text}
        </mark>
      ) : (
        // biome-ignore lint/suspicious/noArrayIndexKey: parts keep their order.
        <span key={index}>{part.text}</span>
      ),
    );
  return (
    <div className="text-stage">
      {readingBlocks(text).map((block, index) =>
        block.kind === "heading" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks keep their order.
          <h3 key={index} className="text-heading">
            {block.text}
          </h3>
        ) : block.kind === "table" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks keep their order.
          <div key={index} className="grid-scroll">
            <table className="table data-grid text-table">
              <tbody>
                {block.rows.slice(0, 2000).map((row, rowIndex) => (
                  <tr
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows keep their order.
                    key={rowIndex}
                    className={
                      [
                        rowIndex === 0 ? "is-header" : "",
                        quotes.some(
                          (quote) => findSpan(row.join(" | "), quote) !== null,
                        )
                          ? "is-cited"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                    ref={
                      focused !== null &&
                      findSpan(row.join(" | "), focused.quote) !== null
                        ? focusRef
                        : undefined
                    }
                  >
                    {row.map((cell, cellIndex) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: cells keep their order.
                      <td key={cellIndex}>{marked(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks keep their order.
          <p key={index} className="text-block">
            {marked(block.text)}
          </p>
        ),
      )}
    </div>
  );
}
