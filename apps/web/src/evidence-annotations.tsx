"use client";

import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import {
  ANNOTATION_BOUNDS,
  ANNOTATION_KINDS,
  type Annotation,
  type AnnotationAction,
  type AnnotationScope,
  type AnnotationSet,
  annotatedCopyName,
  annotationCitations,
  annotationFields,
  annotationName,
  annotationProblem,
  annotationsQuery,
  attributeRows,
  boundsOf,
  CALLOUT_WIDTH,
  CITED_WORDS,
  type CitedMark,
  calloutPlace,
  checkLine,
  citedCitations,
  citedMarks,
  citedName,
  citedPageMarks,
  citedUnboxedLine,
  confirmAllWords,
  copyOffered,
  copyRows,
  doneWords,
  draftOf,
  drawnBox,
  type EditDraft,
  editChanges,
  HANDLE_WORDS,
  HANDLES,
  type Handle,
  handlePoint,
  isDrawn,
  KIND_WORDS,
  type KindTone,
  kindLine,
  legendRows,
  MARK_TOKEN,
  moveBox,
  NOT_IN_FILE,
  nextToReview,
  noAnnotations,
  nudgeOf,
  pageMarks,
  parseAnnotations,
  pickTarget,
  positionWords,
  REVIEW_WORDS,
  resizeBox,
  reviewCounts,
  reviewedWords,
  reviewLine,
  type ShownKind,
  type Size,
  STARTING_BOX,
  stepTo,
  textStageLine,
  unboxedLine,
  type ViewerPick,
  wrapText,
} from "./evidence-annotations-model";
import {
  type Box,
  type EvidenceCitation,
  previewKind,
} from "./evidence-preview-model";
import { type Found, ImageStage, PdfStage, TextStage } from "./evidence-stages";
import { formatDate } from "./format";
import { UiIcon } from "./ui-icon";
import { isTopmostDialog } from "./use-focus-trap";

/**
 * Evidence annotations in the preview (docs/evidence-annotations.md, section 1; the compact
 * layout the product owner approved on 14 November 2026): the evidence with a numbered box
 * on each annotated passage, what the file shows per attribute, one line per annotation,
 * and the basis of the one selected as a callout beside its box.
 *
 * The file is never changed: the boxes are a layer over it. An annotation is the agent's
 * proposal until a person reviews it, and every review is an audit record, so nothing here
 * is shown as done before the server has answered: the list on screen is always the list
 * the server last returned.
 */

type ActResult =
  | { ok: true; set: AnnotationSet | null }
  | { ok: false; problem: string };

export type AnnotationsState = {
  /** `off`: the file is on no D&I request, so nothing is asked. `absent`: the server has
   * none to show. `failed`: they could not be read. */
  status: "off" | "loading" | "ready" | "absent" | "failed";
  set: AnnotationSet | null;
  /** The action the server has not answered yet. */
  busy: AnnotationAction["intent"] | null;
  act: (action: AnnotationAction) => Promise<ActResult>;
};

type Loaded = {
  key: string;
  status: "ready" | "absent" | "failed";
  set: AnnotationSet | null;
};

/**
 * A file's annotations on a D&I request, and a person's review of them. Read when the
 * preview opens on the file; each action answers with the list as it then stands, and a
 * refusal because the annotation changed reads only the list again. Nothing else on the
 * page is fetched or reloaded, and the latest answer wins.
 */
