"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type Box,
  type EvidenceCitation,
  findSpan,
  markParts,
  pdfRuns,
  readingBlocks,
} from "./evidence-preview-model";
import { UiIcon } from "./ui-icon";

/**
 * How each kind of file is drawn under the one evidence viewer (docs/evidence-annotations.md,
 * section 5a): an image as it is, a PDF page by page with its paging and zoom, and any other
 * file (a spreadsheet, a Word document, text) as the text read from it, its tables as
 * tables. The viewer (evidence-annotations.tsx) lays its numbered boxes over the image and
 * the PDF page; nothing here changes the file or writes anything.
 */

export type Found = ReadonlyArray<{ box: Box; index: number }>;

/** The layer the viewer draws over a PDF page: given the boxes of the passages found on
 * the page in view (by their place in the list the PDF was asked to find). */
export type PdfMarks = (
  found: Found,
  page: number,
  ready: boolean,
) => ReactNode;

/** A file that cannot be shown says so plainly, with the original to download. */
function NotShown({
  children,
  download,
}: {
  children: ReactNode;
  download: string;
}) {
  return (
    <p className="preview-empty">
      <span>{children}</span>
      <a className="btn btn-secondary btn-sm" href={download}>
        Download the file
      </a>
    </p>
  );
}

export function ImageStage({
  url,
  download,
  name,
  children,
}: {
  url: string;
  download: string;
  name: string;
  children: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <NotShown download={download}>This image could not be shown.</NotShown>
    );
  }
  return (
    <div className="image-stage">
      <div className="image-frame">
        {/* biome-ignore lint/performance/noImgElement: evidence bytes are shown as they are, never optimised. */}
        <img src={url} alt={name} onError={() => setFailed(true)} />
        {children}
      </div>
    </div>
  );
}

type PdfState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; pages: number };

const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5] as const;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;

/**
 * A PDF, one page at a time, with the page and zoom tools. The passages it is asked to
 * find are looked for in the page's own text (a text PDF); the boxes found are handed to
 * the viewer's layer (`marks`), which draws them. A scanned page has no text: it is shown,
 * and its passages are listed beside it without boxes.
 */
