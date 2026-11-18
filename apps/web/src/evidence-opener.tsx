"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  type AboutTab,
  AnnotatedEvidence,
  type PanelTab,
  useEvidenceAnnotations,
} from "./evidence-annotations";
import {
  type AnnotationAsk,
  type AnnotationSet,
  annotationFor,
  citedMarks,
  type ViewerPick,
} from "./evidence-annotations-model";
import {
  type EvidenceCitation,
  fileQuery,
  previewKind,
} from "./evidence-preview-model";
import { UiIcon } from "./ui-icon";
import { isTopmostDialog, useFocusTrap } from "./use-focus-trap";

/**
 * How a screen opens a file in the one evidence viewer (docs/evidence-annotations.md,
 * section 5a): a button that opens it as a dialog (`PreviewButton`), the dialog for a
 * screen that decides when it is open (`AnnotatedDialog`), and the viewer inline in a page
 * (`AnnotatedFile`). Each reads the file's annotations only where its D&I request is
 * known; opening a file writes nothing.
 *
 * Opening an existing file opens the dialog itself, full size (section 5b): the reviewer
 * that held a file's classification, data and findings is retired, and what it held is
 * the dialog's second tab, "About this file" (evidence-about.tsx), handed in by the
 * screen (`about`).
 */

type ShownFile = { id: string; fileName: string };

/** The D&I request a file serves: its annotations are read and reviewed in the viewer. */
type Request = { controlId: string; requirementId: string };

type DialogProps = {
  organizationId: string;
  projectId: string;
  files: ShownFile[];
  /** The passages the screen cites: boxed as "Cited" in the file they are in. */
  citations?: EvidenceCitation[];
  /** The file to open on; the first cited file, else the first file. */
  startFileId?: string;
  title?: string;
  /** What cited the passages: the heading of their lines in the legend. */
  sourcesTitle?: string;
  /** Where the dialog is drawn: the page by default. A modal <dialog> passes itself, so
   * the viewer sits in its top layer and is not made inert beneath it (the D&I evidence
   * wizard's "Open in the file"). */
  container?: HTMLElement | null;
  /** The D&I request the file serves (docs/evidence-annotations.md). Without it nothing
   * is asked, and the file is shown with the passages cited, if any. */
  annotations?: Request | undefined;
  /** The annotation to open on, where the file was opened from a reference to it (the
   * D&I workpaper's views). */
  startAnnotationId?: string | undefined;
  /** The passage to open on, where the file was opened from a row that rests on it (a
   * "Shown" row of a finished check): once the file's annotations are here, the one that
   * marks the passage for the attribute is selected (annotationFor). */
  startAnnotationFor?: AnnotationAsk | undefined;
  /** "About this file" for the file shown, or null where nothing about it applies (a file
   * with no reading, outside any request): the tab is then not shown (section 5b). */
  about?: ((fileId: string) => AboutTab | null) | undefined;
  /** The tab the side panel opens on: "about" where the file's details were asked for (a
   * check's "Confirm the file's type"). */
  startTab?: PanelTab | undefined;
  /** Opened to add an annotation for this attribute (a tickmark's "Add an annotation"). */
  startAdding?: string | undefined;
};

/**
 * The annotation to open on: one asked for by its id, or the one that marks a passage
 * for an attribute (annotationFor), found once for each file's annotations as they
 * arrive, so reading them again after a review does not select it a second time.
 */
function useAnnotationPick(
  set: AnnotationSet | null,
  fileId: string | undefined,
  startAnnotationId: string | undefined,
  startAnnotationFor: AnnotationAsk | undefined,
): { id: string } | null {
  const asked = useMemo(
    () => (startAnnotationId === undefined ? null : { id: startAnnotationId }),
    [startAnnotationId],
  );
  const [found, setFound] = useState<{
    fileId: string;
    pick: { id: string } | null;
  } | null>(null);
  const foundFor = found?.fileId;
  useEffect(() => {
    if (
      startAnnotationFor === undefined ||
      set === null ||
      foundFor === set.fileId
    ) {
      return;
    }
    const first = annotationFor(set, startAnnotationFor);
    setFound({
      fileId: set.fileId,
      pick: first === null ? null : { id: first.id },
    });
  }, [startAnnotationFor, set, foundFor]);
  return (
    asked ?? (found !== null && found.fileId === fileId ? found.pick : null)
  );
}