export function useEvidenceAnnotations(
  scope: AnnotationScope | null,
): AnnotationsState {
  const key = scope === null ? "" : annotationsQuery(scope);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState<AnnotationAction["intent"] | null>(null);
  // Which call is the latest: an answer a later one overtook is dropped.
  const latest = useRef(0);

  const read = useCallback(
    async (keep: boolean) => {
      if (key === "") {
        return;
      }
      const run = ++latest.current;
      let status = 0;
      let result: unknown = null;
      try {
        const response = await fetch(`/workspace/evidence-annotations?${key}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as {
          status?: unknown;
          result?: unknown;
        };
        status = typeof body.status === "number" ? body.status : 0;
        result = body.result;
      } catch {
        status = 0;
      }
      if (run !== latest.current) {
        return;
      }
      const set = status === 200 ? parseAnnotations(result) : null;
      if (set !== null) {
        setLoaded({ key, status: "ready", set });
      } else if (!keep) {
        // No annotations for this file (or none this person may read) is not a fault.
        setLoaded({
          key,
          status: status === 404 || status === 403 ? "absent" : "failed",
          set: null,
        });
      }
    },
    [key],
  );

  useEffect(() => {
    read(false).catch(() => undefined);
    return () => {
      latest.current++;
    };
  }, [read]);

  const act = useCallback(
    async (action: AnnotationAction): Promise<ActResult> => {
      if (scope === null) {
        return { ok: false, problem: annotationProblem(0) ?? "" };
      }
      setBusy(action.intent);
      const run = ++latest.current;
      let status = 0;
      let detail = "";
      let result: unknown = null;
      try {
        const response = await fetch("/workspace/evidence-annotations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(annotationFields(scope, action)),
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
      const problem = annotationProblem(status, detail);
      if (problem !== null) {
        if (status === 409 || status === 404) {
          // It changed under the person: only the annotations are read again.
          read(true).catch(() => undefined);
        }
        return { ok: false, problem };
      }
      // The server confirmed it and answered with the list as it now stands.
      const confirmed = parseAnnotations(result);
      if (confirmed !== null && run === latest.current) {
        setLoaded({ key, status: "ready", set: confirmed });
        return { ok: true, set: confirmed };
      }
      await read(true);
      return { ok: true, set: null };
    },
    [scope, key, read],
  );

  if (key === "") {
    return { status: "off", set: null, busy: null, act };
  }
  if (loaded === null || loaded.key !== key) {
    return { status: "loading", set: null, busy, act };
  }
  return { status: loaded.status, set: loaded.set, busy, act };
}

/** The panel's shape while a file's annotations are read. */
export function AnnotationsLoading() {
  return (
    <aside className="ea-panel is-loading" aria-busy="true">
      <LegendLoading />
    </aside>
  );
}

/** The legend's shape while the annotations are read: in the panel, or in its tab. */
function LegendLoading() {
  return (
    <>
      <p className="sr-only" role="status">
        Reading the annotations
      </p>
      <div className="ea-sec" aria-hidden="true">
        <span className="ea-skel is-head" />
        <span className="ea-skel" />
        <span className="ea-skel" />
        <span className="ea-skel is-short" />
      </div>
      <div className="ea-sec" aria-hidden="true">
        <span className="ea-skel is-head" />
        <span className="ea-skel" />
        <span className="ea-skel" />
        <span className="ea-skel" />
        <span className="ea-skel is-short" />
      </div>
    </>
  );
}

/** Where a key belongs to what has the focus, not to the viewer's marks: a field, a
 * box's handle, the side panel's tabs, and "About this file" and the rows it shows. */
const KEYS_OF_THEIR_OWN =
  'input, textarea, select, [contenteditable], [data-handle], [role="tablist"], .ea-about, .ea-data';

/** The side panel's tabs, in order: the legend first. */
const PANEL_TABS: ReadonlyArray<readonly [PanelTab, string]> = [
  ["annotations", "Annotations"],
  ["about", "About this file"],
];

type Mode =
  | { kind: "view" }
  | { kind: "edit"; id: string; draft: EditDraft }
  | { kind: "draw" }
  | {
      kind: "add";
      page: number;
      draft: EditDraft & { box: Box };
      annotationKind: (typeof ANNOTATION_KINDS)[number];
    };

const VIEW: Mode = { kind: "view" };

/** At this window width and under, the legend goes under the evidence (the stylesheet's
 * breakpoint, which is the preview dialog's own). */
const STACKED_BELOW = 960;

const toneOf = (annotation: Pick<Annotation, "kind">): KindTone =>
  KIND_WORDS[annotation.kind].tone;

const boxStyle = (box: Box): CSSProperties => ({
  left: `${box.x * 100}%`,
  top: `${box.y * 100}%`,
  width: `${box.w * 100}%`,
  height: `${box.h * 100}%`,
});

const calm = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function useViewportWidth(): number {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener("resize", notify);
      return () => window.removeEventListener("resize", notify);
    },
    () => window.innerWidth,
    () => 1280,
  );
}

type Props = {
  file: { id: string; fileName: string };
  /** The organization and project the file's routes are read with (`fileQuery`). */
  query: string;
  /** The file's annotations on its D&I request; null where no request is known or none
   * could be read: the file is shown without them, and nothing is offered to review. */
  set: AnnotationSet | null;
  /** Where the annotations stand: still being read (the legend's shape is shown, the file
   * already is), or failed (said in one quiet line under the file). */
  status?: AnnotationsState["status"];
  busy: AnnotationAction["intent"] | null;
  act: (action: AnnotationAction) => Promise<ActResult>;
  /** Where the dialog's header takes this file's actions. */
  headSlot: HTMLElement | null;
  /** The passages the screen cites, in this file and in the others it opened (section
   * 5a): numbered boxes of their own kind, "Cited", in the same legend. */
  citations?: EvidenceCitation[];
  /** What cited them: the heading of their lines ("What the tester relied on"). */
  citedBy?: string;
  /** A cited passage of another of the files opened was selected: the dialog shows that
   * file, on that passage. */
  onOpenFile?: ((fileId: string, pick: ViewerPick) => void) | undefined;
  /** An annotation or cited passage the page asks to see (a reference of the D&I
   * workpaper, a citation selected elsewhere on the page): it is selected each time one
   * is asked for, and the person moves on from it as from any. */
  pick?: ViewerPick | null;
  /** Shown in a page, not in the dialog (the workpaper's evidence pane): the keys are
   * heard only while the focus is inside it, so the page's own keys stay the page's, and
   * it takes the focus only for what a person selects inside it, never when it appears,
   * when its annotations arrive, or for an annotation asked for from outside (`pick`). */
  inline?: boolean;
  /** Where the focus goes back to when an annotation asked for from outside is closed:
   * what asked for it (the reference chip), if it is still there. */
  returnFocus?: (() => HTMLElement | null) | undefined;
  /** Opened to add an annotation for this attribute (a tickmark's "Add an annotation",
   * docs/evidence-assurance.md, section 10.13): once the annotations are read and the
   * person may add one, drawing starts, and the box drawn names the attribute. Once. */
  startAdding?: string | undefined;
  /** The files `onOpenFile` can show: a cited passage of any other is listed, and its
   * line is not offered, since selecting it could open nothing. */
  openable?: readonly string[] | undefined;
  /** "About this file" (section 5b): the second tab of the side panel, beside the
   * legend; null where nothing about the file applies. */
  about?: AboutTab | null | undefined;
  /** The tab the panel opens on: "about" where the opener asked for the file's details
   * (a check's "Confirm the file's type"). The legend's otherwise. */
  startTab?: PanelTab | undefined;
  /** The tab a person chose: the dialog keeps it as the person moves between files. */
  onTab?: ((tab: PanelTab) => void) | undefined;
  /** A passage "About this file" asks to see: the dialog marks and selects it. */
  onShowPassage?: ((citation: EvidenceCitation) => void) | undefined;
};

/** The side panel's two tabs (section 5b). */
export type PanelTab = "annotations" | "about";

/** Where "About this file" is drawn, and what it may ask of the viewer. */
export type AboutPlace = {
  /** Where the tab may draw the file's data in place of the file (a population's rows,
   * to pick the walkthrough instance from); null until it is there. */
  stage: HTMLElement | null;
  /** Whether that data is drawn: the file is put aside meanwhile, and back after. */
  onStage: (shown: boolean) => void;
  /** Puts a passage of the file in view on the file: the focus stays in the tab. */
  show: (citation: EvidenceCitation) => void;
};

/** The content of "About this file", for the file shown. */
export type AboutTab = (place: AboutPlace) => ReactNode;

const NONE: EvidenceCitation[] = [];

/**
 * The one evidence viewer (docs/evidence-annotations.md, sections 1 and 5a): the file
 * left, the legend right. Every file in the app is shown through it, inline or in the
 * dialog: an image, a PDF, a spreadsheet's or a document's read text. Where the file's
 * D&I request is known its annotations are boxed and reviewed here; the passages a screen
 * cites are boxed as "Cited" beside them; a file with neither is shown by itself.
 */
export function AnnotatedEvidence({
  file,
  query,
  set: given,
  status = "off",
  busy,
  act,
  headSlot,
  citations = NONE,
  citedBy = "What the tester relied on",
  onOpenFile,
  pick = null,
  inline = false,
  returnFocus,
  startAdding,
  openable,
  about = null,
  startTab = "annotations",
  onTab,
  onShowPassage,
}: Props) {
  const kind = previewKind(file.fileName);
  // A box is drawn on a page: an image, or a PDF's page.
  const drawable = kind !== "text";
  const url = `/workspace/evidence-files/${file.id}/preview?${query}`;
  const reading = `/workspace/evidence-files/${file.id}/reading?${query}`;
  const download = `/workspace/evidence-files/${file.id}?${query}`;
  // Without a request, or with none read, the file has no annotations and offers nothing.
  const set = useMemo(() => given ?? noAnnotations(file.id), [given, file.id]);
  const loading = status === "loading";
  const root = useRef<HTMLDivElement>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const listId = useId();
  const citedListId = useId();
  // Where a sheet is shown: over the foot of the evidence, or, where the legend goes under
  // the evidence (evidence-annotations.css, 960px), along the bottom of the whole body.
  const [footHost, setFootHost] = useState<HTMLElement | null>(null);
  const [endHost, setEndHost] = useState<HTMLElement | null>(null);
  const sheetHost = useViewportWidth() <= STACKED_BELOW ? endHost : footHost;
  const [noteHost, setNoteHost] = useState<HTMLElement | null>(null);
  const [layerOn, setLayerOn] = useState(false);
  // The page of the evidence in view, as its layer reports it: a new box starts there.
  const pageInView = useRef(1);
  const onPageInView = useCallback((page: number) => {
    pageInView.current = page;
  }, []);

  const { annotations } = set;
  // The passages cited, by their content: a screen passes a new list on each of its
  // renders, and a new list alone must not move the page or the selection.
  const citedKey = JSON.stringify(citations);
  const steady = useMemo(
    () => JSON.parse(citedKey) as EvidenceCitation[],
    [citedKey],
  );
  // Numbered after this file's annotations; while those are read none is drawn, so no
  // number changes under the person.
  const cited = useMemo(
    () =>
      loading ? [] : citedMarks(steady, file.id, annotations, kind === "image"),
    [loading, steady, file.id, annotations, kind],
  );
  const citedHere = useMemo(
    () => cited.filter((mark) => mark.fileId === file.id),
    [cited, file.id],
  );
  // A cited passage of another file is reached only where the dialog can show that file.
  const opens = (fileId: string) =>
    fileId === file.id ||
    (onOpenFile !== undefined &&
      (openable === undefined || openable.includes(fileId)));
  // The cited passages a person can step through: this file's, and those of the other
  // files the dialog shows, in the screen's order (the old viewer's Previous and Next).
  const reachable = cited.filter((mark) => opens(mark.fileId));
  // What the keys move through when nothing is selected: the annotations, then the
  // cited passages of this file.
  const marks = useMemo(
    () => [...annotations, ...citedHere],
    [annotations, citedHere],
  );

  const [selectedId, setSelectedId] = useState<string | null>(() =>
    pickTarget(pick, annotations, citedHere),
  );
  // Whether the mark in view was asked for from outside, not selected in here.
  const [asked, setAsked] = useState(
    pickTarget(pick, annotations, citedHere) !== null,
  );
  const [mode, setMode] = useState<Mode>(VIEW);
  const [removing, setRemoving] = useState(false);
  // The side panel's tab, and the file's data drawn in place of the file (section 5b).
  const [tab, setTabState] = useState<PanelTab>(startTab);
  const setTab = (next: PanelTab) => {
    setTabState(next);
    onTab?.(next);
  };
  const [dataHost, setDataHost] = useState<HTMLElement | null>(null);
  const [dataShown, setDataShown] = useState(false);
  const tabsId = useId();
  const tabRefs = useRef(new Map<PanelTab, HTMLButtonElement>());
  // A passage "About this file" asked to see: it is put in view on the file, and the
  // focus stays in the tab the person is working in.
  const [fromAbout, setFromAbout] = useState(false);
  // A refusal is shown where the action was taken; what was done, in the panel.
  const [problem, setProblem] = useState<string | null>(null);
  const [panelProblem, setPanelProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  // An action the server has not answered yet: no second one is sent meanwhile.
  const sending = useRef(false);

  const selected =
    annotations.find((annotation) => annotation.id === selectedId) ?? null;
  const selectedCited =
    citedHere.find((mark) => mark.id === selectedId) ?? null;
  // An edit of an annotation that is no longer the one selected is over.
  const active: Mode =
    mode.kind === "edit" && selected?.id !== mode.id ? VIEW : mode;
  const counts = reviewCounts(annotations);
  const waiting = busy !== null;
  // What the file viewers mark: the annotations, then the cited passages, in that order.
  const stageCitations = useMemo(
    () => [
      ...annotationCitations(set, file.fileName),
      ...citedCitations(citedHere),
    ],
    [set, file.fileName, citedHere],
  );
  // Each passage's kind, by its place: a file shown as its text marks them apart.
  const stageKinds = useMemo(
    () => [
      ...annotations.map(() => "annotated" as const),
      ...citedHere.map(() => "cited" as const),
    ],
    [annotations, citedHere],
  );
  const focused =
    selected !== null
      ? (stageCitations[selected.number - 1] ?? null)
      : selectedCited !== null
        ? (stageCitations[
            annotations.length + citedHere.indexOf(selectedCited)
          ] ?? null)
        : null;
  // The legend: the annotations where the request is known and there are some (or one is
  // being drawn), and the cited passages; neither, and the file is shown by itself.
  const annotated =
    given !== null &&
    (annotations.length > 0 || active.kind === "draw" || active.kind === "add");
  const withPanel = loading || annotated || cited.length > 0;
  const withFoot =
    !dataShown &&
    (marks.length > 0 ||
      active.kind !== "view" ||
      status === "failed" ||
      (kind === "text" && marks.length > 0));

  // A mark asked for from elsewhere on the page is the one in view; asked for while the
  // annotations are read, once they are here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a pick is acted on when it is asked for, and once the marks it may name are here (`loading`).
  useEffect(() => {
    if (pick === null || loading) {
      return;
    }
    const target = pickTarget(pick, annotations, citedHere);
    if (target !== null) {
      setAsked(true);
      setSelectedId(target);
      setMode(VIEW);
      setRemoving(false);
      setProblem(null);
    }
  }, [pick, loading]);

  const dialogOf = () =>
    root.current?.closest<HTMLElement>('[role="dialog"]') ?? null;

  function select(id: string | null) {
    setAsked(false);
    setFromAbout(false);
    setSelectedId(id);
    setMode(VIEW);
    setRemoving(false);
    setProblem(null);
  }

  /** A line of the legend selected: a cited passage of another file opens that file. */
  function choose(mark: CitedMark) {
    if (mark.fileId !== file.id) {
      onOpenFile?.(mark.fileId, { quote: mark.quote });
      return;
    }
    select(mark.id);
  }

  /** Closes the callout and hands the focus back: to what asked for the annotation from
   * outside where something did, else to the annotation's line. */
  function close() {
    const line =
      selectedId === null ? null : rowButtons.current.get(selectedId);
    const back = asked ? (returnFocus?.() ?? null) : null;
    select(null);
    (back ?? line ?? dialogOf())?.focus();
  }

  /** Previous and next: from an annotation, through the annotations; from a cited
   * passage, through the cited passages, into the next file the dialog shows where it is
   * there; from nothing, to the first or last mark of this file. */
  function step(direction: 1 | -1) {
    if (selectedCited !== null) {
      const next = stepTo(reachable, selectedCited.id, direction);
      const mark = reachable.find((each) => each.id === next);
      if (mark !== undefined) {
        choose(mark);
      }
      return;
    }
    const next = stepTo(
      selected !== null ? annotations : marks,
      selectedId,
      direction,
    );
    if (next !== null) {
      select(next);
    }
  }

  /** One action, sent and answered; null while another is still out (a key held down
   * sends once). What it did is said only once the server has confirmed it; a refusal is
   * shown in the server's words where the action was taken. */
  async function run(
    action: AnnotationAction,
    about: { number?: number; count?: number },
    where: "callout" | "panel",
  ): Promise<ActResult | null> {
    if (sending.current) {
      return null;
    }
    sending.current = true;
    setProblem(null);
    setPanelProblem(null);
    setDone(null);
    const result = await act(action);
    sending.current = false;
    if (result.ok) {
      setDone(doneWords(action, about));
    } else if (where === "callout") {
      setProblem(result.problem);
    } else {
      setPanelProblem(result.problem);
    }
    return result;
  }

  async function confirm(annotation: Annotation) {
    if (!set.canEdit || waiting || annotation.status !== "PROPOSED") {
      return;
    }
    const next = nextToReview(annotations, annotation.id);
    const result = await run(
      { intent: "confirm", id: annotation.id, version: annotation.version },
      { number: annotation.number },
      "callout",
    );
    if (result?.ok) {
      setSelectedId(next ?? annotation.id);
      // The person confirmed it: what follows is theirs to confirm by key as well.
      setAsked(false);
    }
  }

  async function confirmAll() {
    if (!set.canEdit || waiting) {
      return;
    }
    await run({ intent: "confirm-all" }, { count: counts.proposed }, "panel");
  }

  async function saveEdit(annotation: Annotation, draft: EditDraft) {
    const changes = editChanges(annotation, draft);
    if (!set.canEdit || waiting || changes === null) {
      return;
    }
    const result = await run(
      {
        intent: "edit",
        id: annotation.id,
        version: annotation.version,
        changes,
      },
      { number: annotation.number },
      "callout",
    );
    if (result?.ok) {
      setMode(VIEW);
    }
  }

  async function remove(annotation: Annotation) {
    if (!set.canEdit || waiting) {
      return;
    }
    const next =
      stepTo(annotations, annotation.id, 1) ??
      stepTo(annotations, annotation.id, -1);
    const result = await run(
      { intent: "remove", id: annotation.id, version: annotation.version },
      { number: annotation.number },
      "callout",
    );
    if (result?.ok) {
      select(next);
      if (next === null) {
        dialogOf()?.focus();
      }
    } else if (result !== null) {
      setRemoving(false);
    }
  }

  async function saveAdd(added: Extract<Mode, { kind: "add" }>) {
    const statement = added.draft.statement.replace(/\s+/g, " ").trim();
    if (!set.canEdit || waiting || statement === "") {
      return;
    }
    const before = new Set(annotations.map((annotation) => annotation.id));
    const result = await run(
      {
        intent: "add",
        page: added.page,
        rects: [added.draft.box],
        statement,
        attributeIds: added.draft.attributeIds,
        kind: added.annotationKind,
      },
      {},
      "callout",
    );
    if (result?.ok) {
      select(
        result.set?.annotations.find((each) => !before.has(each.id))?.id ??
          null,
      );
    }
  }

  function startDrawing() {
    select(null);
    setDone(null);
    setMode({ kind: "draw" });
  }

  function drawn(box: Box, page: number) {
    setMode({
      kind: "add",
      page,
      draft: {
        statement: "",
        // Opened to add one for an attribute: it is chosen, and can be changed.
        attributeIds:
          startAdding !== undefined &&
          set.attributes.some((attribute) => attribute.id === startAdding)
            ? [startAdding]
            : [],
        box,
      },
      annotationKind: "SHOWS",
    });
  }

  // Opened to add an annotation: drawing starts once, when the person may draw.
  const addingStarted = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: drawing starts once, when what it needs is here; startDrawing is the component's own.
  useEffect(() => {
    if (
      startAdding === undefined ||
      addingStarted.current ||
      loading ||
      !set.canEdit ||
      !drawable
    ) {
      return;
    }
    addingStarted.current = true;
    startDrawing();
  }, [startAdding, loading, set.canEdit, drawable]);

  async function downloadCopy() {
    setCopying(true);
    setPanelProblem(null);
    setDone(null);
    const saved = await saveAnnotatedCopy(url, file.fileName, set);
    setCopying(false);
    if (saved) {
      setDone("The annotated copy was saved to your downloads.");
    } else {
      setPanelProblem(
        "The annotated copy could not be made. Download the file itself instead.",
      );
    }
  }

  // Enter confirms the selected proposal and moves on, the arrow keys move, and Escape
  // closes what is open here before it closes the dialog. Heard first (capture), so the
  // dialog's own Escape does not close it as well.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const here = root.current;
      // A key something else took is left to it; an Escape is heard even so, since a
      // dialog the viewer is drawn in cancels its default to stay open itself (the
      // evidence wizard's window), and what is open here still closes first.
      if (here === null || (event.defaultPrevented && event.key !== "Escape")) {
        return;
      }
      if (
        inline &&
        !(event.target instanceof Node && here.contains(event.target))
      ) {
        return;
      }
      const dialog = here.closest<HTMLElement>('[role="dialog"]');
      if (dialog !== null && !isTopmostDialog(dialog)) {
        return;
      }
      const stop = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      if (event.key === "Escape") {
        if (active.kind !== "view") {
          stop();
          setMode(VIEW);
          setProblem(null);
        } else if (removing) {
          stop();
          setRemoving(false);
        } else if (selected !== null || selectedCited !== null) {
          stop();
          close();
        }
        return;
      }
      if (
        active.kind !== "view" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      // A field's keys are the field's, and so are the side panel's tabs' and what
      // "About this file" holds (section 5b): there the arrows move between the tabs.
      if (target?.closest(KEYS_OF_THEIR_OWN)) {
        return;
      }
      if (marks.length === 0) {
        return;
      }
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        stop();
        step(event.key === "ArrowRight" ? 1 : -1);
        return;
      }
      // On a button or a link, Enter is that control's own.
      if (event.key === "Enter" && !target?.closest("button, a, summary")) {
        if (selected === null && selectedCited === null) {
          const first = nextToReview(annotations, null) ?? marks[0]?.id;
          if (first !== undefined) {
            stop();
            select(first);
          }
        } else if (
          // An annotation the viewer was opened on (a reference, a citation) is not
          // confirmed by a key: the person selects it, or presses Confirm, first.
          selected !== null &&
          !asked &&
          set.canEdit &&
          selected.status === "PROPOSED"
        ) {
          stop();
          confirm(selected).catch(() => undefined);
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });

  const callout: { node: ReactNode; tone: KindTone; label: string } | null =
    active.kind === "add"
      ? {
          tone: KIND_WORDS[active.annotationKind].tone,
          label: "New annotation",
          node: (
            <SentenceForm
              title="New annotation"
              set={set}
              draft={active.draft}
              annotationKind={active.annotationKind}
              onKind={(annotationKind) =>
                setMode({ ...active, annotationKind })
              }
              onDraft={(draft) =>
                setMode({
                  ...active,
                  draft: { ...draft, box: active.draft.box },
                })
              }
              canSave={active.draft.statement.trim() !== ""}
              busy={busy}
              problem={problem}
              saveLabel="Save annotation"
              onSave={() => saveAdd(active)}
              onCancel={() => {
                setMode(VIEW);
                setProblem(null);
              }}
            />
          ),
        }
      : selectedCited !== null
        ? {
            tone: CITED_WORDS.tone,
            label: `Cited ${selectedCited.number}`,
            node: (
              <CitedBasis
                mark={selectedCited}
                citedBy={citedBy}
                at={positionWords(reachable, selectedCited.id)}
                previous={stepTo(reachable, selectedCited.id, -1) !== null}
                next={stepTo(reachable, selectedCited.id, 1) !== null}
                onStep={step}
                onClose={close}
                quiet={(inline || fromAbout) && asked}
                asked={asked}
              />
            ),
          }
        : selected === null
          ? null
          : {
              tone: toneOf(selected),
              label: `Annotation ${selected.number}`,
              node:
                active.kind === "edit" ? (
                  <SentenceForm
                    title={`Annotation ${selected.number}`}
                    set={set}
                    annotation={selected}
                    draft={active.draft}
                    onDraft={(draft) => setMode({ ...active, draft })}
                    canSave={editChanges(selected, active.draft) !== null}
                    busy={busy}
                    problem={problem}
                    saveLabel="Save"
                    onSave={() => saveEdit(selected, active.draft)}
                    onCancel={() => {
                      setMode(VIEW);
                      setProblem(null);
                      setRemoving(false);
                    }}
                    removing={removing}
                    onAskRemove={() => setRemoving(true)}
                    onKeep={() => setRemoving(false)}
                    onRemove={() => remove(selected)}
                  />
                ) : (
                  <Basis
                    annotation={selected}
                    at={positionWords(annotations, selected.id)}
                    previous={stepTo(annotations, selected.id, -1) !== null}
                    next={stepTo(annotations, selected.id, 1) !== null}
                    onStep={step}
                    onClose={close}
                    problem={problem}
                    asking={removing}
                    quiet={(inline || fromAbout) && asked}
                    asked={asked}
                    actions={
                      set.canEdit ? (
                        <ReviewActions
                          annotation={selected}
                          busy={busy}
                          removing={removing}
                          onConfirm={() => confirm(selected)}
                          onEdit={() => {
                            setProblem(null);
                            setMode({
                              kind: "edit",
                              id: selected.id,
                              draft: draftOf(selected),
                            });
                          }}
                          onAskRemove={() => setRemoving(true)}
                          onKeep={() => setRemoving(false)}
                          onRemove={() => remove(selected)}
                        />
                      ) : null
                    }
                  />
                ),
            };

  // The box under a person's hand: the one being edited, or the new one.
  const adjust =
    active.kind === "add"
      ? {
          id: null,
          number: null,
          page: active.page,
          box: active.draft.box,
          tone: KIND_WORDS[active.annotationKind].tone,
        }
      : active.kind === "edit" && selected !== null && active.draft.box !== null
        ? {
            id: selected.id,
            number: selected.number,
            page: selected.page,
            box: active.draft.box,
            tone: toneOf(selected),
          }
        : null;

  const layer = (page: number | null, found: Found, ready: boolean) => (
    <Layer
      annotations={annotations}
      cited={citedHere}
      page={page}
      found={found}
      ready={ready}
      selectedId={selectedId}
      onSelect={select}
      adjust={adjust}
      onBox={(box) => {
        if (active.kind === "add") {
          setMode({ ...active, draft: { ...active.draft, box } });
        } else if (active.kind === "edit") {
          setMode({ ...active, draft: { ...active.draft, box } });
        }
      }}
      drawing={active.kind === "draw"}
      onDrawn={drawn}
      callout={callout}
      sheetHost={sheetHost}
      noteHost={noteHost}
      onMounted={setLayerOn}
      onPage={onPageInView}
      shownKind={kind}
    />
  );

  const legend = legendRows(set);
  const matrix = attributeRows(set);
  const kinds = [...new Set(annotations.map((annotation) => annotation.kind))];
  const textLine =
    kind === "text"
      ? textStageLine(annotations.length > 0, citedHere.length > 0)
      : "";
  const lineRef = (id: string) => (node: HTMLButtonElement | null) => {
    if (node === null) {
      rowButtons.current.delete(id);
    } else {
      rowButtons.current.set(id, node);
    }
  };

  // The legend: what this file shows, its annotations, the cited passages, and the
  // review's footer.
  const legendBody = (
    <>
      {annotated && matrix.length > 0 ? (
        <section className="ea-sec">
          <h3>What this file shows</h3>
          <ul className="ea-matrix">
            {matrix.map((row) => (
              <li
                key={row.id}
                className={`ea-mrow${row.marks.length === 0 ? " is-none" : ""}`}
              >
                <span className="ea-attr">{row.code}</span>
                <span className="ea-mtext" title={row.text}>
                  {row.text}
                </span>
                {row.marks.length === 0 ? (
                  <span className="pill tone-warning">{NOT_IN_FILE}</span>
                ) : (
                  <span className="ea-refs">
                    {row.marks.map((mark) => (
                      <button
                        type="button"
                        key={mark.id}
                        className={`ea-ref ea-tone-${KIND_WORDS[mark.kind].tone}`}
                        aria-label={`Annotation ${mark.number}: ${KIND_WORDS[mark.kind].label}`}
                        onClick={() => select(mark.id)}
                      >
                        {mark.number}
                      </button>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {annotated ? (
        <section className="ea-sec ea-list">
          <h3 id={listId}>
            Annotations
            {counts.total > 0 ? <small>{reviewedWords(counts)}</small> : null}
          </h3>
          {legend.length === 0 ? (
            <p className="ea-none">No annotations on this file yet.</p>
          ) : (
            <ol className="ea-rows" aria-labelledby={listId}>
              {legend.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    ref={lineRef(row.id)}
                    className={`ea-row ea-tone-${KIND_WORDS[row.kind].tone}${
                      row.id === selectedId ? " is-selected" : ""
                    }`}
                    aria-current={row.id === selectedId ? "true" : undefined}
                    title={`${KIND_WORDS[row.kind].label} · ${REVIEW_WORDS[row.review].word}`}
                    onClick={() => select(row.id)}
                  >
                    <span className="ea-num">{row.number}</span>
                    <span className="ea-what">
                      {row.label}
                      {row.value !== "" ? <span> · {row.value}</span> : null}
                    </span>
                    <span className="ea-letters">
                      {row.codes.map((code) => (
                        <span className="ea-attr" key={code}>
                          {code}
                        </span>
                      ))}
                    </span>
                    <span
                      className={`ea-st is-${row.review}`}
                      aria-hidden="true"
                    >
                      {REVIEW_WORDS[row.review].mark}
                    </span>
                    <span className="sr-only">
                      {KIND_WORDS[row.kind].label}.{" "}
                      {REVIEW_WORDS[row.review].word}.
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          {counts.total > 0 ? (
            <div className="ea-progress" aria-hidden="true">
              <i
                style={{
                  width: `${(counts.reviewed / counts.total) * 100}%`,
                }}
              />
            </div>
          ) : null}
        </section>
      ) : null}
      {cited.length > 0 ? (
        <section className="ea-sec ea-list ea-cited">
          <h3 id={citedListId}>{citedBy}</h3>
          <ol className="ea-rows" aria-labelledby={citedListId}>
            {cited.map((mark) => {
              const elsewhere = mark.fileId !== file.id;
              return (
                <li key={mark.id}>
                  <button
                    type="button"
                    ref={lineRef(mark.id)}
                    className={`ea-row ea-tone-${CITED_WORDS.tone}${
                      mark.id === selectedId ? " is-selected" : ""
                    }${elsewhere ? " is-elsewhere" : ""}`}
                    aria-current={mark.id === selectedId ? "true" : undefined}
                    title={
                      elsewhere
                        ? `${CITED_WORDS.label} · in ${mark.fileName}`
                        : CITED_WORDS.label
                    }
                    disabled={elsewhere && !opens(mark.fileId)}
                    onClick={() => choose(mark)}
                  >
                    <span className="ea-num is-cited">{mark.number}</span>
                    <span className="ea-what">
                      <q>{mark.quote}</q>
                      {mark.location !== "" ? (
                        <span> · {mark.location}</span>
                      ) : null}
                      {elsewhere ? <span> · {mark.fileName}</span> : null}
                    </span>
                    <span className="ea-letters">
                      {mark.label !== "" ? (
                        <span className="ea-attr">{mark.label}</span>
                      ) : null}
                    </span>
                    <span className="ea-st is-cited" aria-hidden="true">
                      <UiIcon name={CITED_WORDS.mark} size={11} />
                    </span>
                    <span className="sr-only">
                      {CITED_WORDS.label}
                      {elsewhere ? `, in ${mark.fileName}` : ""}.
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
      {annotated || citedHere.length > 0 ? (
        <footer className="ea-foot">
          {annotated && set.canEdit && counts.proposed > 0 ? (
            <ConfirmAll
              proposed={counts.proposed}
              busy={busy}
              onConfirmAll={confirmAll}
            />
          ) : null}
          {marks.length > 0 ? (
            <small>
              {set.canEdit && counts.proposed > 0
                ? "or review one by one with "
                : set.canEdit && counts.total > 0
                  ? "Every annotation is reviewed. Move between them with "
                  : counts.total > 0
                    ? "Move between the annotations with "
                    : "Move between the cited passages with "}
              {set.canEdit && counts.proposed > 0 ? (
                <>
                  <kbd className="ea-kbd">↵</kbd>{" "}
                </>
              ) : null}
              <kbd className="ea-kbd">←</kbd> <kbd className="ea-kbd">→</kbd>
            </small>
          ) : null}
          <p className="ea-done" role="status">
            {done !== null ? (
              <>
                <UiIcon name="check" size={13} /> {done}
              </>
            ) : null}
          </p>
          {panelProblem !== null ? (
            <p className="ea-problem" role="alert">
              {panelProblem}
            </p>
          ) : null}
        </footer>
      ) : null}
    </>
  );
  // With nothing in the legend, "About this file" is the panel by itself.
  const shownTab: PanelTab = withPanel ? tab : "about";
  /** The arrow keys, Home and End move between the two tabs, and choose the one reached. */
  const onTabKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const at = PANEL_TABS.findIndex(([key]) => key === shownTab);
    const to =
      event.key === "ArrowRight"
        ? (at + 1) % PANEL_TABS.length
        : event.key === "ArrowLeft"
          ? (at + PANEL_TABS.length - 1) % PANEL_TABS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? PANEL_TABS.length - 1
              : -1;
    const next = PANEL_TABS[to]?.[0];
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    // Heard before the viewer's own arrow keys, which step through the marks.
    event.stopPropagation();
    setTab(next);
    tabRefs.current.get(next)?.focus();
  };
  const place: AboutPlace = {
    stage: dataHost,
    onStage: setDataShown,
    show: (citation) => {
      setFromAbout(true);
      onShowPassage?.(citation);
    },
  };

  return (
    <div
      className={`preview-body ea-body${withPanel || about !== null ? "" : " is-plain"}`}
      ref={root}
    >
      <div className="ea-stage-col">
        <div className="preview-stage ea-stage">
          {dataShown ? null : kind === "image" ? (
            <ImageStage url={url} download={download} name={file.fileName}>
              {layer(null, [], true)}
            </ImageStage>
          ) : kind === "pdf" ? (
            <PdfStage
              url={url}
              download={download}
              citations={stageCitations}
              focused={focused}
              marks={(found, page, ready) => layer(page, found, ready)}
            />
          ) : (
            <TextStage
              url={reading}
              download={download}
              citations={stageCitations}
              kinds={stageKinds}
              focused={focused}
            />
          )}
          {about !== null ? (
            // The file's data, where "About this file" draws it (a population's rows).
            <div className="ea-data" ref={setDataHost} hidden={!dataShown} />
          ) : null}
        </div>
        {withFoot ? (
          <div className="ea-stage-foot">
            <div className="ea-sheet-host is-foot" ref={setFootHost} />
            {active.kind === "draw" ? (
              <p className="ea-drawbar" role="status">
                <span>
                  Drag on the evidence to draw a box around the words.
                </span>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => drawn(STARTING_BOX, pageInView.current)}
                >
                  Place a box to adjust
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => setMode(VIEW)}
                >
                  Cancel
                </button>
              </p>
            ) : marks.length > 0 ? (
              <p className="ea-hint">
                {annotations.length > 0
                  ? "Select a box or a line to see its basis. The file itself is never changed."
                  : "Select a box or a line to see what is cited. The file itself is never changed."}
              </p>
            ) : null}
            {status === "failed" ? (
              <p className="ea-hint">
                The annotations could not be loaded. The file is shown without
                them.
              </p>
            ) : null}
            <span className="ea-quiet" ref={setNoteHost}>
              {textLine !== "" ? textLine : null}
            </span>
            {kinds.length > 0 || citedHere.length > 0 ? (
              <ul className="ea-key" aria-label="Kinds of mark">
                {kinds.map((each) => (
                  <li key={each} className={`ea-tone-${KIND_WORDS[each].tone}`}>
                    <UiIcon name={KIND_WORDS[each].mark} size={13} />
                    {KIND_WORDS[each].label}
                  </li>
                ))}
                {citedHere.length > 0 ? (
                  <li className={`ea-tone-${CITED_WORDS.tone}`}>
                    <UiIcon name={CITED_WORDS.mark} size={13} />
                    {CITED_WORDS.label}
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      {about === null ? (
        loading ? (
          <AnnotationsLoading />
        ) : withPanel ? (
          <aside className="ea-panel" aria-label="Legend">
            {legendBody}
          </aside>
        ) : null
      ) : (
        <aside
          className="ea-panel has-tabs"
          aria-label={
            withPanel ? "Annotations and the file" : "About this file"
          }
        >
          {withPanel ? (
            <div className="ea-tabs-bar">
              <div
                className="ea-tabs"
                role="tablist"
                aria-label="Beside the file"
                onKeyDown={onTabKey}
              >
                {PANEL_TABS.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    id={`${tabsId}-${key}`}
                    ref={(node) => {
                      if (node === null) {
                        tabRefs.current.delete(key);
                      } else {
                        tabRefs.current.set(key, node);
                      }
                    }}
                    className={`ea-tab${shownTab === key ? " is-on" : ""}`}
                    aria-selected={shownTab === key}
                    aria-controls={`${tabsId}-${key}-panel`}
                    tabIndex={shownTab === key ? 0 : -1}
                    onClick={() => setTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {withPanel ? (
            <div
              className="ea-tabpanel"
              role="tabpanel"
              id={`${tabsId}-annotations-panel`}
              aria-labelledby={`${tabsId}-annotations`}
              hidden={shownTab !== "annotations"}
            >
              {loading ? <LegendLoading /> : legendBody}
            </div>
          ) : null}
          <div
            className="ea-tabpanel ea-about"
            {...(withPanel
              ? {
                  role: "tabpanel",
                  id: `${tabsId}-about-panel`,
                  "aria-labelledby": `${tabsId}-about`,
                }
              : {})}
            hidden={withPanel && shownTab !== "about"}
          >
            {about(place)}
          </div>
        </aside>
      )}

      <div className="ea-sheet-host is-end" ref={setEndHost} />
      {!layerOn && callout !== null ? (
        <CalloutShell
          frame={null}
          box={null}
          sheetHost={sheetHost}
          tone={callout.tone}
          label={callout.label}
        >
          {callout.node}
        </CalloutShell>
      ) : null}

      {headSlot !== null
        ? createPortal(
            <>
              {copyOffered(file.fileName, set) ? (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={copying}
                  onClick={() => downloadCopy().catch(() => setCopying(false))}
                >
                  {copying ? "Preparing the copy…" : "Download annotated copy"}
                </button>
              ) : null}
              {set.canEdit && drawable ? (
                <AddAnnotation
                  disabled={waiting || active.kind === "draw"}
                  onAdd={startDrawing}
                />
              ) : null}
            </>,
            headSlot,
          )
        : null}
    </div>
  );
}

/** "Add annotation": a person draws a box on the evidence, then says what it shows. */
function AddAnnotation({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: () => void;
}) {
  return (
    <button
      type="button"
      className="btn-secondary btn-sm"
      disabled={disabled}
      onClick={onAdd}
    >
      Add annotation
    </button>
  );
}

/** "Confirm all N proposed", for a routine file: one decision, recorded per annotation. */
function ConfirmAll({
  proposed,
  busy,
  onConfirmAll,
}: {
  proposed: number;
  busy: AnnotationAction["intent"] | null;
  onConfirmAll: () => void;
}) {
  return (
    <button
      type="button"
      className="btn-block"
      disabled={busy !== null}
      onClick={onConfirmAll}
    >
      {busy === "confirm-all" ? "Confirming…" : confirmAllWords(proposed)}
    </button>
  );
}

type Adjust = {
  /** The annotation whose box it is; null for a new one. */
  id: string | null;
  number: number | null;
  page: number;
  box: Box;
  tone: KindTone;
};

/**
 * The layer over one page of the evidence: a numbered box on each annotated passage and on
 * each cited one, the box under a person's hand with its eight handles, the surface a new
 * box is drawn on, and the callout of the mark selected. Nothing of the file is touched.
 */
function Layer({
  annotations,
  cited,
  page,
  found,
  ready,
  selectedId,
  onSelect,
  adjust,
  onBox,
  drawing,
  onDrawn,
  callout,
  sheetHost,
  noteHost,
  onMounted,
  onPage,
  shownKind,
}: {
  annotations: Annotation[];
  /** The passages cited in this file, numbered after its annotations. */
  cited: CitedMark[];
  /** The page in view; null for a file of one page. */
  page: number | null;
  found: Found;
  /** Whether `found` is this page's: a page still being drawn has none yet. */
  ready: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  adjust: Adjust | null;
  onBox: (box: Box) => void;
  drawing: boolean;
  onDrawn: (box: Box, page: number) => void;
  callout: { node: ReactNode; tone: KindTone; label: string } | null;
  sheetHost: HTMLElement | null;
  noteHost: HTMLElement | null;
  onMounted: (mounted: boolean) => void;
  onPage: (page: number) => void;
  /** How the file is shown: a cited passage without a box is said so in its terms. */
  shownKind: ShownKind;
}) {
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [sketch, setSketch] = useState<{
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null>(null);
  const drag = useRef<{
    handle: Handle | "move";
    start: Box;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    onMounted(true);
    return () => onMounted(false);
  }, [onMounted]);

  useEffect(() => {
    onPage(page ?? 1);
  }, [onPage, page]);

  // The selected box comes into view; the focus stays where the person put it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a PDF's box is there only once its page is drawn (`page`, `ready`).
  useEffect(() => {
    if (selectedId === null || frame === null) {
      return;
    }
    frame.querySelector('[data-selected="true"]')?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: calm() ? "auto" : "smooth",
    });
  }, [selectedId, frame, page, ready]);

  const marks = pageMarks(annotations, page, found);
  // A cited passage's words are found after the annotations' (`found`, by place).
  const citedOn = citedPageMarks(cited, page, found, annotations.length);
  const adjustHere =
    adjust !== null && (page === null || adjust.page === page) ? adjust : null;
  const anchor =
    adjustHere !== null
      ? adjustHere.box
      : adjust !== null
        ? null
        : boundsOf(
            [...marks, ...citedOn].find((mark) => mark.id === selectedId)
              ?.rects ?? [],
          );
  const quiet = ready
    ? [
        unboxedLine(annotations, page, marks),
        citedUnboxedLine(cited, page, citedOn, shownKind),
      ]
        .filter((line): line is string => line !== null)
        .join(" ") || null
    : null;

  /** A pointer's place on the page, as fractions of it. */
  const point = (event: { clientX: number; clientY: number }) => {
    const bounds = frame?.getBoundingClientRect();
    return bounds === undefined || bounds.width === 0 || bounds.height === 0
      ? { x: 0, y: 0 }
      : {
          x: (event.clientX - bounds.left) / bounds.width,
          y: (event.clientY - bounds.top) / bounds.height,
        };
  };

  /** A handle (or the box itself) taken hold of by mouse, touch or pen, or moved by the
   * arrow keys while it has the focus. */
  const held = (handle: Handle | "move") => ({
    "data-handle": handle,
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (adjustHere === null) {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.focus({ preventScroll: true });
      drag.current = { handle, start: adjustHere.box, ...point(event) };
    },
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
      const from = drag.current;
      if (from === null) {
        return;
      }
      const at = point(event);
      const [dx, dy] = [at.x - from.x, at.y - from.y];
      onBox(
        from.handle === "move"
          ? moveBox(from.start, dx, dy)
          : resizeBox(from.start, from.handle, dx, dy),
      );
    },
    onPointerUp: () => {
      drag.current = null;
    },
    onPointerCancel: () => {
      drag.current = null;
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const nudge = nudgeOf(event.key, event.shiftKey);
      if (nudge === null || adjustHere === null) {
        return;
      }
      event.preventDefault();
      onBox(
        handle === "move"
          ? moveBox(adjustHere.box, nudge.dx, nudge.dy)
          : resizeBox(adjustHere.box, handle, nudge.dx, nudge.dy),
      );
    },
  });

  return (
    <div className="ea-layer" ref={setFrame}>
      {marks.map((mark, index) => {
        const annotation = annotations[index];
        if (annotation === undefined || adjustHere?.id === mark.id) {
          return null;
        }
        const on = mark.id === selectedId;
        return mark.rects.map((rect, line) => (
          <button
            type="button"
            // biome-ignore lint/suspicious/noArrayIndexKey: an annotation's boxes keep their order.
            key={`${mark.id}-${line}`}
            className={`ea-box ea-tone-${toneOf(annotation)}${on ? " is-selected" : ""}`}
            style={boxStyle(rect)}
            // The lines on the right reach every annotation by keyboard; a box is the
            // same choice for a pointer.
            tabIndex={-1}
            data-selected={on && line === 0 ? "true" : undefined}
            aria-label={annotationName(annotation)}
            aria-pressed={on}
            onClick={() => onSelect(mark.id)}
          >
            {line === 0 ? (
              <span className="ea-tick" aria-hidden="true">
                {annotation.number}
              </span>
            ) : null}
          </button>
        ));
      })}

      {citedOn.map((mark, index) => {
        const passage = cited[index];
        if (passage === undefined) {
          return null;
        }
        const on = mark.id === selectedId;
        return mark.rects.map((rect, line) => (
          <button
            type="button"
            // biome-ignore lint/suspicious/noArrayIndexKey: a passage's boxes keep their order.
            key={`${mark.id}-${line}`}
            className={`ea-box is-cited ea-tone-${CITED_WORDS.tone}${on ? " is-selected" : ""}`}
            style={boxStyle(rect)}
            // As for an annotation: the lines on the right reach it by keyboard.
            tabIndex={-1}
            data-selected={on && line === 0 ? "true" : undefined}
            aria-label={citedName(passage)}
            aria-pressed={on}
            onClick={() => onSelect(mark.id)}
          >
            {line === 0 ? (
              <span className="ea-tick" aria-hidden="true">
                {passage.number}
              </span>
            ) : null}
          </button>
        ));
      })}

      {adjustHere !== null ? (
        <div
          className={`ea-edit-box ea-tone-${adjustHere.tone}`}
          style={boxStyle(adjustHere.box)}
          data-selected="true"
        >
          {adjustHere.number !== null ? (
            <span className="ea-tick" aria-hidden="true">
              {adjustHere.number}
            </span>
          ) : null}
          <button
            type="button"
            className="ea-move"
            aria-label="The box. Drag it, or move it with the arrow keys."
            {...held("move")}
          />
          {HANDLES.map((handle) => {
            const at = handlePoint(handle);
            return (
              <button
                type="button"
                key={handle}
                className={`ea-handle is-${handle}`}
                style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}
                aria-label={`The box's ${HANDLE_WORDS[handle]}. Drag it, or move it with the arrow keys.`}
                {...held(handle)}
              />
            );
          })}
        </div>
      ) : null}

      {drawing ? (
        <div
          className="ea-draw"
          role="presentation"
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            const at = point(event);
            setSketch({ from: at, to: at });
          }}
          onPointerMove={(event) => {
            if (sketch !== null) {
              setSketch({ from: sketch.from, to: point(event) });
            }
          }}
          onPointerUp={(event) => {
            const from = sketch?.from;
            const to = point(event);
            setSketch(null);
            // A tap without a drag draws nothing: the surface stays for another try.
            if (from !== undefined && isDrawn(from, to)) {
              onDrawn(drawnBox(from, to), page ?? 1);
            }
          }}
          onPointerCancel={() => setSketch(null)}
        >
          {sketch !== null ? (
            <span
              className="ea-sketch"
              style={boxStyle(drawnBox(sketch.from, sketch.to))}
            />
          ) : null}
        </div>
      ) : null}

      {callout !== null && !drawing ? (
        <CalloutShell
          frame={frame}
          box={anchor}
          sheetHost={sheetHost}
          tone={callout.tone}
          label={callout.label}
        >
          {callout.node}
        </CalloutShell>
      ) : null}
      {quiet !== null && noteHost !== null
        ? createPortal(quiet, noteHost)
        : null}
    </div>
  );
}