export function PdfStage({
  url,
  download,
  citations,
  focused,
  marks: layer,
}: {
  url: string;
  download: string;
  citations: EvidenceCitation[];
  focused: EvidenceCitation | null;
  marks: PdfMarks;
}) {
  // Relative to the width that fits the stage: 1 fits, 2 is twice that.
  const [zoom, setZoom] = useState(1);
  const canvas = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  // biome-ignore lint/suspicious/noExplicitAny: pdf.js types load with the library.
  const doc = useRef<any>(null);
  const [state, setState] = useState<PdfState>({ status: "loading" });
  const [page, setPage] = useState(focused?.page ?? citations[0]?.page ?? 1);
  const [boxes, setBoxes] = useState<Array<{ box: Box; index: number }>>([]);
  // The page the boxes were found on: until a page is drawn, the last one's are not its.
  const [boxedPage, setBoxedPage] = useState(0);
  // The passages to find, by their content: the parent passes a new array on each of its
  // renders, and a new array alone must not draw the page again.
  const wanted = JSON.stringify(
    citations.map((item) => ({ quote: item.quote, page: item.page })),
  );
  const quotes = useMemo(
    () =>
      (JSON.parse(wanted) as Array<{ quote: string; page: number | null }>).map(
        (item, index) => ({ item, index }),
      ),
    [wanted],
  );
  // The draw in progress, and which call is the latest: pdf.js refuses two draws on one
  // canvas at once, and a draw a later one overtook must not set the boxes.
  // biome-ignore lint/suspicious/noExplicitAny: pdf.js types load with the library.
  const drawing = useRef<any>(null);
  const latest = useRef(0);

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
    const run = ++latest.current;
    const current = doc.current;
    const target = canvas.current;
    if (current === null || target === null || state.status !== "ready") {
      return;
    }
    const { pdfjs, loaded } = current;
    const pdfPage = await loaded.getPage(
      Math.min(Math.max(page, 1), state.pages),
    );
    // A draw still going on this canvas stops first (31 October 2026: a second draw on the
    // same canvas threw and took the workspace down).
    const previous = drawing.current;
    if (previous !== null) {
      previous.cancel();
      await previous.promise.catch(() => undefined);
    }
    if (run !== latest.current) {
      return;
    }
    const width = holder.current?.clientWidth ?? 800;
    const base = pdfPage.getViewport({ scale: 1 });
    const scale = Math.min(5, Math.max(0.3, ((width - 8) / base.width) * zoom));
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
    const task = pdfPage.render({
      canvas: target,
      canvasContext: context,
      viewport,
    });
    drawing.current = task;
    try {
      await task.promise;
    } catch {
      // Cancelled by a later draw, or the page could not be drawn: nothing to mark.
      return;
    } finally {
      if (drawing.current === task) {
        drawing.current = null;
      }
    }
    if (run !== latest.current) {
      return;
    }
    // The passages on this page, as boxes over the text runs they cover.
    const text = await pdfPage.getTextContent();
    if (run !== latest.current) {
      return;
    }
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
    setBoxedPage(page);
  }, [page, quotes, state, zoom]);

  useEffect(() => {
    render().catch(() => undefined);
    return () => {
      // A draw for a page or zoom no longer shown stops, and its result is dropped.
      latest.current++;
      drawing.current?.cancel();
    };
  }, [render]);

  if (state.status === "failed") {
    return (
      <NotShown download={download}>This PDF could not be shown.</NotShown>
    );
  }
  const step = (direction: 1 | -1) => {
    const at = ZOOMS.findIndex((value) => value >= zoom - 0.001);
    const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, at + direction))];
    setZoom(next ?? 1);
  };
  return (
    <div className="pdf-stage has-tools" ref={holder}>
      {state.status === "ready" ? (
        <div className="pdf-bar">
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={page <= 1}
            aria-label="Previous page"
            onClick={() => setPage(page - 1)}
          >
            <UiIcon name="chevron" size={14} />
          </button>
          <span className="num">
            <input
              type="number"
              min={1}
              max={state.pages}
              value={page}
              aria-label={`Page, of ${state.pages}`}
              onChange={(event) => {
                const asked = Number(event.target.value);
                if (Number.isInteger(asked)) {
                  setPage(Math.min(state.pages, Math.max(1, asked)));
                }
              }}
            />{" "}
            / {state.pages}
          </span>
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={page >= state.pages}
            aria-label="Next page"
            onClick={() => setPage(page + 1)}
          >
            <UiIcon name="chevron" size={14} />
          </button>
          <span className="pdf-zoom">
            <button
              type="button"
              className="btn-ghost btn-sm"
              aria-label="Zoom out"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => step(-1)}
            >
              <UiIcon name="minus" size={14} />
            </button>
            <button
              type="button"
              className="pdf-zoom-value"
              title="Fit the width"
              aria-label={`Zoom ${Math.round(zoom * 100)}%. Fit the width`}
              onClick={() => setZoom(1)}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              aria-label="Zoom in"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => step(1)}
            >
              <UiIcon name="plus" size={14} />
            </button>
          </span>
        </div>
      ) : null}
      {state.status === "loading" ? (
        <p className="preview-empty">
          <span className="spinner small" aria-hidden="true" /> Opening the PDF…
        </p>
      ) : null}
      <div className="pdf-page">
        <canvas ref={canvas} />
        {layer(
          boxedPage === page ? boxes : [],
          page,
          state.status === "ready" && boxedPage === page,
        )}
      </div>
    </div>
  );
}

/**
 * Any other file, as the text read from it: a spreadsheet's sheets as tables, a document's
 * headings and paragraphs, each passage it is asked to mark marked where its words are.
 */
export function TextStage({
  url,
  download,
  citations,
  focused,
}: {
  url: string;
  download: string;
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
        node.scrollIntoView({
          block: "center",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "auto"
            : "smooth",
        });
      }
    },
    [focused],
  );
  if (failed) {
    return (
      <NotShown download={download}>
        The text of this file could not be loaded.
      </NotShown>
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
      <NotShown download={download}>
        Nothing was read from this file yet, so it cannot be shown here.
      </NotShown>
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