/** The cited passage a file opens on: the first the screen cites in it. */
function firstCited(
  citations: readonly EvidenceCitation[],
  fileId: string,
): ViewerPick | null {
  const first = citations.find((item) => item.fileId === fileId);
  return first === undefined ? null : { quote: first.quote };
}

/** A button that opens the evidence viewer as a dialog. */
export function PreviewButton(
  props: DialogProps & { label: React.ReactNode; className?: string },
) {
  const [open, setOpen] = useState(false);
  const { label, className, ...dialog } = props;
  return (
    <>
      <button
        type="button"
        className={className ?? "btn-secondary btn-sm"}
        onClick={(event) => {
          // Inside a row that opens on click, the viewer opens and the row stays as it is.
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {label}
      </button>
      {open ? (
        <AnnotatedDialog {...dialog} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

/**
 * The evidence viewer as a dialog, for a screen that decides when it is open: the file,
 * a switcher where several were opened, Download, and Close. The focus stays inside
 * while it is open (useFocusTrap), Escape closes it once what is open inside has closed,
 * and the focus goes back to what opened it.
 */
export function AnnotatedDialog({
  organizationId,
  projectId,
  files,
  citations = [],
  startFileId,
  title,
  sourcesTitle = "What the tester relied on",
  container = null,
  annotations,
  startAnnotationId,
  startAnnotationFor,
  about,
  startTab = "annotations",
  startAdding,
  onClose,
}: DialogProps & { onClose: () => void }) {
  const first = startFileId ?? citations[0]?.fileId ?? files[0]?.id ?? "";
  const [fileId, setFileId] = useState(first);
  const [citedPick, setCitedPick] = useState<ViewerPick | null>(() =>
    firstCited(citations, first),
  );
  // The side panel's tab, kept as the person moves between files.
  const [tab, setTab] = useState<PanelTab>(startTab);
  // A passage "About this file" asked to see: marked, where the screen does not cite it
  // already, and selected (`shownPick`, over any other pick).
  const [shown, setShown] = useState<EvidenceCitation | null>(null);
  const [shownPick, setShownPick] = useState<ViewerPick | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useFocusTrap(dialog);
  const file = files.find((item) => item.id === fileId) ?? files[0];
  const query = fileQuery(organizationId, projectId);
  // A file on a D&I request has annotations to read; any other file asks for none.
  const controlId = annotations?.controlId;
  const requirementId = annotations?.requirementId;
  const shownId = file?.id;
  const scope = useMemo(
    () =>
      controlId === undefined ||
      requirementId === undefined ||
      shownId === undefined
        ? null
        : {
            organizationId,
            projectId,
            controlId,
            requirementId,
            fileId: shownId,
          },
    [organizationId, projectId, controlId, requirementId, shownId],
  );
  const notes = useEvidenceAnnotations(scope);
  // Where the header takes the file's own actions (Download annotated copy, Add
  // annotation).
  const [headSlot, setHeadSlot] = useState<HTMLElement | null>(null);
  const annotationPick = useAnnotationPick(
    notes.set,
    file?.id,
    startAnnotationId,
    startAnnotationFor,
  );
  // The passage the file was opened to see (a "Shown" row), marked as cited where no
  // annotation of the file marks it once they are read, so it still opens on it.
  const askedQuote =
    startAnnotationFor !== undefined &&
    startAnnotationFor.quote !== "" &&
    file !== undefined &&
    file.id === first &&
    notes.status !== "loading" &&
    (notes.set === null ||
      annotationFor(notes.set, startAnnotationFor) === null)
      ? startAnnotationFor.quote
      : "";
  const marked = useMemo(() => {
    const list = [...citations];
    if (shown !== null && !list.some((item) => item.quote === shown.quote)) {
      list.push(shown);
    }
    if (
      askedQuote !== "" &&
      shownId !== undefined &&
      !list.some((item) => item.fileId === shownId && item.quote === askedQuote)
    ) {
      list.push({
        fileId: shownId,
        fileName: file?.fileName ?? "",
        quote: askedQuote,
        found: true,
        location: "",
        page: null,
        box: null,
        label: "",
      });
    }
    return list;
  }, [citations, shown, askedQuote, shownId, file?.fileName]);
  // A passage asked to see, once; an annotation asked for, once it is found; else the
  // first passage cited in the file.
  const askedPick = useMemo(
    () => (askedQuote === "" ? null : { quote: askedQuote }),
    [askedQuote],
  );
  const pick = shownPick ?? annotationPick ?? askedPick ?? citedPick;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      // An Escape the viewer inside took (the open annotation or passage) closes only
      // that: it stops there, so it never reaches this. A dialog the viewer is drawn in
      // may cancel the Escape's default to stay open itself (the evidence wizard's
      // window); this one still closes, as that window means it to.
      if (event.key === "Escape" && isTopmostDialog(dialog.current)) {
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

  const show = (next: string, at: ViewerPick | null) => {
    setFileId(next);
    setCitedPick(at);
    setShownPick(null);
  };

  if (file === undefined) {
    return null;
  }
  // How many passages are cited in each file, as its legend lists them: in the file shown,
  // after a citation that is one of its annotations is folded into it (citedMarks).
  const citedIn = (id: string) =>
    id === file.id
      ? citedMarks(
          marked,
          file.id,
          notes.set?.annotations ?? [],
          previewKind(file.fileName) === "image",
        ).filter((mark) => mark.fileId === id).length
      : marked.filter((item) => item.fileId === id).length;
  const aboutTab = about?.(file.id) ?? null;
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
              className="preview-file-switch"
              aria-label="File"
              value={file.id}
              onChange={(event) =>
                show(
                  event.target.value,
                  firstCited(citations, event.target.value),
                )
              }
            >
              {files.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.fileName}
                  {citedIn(item.id) > 0 ? ` (${citedIn(item.id)} cited)` : ""}
                </option>
              ))}
            </select>
          ) : null}
          <span className="ea-head" ref={setHeadSlot} />
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
        <AnnotatedEvidence
          key={file.id}
          file={file}
          query={query}
          set={notes.set}
          status={notes.status}
          busy={notes.busy}
          act={notes.act}
          headSlot={headSlot}
          citations={marked}
          citedBy={sourcesTitle}
          onOpenFile={(next, at) => {
            if (files.some((item) => item.id === next)) {
              show(next, at);
            }
          }}
          openable={files.map((item) => item.id)}
          pick={pick}
          about={aboutTab}
          startTab={tab}
          onTab={setTab}
          onShowPassage={(citation) => {
            setShown(citation);
            setShownPick({ quote: citation.quote });
          }}
          startAdding={file.id === first ? startAdding : undefined}
        />
      </div>
    </div>,
    container ?? document.body,
  );
}

/**
 * A file shown in a page (the evidence reviewer's Preview): the same viewer, inline, with
 * the annotations of its D&I request where one is known and the passages the page cites.
 * A citation selected elsewhere on the page (`focused`) is put in view. The file's own
 * actions go to `headSlot`.
 */
export function AnnotatedFile({
  organizationId,
  projectId,
  file,
  annotations,
  citations = [],
  focused = null,
  startAnnotationFor,
  startAnnotationId,
  startAdding,
  headSlot,
  returnFocus,
}: {
  organizationId: string;
  projectId: string;
  file: ShownFile;
  annotations?: Request | undefined;
  citations?: EvidenceCitation[];
  focused?: EvidenceCitation | null;
  startAnnotationFor?: AnnotationAsk | undefined;
  /** The annotation to open on, by its id. */
  startAnnotationId?: string | undefined;
  /** Opened to add an annotation for this attribute: drawing starts at once, where the
   * person may add one. */
  startAdding?: string | undefined;
  headSlot: HTMLElement | null;
  returnFocus?: (() => HTMLElement | null) | undefined;
}) {
  const controlId = annotations?.controlId;
  const requirementId = annotations?.requirementId;
  const scope = useMemo(
    () =>
      controlId === undefined || requirementId === undefined
        ? null
        : {
            organizationId,
            projectId,
            controlId,
            requirementId,
            fileId: file.id,
          },
    [organizationId, projectId, controlId, requirementId, file.id],
  );
  const notes = useEvidenceAnnotations(scope);
  const annotationPick = useAnnotationPick(
    notes.set,
    file.id,
    startAnnotationId,
    startAnnotationFor,
  );
  const focusedPick = useMemo(
    () =>
      focused !== null && focused.fileId === file.id
        ? { quote: focused.quote }
        : null,
    [focused, file.id],
  );
  return (
    <AnnotatedEvidence
      key={file.id}
      file={file}
      query={fileQuery(organizationId, projectId)}
      set={notes.set}
      status={notes.status}
      busy={notes.busy}
      act={notes.act}
      headSlot={headSlot}
      citations={citations}
      pick={focusedPick ?? annotationPick}
      inline
      returnFocus={returnFocus}
      startAdding={startAdding}
    />
  );
}