/**
 * The callout: on the page beside its box where it fits (else below, else above), or a
 * sheet along the bottom on a small screen and for an annotation with no box. It is laid
 * over the evidence, so opening it moves nothing.
 */
function CalloutShell({
  frame,
  box,
  sheetHost,
  tone,
  label,
  children,
}: {
  /** The page the box is on; null where there is none to stand on. */
  frame: HTMLElement | null;
  box: Box | null;
  sheetHost: HTMLElement | null;
  tone: KindTone;
  label: string;
  children: ReactNode;
}) {
  const viewportWidth = useViewportWidth();
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState(0);
  const [page, setPage] = useState<Size | null>(null);

  useLayoutEffect(() => {
    if (frame === null) {
      setPage(null);
      return;
    }
    const measure = () =>
      setPage({ width: frame.clientWidth, height: frame.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frame]);

  useLayoutEffect(() => {
    if (node === null) {
      return;
    }
    const measure = () => setHeight(node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  const place =
    frame === null || page === null
      ? null
      : calloutPlace({
          box,
          page,
          callout: { width: CALLOUT_WIDTH, height },
          viewportWidth,
        });
  // On the page: where the box, the page and its own height put it. Until those are
  // measured (before the first paint) it is laid out unseen, and can still take the focus.
  const onPage = frame !== null && (place === null || place.mode !== "sheet");
  const style: CSSProperties | undefined = !onPage
    ? undefined
    : place === null || place.mode === "sheet" || height === 0
      ? { left: 0, top: 0, opacity: 0, pointerEvents: "none" }
      : {
          left: place.left,
          top: place.top,
          ...(place.mode === "beside"
            ? ({ "--ea-pointer": `${place.pointer}px` } as CSSProperties)
            : {}),
        };
  // Placed where the stage has to scroll to it, it comes into view: it holds the focus.
  const placed = onPage && place !== null && height > 0 ? place.mode : null;
  useEffect(() => {
    if (placed !== null) {
      node?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: calm() ? "auto" : "smooth",
      });
    }
  }, [placed, node]);
  const shell = (
    <section
      ref={setNode}
      className={`ea-callout ea-tone-${tone} ${
        !onPage ? "is-sheet" : `is-${place?.mode ?? "beside"}`
      }`}
      style={style}
      aria-label={label}
    >
      {children}
    </section>
  );
  if (onPage) {
    return shell;
  }
  return sheetHost === null ? null : createPortal(shell, sheetHost);
}

/** Moves the focus into the callout when what it shows changes: to its first action, or
 * to itself where there is none to take. `quiet` leaves the focus where it is (a callout
 * shown in a page for an annotation nobody selected in it). `asked`: the viewer was
 * opened on it (a reference, a citation), so the focus goes to its heading, never to a
 * review action a key could press without the person having chosen the annotation. */
function useCalloutFocus<T extends HTMLElement>(
  key: string,
  quiet = false,
  asked = false,
) {
  const box = useRef<T>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the focus moves when the callout's subject does, named by `key`.
  useEffect(() => {
    if (quiet) {
      return;
    }
    const node = box.current;
    (
      node?.querySelector<HTMLElement>(
        asked ? "[data-heading]" : "[data-first]",
      ) ?? node
    )?.focus({
      preventScroll: true,
    });
  }, [key, quiet, asked]);
  return box;
}

/** The basis of one annotation: the sentence, the exact words it rests on, the comparison
 * made in code where one backs it, and where it is in the list. */
function Basis({
  annotation,
  at,
  previous,
  next,
  onStep,
  onClose,
  problem,
  actions,
  asking,
  quiet = false,
  asked = false,
}: {
  annotation: Annotation;
  at: string;
  previous: boolean;
  next: boolean;
  onStep: (direction: 1 | -1) => void;
  onClose: () => void;
  problem: string | null;
  /** Confirm, Edit and Remove, for a person who may review; null for a reader. */
  actions: ReactNode;
  /** Whether the actions ask before removing: the focus goes to the question. */
  asking: boolean;
  /** Shown without taking the focus. */
  quiet?: boolean;
  /** Opened on from outside: the focus goes to its heading (useCalloutFocus). */
  asked?: boolean;
}) {
  const focus = useCalloutFocus<HTMLDivElement>(
    `${annotation.id}-${annotation.status}-${asking}`,
    quiet,
    asked && !asking,
  );
  const check = checkLine(annotation.checkSentence);
  const kept =
    annotation.status === "EDITED" &&
    annotation.agentStatement !== "" &&
    annotation.agentStatement !== annotation.statement;
  return (
    // Its first action takes the focus where there is one (ReviewActions), else itself.
    <div className="ea-basis" ref={focus} tabIndex={-1}>
      <div className="ea-top">
        <span className="ea-num">{annotation.number}</span>
        {annotation.codes.map((code) => (
          <span className="ea-attr" key={code}>
            {code}
          </span>
        ))}
        <span className="ea-kind">
          <UiIcon name={KIND_WORDS[annotation.kind].mark} size={13} />
          {kindLine(annotation)} · {reviewLine(annotation)}
        </span>
        <button
          type="button"
          className="btn-ghost btn-sm ea-close"
          aria-label="Close the annotation"
          onClick={onClose}
        >
          <UiIcon name="x" size={14} />
        </button>
      </div>
      <h3 className="ea-statement" tabIndex={-1} data-heading>
        {annotation.statement !== ""
          ? annotation.statement
          : annotation.label !== ""
            ? annotation.label
            : "No sentence is recorded for this annotation."}
      </h3>
      {annotation.quote !== "" ? (
        <p className="ea-reads">{annotation.quote}</p>
      ) : null}
      {check !== "" ? (
        <p className="ea-check">
          <UiIcon name="check" size={13} /> {check}
        </p>
      ) : null}
      {kept ? (
        <p className="ea-was">
          Agent&apos;s wording, kept: <s>{annotation.agentStatement}</s>
        </p>
      ) : null}
      <div className="ea-acts">
        {actions}
        <span className="ea-nav">
          <span className="ea-at">{at}</span>
          <button
            type="button"
            className="btn-secondary btn-sm ea-step"
            aria-label="Previous annotation"
            disabled={!previous}
            onClick={() => onStep(-1)}
          >
            <span className="icon-back" aria-hidden="true">
              <UiIcon name="chevron" size={14} />
            </span>
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm ea-step"
            aria-label="Next annotation"
            disabled={!next}
            onClick={() => onStep(1)}
          >
            <UiIcon name="chevron" size={14} />
          </button>
        </span>
      </div>
      {problem !== null ? (
        <p className="ea-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** A cited passage (section 5a): its words as the file has them, where they are, and what
 * cited them. It is shown only: a citation is never stored or reviewed, so it has no
 * action of its own. */
function CitedBasis({
  mark,
  citedBy,
  at,
  previous,
  next,
  onStep,
  onClose,
  quiet = false,
  asked = false,
}: {
  mark: CitedMark;
  citedBy: string;
  at: string;
  previous: boolean;
  next: boolean;
  onStep: (direction: 1 | -1) => void;
  onClose: () => void;
  quiet?: boolean;
  asked?: boolean;
}) {
  const focus = useCalloutFocus<HTMLDivElement>(mark.id, quiet, asked);
  return (
    <div className="ea-basis" ref={focus} tabIndex={-1}>
      <div className="ea-top">
        <span className="ea-num is-cited">{mark.number}</span>
        {mark.label !== "" ? (
          <span className="ea-attr">{mark.label}</span>
        ) : null}
        <span className="ea-kind">
          <UiIcon name={CITED_WORDS.mark} size={13} />
          {CITED_WORDS.label}
          {mark.location !== "" ? ` · ${mark.location}` : ""}
        </span>
        <button
          type="button"
          className="btn-ghost btn-sm ea-close"
          aria-label="Close the cited passage"
          onClick={onClose}
        >
          <UiIcon name="x" size={14} />
        </button>
      </div>
      <h3 className="ea-statement" tabIndex={-1} data-heading>
        {citedBy}
      </h3>
      <p className="ea-reads">{mark.quote}</p>
      {!mark.found ? (
        <p className="ea-tip">
          Boxed on the image; the words were not read by OCR.
        </p>
      ) : null}
      <div className="ea-acts">
        <span className="ea-nav">
          <span className="ea-at">{at}</span>
          <button
            type="button"
            className="btn-secondary btn-sm ea-step"
            aria-label="Previous cited passage"
            disabled={!previous}
            onClick={() => onStep(-1)}
          >
            <span className="icon-back" aria-hidden="true">
              <UiIcon name="chevron" size={14} />
            </span>
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm ea-step"
            aria-label="Next cited passage"
            disabled={!next}
            onClick={() => onStep(1)}
          >
            <UiIcon name="chevron" size={14} />
          </button>
        </span>
      </div>
    </div>
  );
}

/** Confirm & next, Edit and Remove: shown only to a person who may review. Removing asks
 * once, since it changes the record. */
function ReviewActions({
  annotation,
  busy,
  removing,
  onConfirm,
  onEdit,
  onAskRemove,
  onKeep,
  onRemove,
}: {
  annotation: Annotation;
  busy: AnnotationAction["intent"] | null;
  removing: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  onAskRemove: () => void;
  onKeep: () => void;
  onRemove: () => void;
}) {
  const waiting = busy !== null;
  if (removing) {
    return (
      <RemoveAsk
        number={annotation.number}
        busy={busy}
        onKeep={onKeep}
        onRemove={onRemove}
      />
    );
  }
  return (
    <>
      {annotation.status === "PROPOSED" ? (
        <button
          type="button"
          className="btn-sm"
          data-first
          disabled={waiting}
          onClick={onConfirm}
        >
          {busy === "confirm" ? (
            "Confirming…"
          ) : (
            <>
              Confirm &amp; next{" "}
              <span className="ea-kbd is-on-fill" aria-hidden="true">
                ↵
              </span>
            </>
          )}
        </button>
      ) : null}
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={waiting}
        onClick={onEdit}
      >
        Edit
      </button>
      <button
        type="button"
        className="btn-ghost btn-sm"
        disabled={waiting}
        onClick={onAskRemove}
      >
        Remove
      </button>
    </>
  );
}

function RemoveAsk({
  number,
  busy,
  onKeep,
  onRemove,
}: {
  number: number;
  busy: AnnotationAction["intent"] | null;
  onKeep: () => void;
  onRemove: () => void;
}) {
  return (
    <>
      <span className="ea-ask">
        Remove annotation {number}? It stays on record.
      </span>
      <button
        type="button"
        className="btn-danger btn-sm"
        disabled={busy !== null}
        onClick={onRemove}
      >
        {busy === "remove" ? "Removing…" : "Remove"}
      </button>
      {/* The focus lands on the choice that changes nothing. */}
      <button
        type="button"
        className="btn-secondary btn-sm"
        data-first
        disabled={busy !== null}
        onClick={onKeep}
      >
        Keep
      </button>
    </>
  );
}

/**
 * Editing an annotation, or writing a new one, in the callout: the sentence, the
 * attributes it supports and, on the evidence, the box by its handles. The agent's own
 * wording is kept and shown. Nothing is saved until Save, and Save is confirmed by the
 * server before the form closes.
 */
function SentenceForm({
  title,
  set,
  annotation = null,
  draft,
  onDraft,
  annotationKind,
  onKind,
  canSave,
  busy,
  problem,
  saveLabel,
  onSave,
  onCancel,
  removing = false,
  onAskRemove,
  onKeep,
  onRemove,
}: {
  title: string;
  set: AnnotationSet;
  /** The annotation being edited; null for a new one. */
  annotation?: Annotation | null;
  draft: EditDraft;
  onDraft: (draft: EditDraft) => void;
  annotationKind?: (typeof ANNOTATION_KINDS)[number];
  onKind?: (kind: (typeof ANNOTATION_KINDS)[number]) => void;
  canSave: boolean;
  busy: AnnotationAction["intent"] | null;
  problem: string | null;
  saveLabel: string;
  onSave: () => void;
  onCancel: () => void;
  removing?: boolean;
  onAskRemove?: () => void;
  onKeep?: () => void;
  onRemove?: () => void;
}) {
  const id = useId();
  const waiting = busy !== null;
  const focus = useCalloutFocus<HTMLFormElement>(
    `${annotation?.id ?? "new"}-${removing}`,
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSave && !waiting) {
      onSave();
    }
  };
  return (
    <form
      className="ea-form"
      ref={focus}
      tabIndex={-1}
      autoComplete="off"
      onSubmit={submit}
    >
      <div className="ea-top">
        {annotation !== null ? (
          <span className="ea-num">{annotation.number}</span>
        ) : null}
        <span className="ea-kind">{title}</span>
      </div>
      <label htmlFor={`${id}-statement`}>What it shows</label>
      <textarea
        id={`${id}-statement`}
        data-first={removing ? undefined : ""}
        rows={3}
        maxLength={ANNOTATION_BOUNDS.statement}
        value={draft.statement}
        placeholder="One sentence on what this passage shows"
        onChange={(event) =>
          onDraft({ ...draft, statement: event.target.value })
        }
      />
      {annotation !== null && annotation.agentStatement !== "" ? (
        <p className="ea-was">
          Agent&apos;s wording, kept: <s>{annotation.agentStatement}</s>
        </p>
      ) : null}
      {annotationKind !== undefined && onKind !== undefined ? (
        <>
          <label htmlFor={`${id}-kind`}>What it is</label>
          <select
            id={`${id}-kind`}
            value={annotationKind}
            onChange={(event) => {
              const chosen = ANNOTATION_KINDS.find(
                (each) => each === event.target.value,
              );
              if (chosen !== undefined) {
                onKind(chosen);
              }
            }}
          >
            {ANNOTATION_KINDS.map((each) => (
              <option key={each} value={each}>
                {KIND_WORDS[each].label}
              </option>
            ))}
          </select>
        </>
      ) : null}
      {set.attributes.length > 0 ? (
        <fieldset className="ea-attrs">
          <legend>Attributes it supports</legend>
          {set.attributes.map((attribute) => {
            const on = draft.attributeIds.includes(attribute.id);
            return (
              <button
                type="button"
                key={attribute.id}
                className={`ea-chip${on ? " is-on" : ""}`}
                aria-pressed={on}
                aria-label={`Attribute ${attribute.code}: ${attribute.text}`}
                title={attribute.text}
                onClick={() =>
                  onDraft({
                    ...draft,
                    attributeIds: on
                      ? draft.attributeIds.filter(
                          (each) => each !== attribute.id,
                        )
                      : [...draft.attributeIds, attribute.id],
                  })
                }
              >
                {attribute.code}
              </button>
            );
          })}
          <span className="ea-tip">Select to add or remove</span>
        </fieldset>
      ) : null}
      {annotation !== null && annotation.quote !== "" ? (
        <>
          <p className="ea-label">Reads from the file</p>
          <p className="ea-reads">{annotation.quote}</p>
        </>
      ) : null}
      {draft.box !== null ? (
        <p className="ea-tip">
          Drag the box&apos;s handles on the evidence to adjust what is boxed,
          or move to a handle and use the arrow keys.
          {set.positions
            ? " The words under the box are read again and must be in the file."
            : ""}
        </p>
      ) : null}
      <div className="ea-acts">
        {removing &&
        annotation !== null &&
        onKeep !== undefined &&
        onRemove !== undefined ? (
          <RemoveAsk
            number={annotation.number}
            busy={busy}
            onKeep={onKeep}
            onRemove={onRemove}
          />
        ) : (
          <>
            <button
              type="submit"
              className="btn-sm"
              disabled={!canSave || waiting}
            >
              {busy === "edit" || busy === "add" ? "Saving…" : saveLabel}
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={waiting}
              onClick={onCancel}
            >
              Cancel
            </button>
            <span className="ea-spacer" />
            {onAskRemove !== undefined ? (
              <button
                type="button"
                className="btn-ghost btn-sm is-danger"
                disabled={waiting}
                onClick={onAskRemove}
              >
                Remove
              </button>
            ) : null}
          </>
        )}
      </div>
      {problem !== null ? (
        <p className="ea-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </form>
  );
}

/**
 * The annotated copy: the evidence with its boxes and tickmarks, and under it a numbered
 * legend (number, attribute letters, the sentence, who reviewed it), drawn on a canvas and
 * saved as a PNG. It is made when a person asks for it and is never added to the workpaper
 * by itself; the file is not changed. Drawn as a light page whatever the theme, like the
 * evidence itself.
 */
async function saveAnnotatedCopy(
  url: string,
  fileName: string,
  set: AnnotationSet,
): Promise<boolean> {
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    if (image.naturalWidth === 0 || image.naturalHeight === 0) {
      return false;
    }
    const tokens = getComputedStyle(document.documentElement);
    const token = (name: string) => tokens.getPropertyValue(name).trim();
    const paper = token("--mark-paper");
    const ink = token("--mark-ink");
    const muted = token("--mark-neutral");
    const colourOf = (tone: KindTone) => token(MARK_TOKEN[tone]);
    const family = getComputedStyle(document.body).fontFamily || "sans-serif";

    // A very large image is drawn smaller, so the canvas stays one a browser can make.
    const scale = Math.min(1, 3000 / image.naturalWidth);
    const width = Math.round(image.naturalWidth * scale);
    const height = Math.round(image.naturalHeight * scale);
    // One unit of the legend's type and marks, so they read at the image's own size.
    const u = Math.max(1, width / 1100);
    const pad = Math.round(34 * u);
    const font = (size: number, weight = 400) =>
      `${weight} ${Math.round(size * u)}px ${family}`;
    const radius = 11 * u;
    const textLeft = pad + radius * 2 + 10 * u;
    const textWidth = width + pad - textLeft;
    const lineHeight = 20 * u;

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context === null) {
      return false;
    }
    const rows = copyRows(set).map((row) => {
      // The attribute letters lead, in bold; the sentence hangs beside them.
      context.font = font(14, 700);
      const lead =
        row.letters === "" ? 0 : context.measureText(`${row.letters}  `).width;
      context.font = font(14, 400);
      const lines = wrapText(
        row.statement,
        textWidth - lead,
        (value) => context.measureText(value).width,
      );
      return { row, lead, lines };
    });
    const legendTop = pad + height + 26 * u;
    const legendHeight = rows.reduce(
      (sum, each) =>
        sum + (Math.max(1, each.lines.length) + 1) * lineHeight + 12 * u,
      34 * u,
    );
    canvas.width = width + pad * 2;
    canvas.height = Math.round(legendTop + legendHeight + 30 * u + pad);

    context.fillStyle = paper;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, pad, pad, width, height);
    context.strokeStyle = muted;
    context.globalAlpha = 0.35;
    context.lineWidth = Math.max(1, u);
    context.strokeRect(pad, pad, width, height);
    context.globalAlpha = 1;

    const tick = (x: number, y: number, tone: KindTone, number: number) => {
      context.beginPath();
      context.arc(x, y, radius + 2 * u, 0, Math.PI * 2);
      context.fillStyle = paper;
      context.fill();
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fillStyle = colourOf(tone);
      context.fill();
      context.fillStyle = paper;
      context.font = font(12, 700);
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(number), x, y + 0.5 * u);
      context.textAlign = "left";
      context.textBaseline = "alphabetic";
    };

    for (const annotation of set.annotations) {
      const tone = toneOf(annotation);
      annotation.rects.forEach((rect, index) => {
        const margin = 4 * u;
        const [x, y, w, h] = [
          pad + rect.x * width - margin,
          pad + rect.y * height - margin,
          rect.w * width + margin * 2,
          rect.h * height + margin * 2,
        ];
        // A ring of the page's white under the colour, so the box reads on a dark image.
        context.lineWidth = 5 * u;
        context.strokeStyle = paper;
        context.strokeRect(x, y, w, h);
        context.lineWidth = 2 * u;
        context.strokeStyle = colourOf(tone);
        context.strokeRect(x, y, w, h);
        context.globalAlpha = 0.08;
        context.fillStyle = colourOf(tone);
        context.fillRect(x, y, w, h);
        context.globalAlpha = 1;
        if (index === 0) {
          // Beside the box, never over its words.
          tick(
            Math.max(radius + 3 * u, x - radius - 5 * u),
            y + h / 2,
            tone,
            annotation.number,
          );
        }
      });
    }

    let y = legendTop;
    context.fillStyle = ink;
    context.font = font(15, 700);
    context.fillText(`Annotations on ${fileName}`, pad, y);
    y += 30 * u;
    for (const { row, lead, lines } of rows) {
      tick(pad + radius, y + 2 * u, KIND_WORDS[row.kind].tone, row.number);
      context.fillStyle = ink;
      if (row.letters !== "") {
        context.font = font(14, 700);
        context.fillText(row.letters, textLeft, y + 7 * u);
      }
      context.font = font(14, 400);
      for (const text of lines.length > 0 ? lines : [""]) {
        context.fillText(text, textLeft + lead, y + 7 * u);
        y += lineHeight;
      }
      context.fillStyle = muted;
      context.font = font(12, 400);
      context.fillText(
        `${KIND_WORDS[row.kind].label} · ${row.review}`,
        textLeft + lead,
        y + 5 * u,
      );
      y += lineHeight + 12 * u;
    }
    context.fillStyle = muted;
    context.font = font(12, 400);
    context.fillText(
      `Annotated copy made on ${formatDate(new Date().toISOString())}. The file itself is not changed.`,
      pad,
      y + 14 * u,
    );

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (blob === null) {
      return false;
    }
    const link = document.createElement("a");
    const href = URL.createObjectURL(blob);
    link.href = href;
    link.download = annotatedCopyName(fileName);
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
    return true;
  } catch {
    return false;
  }
}
