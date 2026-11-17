"use client";

import {
  type ComponentProps,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { ConclusionChoicePanel, openedAtConclusion } from "./conclusion-choice";
import {
  BASIS_WORDS,
  CONCLUSION_WORDS,
  type ConclusionChoice,
  type DesignConclusion,
} from "./design-conclusion-model";
import { PointRow, type PointWrites } from "./design-points";
import {
  decisionsList,
  decisionsWords,
  draftMessage,
  pointAnchor,
  pointShown,
  pointsAt,
  raisedSinceSigned,
  type Shown,
  unsettled,
} from "./design-points-model";
import {
  CONCLUSION_ANCHOR,
  type ConclusionView,
  choiceFactsOf,
  conclusionOf,
  DW_SECTION,
  deficiencyWanted,
  designWorkpaperQuery,
  type EditableSection,
  type EvidenceEntry,
  editableSections,
  establishedLine,
  evidenceLine,
  evidenceTitle,
  foldStartsOpen,
  headerOf,
  keyed,
  loadProblem,
  matrixOf,
  moreFilesLine,
  NOT_RELIED_ON,
  notReliedOnLine,
  type DesignWorkpaper as Paper,
  PROPOSED_BY_AGENT,
  parseDesignWorkpaper,
  previewUrl,
  type RefChip,
  type Reference,
  recordedLine,
  recordKey,
  refChip,
  refChips,
  rememberedView,
  rememberView,
  reportInspected,
  resultBoxes,
  type Selection,
  SHOWN_BY_WORDS,
  sectionKeyFor,
  staleProblem,
  startingSelection,
  stateOf,
  strayLine,
  TIMELINE_ACROSS_MOST,
  tickmarkLegend,
  tickmarkOf,
  tilesOf,
  timelineOf,
  VIEWS,
  type ViewKey,
  viewForKey,
  type WorkpaperScope,
  walkthroughHeaders,
  walkthroughIsDated,
  withoutCheck,
} from "./design-workpaper-model";
import {
  AnnotatedEvidence,
  AnnotationsLoading,
  useEvidenceAnnotations,
} from "./evidence-annotations";
import { AnnotatedDialog } from "./evidence-opener";
import { fileQuery } from "./evidence-preview-model";
import { FileBadge } from "./file-badge";
import { useGuardedLinks } from "./guarded-router";
import { LeaveDialog } from "./leave-dialog";
import {
  guarding as guardingNow,
  setLeaveAsker,
  whenAsked,
} from "./leave-guard";
import {
  AllNotesView,
  NoteField,
  NotesMargin,
  NotesRail,
  NotesStrip,
  openedAtNotes,
  ReviewNotesProvider,
  useReviewNotes,
} from "./review-notes";
import {
  attributeKey,
  CONCLUSION,
  CONCLUSION_CHOICE,
  controlKey,
  isOpen,
  procedureKey,
  reportKey,
  UNDERSTANDING,
  walkthroughColumnsOf,
  walkthroughKey,
} from "./review-notes-model";
import { SignOffBlock } from "./review-signoff";
import { RichText } from "./rich-text";
import { destinationHref } from "./routes";
import {
  changed,
  DISCARD_QUESTION,
  type Draft,
  draftOf,
  draftProblem,
  type EditSource,
  editorFor,
  editSource,
  recordsBehind,
  recordVersionBehind,
  SAVED,
  SAVED_NOT_READ,
  type SectionEditor,
  saveProblem,
  saveRequest,
} from "./section-edit-model";
import {
  type EditorProps,
  type EditPhase,
  NoteBox,
  NotesEditorPanel,
  SectionEditorPanel,
  sendSection,
  useRecordsRefresh,
} from "./section-editor";
import {
  draftChanged,
  draftRefused,
  draftRestored,
  draftUsed,
  namedDraft,
  type Proposal,
  redraftable,
  type UsedDraft,
  usedAfter,
  withProposal,
} from "./section-redraft-model";
import { useFocusSide } from "./step-focus";
import { type IconName, UiIcon } from "./ui-icon";
import { useKeeping, useWorkingCopies } from "./working-copy";
import {
  afterRead,
  CHECKING_COPIES,
  CONTINUE_EDITING,
  type CopyKnown,
  copyFor,
  copyIsStale,
  dropRestored,
  editGate,
  foundWords,
  HAS_COPY,
  keepingOff,
  leaveWords,
  restoredDraft,
  restoredWords,
  type WorkingCopy,
} from "./working-copy-model";
import type { Workpaper } from "./workpaper-model";
import { WorkpapersTab } from "./workpaper-view";

/**
 * The D&I workpaper in three views (docs/design-workpaper.md): the formal document, the
 * test matrix, and the workpaper with its evidence beside it. One record and one read of
 * it; a person switches between the views on the page, and the browser remembers which.
 *
 * Nothing here is a decision. A view shows what the server assembled; the conclusion reads
 * as proposed until the server says a reviewer signed it; and drafting, preparing,
 * reopening and the versions stay the existing workpaper card's, in the fold under the
 * views. A section of the draft is edited where the document shows it (section 3.2): the
 * editors and the request a save sends are section-editor.tsx's, the server decides whether
 * the save is taken, and the card's own editor in the fold stays for everything else.
 */

const VIEW_ICONS: Record<ViewKey, IconName> = {
  document: "file",
  matrix: "grid",
  evidence: "panel",
  notes: "message",
};

const calm = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A reference a person selected: the file, and the annotation it names, if any. */
type Opened = { entry: EvidenceEntry; annotationId: string | null };

/** The file in view beside the workpaper, and the statement it was selected on. */
type Current = { ref: string; from: string };

type Actions = {
  /** Selecting a reference: opens the file (the document and the matrix), or shows it in
   * the pane (the evidence view). */
  onRef: (chip: RefChip, from?: string, opener?: HTMLElement) => void;
  /** "Edit" on a section a preparer may edit: its editor where the document shows it, or
   * the fold at that section where the page cannot edit it in place. */
  onEdit: ((section: EditableSection) => void) | null;
  /** The section being edited where it is, and what its editor may do; null while none
   * is. Only one is open at a time. */
  editing: (EditorProps & { section: EditableSection }) | null;
  /** The section whose save the server last confirmed, until another editor opens. */
  saved: EditableSection | null;
  /** The page's records are a version behind the views: "Edit" waits for them. */
  behind: boolean;
  /** The sections the person has a working copy of (section 3.4): their link reads
   * "Continue editing". */
  copied: ReadonlySet<EditableSection>;
  /** The working copies are being read: "Edit" waits, so no editor opens without an
   * earlier copy that is there (independent review, 15 November 2026). */
  checking: boolean;
  /** Goes to a point at its place in the document (docs/design-workpaper.md, section
   * 3.9): from the preparer's sign-off's list, and the Evidence view's line. */
  onPoint: ((key: string) => void) | null;
  /** The points' writes (section 3.9): the ids, the workpaper version the views read,
   * whether a write waits for a read, where the existing actions are done (the
   * evidence step), and what the page does once the server answered. */
  points: PointWrites | null;
  /** The Matrix's and the Evidence view's link to the document's section 7, where the
   * conclusion is (docs/design-workpaper.md, sections 3.5 and 3.9). */
  onConclusion: (() => void) | null;
  /** Section 7's choice of the conclusion (section 3.6): the ids it is recorded for,
   * and what the page does once the server confirmed or refused it. */
  choice: {
    scope: WorkpaperScope;
    onRecorded: (choice: ConclusionChoice | null) => void;
    onRefused: () => void;
  } | null;
  /** Where a design deficiency is logged (the deficiency log's form for this control);
   * null where the page has no link to it. */
  deficiencyHref: string | null;
  /** Section 7's Sign-off (sections 3.7 and 3.8): the control's ids, what the page knows
   * that the preparer's sign-off needs, the D&I conclusion's body (the review request,
   * the reviewers, the reviewer's sign-off), who is reading, the review notes' counts,
   * and what it does once confirmed. */
  signOff: {
    ids: { organizationId: string; projectId: string; controlId: string };
    unsaved: boolean;
    behind: boolean;
    conclusion: DesignConclusion | null;
    viewerId: string | null;
    notes: { open: number; urgent: number } | null;
    onNotes: (() => void) | null;
    /** The viewer may act on the engagement's work (the card's `canAct`: the role, and
     * the engagement open): "Reopen to change" is offered only then. */
    canAct: boolean;
    onDone: () => void;
  } | null;
};

/* The mount: the views, and the existing card in a fold under them ---------------------- */

type CardProps = Omit<
  ComponentProps<typeof WorkpapersTab>,
  "stage" | "compact"
> & {
  /** The control's D&I conclusion, as the page read it: section 7's sign-off reads the
   * review request and the reviewer's sign-off from it (docs/design-workpaper.md,
   * section 3.8). Null where it could not be read. */
  conclusion?: DesignConclusion | null;
  /** The control's D&I Evidence step: where a point's own action is done (a file's
   * reliability, a tickmark, checking a request again, a finding; section 3.9). */
  evidenceHref?: string | null;
};

/**
 * Where the D&I workpaper is shown (docs/design-workpaper.md, section 3.1): the three
 * views first, and under them one fold holding today's workpaper card unchanged, with the
 * section editor, Draft again, Reopen, the versions and the Excel export (the preparer
 * signs at the end of section 6, section 3.7: the fold shows no Prepare for it). It
 * takes the card's own props.
 */
export function DesignWorkpaperStep({
  conclusion = null,
  evidenceHref = null,
  ...props
}: CardProps) {
  const { ids, papers, notice, viewing } = props;
  // Section 7 links to where a design deficiency is logged: the deficiency log's form for
  // this control (Reports, Deficiencies; docs/design-workpaper.md, section 3.5).
  const deficiencyHref = destinationHref(
    "reports",
    "deficiencies",
    ids.organizationId,
    ids.projectId,
    { new: ids.controlId },
  );
  const starts = foldStartsOpen({ papers, notice, viewing });
  const [open, setOpen] = useState(starts);
  // The page's records are behind the views (a save or a recorded conclusion moved the
  // workpaper's version, and the records are being read again): the fold's Prepare
  // waits, so it never posts the version before it.
  const [behind, setBehind] = useState(false);
  const fold = useRef<HTMLDetailsElement>(null);
  const key = recordKey(papers);
  // A draft that starts, or something just done in the card, opens the fold; a person
  // who closed it otherwise keeps it closed.
  useEffect(() => {
    if (starts) {
      setOpen(true);
    }
  }, [starts]);
  const scope = useMemo(
    () => ({
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      controlId: ids.controlId,
    }),
    [ids.organizationId, ids.projectId, ids.controlId],
  );

  /** Opens the fold, at a section's own editor where one is named, and moves the focus
   * there. The editor decides what may be edited; this only shows it. */
  const reveal = useCallback((section: EditableSection | null) => {
    const node = fold.current;
    if (node === null) {
      return;
    }
    setOpen(true);
    node.open = true;
    let target: HTMLElement | null = null;
    if (section !== null) {
      const inputs = [
        ...node.querySelectorAll<HTMLInputElement>(
          'input[type="hidden"][name="section"]',
        ),
      ];
      const wanted = sectionKeyFor(
        section,
        inputs.map((input) => input.value),
      );
      const editor =
        inputs
          .find((input) => input.value === wanted)
          ?.closest<HTMLDetailsElement>("details") ?? null;
      if (editor !== null) {
        // The card itself is folded to a row: it opens too.
        for (
          let up: Element | null = editor;
          up !== null && up !== node;
          up = up.parentElement
        ) {
          if (up instanceof HTMLDetailsElement) {
            up.open = true;
          }
        }
        target =
          editor.querySelector<HTMLElement>("textarea") ??
          editor.querySelector<HTMLElement>("summary");
      }
    }
    const landing = target ?? node.querySelector<HTMLElement>("summary");
    window.requestAnimationFrame(() => {
      landing?.scrollIntoView({
        block: "center",
        behavior: calm() ? "auto" : "smooth",
      });
      landing?.focus({ preventScroll: true });
    });
  }, []);

  return (
    <div className="dw-step">
      <DesignWorkpaper
        // Another control is another workpaper: nothing of the last one is kept.
        key={scope.controlId}
        scope={scope}
        recordKey={key}
        papers={papers}
        onEdit={reveal}
        onDraft={() => reveal(null)}
        deficiencyHref={deficiencyHref}
        onBehind={setBehind}
        canAct={props.canAct}
        conclusion={conclusion}
        evidenceHref={evidenceHref}
      />
      <details
        ref={fold}
        className="dw-fold"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>
          <span className="dw-fold-mark" aria-hidden="true">
            <UiIcon name="chevron" size={14} />
          </span>
          <span className="dw-fold-copy">
            <strong>Edit, prepare and versions</strong>
            <small>
              The section editor, drafting, Reopen, the version history and the
              Excel export
            </small>
          </span>
        </summary>
        <div className="dw-fold-body">
          <WorkpapersTab
            compact
            {...props}
            stage="DESIGN"
            prepareHeld={behind}
          />
        </div>
      </details>
    </div>
  );
}

/* The three views ----------------------------------------------------------------------- */

type Loaded = {
  paper: Paper | null;
  problem: string | null;
  loading: boolean;
};

/** The section being edited where it is (docs/design-workpaper.md, section 3.2). */
type Editing = {
  section: EditableSection;
  /** The stored workpaper the editor was opened on: a save is based on its version, so a
   * workpaper that changed since is refused by the server, never written over. */
  source: EditSource;
  editor: SectionEditor;
  draft: Draft;
  phase: EditPhase;
  /** Why the last save was not taken; "" where none was refused. */
  refusal: string;
  /** The working copy it holds (section 3.4: it opened with it, or the person chose one
   * found later), until it closes or the copy is discarded by any way; null otherwise. */
  restored: WorkingCopy | null;
  /** What it knows of the server's working copy of its section; keeping is off while it
   * does not know (independent review, 15 November 2026). */
  known: CopyKnown;
};

const KNOWN: CopyKnown = { state: "known" };

/** The agent's draft an editor holds, and the editor it was put in. */
type HeldDraft = UsedDraft & { editor: SectionEditor };

/** What an editor that takes up a working copy holds of the agent's draft (section
 * 3.11): the draft the copy names, so a save names it; null where it names none. */
function heldFrom(editor: SectionEditor, copy: WorkingCopy): HeldDraft | null {
  const from = editor.kind === "text" ? draftRestored(copy, editor.text) : null;
  return from === null ? null : { ...from, editor };
}

/** "Leave without saving" waits no longer than this for the latest working copy to be
 * kept before the page goes on (section 3.4). */
const LEAVE_WAIT_MS = 1000;
/** A save waits no longer than this for a working copy already on its way, so the copy
 * lands first and the save deletes it. */
const SETTLE_MS = 2000;

export function DesignWorkpaper({
  scope,
  recordKey: record = "",
  papers = null,
  onEdit,
  onDraft,
  deficiencyHref = null,
  onBehind,
  canAct = false,
  conclusion = null,
  evidenceHref = null,
}: {
  scope: WorkpaperScope;
  /** Changes when the workpaper record does: the views then read again. */
  recordKey?: string;
  /** The page's stored workpapers: what "Edit" on a section edits where it is. Without
   * them every "Edit" opens the fold. */
  papers?: ReadonlyArray<Workpaper> | null;
  /** Opens the fold at a section's own editor: what "Edit" falls back to. */
  onEdit?: (section: EditableSection) => void;
  /** Shows where the existing "Draft" action is, for a control with no workpaper yet. */
  onDraft?: () => void;
  /** Where a design deficiency is logged for this control; null where not linked. */
  deficiencyHref?: string | null;
  /** Told whether the page's records are behind the views (by the content's version or
   * the record's): the fold's Prepare waits while they are. */
  onBehind?: (behind: boolean) => void;
  /** The viewer may act on the engagement's work (the card's `canAct`): section 7's
   * "Reopen to change" is offered only then, as the fold's Reopen is. */
  canAct?: boolean;
  /** The control's D&I conclusion, for section 7's Sign-off (section 3.8). */
  conclusion?: DesignConclusion | null;
  /** The control's D&I Evidence step, where a point's own action is done (section 3.9). */
  evidenceHref?: string | null;
}) {
  const uid = useId();
  const query = designWorkpaperQuery(scope);
  const [view, setView] = useState<ViewKey>("document");
  const [state, setState] = useState<Loaded>({
    paper: null,
    problem: null,
    loading: true,
  });
  const [attempt, setAttempt] = useState(0);
  // A conclusion the server just recorded moved the workpaper's version, which its answer
  // does not carry: the sign-off and the fold's Prepare wait until the views read the
  // new version (independent review, 16 November 2026), so neither posts the one before.
  const [rereading, setRereading] = useState(false);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [selection, setSelection] = useState<
    (Selection & { from: string }) | null
  >(null);
  const [printing, setPrinting] = useState(false);
  // A point at its place (section 3.9): from the sign-off's list or the Evidence view.
  const [seeking, setSeeking] = useState<string | null>(null);
  // Section 7, the conclusion: from the Matrix, the Evidence view, or a link to it.
  const [seekingConclusion, setSeekingConclusion] = useState(false);
  const linkedOnce = useRef(false);
  const tabs = useRef(new Map<ViewKey, HTMLButtonElement>());
  const pane = useRef<HTMLDivElement>(null);
  // The reference chip that last showed a file in the pane: Escape from its annotation
  // goes back to it.
  const opener = useRef<HTMLElement | null>(null);
  // "Try again" was pressed: when the banner it is in goes, the focus is not left
  // nowhere.
  const retried = useRef(false);
  // The one editor open in the document, if any.
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saved, setSaved] = useState<EditableSection | null>(null);
  // The section whose editor just closed: its "Edit" link takes the focus back.
  const [closed, setClosed] = useState<EditableSection | null>(null);
  const root = useRef<HTMLElement>(null);
  // A save the server confirmed, until the views have read the workpaper again.
  const confirmed = useRef<EditableSection | null>(null);
  // One press, one request.
  const sending = useRef(false);
  // The section whose editor was given the focus when it opened.
  const focused = useRef<EditableSection | null>(null);
  // The agent's draft the open editor holds, not saved yet (section 3.11): the editor it
  // was put in, so it is never named by a save of another editor. Read again: the count
  // the editor's proposal is read again by.
  const [used, setUsed] = useState<HeldDraft | null>(null);
  const [proposalRead, setProposalRead] = useState(0);
  // Another control is another mount: an answer for the last one is dropped.
  const mounted = useRef(true);
  const refreshRecords = useRecordsRefresh();

  // The view this browser chose last: read once the page is in the browser, so the
  // server's page and the browser's first one are the same.
  useEffect(() => {
    setView(rememberedView(() => window.localStorage));
  }, []);

  // One read, and again when the record changes or a person asks. A newer read stops the
  // one before it, and an answer that arrives late is dropped.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `record` and `attempt` are what ask for another read.
  useEffect(() => {
    const control = new AbortController();
    let current = true;
    // A save confirmed before this read began: this read is the one that shows it.
    const shows = confirmed.current;
    setState((before) => ({ ...before, loading: true }));
    (async () => {
      let status = 0;
      let result: unknown = null;
      try {
        const response = await fetch(`/workspace/design-workpaper?${query}`, {
          cache: "no-store",
          signal: control.signal,
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
      if (!current) {
        return;
      }
      const paper = status === 200 ? parseDesignWorkpaper(result) : null;
      if (paper !== null) {
        // The views hold the version the server holds now: a recorded conclusion's
        // version is read, and the sign-off may post it.
        setRereading(false);
      }
      setState((before) =>
        paper !== null
          ? { paper, problem: null, loading: false }
          : {
              // What was on screen stays there; the sentence says the read failed.
              paper: before.paper,
              problem:
                // After a save the server took, "nothing was changed" would be wrong.
                shows !== null
                  ? SAVED_NOT_READ
                  : (loadProblem(status) ??
                    "The workpaper views could not be read. Nothing was changed: try again."),
              loading: false,
            },
      );
      // The server confirmed the save and the views have read again (or said they could
      // not): only now does the editor close and the section say it was saved. A read
      // that was stopped never gets here, and the read that replaced it does.
      if (shows !== null && confirmed.current === shows) {
        confirmed.current = null;
        setEditing(null);
        setSaved(shows);
        setClosed(shows);
      }
    })();
    return () => {
      current = false;
      control.abort();
    };
  }, [query, record, attempt]);

  // "Print or save as PDF": only the sheet is on the paper (design-workpaper.css).
  useEffect(() => {
    if (!printing) {
      return;
    }
    const root = document.documentElement;
    const done = () => setPrinting(false);
    root.classList.add("dw-printing");
    window.addEventListener("afterprint", done);
    window.print();
    return () => {
      window.removeEventListener("afterprint", done);
      root.classList.remove("dw-printing");
    };
  }, [printing]);

  const choose = (next: ViewKey, focus = false) => {
    setView(next);
    rememberView(() => window.localStorage, next);
    // The file stays the one in view; the annotation a reference opened does not, so
    // coming back to the evidence opens nothing by itself.
    setSelection((before) =>
      before === null || before.annotationId === null
        ? before
        : { ...before, annotationId: null },
    );
    if (focus) {
      tabs.current.get(next)?.focus();
    }
  };

  // The retry answered and its banner is gone: the focus it held goes to the view's tab,
  // unless the person has already moved on to something else.
  const settled = state.problem === null && !state.loading;
  useEffect(() => {
    if (!settled || !retried.current) {
      return;
    }
    retried.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) {
      tabs.current.get(view)?.focus();
    }
  }, [settled, view]);

  // A point at its place, once the document is the view shown.
  useEffect(() => {
    if (seeking === null || view !== "document") {
      return;
    }
    setSeeking(null);
    const place = document.getElementById(pointAnchor(seeking));
    place?.scrollIntoView({
      block: "center",
      behavior: calm() ? "auto" : "smooth",
    });
    place?.focus({ preventScroll: true });
  }, [seeking, view]);

  // Section 7, once the document is the view shown; and once on arrival where the page
  // was opened at it (`#di-conclusion`: from Home's "Waiting for your review", or a link
  // to the removed "D&I Conclusion and Review" step, section 3.8).
  const arrived = state.paper !== null && state.paper.workpaper !== null;
  useEffect(() => {
    if (!arrived || linkedOnce.current) {
      return;
    }
    linkedOnce.current = true;
    if (openedAtConclusion()) {
      setView("document");
      setSeekingConclusion(true);
    } else if (openedAtNotes()) {
      // A link to every review note of the workpaper.
      setView("notes");
    }
  }, [arrived]);
  useEffect(() => {
    if (!seekingConclusion || view !== "document") {
      return;
    }
    setSeekingConclusion(false);
    const heading = document
      .getElementById(CONCLUSION_ANCHOR)
      ?.querySelector<HTMLElement>("h5");
    heading?.scrollIntoView({
      block: "start",
      behavior: calm() ? "auto" : "smooth",
    });
    heading?.focus({ preventScroll: true });
  }, [seekingConclusion, view]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // An editor that opened: its first box takes the focus, and it comes into view.
  const openSection = editing?.section ?? null;
  useEffect(() => {
    if (openSection === null) {
      focused.current = null;
      return;
    }
    if (view !== "document" || focused.current === openSection) {
      return;
    }
    const frame =
      root.current?.querySelector<HTMLElement>("[data-section-editor]") ?? null;
    if (frame === null) {
      return;
    }
    focused.current = openSection;
    const first =
      frame.querySelector<HTMLElement>('[role="textbox"], textarea') ??
      frame.querySelector<HTMLElement>("button:not(:disabled)");
    first?.focus({ preventScroll: true });
    frame.scrollIntoView({
      block:
        frame.getBoundingClientRect().height > window.innerHeight
          ? "start"
          : "nearest",
      behavior: calm() ? "auto" : "smooth",
    });
  }, [openSection, view]);

  // An editor that closed: the focus it held goes back to its section's "Edit" link,
  // unless the person has already moved on to something else.
  useEffect(() => {
    if (closed === null || editing !== null) {
      return;
    }
    setClosed(null);
    const active = document.activeElement;
    if (active !== null && active !== document.body) {
      return;
    }
    const link =
      root.current?.querySelector<HTMLElement>(
        `button[data-edit="${closed}"]`,
      ) ?? null;
    (link ?? tabs.current.get(view))?.focus();
  }, [closed, editing, view]);

  const returnToOpener = useCallback(
    () => (opener.current?.isConnected ? opener.current : null),
    [],
  );
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const next = viewForKey(view, event.key);
    if (next !== null) {
      event.preventDefault();
      choose(next, true);
    }
  };

  const { paper } = state;
  // The workpaper's review notes (docs/workpaper-review.md, section 6): one read, shared
  // by the Document view's markers and rail and by the Notes view.
  const paperId = paper?.workpaper?.id ?? null;
  const notesScope = useMemo(
    () =>
      paperId === null
        ? null
        : {
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            workpaperId: paperId,
          },
    [scope.organizationId, scope.projectId, paperId],
  );
  const reviewNotes = useReviewNotes(notesScope);
  const openNotes = (reviewNotes.set?.notes ?? []).filter(isOpen).length;
  // Focus mode (product owner, 16 November 2026: focus mode, option A): the panel's side
  // column at its right edge, where the notes fold to a strip and open as a column beside
  // the document. Null outside focus: the rail stays beside the sheet, as before.
  const focusSide = useFocusSide();
  const notesAside =
    focusSide !== null &&
    view === "document" &&
    paper !== null &&
    paper.workpaper !== null &&
    reviewNotes.status !== "off";
  // The rail beside the document: as the person set it, or, until they do, on where a
  // note is open (folded in focus until it is opened).
  const [railChoice, setRailChoice] = useState<boolean | null>(null);
  const railOn = railChoice ?? (!notesAside && openNotes > 0);
  // The rail in the sheet's grid; in focus it is in the side column instead.
  const railBeside = railOn && !notesAside;
  const showRail = useCallback(() => setRailChoice(true), []);
  // The Document view with its notes: its fields offer a note in the margin, and with
  // the rail on the highlights and markers are drawn. Never on the printed sheet.
  const notesShown =
    view === "document" && !printing && reviewNotes.status === "ready";
  const sheetRef = useRef<HTMLDivElement>(null);
  const editable = useMemo(
    () =>
      paper === null ? new Set<EditableSection>() : editableSections(paper),
    [paper],
  );
  // The stored workpaper "Edit" may open where it is; null where it opens the fold.
  const source = useMemo(() => editSource(papers, paper), [papers, paper]);
  // The page's records are a version behind the views (a save's reading of them has not
  // landed): "Edit" waits for them, so no editor opens on the text before the save.
  const behind = useMemo(() => recordsBehind(papers, paper), [papers, paper]);
  // Behind by the record's own version too (a recorded conclusion moves it, section
  // 3.6): the step holds the fold's Prepare until the page's records are read again.
  const held = useMemo(
    () => behind || recordVersionBehind(papers, paper),
    [behind, papers, paper],
  );
  useEffect(() => {
    onBehind?.(held || rereading);
  }, [onBehind, held, rereading]);

  // The person's working copies of this workpaper (section 3.4): what they typed and did
  // not save, kept on the server and private to them. Read while "Edit" opens in place.
  const working = useWorkingCopies(
    scope,
    source?.workpaperId ?? null,
    source?.basedOn ?? null,
    editing !== null && editing.known.state === "known"
      ? editing.editor.key
      : null,
  );
  const { copies } = working;
  const gate = editGate(working.read);
  const hasCopy =
    editing !== null &&
    copies.some((copy) => copy.section === editing.editor.key);
  // The agent's draft the open editor holds, if it does: never one put in another editor.
  const usedNow =
    used !== null && editing !== null && used.editor === editing.editor
      ? used
      : null;
  const keeper = useKeeping(
    editing === null
      ? null
      : {
          scope,
          source: editing.source,
          editor: editing.editor,
          draft: editing.draft,
          phase: editing.phase,
          hasCopy,
          restored: editing.restored,
          off: keepingOff(editing.known),
          // The agent's draft its text came from is kept with the copy (section 3.11).
          proposalId: namedDraft(usedNow)?.id ?? null,
        },
    {
      onKept: working.remember,
      // A copy discarded by any way: the editor no longer says it was restored.
      onDiscarded: (section) => {
        working.forget(section);
        setEditing((before) => dropRestored(before, section));
      },
      onGone: working.reread,
      // A keep refused as the draft it named changed: the link is kept, the ways on are
      // shown, and the proposal is read again (section 3.11).
      onDraftChanged: (id) => {
        setUsed((before) => draftRefused(before, id));
        setProposalRead((count) => count + 1);
      },
    },
  );
  // A read that answered after an editor opened that did not know what the server holds
  // for it: a copy of its section is offered, never put in place of what it holds; none,
  // and keeping goes on (independent review, 15 November 2026).
  // biome-ignore lint/correctness/useExhaustiveDependencies: a read that answered is what is looked at.
  useEffect(() => {
    setEditing((before) => {
      if (before === null || before.known.state === "known") {
        return before;
      }
      const known = afterRead(before.known, before.editor, copies);
      return known.state === before.known.state &&
        (known.state !== "found" ||
          (before.known.state === "found" && known.copy === before.known.copy))
        ? before
        : { ...before, known };
    });
  }, [working.answered]);
  // The sections whose link reads "Continue editing".
  const copied = useMemo(() => {
    const found = new Set<EditableSection>();
    if (source === null) {
      return found;
    }
    const keys = source.sections.map((item) => item.key);
    for (const section of editable) {
      const key = sectionKeyFor(section, keys);
      if (key !== null && copies.some((copy) => copy.section === key)) {
        found.add(section);
      }
    }
    return found;
  }, [source, editable, copies]);

  // Closing or reloading the tab (section 3.4): the browser's own prompt only while the
  // latest changes are not kept yet (what is kept is there on return), and what is not
  // kept yet is sent as the page goes.
  const open = editing !== null && editing.phase !== "refreshing";
  useEffect(() => {
    if (!open) {
      return;
    }
    const ask = (event: BeforeUnloadEvent) => {
      if (keeper.unkept()) {
        event.preventDefault();
      }
    };
    const going = () => keeper.beacon();
    // A body too large for keepalive is kept as the tab is hidden, and is not kept (the
    // prompt above still asks) until the server answered it.
    const hidden = () => {
      if (document.visibilityState === "hidden") {
        keeper.hidden();
      }
    };
    window.addEventListener("beforeunload", ask);
    window.addEventListener("pagehide", going);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("beforeunload", ask);
      window.removeEventListener("pagehide", going);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [open, keeper.unkept, keeper.beacon, keeper.hidden]);

  // Going elsewhere in the app with changes not in the workpaper asks first, in a dialog
  // (section 3.4): a link, another step, another control, closing the panel.
  const [asking, setAsking] = useState(false);
  const proceed = useRef<(() => void) | null>(null);
  // A way out taken while a save is out: it waits for the save's answer.
  const afterSave = useRef<(() => void) | null>(null);
  // "Leave without saving" waited for the keep, and it was not confirmed.
  const [waited, setWaited] = useState(false);
  const askingNow = asking && editing !== null;
  // While a save is out too (independent review, 15 November 2026).
  const guarding =
    editing !== null &&
    guardingNow({
      phase: editing.phase,
      changed: changed(editing.editor, editing.draft),
      asking: askingNow,
    });
  const asked = useRef({ phase: editing?.phase ?? null, asking: askingNow });
  asked.current = { phase: editing?.phase ?? null, asking: askingNow };
  useEffect(() => {
    if (!guarding) {
      return;
    }
    // A second attempt while the dialog is open replaces the first: the latest wins.
    return setLeaveAsker((next) => {
      const now = asked.current;
      if (
        now.phase !== null &&
        whenAsked({ phase: now.phase, asking: now.asking }) === "after-save"
      ) {
        afterSave.current = next;
        return;
      }
      proceed.current = next;
      setWaited(false);
      setAsking(true);
    });
  }, [guarding]);
  useGuardedLinks(guarding);
  /** The dialog closes, and the page goes where it was asked to, once. */
  const goOn = () => {
    const next = proceed.current;
    proceed.current = null;
    setAsking(false);
    setWaited(false);
    next?.();
  };
  const stay = () => {
    proceed.current = null;
    setAsking(false);
    setWaited(false);
  };
  const shown =
    paper === null ? null : startingSelection(paper, selection ?? null);
  // The annotation asked for, as the viewer takes it: a new one each time a person asks.
  const pick = useMemo(
    () =>
      selection === null || selection.annotationId === null
        ? null
        : { id: selection.annotationId },
    [selection],
  );

  const redraft = (draft: Draft) => {
    setEditing((before) =>
      before === null || before.phase !== "editing"
        ? before
        : { ...before, draft },
    );
    // Back to what it held before "Use the draft" (an undo), a save no longer names the
    // agent's draft; back to the draft, it does again (section 3.11).
    if (draft.kind === "text") {
      setUsed((before) => usedAfter(before, draft.text));
    }
  };
  /** "Use the draft" (section 3.11): the agent's text replaces what the editor holds, as
   * the editor writes it back. It is an unsaved change like any other: kept as a working
   * copy, asked about on leaving, and only the person's Save makes it a version, which
   * then names the proposal. */
  const takeProposal = (proposal: Proposal) => {
    const open = editing;
    if (
      open === null ||
      open.phase !== "editing" ||
      open.draft.kind !== "text" ||
      proposal.status !== "READY"
    ) {
      return;
    }
    // Over a draft the editor already holds, what it held before that one is kept: an
    // undo back to the earlier draft's text still names a draft, never none.
    const made = draftUsed(proposal, open.draft.text, usedNow);
    setEditing({
      ...open,
      draft: { kind: "text", text: made.text },
      refusal: "",
    });
    setUsed({ ...made, editor: open.editor });
  };
  /** "Cancel", and Escape inside the editor: what was typed is given up only if the
   * person says so. */
  const cancel = () => {
    if (editing === null || editing.phase !== "editing") {
      return;
    }
    if (
      changed(editing.editor, editing.draft) &&
      !window.confirm(DISCARD_QUESTION)
    ) {
      return;
    }
    setEditing(null);
    setClosed(editing.section);
    // Cancel gives up the working copy too (section 3.4); never one the editor did not
    // know of (independent review, 15 November 2026).
    if (editing.known.state !== "known") {
      return;
    }
    keeper.discard(
      scope,
      editing.source.workpaperId,
      editing.editor.key,
      copies.some((copy) => copy.section === editing.editor.key),
    );
  };
  /** "Discard them" over an editor that opened with a working copy: back to what is
   * stored, asked first where that gives up a change. */
  const discardRestored = () => {
    const open = editing;
    if (open === null || open.phase !== "editing" || open.restored === null) {
      return;
    }
    if (changed(open.editor, open.draft) && !window.confirm(DISCARD_QUESTION)) {
      return;
    }
    setEditing({
      ...open,
      draft: draftOf(open.editor),
      restored: null,
      refusal: "",
    });
    keeper.discard(scope, open.source.workpaperId, open.editor.key, true);
    // Everything is replaced again: the agent's draft is no longer what it holds.
    setUsed(null);
  };
  /** "Discard" where the draft the editor's text came from changed (section 3.11): back to
   * what is stored, asked first, and the working copy discarded, as "Discard them" does.
   * Only now does the editor stop naming the draft. */
  const discardHeld = () => {
    const open = editing;
    if (open === null || open.phase !== "editing" || usedNow === null) {
      return;
    }
    if (changed(open.editor, open.draft) && !window.confirm(DISCARD_QUESTION)) {
      return;
    }
    setEditing({
      ...open,
      draft: draftOf(open.editor),
      restored: null,
      refusal: "",
    });
    setUsed(null);
    // Never a copy the editor did not know of (as Cancel).
    if (open.known.state === "known") {
      keeper.discard(
        scope,
        open.source.workpaperId,
        open.editor.key,
        copies.some((copy) => copy.section === open.editor.key),
      );
    }
  };
  /** "Use them" over a working copy found after the editor opened: the editor takes it up,
   * asked first where that gives up a change; keeping goes on from it. */
  const useFound = () => {
    const open = editing;
    if (
      open === null ||
      open.phase !== "editing" ||
      open.known.state !== "found"
    ) {
      return;
    }
    if (changed(open.editor, open.draft) && !window.confirm(DISCARD_QUESTION)) {
      return;
    }
    const copy = open.known.copy;
    setEditing({
      ...open,
      draft: restoredDraft(open.editor, copy),
      restored: copy,
      known: KNOWN,
      refusal: "",
    });
    // Everything is replaced again: it holds the agent's draft the copy names, or none.
    setUsed(heldFrom(open.editor, copy));
  };
  /** "Discard them" over a working copy found after the editor opened: it is discarded,
   * and what the editor holds stays; keeping goes on from it, after the discard. */
  const discardFound = () => {
    const open = editing;
    if (
      open === null ||
      open.phase !== "editing" ||
      open.known.state !== "found"
    ) {
      return;
    }
    setEditing({ ...open, known: KNOWN });
    keeper.discard(scope, open.source.workpaperId, open.editor.key, true);
  };
  /** "Save": one request. Nothing reads as saved until the server confirmed it and the
   * views have read the workpaper again; a refusal keeps the editor and what was typed. */
  const save = async () => {
    const open = editing;
    if (
      open === null ||
      open.phase !== "editing" ||
      sending.current ||
      !changed(open.editor, open.draft) ||
      draftProblem(open.editor, open.draft) !== ""
    ) {
      return;
    }
    sending.current = true;
    setEditing({ ...open, phase: "saving", refusal: "" });
    // A working copy on its way lands first, so the save deletes it (section 3.4).
    await keeper.settle(SETTLE_MS);
    // The keeps out as the save goes: one that lands after it is discarded after it.
    const atSave = keeper.mark();
    const answer = await sendSection(
      // Where the editor holds the agent's draft, the save names it (section 3.11).
      withProposal(
        saveRequest(scope, open.source, open.editor, open.draft),
        namedDraft(usedNow),
      ),
    );
    sending.current = false;
    const refusal = saveProblem(answer.status, answer.detail);
    if (refusal === "") {
      // The server took it: the page reads its records again, so the card in the fold
      // and its version are current, whatever became of this view. No page is loaded
      // again.
      refreshRecords();
    }
    // An answer for a view that has gone to another control changes nothing on screen.
    if (!mounted.current) {
      return;
    }
    // A way out taken while the save was out (independent review, 15 November 2026).
    const then = afterSave.current;
    afterSave.current = null;
    if (refusal !== "") {
      setEditing((before) =>
        before === null ? before : { ...before, phase: "editing", refusal },
      );
      if (then !== null) {
        // Refused: the person is asked, with the reason.
        proceed.current = then;
        setWaited(false);
        setAsking(true);
      }
      if (answer.status === 409) {
        // The workpaper is not as this page has it: the records and the views are read
        // again, so "Edit" after "Cancel" opens the latest. The editor and what was
        // typed stay as they are.
        refreshRecords();
        setAttempt((count) => count + 1);
      }
      // The agent's draft the save named may not be saved from (section 3.11): the
      // server's sentence is said, the editor keeps its text and the link to that draft
      // (never dropped in silence), the proposal is read again, and the card offers the
      // ways on: the new draft, or Discard.
      const named = namedDraft(usedNow);
      if (named !== null && draftChanged(answer.status, answer.detail)) {
        setUsed((before) => draftRefused(before, named.id));
        setProposalRead((count) => count + 1);
      }
      return;
    }
    // The server deleted this section's working copy with the save (section 3.4).
    keeper.saved(scope, open.source.workpaperId, open.editor.key, atSave);
    working.reread();
    // Confirmed: a way out taken while it was out goes on.
    then?.();
    confirmed.current = open.section;
    setEditing((before) =>
      before === null ? before : { ...before, phase: "refreshing" },
    );
    // The views read the workpaper again: the read that shows the save closes the editor.
    setAttempt((count) => count + 1);
  };

  // "Redraft with the agent" (section 3.11): in the editor of a text section the agent
  // drafts, at the version the editor was opened on (the workpaper's current version,
  // which the server checks as a save's `based_on`).
  const storedSection =
    editing === null
      ? undefined
      : editing.source.sections.find((item) => item.key === editing.editor.key);
  const workpaperVersion = editing?.source.basedOn ?? 0;
  const redraftOffer =
    editing !== null &&
    editing.editor.kind === "text" &&
    workpaperVersion >= 1 &&
    redraftable(storedSection, "DESIGN")
      ? {
          scope,
          place: {
            workpaperId: editing.source.workpaperId,
            sectionKey: editing.editor.key,
          },
          workpaperVersion,
          used: usedNow === null || usedNow.off ? null : usedNow.id,
          refused: usedNow !== null && !usedNow.off && usedNow.refused,
          reread: proposalRead,
          onUse: takeProposal,
          onDiscard: discardHeld,
        }
      : null;

  const actions: Actions = {
    onRef: (chip, from = "", element) => {
      if (chip.entry === null) {
        return;
      }
      if (view !== "evidence") {
        setOpened({ entry: chip.entry, annotationId: chip.annotationId });
        return;
      }
      opener.current = element ?? null;
      setSelection({ ref: chip.ref, annotationId: chip.annotationId, from });
      // Stacked on a narrow screen, the evidence is further down the page: it comes
      // into view. Beside the workpaper it is already there. The focus stays on the
      // reference: the pane never takes it.
      window.requestAnimationFrame(() => {
        const node = pane.current;
        if (node === null) {
          return;
        }
        const box = node.getBoundingClientRect();
        if (box.top > window.innerHeight - 160 || box.bottom < 160) {
          node.scrollIntoView({
            block: "start",
            behavior: calm() ? "auto" : "smooth",
          });
        }
      });
    },
    onEdit:
      onEdit === undefined
        ? null
        : (section) => {
            if (
              !editable.has(section) ||
              editing !== null ||
              paper === null ||
              behind
            ) {
              return;
            }
            const editor = editorFor(section, source, paper);
            if (source === null || editor === null) {
              // Not a section this page can edit where it is: the fold's own editor.
              onEdit(section);
              return;
            }
            // Not before the working copies are read (independent review, 15 November
            // 2026): an editor never opens without an earlier copy that is there.
            if (gate === "wait") {
              return;
            }
            if (view !== "document") {
              choose("document");
            }
            // What the person typed and did not save, where there is some (section 3.4).
            // Where the read failed, the editor opens with keeping off, and they are read
            // again: a copy found then is offered, never kept over.
            const copy = gate === "open" ? copyFor(editor, copies) : null;
            if (gate === "unread") {
              working.reread();
            }
            setSaved(null);
            setEditing({
              section,
              source,
              editor,
              draft:
                copy === null ? draftOf(editor) : restoredDraft(editor, copy),
              phase: "editing",
              refusal: "",
              restored: copy,
              known: gate === "open" ? KNOWN : { state: "unknown" },
            });
            // A copy taken up again that names the agent's draft (section 3.11: "Use the
            // draft", "Leave without saving", back): the editor holds that draft, so the
            // next Save names it and is never recorded as the person's own text.
            setUsed(copy === null ? null : heldFrom(editor, copy));
          },
    editing:
      editing === null
        ? null
        : {
            section: editing.section,
            editor: editing.editor,
            draft: editing.draft,
            phase: editing.phase,
            refusal: editing.refusal,
            onChange: redraft,
            onSave: () => {
              void save();
            },
            onCancel: cancel,
            keeping: keeper.keeping,
            restored:
              editing.known.state === "found"
                ? {
                    words: foundWords(editing.known.copy),
                    stale: copyIsStale(editing.known.copy, editing.source),
                    onDiscard: discardFound,
                    onUse: useFound,
                  }
                : editing.restored === null
                  ? null
                  : {
                      words: restoredWords(editing.restored),
                      stale: copyIsStale(editing.restored, editing.source),
                      onDiscard: discardRestored,
                    },
            redraft: redraftOffer,
          },
    saved,
    copied,
    checking: source !== null && gate === "wait",
    behind,
    onPoint: (key) => {
      choose("document");
      setSeeking(key);
    },
    points:
      paper === null || paper.workpaper === null
        ? null
        : {
            scope,
            version: paper.workpaper.version,
            // A consideration moves the workpaper's version: the next write waits for
            // the read that shows it, so it never posts the version before.
            held: held || rereading,
            evidenceHref,
            // Confirmed (or in doubt): the views are read again, and the page's records,
            // whose version the write moved (as after a recorded conclusion, 3.6).
            onSettled: () => {
              setRereading(true);
              setAttempt((n) => n + 1);
              refreshRecords();
            },
          },
    onConclusion: () => {
      choose("document");
      setSeekingConclusion(true);
    },
    choice: {
      scope,
      // Recorded (section 3.6): the conclusion the server answered with is shown at
      // once, and the views are read again in the background (the choice's panel reads
      // the page's records again itself).
      onRecorded: (choice) => {
        setState((before) =>
          before.paper === null
            ? before
            : {
                ...before,
                paper: {
                  ...before.paper,
                  conclusion: { ...before.paper.conclusion, choice },
                },
              },
        );
        setRereading(true);
        setAttempt((n) => n + 1);
      },
      // Refused as the records changed: they are read again, what was chosen stays.
      onRefused: () => {
        setAttempt((n) => n + 1);
      },
    },
    deficiencyHref,
    signOff: {
      ids: scope,
      unsaved: editing !== null,
      // Held, not only `behind` (independent review, 16 November 2026): the record's
      // own version behind the views, or a recorded conclusion not read yet, would post
      // a version the server refuses as stale.
      behind: held || rereading,
      canAct,
      conclusion,
      // Who is reading (the review notes' route asks the API who the session is): the
      // reviewer a request names signs it; their own row in the picker says "(you)".
      viewerId: reviewNotes.set?.viewerId ?? null,
      notes:
        reviewNotes.set === null
          ? null
          : {
              open:
                reviewNotes.set.counts.open + reviewNotes.set.counts.responded,
              urgent: reviewNotes.set.counts.urgentOpen,
            },
      onNotes: () => choose("notes"),
      // Signed or reopened: the views and the page's records are read again, as after
      // any confirmed write; nothing is shown as done before the server confirmed.
      onDone: () => {
        setAttempt((n) => n + 1);
        refreshRecords();
      },
    },
  };
  // A paper kept after a read that failed may be out of date: it says so, and is not
  // printed until it is read again.
  const stale = paper !== null && state.problem !== null;
  const tabbed = paper === null || paper.workpaper !== null;

  const panelId = `${uid}-panel`;
  const body: ReactNode =
    paper === null ? (
      state.problem !== null && !state.loading ? null : (
        <Outline />
      )
    ) : paper.workpaper === null ? (
      <div className="card dw-empty">
        <span className="dw-empty-mark" aria-hidden="true">
          <UiIcon name="file" size={18} />
        </span>
        <div>
          <strong>No design workpaper yet</strong>
          <p>
            Draft it under “Edit, prepare and versions” below. The agent writes
            the walkthrough from the evidence on record
            {paper.evidence.length > 0
              ? ` (${paper.evidence.length} ${paper.evidence.length === 1 ? "file" : "files"} so far)`
              : ""}
            , and the document, the matrix and the evidence view appear here for
            you to edit. The preparer signs at the end of section{" "}
            {DW_SECTION.conclusion}, the conclusion.
          </p>
          {onDraft !== undefined ? (
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={onDraft}
            >
              Go to Draft
            </button>
          ) : null}
        </div>
      </div>
    ) : view === "document" ? (
      <div className={railBeside ? "rn-with-rail" : undefined}>
        <div
          ref={sheetRef}
          className={`rn-sheet${notesShown ? " is-noting" : ""}`}
        >
          <DocumentSheet paper={paper} actions={actions} />
          {/* The margin: the markers and "Add review note" (docs/workpaper-review.md,
              section 6). */}
          <NotesMargin />
        </div>
        {railBeside ? <NotesRail id={`${uid}-rail`} /> : null}
        {notesAside && focusSide !== null
          ? createPortal(
              <div className={`rn-side${railOn ? " is-open" : ""}`}>
                {railOn ? <NotesRail id={`${uid}-rail`} /> : null}
                <NotesStrip
                  open={railOn}
                  onToggle={() => setRailChoice(!railOn)}
                  railId={`${uid}-rail`}
                />
              </div>,
              focusSide,
            )
          : null}
      </div>
    ) : view === "notes" ? (
      <AllNotesView
        workpaperId={paper.workpaper.id}
        onOpenAt={() => {
          setRailChoice(true);
          choose("document");
        }}
      />
    ) : view === "matrix" ? (
      <MatrixBoard paper={paper} scope={scope} actions={actions} />
    ) : (
      <EvidenceSplit
        paper={paper}
        scope={scope}
        actions={actions}
        selection={shown}
        from={selection?.from ?? ""}
        pick={pick}
        paneRef={pane}
        revision={attempt}
        returnFocus={returnToOpener}
        onReview={(entry) => setOpened({ entry, annotationId: null })}
      />
    );

  return (
    <ReviewNotesProvider
      notes={reviewNotes}
      paper={paper}
      // Off while the sheet prints: the printed copy carries no marker or highlight.
      on={notesShown}
      // The highlights and the markers with the rail; a note started while it is off
      // turns it on, and its form opens there.
      railOn={railOn}
      onRailOn={showRail}
      workpaperVersion={
        paper?.workpaper?.shownVersion || paper?.workpaper?.currentVersion || 1
      }
      rootRef={sheetRef}
    >
      <section
        ref={root}
        className="dw"
        aria-label="Design and implementation workpaper"
      >
        {tabbed ? (
          <div className="dw-bar">
            <div
              className="dw-switch"
              role="tablist"
              aria-label="Workpaper view"
              onKeyDown={onKey}
            >
              {VIEWS.map((item) => {
                const on = item.key === view;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    id={`${uid}-tab-${item.key}`}
                    ref={(node) => {
                      if (node === null) {
                        tabs.current.delete(item.key);
                      } else {
                        tabs.current.set(item.key, node);
                      }
                    }}
                    className={`dw-tab${on ? " is-on" : ""}`}
                    aria-selected={on}
                    aria-controls={panelId}
                    tabIndex={on ? 0 : -1}
                    title={item.hint}
                    onClick={() => choose(item.key)}
                  >
                    <UiIcon name={VIEW_ICONS[item.key]} size={14} />
                    {item.label}
                    {item.key === "notes" && openNotes > 0
                      ? ` · ${openNotes}`
                      : ""}
                  </button>
                );
              })}
            </div>
            <p className="dw-bar-note" aria-live="polite">
              {state.loading && paper !== null
                ? "Reading the workpaper again"
                : ""}
            </p>
            {view === "document" &&
            paper !== null &&
            paper.workpaper !== null &&
            reviewNotes.status !== "off" &&
            !notesAside ? (
              // The review notes beside the sheet (docs/workpaper-review.md, section 6);
              // in focus, the strip at the panel's edge is their switch.
              <button
                type="button"
                className={`dw-notes-switch${railOn ? " is-on" : ""}`}
                aria-pressed={railOn}
                aria-controls={railOn ? `${uid}-rail` : undefined}
                onClick={() => setRailChoice(!railOn)}
              >
                <UiIcon name="message" size={13} />
                Notes{openNotes > 0 ? ` · ${openNotes}` : ""}
              </button>
            ) : null}
            {view === "document" && paper !== null && editing !== null ? (
              // A section open in its editor is not the workpaper as saved: it is not
              // printed until the editor is closed.
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled
                title="Save or cancel the section you are editing before printing."
              >
                <UiIcon name="file" size={13} /> Print or save as PDF
              </button>
            ) : view === "document" && paper !== null ? (
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={stale}
                title={
                  stale
                    ? "Read the workpaper again before printing it."
                    : undefined
                }
                onClick={() => {
                  if (!stale) {
                    setPrinting(true);
                  }
                }}
              >
                <UiIcon name="file" size={13} /> Print or save as PDF
              </button>
            ) : null}
          </div>
        ) : null}
        {state.problem !== null ? (
          // It stays while the retry is out, so the button a person pressed keeps the focus.
          <p className="banner banner-warning dw-problem" role="alert">
            <UiIcon name="info" size={15} />
            <span>{stale ? staleProblem(state.problem) : state.problem}</span>
            <button
              type="button"
              className="btn-secondary btn-sm"
              aria-busy={state.loading}
              onClick={() => {
                if (!state.loading) {
                  retried.current = true;
                  setAttempt((count) => count + 1);
                }
              }}
            >
              Try again
            </button>
          </p>
        ) : null}
        {tabbed ? (
          <div
            className="dw-panel"
            role="tabpanel"
            id={panelId}
            aria-labelledby={`${uid}-tab-${view}`}
            aria-busy={state.loading}
          >
            {body}
          </div>
        ) : (
          // No workpaper, so no tabs: the panel is not labelled by one that is not there.
          <div className="dw-panel" aria-busy={state.loading}>
            {body}
          </div>
        )}
        {opened !== null ? (
          <AnnotatedDialog
            organizationId={scope.organizationId}
            projectId={scope.projectId}
            files={[
              { id: opened.entry.fileId, fileName: opened.entry.fileName },
            ]}
            title={opened.entry.requirementTitle || evidenceTitle(opened.entry)}
            annotations={
              opened.entry.requirementId === null
                ? undefined
                : {
                    controlId: scope.controlId,
                    requirementId: opened.entry.requirementId,
                  }
            }
            startAnnotationId={opened.annotationId ?? undefined}
            onClose={() => {
              setOpened(null);
              // The pane reads the file again without opening an annotation, so the focus
              // the preview hands back stays where it is put.
              setSelection((before) =>
                before === null || before.annotationId === null
                  ? before
                  : { ...before, annotationId: null },
              );
              // An annotation reviewed in the preview changes the counts: read them again.
              setAttempt((count) => count + 1);
            }}
          />
        ) : null}
        {askingNow && editing !== null ? (
          <LeaveDialog
            section={editing.editor.title}
            problem={draftProblem(editing.editor, editing.draft)}
            refusal={editing.refusal}
            words={leaveWords({
              keeping: keeper.keeping,
              problem: draftProblem(editing.editor, editing.draft),
              unkept: keeper.unkept(),
              waited,
            })}
            onSave={async () => {
              const section = editing.section;
              await save();
              // Only once the server confirmed the save; the page is leaving, so it does
              // not wait for the views to read again. A refusal stays, said in the bar.
              if (confirmed.current === section) {
                goOn();
              } else {
                stay();
              }
            }}
            onLeave={async (lose) => {
              // The latest is kept at once (no pause), and the page does not wait long. It
              // goes on only once the keep was confirmed, or where the person was told the
              // changes are not kept and chose to leave anyway (independent review, 15
              // November 2026); otherwise the dialog stays and says so.
              await keeper.flush(LEAVE_WAIT_MS);
              if (lose || !keeper.unkept()) {
                goOn();
              } else {
                setWaited(true);
              }
            }}
            onStay={stay}
          />
        ) : null}
        {printing && !stale && paper !== null && paper.workpaper !== null
          ? createPortal(
              <div className="dw-print-root">
                <DocumentSheet paper={paper} actions={null} />
              </div>,
              document.body,
            )
          : null}
      </section>
    </ReviewNotesProvider>
  );
}

/** The views' shape while the workpaper is read: a header block and a few sections. */
/** A report whose reliability a person established on review (section 10.14): the
 * legend's mark with its words, then the server's sentence (who, when, what was relied
 * on). Nothing where no person did. */
function Inspected({
  paper,
  report,
}: {
  paper: Paper;
  report: Paper["reports"][number];
}) {
  const said = reportInspected(paper, report);
  if (said === null) {
    return null;
  }
  return (
    <span className="dw-inspected">
      <b className="dw-tm" aria-hidden="true">
        {said.symbol}
      </b>{" "}
      {`${said.words}. ${said.said}`}
    </span>
  );
}

function Outline() {
  return (
    <div className="card dw-outline">
      <p className="sr-only" role="status">
        Reading the workpaper
      </p>
      <div className="dw-outline-top" aria-hidden="true">
        <div>
          <span className="dw-skel is-eyebrow" />
          <span className="dw-skel is-title" />
          <span className="dw-skel is-line" />
        </div>
        <span className="dw-skel is-block" />
      </div>
      {[0, 1, 2].map((section) => (
        <div className="dw-outline-sec" key={section} aria-hidden="true">
          <span className="dw-skel is-head" />
          <span className="dw-skel" />
          <span className="dw-skel" />
          <span className="dw-skel is-short" />
        </div>
      ))}
    </div>
  );
}

/* Shared pieces ------------------------------------------------------------------------- */

/** References as chips. With actions, each opens its file; printed, each is its text. */
function Refs({
  refs,
  paper,
  actions,
  current,
  from = "",
}: {
  refs: ReadonlyArray<Reference | string>;
  paper: Paper;
  actions: Actions | null;
  /** Beside the evidence: the file in view, and the statement it was selected on. */
  current?: Current | undefined;
  /** The statement these chips belong to. */
  from?: string;
}) {
  const chips = refChips(refs, paper.evidence);
  if (chips.length === 0) {
    return null;
  }
  return (
    <span className="dw-refs">
      {chips.map((chip) => {
        if (actions === null || chip.entry === null) {
          return (
            <span className="dw-ref" key={chip.ref} title={chip.title}>
              {chip.label}
            </span>
          );
        }
        const on =
          current !== undefined &&
          current.ref === chip.ref &&
          current.from === from;
        return (
          <button
            type="button"
            key={chip.ref}
            className={`dw-ref${on ? " is-on" : ""}`}
            title={chip.title}
            aria-pressed={current === undefined ? undefined : on}
            onClick={(event) => actions.onRef(chip, from, event.currentTarget)}
          >
            <span aria-hidden="true">{chip.label}</span>
            <span className="sr-only">{chip.name}</span>
          </button>
        );
      })}
    </span>
  );
}

function StatePill({ words, tone }: { words: string; tone: string }) {
  return <span className={`pill tone-${tone}`}>{words}</span>;
}

/** "Edit" on a section a preparer may edit: it opens the section's editor where the
 * document shows it, or the existing editor in the fold. While a section is being edited it
 * says so in place of its link, and the other links are off. */
function EditLink({
  section,
  what,
  actions,
  editable,
}: {
  section: EditableSection;
  what: string;
  actions: Actions | null;
  editable: boolean;
}) {
  const onEdit = actions?.onEdit ?? null;
  if (onEdit === null || !editable) {
    return null;
  }
  const editing = actions?.editing ?? null;
  if (editing !== null && editing.section === section) {
    return (
      <span className="pill tone-info dw-editing">
        Editing<span className="sr-only"> {what}</span>
      </span>
    );
  }
  // A working copy of it (section 3.4): the link goes on with it.
  const copied = actions?.copied.has(section) === true;
  const checking = actions?.checking === true;
  const link = (
    <button
      type="button"
      className="dw-edit"
      data-edit={section}
      disabled={editing !== null || actions?.behind === true || checking}
      onClick={() => onEdit(section)}
    >
      {copied ? CONTINUE_EDITING : "Edit"}
      <span className="sr-only"> {what}</span>
    </button>
  );
  // While the working copies are read, "Edit" waits and says why.
  if (checking && editing === null) {
    return (
      <span className="dw-edit-group">
        <span className="dw-checking">{CHECKING_COPIES}</span>
        {link}
      </span>
    );
  }
  return copied ? (
    <span className="dw-edit-group">
      <span className="pill tone-neutral dw-has-copy">{HAS_COPY}</span>
      {link}
    </span>
  ) : (
    link
  );
}

function Verdict({
  conclusion,
  label,
}: {
  conclusion: ConclusionView;
  label: string;
}) {
  return (
    <div className={`dw-verdict is-${conclusion.tone}`}>
      <small>{label}</small>
      <strong>{conclusion.headline}</strong>
      <span className={`pill tone-${conclusion.tone}`}>
        {conclusion.standing === PROPOSED_BY_AGENT ? (
          <UiIcon name="sparkles" size={11} />
        ) : null}
        {conclusion.standing}
      </span>
    </div>
  );
}

/** Section 7's head (product owner, 16 November 2026: section 7 lighter, option A): the
 * conclusion in the display serif, or "No conclusion recorded yet" in quiet text, and
 * under it one quiet line: who recorded it and whether the agent proposed the same (or,
 * before any choice, what the agent proposes), signed or out of date where the server
 * says so (sections 3.5 and 3.6), and "Change" (`change`, the choice's own link, where
 * the preparer may record it). Why a sign-off is out of date, quietly under it. */
function ConclusionHead({
  paper,
  conclusion,
  change,
}: {
  paper: Paper;
  conclusion: ConclusionView;
  change: ReactNode;
}) {
  const proposal = paper.conclusion.proposedConclusion;
  const choice = paper.conclusion.choice;
  const named =
    choice !== null || conclusion.signed
      ? conclusion.verdict !== ""
        ? conclusion.verdict
        : conclusion.headline
      : "";
  const said: string[] = [];
  if (choice !== null) {
    said.push(recordedLine(choice));
    if (proposal !== null) {
      said.push(
        choice.kind === proposal
          ? "the agent proposed the same"
          : `the agent proposed “${CONCLUSION_WORDS[proposal]}”`,
      );
    }
  } else if (proposal !== null) {
    said.push(
      `Proposed by the agent: ${CONCLUSION_WORDS[proposal]}`,
      "not recorded yet",
    );
  } else if (!conclusion.signed) {
    said.push(
      conclusion.verdict !== ""
        ? `Proposed: ${conclusion.verdict}`
        : "Not recorded yet",
    );
  }
  // Signed, or out of date: in the model's words, in the same line.
  if (conclusion.signed || conclusion.stale) {
    said.push(conclusion.standing);
  }
  return (
    <div className="dw-concl-head">
      <small>Design and implementation</small>
      {named !== "" ? (
        // The conclusion chosen: a reviewer's note may be raised on it (section 3 of
        // docs/workpaper-review.md, `conclusion.choice`; independent review, 16
        // November 2026). It has no words to highlight.
        <NoteField field={CONCLUSION_CHOICE}>
          <strong>{named}</strong>
        </NoteField>
      ) : (
        <strong className="is-none">No conclusion recorded yet</strong>
      )}
      <p className="dw-concl-meta">
        {said.join(" · ")}
        {change}
      </p>
      {choice !== null && choice.basis !== null ? (
        <p className="dw-concl-meta">
          Not effective in: {BASIS_WORDS[choice.basis]}
        </p>
      ) : null}
      {choice !== null && choice.reason !== "" ? (
        <p className="dw-concl-meta">Reason: {choice.reason}</p>
      ) : null}
      <OutOfDate reasons={conclusion.outOfDate} />
    </div>
  );
}

/** The two results' marks: settled, exceptions, open. Words carry the meaning; the mark
 * is for the eye. */
const RESULT_MARKS: Readonly<Record<string, string>> = {
  info: "✓",
  warning: "!",
  neutral: "–",
};

/** The design and the implementation result on one line (section 3.6; option A), each a
 * mark, its name and its words, and "Why" at the right, which shows the agent's reasons
 * and the results' sentences and open letters as a short quiet list. Nothing where the
 * server sends neither. On paper (`why` false) there is no toggle: the list is printed,
 * open, so the sheet keeps each result's sentence and the agent's reasons (contract 3.6,
 * "Each with one sentence"; independent review, 16 November 2026: before, the printed
 * sheet carried the marks and the words only). */
function Results({ paper, why }: { paper: Paper; why: boolean }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  if (paper.design === null && paper.implementation === null) {
    return null;
  }
  const boxes = resultBoxes(paper);
  const reasons = paper.conclusion.proposedReasons;
  const more = boxes
    .map((box) => ({
      label: box.label,
      said: [
        reasons.includes(box.sentence) ? "" : box.sentence,
        box.open === "" ? "" : `${box.open}.`,
      ]
        .filter((part) => part !== "")
        .join(" "),
    }))
    .filter((item) => item.said !== "");
  const any = reasons.length > 0 || more.length > 0;
  return (
    <div className="dw-results">
      <ul className="dw-results-line" aria-label="Results">
        {boxes.map((box) => (
          <li key={box.label} className={`dw-result is-${box.tone}`}>
            <span className="dw-result-mark" aria-hidden="true">
              {RESULT_MARKS[box.tone] ?? "–"}
            </span>
            <b>{box.label}</b>{" "}
            <span className="dw-result-words">
              {box.words.charAt(0).toLowerCase() + box.words.slice(1)}
            </span>
          </li>
        ))}
      </ul>
      {any && why ? (
        <button
          type="button"
          className="dw-link dw-why-toggle"
          aria-expanded={open}
          aria-controls={`${uid}-why`}
          onClick={() => setOpen((was) => !was)}
        >
          Why
          <span className="sr-only"> the agent proposes it</span>
        </button>
      ) : null}
      {any ? (
        <ul id={`${uid}-why`} className="dw-why" hidden={why && !open}>
          {keyed(reasons, (reason) => reason).map(({ key, item }) => (
            <li key={key}>{item}</li>
          ))}
          {more.map((item) => (
            <li key={item.label}>
              <b>{item.label}.</b> {item.said}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Section 7's Sign-off (sections 3.7 and 3.8): the preparer's row, then the
 * reviewer's; on paper, the signature lines under the sheet say it. */
function SignOffOf({
  paper,
  actions,
  head,
}: {
  paper: Paper;
  actions: Actions | null;
  head: ReturnType<typeof headerOf>;
}) {
  const workpaper = paper.workpaper;
  const sign = actions?.signOff ?? null;
  if (workpaper === null || sign === null) {
    return null;
  }
  return (
    <SignOffBlock
      ids={sign.ids}
      workpaperId={workpaper.id}
      version={workpaper.version}
      // A draft: the server's `can_edit` (the role and the engagement open). Prepared:
      // "Reopen to change" only for a viewer who may act, as the fold's Reopen
      // (independent review, 16 November 2026: before, anyone who could read it).
      preparerMayAct={
        paper.canEdit || (workpaper.status === "PREPARED" && sign.canAct)
      }
      facts={{
        status: workpaper.status,
        drafting: workpaper.drafting,
        latest:
          workpaper.shownVersion === 0 ||
          workpaper.shownVersion === workpaper.currentVersion,
        choice: paper.conclusion.choice,
        unsaved: sign.unsaved,
        behind: sign.behind,
        // Section 3.9: the button waits while a point is not settled.
        points:
          workpaper.status === "DRAFT" ? unsettled(paper.points).length : 0,
      }}
      // The preparer's list of what is left, each with the way to its place; nobody else
      // sees it (section 3.9).
      decisions={
        paper.canSettle
          ? decisionsList(paper.points, paper).map((item) => ({
              ...item,
              onGo:
                actions?.onPoint === null || actions?.onPoint === undefined
                  ? null
                  : () => actions.onPoint?.(item.key),
            }))
          : []
      }
      // The reviewer's sign-off waits while points were raised since the preparer signed.
      raised={raisedSinceSigned(paper.points, workpaper.status)}
      // The message to the reviewer starts with the agent's observations, one per line.
      draft={draftMessage(paper.observations)}
      prepared={{
        by: head.prepared.by,
        on: head.prepared.on,
        version:
          workpaper.status === "PREPARED" ? workpaper.currentVersion : null,
      }}
      conclusion={sign.conclusion}
      viewerId={sign.viewerId}
      canAct={sign.canAct}
      notes={sign.notes}
      onNotes={sign.onNotes}
      onDone={sign.onDone}
    />
  );
}

/** Section 7's top: the head, the results (`children`), and the choice where the
 * preparer may record it (the editable draft: the server's `can_edit`, the same rule as
 * its `can_choose`): "Change" in the head's line, the form in place under the results.
 * On paper, and for anyone else, the head and the results only. The way to a design
 * deficiency, where the conclusion depends on one, quietly under the results. */
function ConclusionChoiceOf({
  paper,
  conclusion,
  actions,
  children,
}: {
  paper: Paper;
  conclusion: ConclusionView;
  actions: Actions | null;
  children: ReactNode;
}) {
  const head = (change: ReactNode) => (
    <ConclusionHead paper={paper} conclusion={conclusion} change={change} />
  );
  if (actions === null) {
    // On paper: nothing to choose.
    return (
      <>
        {head(null)}
        {children}
      </>
    );
  }
  const facts = choiceFactsOf(paper);
  const choice = paper.conclusion.choice;
  const wanted = deficiencyWanted(
    facts,
    choice?.kind ?? paper.conclusion.proposedConclusion,
  );
  const scope = actions.choice?.scope ?? null;
  const deficiency = wanted ? (
    <p className="dw-concl-deficiency">
      {actions.deficiencyHref !== null ? (
        <>
          The conclusion follows the deficiency log.{" "}
          <a href={actions.deficiencyHref}>Log a design deficiency</a>
        </>
      ) : (
        "The conclusion follows the deficiency log: log a design deficiency in Reports, under Deficiencies."
      )}
    </p>
  ) : null;
  return paper.canEdit && scope !== null && actions.choice !== null ? (
    <ConclusionChoicePanel
      // Another workpaper is another panel.
      key={paper.workpaper?.id ?? ""}
      scope={scope}
      choice={choice}
      proposal={paper.conclusion.proposedConclusion}
      facts={facts}
      onRecorded={actions.choice.onRecorded}
      onRefused={actions.choice.onRefused}
      deficiencyHref={actions.deficiencyHref}
      head={head}
    >
      {children}
      {deficiency}
    </ConclusionChoicePanel>
  ) : (
    <>
      {head(null)}
      {children}
      {deficiency}
    </>
  );
}

/** "Edit conclusion": the same in-place editor as the link on section 7's heading, as a
 * quiet text link under the text (section 3.5; option A). Off while another editor is
 * open, while the page's records are behind a save, and while the working copies are
 * read. */
function EditConclusion({
  actions,
  editable,
}: {
  actions: Actions | null;
  editable: boolean;
}) {
  const onEdit = actions?.onEdit ?? null;
  if (onEdit === null || !editable) {
    return null;
  }
  const copied = actions?.copied.has("conclusion") === true;
  return (
    <p className="dw-concl-edit">
      <button
        type="button"
        className="dw-link"
        disabled={
          actions?.editing != null ||
          actions?.behind === true ||
          actions?.checking === true
        }
        onClick={() => onEdit("conclusion")}
      >
        {copied ? CONTINUE_EDITING : "Edit conclusion"}
        {copied ? <span className="sr-only"> the conclusion</span> : null}
      </button>
    </p>
  );
}

/** "Open section 7": the document's conclusion, from the Matrix and the Evidence view. */
function ToConclusion({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="dw-edit dw-to-concl" onClick={onOpen}>
      Open section {DW_SECTION.conclusion}
      <span className="sr-only">, the conclusion, in the document</span>
    </button>
  );
}

function OutOfDate({ reasons }: { reasons: readonly string[] }) {
  if (reasons.length === 0) {
    return null;
  }
  return (
    <ul className="dw-stale">
      {keyed(reasons, (reason) => reason).map(({ key, item }) => (
        <li key={key}>{item}</li>
      ))}
    </ul>
  );
}

/* The points, at their place (docs/design-workpaper.md, section 3.9) ------------------ */

/** The points shown at one place, each as its viewer sees it; nothing where none is. On
 * the printed copy (no actions), only the considered ones. */
function PointsHere({
  paper,
  actions,
  at,
}: {
  paper: Paper;
  actions: Actions | null;
  at: Shown;
}) {
  const facts = {
    canSettle: paper.canSettle,
    status: paper.workpaper?.status ?? null,
  };
  const here = pointsAt(paper.points, paper, at).filter(
    (point) => pointShown(point, facts, actions === null) !== "hidden",
  );
  if (here.length === 0) {
    return null;
  }
  return (
    <div className="dw-points">
      {here.map((point) => (
        <PointRow
          key={point.key}
          point={point}
          shown={pointShown(point, facts, actions === null)}
          canSettle={paper.canSettle}
          writes={actions?.points ?? null}
          printed={actions === null}
          refs={<Refs refs={point.refs} paper={paper} actions={actions} />}
        />
      ))}
    </div>
  );
}

/* Document: the classic workpaper ------------------------------------------------------- */

/** The attributes' table: as it is, or inside the notes editor while the notes are edited
 * (each row then holds its own box, and the editor's bar is under the table). */
function NotesFrame({
  open,
  children,
}: {
  open: EditorProps | null;
  children: ReactNode;
}) {
  return open === null ? (
    children
  ) : (
    <NotesEditorPanel {...open}>{children}</NotesEditorPanel>
  );
}

function Section({
  number,
  title,
  subtitle,
  edit,
  said,
  anchor,
  children,
}: {
  /** The section's number: DW_SECTION's, never a literal. None for "Tickmarks and
   * evidence". */
  number?: number;
  title: string;
  /** A quiet line beside the title, in the heading row (section 3.10). */
  subtitle?: string;
  edit?: ReactNode;
  /** What the section says once a save of it is confirmed; "" until then. The line is
   * there from the start, so the words are announced when they arrive. */
  said?: string | undefined;
  /** Where a link elsewhere on the page lands: its heading then takes the focus. */
  anchor?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section className="dw-sec" id={anchor}>
      <header className="dw-sec-head">
        <h5 tabIndex={anchor === undefined ? undefined : -1}>
          {number !== undefined ? <span>{number}</span> : null}
          {title}
        </h5>
        {subtitle !== undefined ? (
          <p className="dw-sec-sub">{subtitle}</p>
        ) : null}
        {edit}
      </header>
      {said !== undefined ? (
        <p className="dw-saved" role="status">
          {said}
        </p>
      ) : null}
      {children}
    </section>
  );
}

function DocumentSheet({
  paper,
  actions,
}: {
  paper: Paper;
  /** Null on the printed sheet: references are text, nothing is offered, and only the
   * considered points are shown (section 3.9). */
  actions: Actions | null;
}) {
  const head = headerOf(paper);
  const editable = editableSections(paper);
  const conclusion = conclusionOf(paper);
  const dated = walkthroughIsDated(paper.walkthrough);
  const columns = walkthroughHeaders(paper.walkthrough.columns);
  // The stored walkthrough's column numbers: the review notes' field keys (section 3 of
  // docs/workpaper-review.md).
  const stored = walkthroughColumnsOf(paper.walkthrough.columns);
  const legend = tickmarkLegend(paper);
  // Whether a place has a point this viewer sees (section 3.9): only then is a row of
  // its own drawn under the attribute or the report.
  const pointFacts = {
    canSettle: paper.canSettle,
    status: paper.workpaper?.status ?? null,
  };
  const pointed = (at: Shown) =>
    pointsAt(paper.points, paper, at).some(
      (point) => pointShown(point, pointFacts, actions === null) !== "hidden",
    );
  const { understanding } = paper;
  const { workpaper } = paper;
  // The section open in its editor, if one is (never on the printed sheet).
  const open = actions?.editing ?? null;
  const editorOf = (section: EditableSection) =>
    open !== null && open.section === section ? open : null;
  const understood = editorOf("understanding");
  const walking = editorOf("walkthrough");
  const reporting = editorOf("reports");
  const concluding = editorOf("conclusion");
  const noting = editorOf("attributes");
  const notes =
    noting !== null &&
    noting.editor.kind === "notes" &&
    noting.draft.kind === "notes"
      ? {
          items: noting.editor.items,
          typed: noting.draft.notes,
          phase: noting.phase,
          onChange: noting.onChange,
        }
      : null;
  /** The line under a section's heading that says its save was confirmed. */
  const saidOf = (section: EditableSection) =>
    actions === null || !editable.has(section)
      ? undefined
      : actions.saved === section
        ? SAVED
        : "";
  return (
    <article className="card dw-sheet">
      <header className="dw-top">
        <div>
          {head.eyebrow !== "" ? (
            <p className="dw-eyebrow">{head.eyebrow}</p>
          ) : null}
          <h4 className="dw-title">Test of design and implementation</h4>
          <p className="dw-sub">
            <strong>{head.control.ref}</strong> {head.control.title}
            {head.control.system !== "" ? ` · ${head.control.system}` : ""}
          </p>
        </div>
        <dl className="dw-stone">
          {head.rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd className={row.pending ? "is-pending" : undefined}>
                {row.value}
              </dd>
            </div>
          ))}
          <div>
            <dt>Status</dt>
            <dd>
              <StatePill {...head.status} />
            </dd>
          </div>
        </dl>
      </header>

      {/* The order (docs/design-workpaper.md, section 3.10; product owner, 16 November
          2026: "Should the procedure be first then the narrative will be the result of
          the procedure?"): the control as management describes it, the procedures
          performed, then the understanding they led to, then the walkthrough, the
          attributes, the information produced by the entity and the conclusion. The
          numbers are DW_SECTION's. */}
      <Section
        number={DW_SECTION.objective}
        title="Objective, risk and control"
      >
        <div className="dw-two">
          <div>
            <h6>Risk addressed</h6>
            <p>
              {paper.risk !== "" ? (
                <NoteField
                  field={controlKey("risk")}
                  text={paper.risk}
                  inline
                />
              ) : (
                "Not stated on the control."
              )}
            </p>
          </div>
          <div>
            <h6>Control activity</h6>
            <p>
              {paper.activity !== "" ? (
                <NoteField
                  field={controlKey("activity")}
                  text={paper.activity}
                  inline
                />
              ) : (
                "Not stated on the control."
              )}
            </p>
          </div>
        </div>
        {paper.facts.length > 0 ? (
          <dl className="dw-facts">
            {keyed(paper.facts, (item) => item.label).map(
              ({ key, item: fact }) => (
                <div key={key}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ),
            )}
          </dl>
        ) : null}
      </Section>

      <Section number={DW_SECTION.procedures} title="Procedures performed">
        {paper.procedures.length === 0 ? (
          <p className="dw-none">
            No procedure is on record yet. They are listed here as the evidence
            is inspected.
          </p>
        ) : (
          <ol className="dw-proc">
            {keyed(paper.procedures, (item) => item).map(
              ({ key, item }, index) => (
                <li key={key}>
                  <NoteField
                    field={procedureKey(index + 1)}
                    text={item}
                    inline
                  />
                </li>
              ),
            )}
          </ol>
        )}
      </Section>

      <Section
        number={DW_SECTION.understanding}
        title="Understanding of the control"
        subtitle={`The result of the procedures in section ${DW_SECTION.procedures}`}
        said={saidOf("understanding")}
        edit={
          understanding.length > 0 ? (
            <EditLink
              section="understanding"
              what="the understanding of the control"
              actions={actions}
              editable={editable.has("understanding")}
            />
          ) : null
        }
      >
        {understood !== null ? (
          <SectionEditorPanel {...understood} />
        ) : understanding.length > 0 ? (
          <div className="dw-prose">
            <NoteField field={UNDERSTANDING} text={understanding} rich>
              <RichText text={understanding} />
            </NoteField>
          </div>
        ) : (
          <p className="dw-none">
            No understanding of the control is written in this workpaper.
          </p>
        )}
      </Section>

      <Section
        number={DW_SECTION.walkthrough}
        title="Implementation: walkthrough of one instance"
        said={saidOf("walkthrough")}
        edit={
          <EditLink
            section="walkthrough"
            what="the walkthrough"
            actions={actions}
            editable={editable.has("walkthrough")}
          />
        }
      >
        {walking !== null ? (
          <SectionEditorPanel {...walking} />
        ) : paper.walkthrough.steps.length === 0 ? (
          <p className="dw-none">
            No walkthrough yet. The agent writes it when the workpaper is
            drafted from the evidence.
          </p>
        ) : (
          <div className="dw-table-wrap">
            <table className="dw-table">
              <thead>
                <tr>
                  <th scope="col" className="is-num">
                    #
                  </th>
                  {dated ? (
                    <th scope="col" className="is-when">
                      When
                    </th>
                  ) : null}
                  <th scope="col" className="is-step">
                    {columns.step}
                  </th>
                  <th scope="col">{columns.who}</th>
                  <th scope="col">{columns.evidence}</th>
                  <th scope="col">{columns.result}</th>
                  <th scope="col" className="is-refs">
                    Ref
                  </th>
                </tr>
              </thead>
              <tbody>
                {keyed(paper.walkthrough.steps, (item) =>
                  String(item.number),
                ).map(({ key, item: step }) => (
                  <tr key={key}>
                    <td className="is-num">{step.number}</td>
                    {dated ? (
                      <td className="is-when">
                        {stored.when !== null ? (
                          <NoteField
                            field={walkthroughKey(step.number, stored.when)}
                            text={step.when}
                          />
                        ) : (
                          step.when
                        )}
                      </td>
                    ) : null}
                    <td>
                      <NoteField
                        field={walkthroughKey(step.number, stored.step)}
                        text={step.step}
                      />
                    </td>
                    <td>
                      <NoteField
                        field={walkthroughKey(step.number, stored.who)}
                        text={step.who}
                      />
                    </td>
                    <td>
                      <NoteField
                        field={walkthroughKey(step.number, stored.evidence)}
                        text={step.evidence}
                      />
                    </td>
                    <td>
                      <NoteField
                        field={walkthroughKey(step.number, stored.result)}
                        text={step.result}
                      />
                    </td>
                    <td className="is-refs">
                      <Refs refs={step.refs} paper={paper} actions={actions} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        number={DW_SECTION.attributes}
        title="Attributes tested"
        said={saidOf("attributes")}
        edit={
          <EditLink
            section="attributes"
            what="the notes on the attributes"
            actions={actions}
            editable={editable.has("attributes")}
          />
        }
      >
        {/* A point about a request, or a row this read does not have (section 3.9). */}
        <PointsHere paper={paper} actions={actions} at={{ where: "head" }} />
        {paper.attributes.length === 0 && noting === null ? (
          <p className="dw-none">
            No approved attribute yet. They are listed here once the test plan
            is approved.
          </p>
        ) : (
          <NotesFrame open={noting}>
            <div className="dw-table-wrap">
              <table className="dw-table">
                <thead>
                  <tr>
                    <th scope="col" className="is-attr">
                      Attribute
                    </th>
                    <th scope="col">What the evidence shows</th>
                    <th scope="col" className="is-refs">
                      Evidence
                    </th>
                    <th scope="col" className="is-state">
                      Result
                    </th>
                    <th
                      scope="col"
                      className="is-tm"
                      aria-label="Tickmark"
                      title="Tickmark"
                    >
                      TM
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paper.attributes.map((attribute) => {
                    const mark = tickmarkOf(paper, attribute.tickmark);
                    const item =
                      notes?.items.find((entry) => entry.id === attribute.id) ??
                      null;
                    const at: Shown = {
                      where: "attribute",
                      attributeId: attribute.id,
                    };
                    return (
                      <Fragment key={attribute.id}>
                        <tr>
                          <th scope="row" className="is-attr">
                            <b>{attribute.code}. </b>
                            {attribute.text}
                          </th>
                          <td>
                            {attribute.basis !== "" ? (
                              <NoteField
                                field={attributeKey(attribute.id, "basis")}
                                text={attribute.basis}
                              />
                            ) : (
                              <span className="dw-quiet">
                                Nothing on record for it yet.
                              </span>
                            )}
                            {strayLine(attribute) !== "" ? (
                              <p className="dw-stray">{strayLine(attribute)}</p>
                            ) : null}
                            {attribute.checks.length > 0 ? (
                              <ul className="dw-checks">
                                {keyed(attribute.checks, (item) => item).map(
                                  ({ key, item }) => (
                                    <li key={key}>{item}</li>
                                  ),
                                )}
                              </ul>
                            ) : null}
                            {/* A person's tickmark that does not change the state
                              (section 3.9): said on its row, with who, when and why. */}
                            {attribute.tickmarkNote !== undefined ? (
                              <p className="dw-tm-note">
                                {attribute.tickmarkNote}
                              </p>
                            ) : null}
                            {notes !== null && item !== null ? (
                              <NoteBox
                                item={item}
                                notes={notes.typed}
                                phase={notes.phase}
                                onChange={notes.onChange}
                              />
                            ) : attribute.notes !== "" ? (
                              <p className="dw-note">
                                <b>Preparer's note.</b>{" "}
                                <NoteField
                                  field={attributeKey(attribute.id, "note")}
                                  text={attribute.notes}
                                  inline
                                />
                              </p>
                            ) : null}
                          </td>
                          <td className="is-refs">
                            <Refs
                              refs={attribute.refs}
                              paper={paper}
                              actions={actions}
                            />
                          </td>
                          <td className="is-state">
                            <NoteField
                              field={attributeKey(attribute.id, "result")}
                            >
                              <StatePill {...stateOf(attribute)} />
                              {attribute.shownBy !== null ? (
                                <small className="dw-shown-by">
                                  {SHOWN_BY_WORDS[attribute.shownBy]}
                                </small>
                              ) : null}
                            </NoteField>
                          </td>
                          <td className="is-tm">
                            {mark.symbol !== "" ? (
                              <span className="dw-tm" title={mark.meaning}>
                                <span aria-hidden="true">{mark.symbol}</span>
                                <span className="sr-only">{mark.meaning}</span>
                              </span>
                            ) : (
                              <span className="sr-only">No tickmark</span>
                            )}
                          </td>
                        </tr>
                        {pointed(at) ? (
                          <tr className="dw-point-tr">
                            <td colSpan={5}>
                              <PointsHere
                                paper={paper}
                                actions={actions}
                                at={at}
                              />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </NotesFrame>
        )}
      </Section>

      <Section
        number={DW_SECTION.ipe}
        title="Information produced by the entity"
        said={saidOf("reports")}
        edit={
          <EditLink
            section="reports"
            what="the reports relied on"
            actions={actions}
            editable={editable.has("reports")}
          />
        }
      >
        {reporting !== null ? (
          <SectionEditorPanel {...reporting} />
        ) : paper.reports.length === 0 ? (
          <p className="dw-none">No report is listed in this workpaper.</p>
        ) : (
          <div className="dw-table-wrap">
            <table className="dw-table">
              <thead>
                <tr>
                  <th scope="col" className="is-attr">
                    Report
                  </th>
                  <th scope="col">Source</th>
                  <th scope="col">Completeness and accuracy procedure</th>
                </tr>
              </thead>
              <tbody>
                {keyed(
                  paper.reports,
                  (item) => `${item.ref} ${item.report}`,
                ).map(({ key, item: report }, index) => (
                  <Fragment key={key}>
                    <tr>
                      <th scope="row" className="is-attr">
                        {report.ref !== "" ? (
                          <Refs
                            refs={[report.ref]}
                            paper={paper}
                            actions={actions}
                          />
                        ) : null}{" "}
                        <NoteField
                          field={reportKey(index + 1, 1)}
                          text={report.report}
                          inline
                        />
                      </th>
                      <td>
                        {report.source !== "" ? (
                          <NoteField
                            field={reportKey(index + 1, 2)}
                            text={report.source}
                          />
                        ) : (
                          "Not stated"
                        )}
                      </td>
                      <td>
                        {report.procedure !== "" ? (
                          <NoteField
                            field={reportKey(index + 1, 3)}
                            text={report.procedure}
                          />
                        ) : reportInspected(paper, report) === null ? (
                          <span className="dw-quiet">
                            No procedure on record yet.
                          </span>
                        ) : null}
                        <Inspected paper={paper} report={report} />
                      </td>
                    </tr>
                    {pointed({ where: "report", index }) ? (
                      <tr className="dw-point-tr">
                        <td colSpan={3}>
                          <PointsHere
                            paper={paper}
                            actions={actions}
                            at={{ where: "report", index }}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        number={DW_SECTION.conclusion}
        title="Conclusion"
        said={saidOf("conclusion")}
        // Where Home's "Waiting for your review" links to (section 3.8); not on the
        // printed copy, which is a second sheet.
        anchor={actions === null ? undefined : CONCLUSION_ANCHOR}
        edit={
          <EditLink
            section="conclusion"
            what="the conclusion"
            actions={actions}
            editable={editable.has("conclusion")}
          />
        }
      >
        {/* On the plain sheet, top to bottom (docs/design-workpaper.md, sections 3.5 to
            3.7; product owner, 16 November 2026: section 7 lighter, option A): the
            conclusion and its one quiet line, the two results, the choice in place
            after "Change", the way to a design deficiency, then the text with its one
            editor, and the sign-off. */}
        <div className="dw-concl">
          <ConclusionChoiceOf
            paper={paper}
            conclusion={conclusion}
            actions={actions}
          >
            <Results paper={paper} why={actions !== null} />
          </ConclusionChoiceOf>
          <div className="dw-concl-text">
            {concluding !== null ? (
              <SectionEditorPanel {...concluding} />
            ) : conclusion.text === "" ? (
              <p className="dw-quiet">
                No conclusion is written yet. The agent drafts it with the
                workpaper, and the preparer finalizes it here.
              </p>
            ) : (
              <NoteField field={CONCLUSION} text={conclusion.text} rich>
                <RichText text={conclusion.text} />
              </NoteField>
            )}
            {concluding === null ? (
              <EditConclusion
                actions={actions}
                editable={editable.has("conclusion")}
              />
            ) : null}
          </div>
          <SignOffOf paper={paper} actions={actions} head={head} />
        </div>
      </Section>

      <Section title="Tickmarks and evidence">
        <div className="dw-legend">
          <ul aria-label="Tickmarks">
            {legend.length === 0 ? (
              <li className="dw-quiet">No tickmark is used yet.</li>
            ) : (
              legend.map((item) => (
                <li key={item.mark || item.symbol}>
                  <b className="dw-tm" aria-hidden="true">
                    {item.symbol}
                  </b>
                  <span>{item.meaning}</span>
                </li>
              ))
            )}
          </ul>
          <div>
            <ul aria-label="Evidence index">
              {paper.evidence.length === 0 ? (
                <li className="dw-quiet">
                  No evidence is in force yet. Files are listed here as the
                  design and implementation requests receive them.
                </li>
              ) : (
                paper.evidence.map((entry) => (
                  <li key={entry.ref}>
                    <Refs refs={[entry.ref]} paper={paper} actions={actions} />
                    <span>
                      {evidenceTitle(entry)}
                      {entry.kindWords !== "" ? (
                        <small> · {entry.kindWords}</small>
                      ) : null}
                      {entry.leftOut !== null ? (
                        <small className="dw-left-out">
                          {" "}
                          Left out of the check: {entry.leftOut}
                        </small>
                      ) : null}
                      {notReliedOnLine(entry) !== "" ? (
                        <small className="dw-not-relied">
                          {" "}
                          {notReliedOnLine(entry)}
                        </small>
                      ) : null}
                      {/* Where no section 6 row names the file, its reliability
                        established on review is said here (section 3.9). */}
                      {establishedLine(entry) !== "" &&
                      !paper.reports.some(
                        (report) =>
                          report.ref === entry.ref &&
                          report.inspected !== undefined,
                      ) ? (
                        <small className="dw-not-relied">
                          {" "}
                          {establishedLine(entry)}
                        </small>
                      ) : null}
                      <PointsHere
                        paper={paper}
                        actions={actions}
                        at={{ where: "evidence", ref: entry.ref }}
                      />
                    </span>
                  </li>
                ))
              )}
            </ul>
            {moreFilesLine(paper.evidenceMore) !== "" ? (
              <p className="dw-quiet dw-more-files">
                {moreFilesLine(paper.evidenceMore)}
              </p>
            ) : null}
          </div>
        </div>
      </Section>

      <div className="dw-sign">
        {(
          [
            ["Prepared by", head.prepared],
            ["Reviewed by", head.reviewed],
          ] as const
        ).map(([label, who]) => (
          <div key={label}>
            <span>
              {label}
              {who.by !== null ? <b> {who.by}</b> : null}
            </span>
            <span>
              Date
              {who.on !== null ? <b> {who.on}</b> : null}
            </span>
          </div>
        ))}
      </div>
      <p className="dw-foot">
        <span>
          {[workpaper?.reference ?? "", head.version]
            .filter((part) => part !== "")
            .join(" · ")}
        </span>
        <span>
          References (E1, E2, …) name the evidence a statement rests on.
        </span>
      </p>
    </article>
  );
}

/* Matrix: the test matrix --------------------------------------------------------------- */

function ViewHead({ paper, card = false }: { paper: Paper; card?: boolean }) {
  const head = headerOf(paper);
  const [, , prepared, reviewed] = head.rows;
  return (
    <header className={card ? "card dw-vhead" : "dw-vhead"}>
      <div>
        <h4>
          {head.control.ref !== "" ? `${head.control.ref} · ` : ""}Test of
          design and implementation
        </h4>
        <p>
          {[
            head.control.title,
            head.control.system,
            paper.control.engagement,
            paper.workpaper?.reference
              ? `W/P ${paper.workpaper.reference}`
              : "",
            head.version,
          ]
            .filter((part) => part !== "")
            .join(" · ")}
        </p>
      </div>
      <dl className="dw-who">
        <div>
          <dt>Prepared</dt>
          <dd>{prepared?.value ?? "Not yet"}</dd>
        </div>
        <div>
          <dt>Reviewed</dt>
          <dd>{reviewed?.value ?? "Not yet"}</dd>
        </div>
      </dl>
      <StatePill {...head.status} />
    </header>
  );
}

function Timeline({
  paper,
  actions,
  current,
  across = false,
}: {
  paper: Paper;
  actions: Actions | null;
  current?: Current | undefined;
  /** Laid across the page (the matrix); down it otherwise (beside the evidence). */
  across?: boolean;
}) {
  const stops = timelineOf(paper.walkthrough);
  if (stops.length === 0) {
    return (
      <p className="dw-none">
        No walkthrough yet. The agent writes it when the workpaper is drafted
        from the evidence.
      </p>
    );
  }
  return (
    <ol
      className={`dw-track${
        across && stops.length <= TIMELINE_ACROSS_MOST ? " is-across" : ""
      }`}
    >
      {keyed(stops, (item) => String(item.number)).map(
        ({ key, item: stop }) => (
          <li key={key} className="dw-stop">
            <span className="dw-stop-n" aria-hidden="true">
              {stop.number}
            </span>
            <div className="dw-stop-body">
              <p className="dw-stop-head">
                <span className="sr-only">Step {stop.number}: </span>
                {stop.dated ? <time>{stop.head}</time> : <b>{stop.head}</b>}
                {stop.who !== "" ? <small>{stop.who}</small> : null}
              </p>
              <p className="dw-stop-text">{stop.text}</p>
              {stop.result !== "" ? (
                <p className="dw-stop-result">{stop.result}</p>
              ) : null}
              <Refs
                refs={stop.refs}
                paper={paper}
                actions={actions}
                current={current}
                from={`step-${stop.number}`}
              />
            </div>
          </li>
        ),
      )}
    </ol>
  );
}

function MatrixBoard({
  paper,
  scope,
  actions,
}: {
  paper: Paper;
  scope: WorkpaperScope;
  actions: Actions;
}) {
  const tiles = tilesOf(paper);
  const matrix = matrixOf(paper);
  const editable = editableSections(paper);
  return (
    <div className="dw-board">
      <ViewHead paper={paper} card />
      <ul className="dw-tiles" aria-label="Where the workpaper stands">
        {tiles.map((tile) => (
          <li key={tile.key} className={`card dw-tile is-${tile.tone}`}>
            <small>{tile.label}</small>
            <strong>{tile.value}</strong>
            <p title={tile.note}>{tile.note}</p>
            {/* The conclusion is read and chosen in the document's section 7 (section
                3.5): a short line here, and the way there. */}
            {tile.key === "conclusion" && actions.onConclusion !== null ? (
              <ToConclusion onOpen={actions.onConclusion} />
            ) : null}
          </li>
        ))}
      </ul>

      <section className="card dw-card">
        <header className="dw-card-head">
          <h5>Attributes against the evidence</h5>
          <EditLink
            section="attributes"
            what="the notes on the attributes"
            actions={actions}
            editable={editable.has("attributes")}
          />
        </header>
        {matrix.rows.length === 0 ? (
          <p className="dw-none">
            No approved attribute yet. The matrix is drawn once the test plan is
            approved.
          </p>
        ) : matrix.columns.length === 0 ? (
          <p className="dw-none">
            No evidence is in force yet. Each file becomes a column here as the
            design and implementation requests receive it.
          </p>
        ) : (
          <>
            {withoutCheck(paper) ? (
              <p className="dw-none">
                No current check covers these attributes yet. Run the check on
                the design and implementation evidence and each file's mark
                appears in its cell.
              </p>
            ) : null}
            <div className="dw-grid-scroll">
              <table className="dw-grid">
                <caption className="sr-only">
                  What each file does for each attribute
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="is-first">
                      Attribute
                    </th>
                    {matrix.columns.map((entry) => (
                      <th scope="col" className="is-file" key={entry.ref}>
                        <span className="dw-grid-ref">{entry.ref}</span>
                        <span
                          className="dw-grid-name"
                          title={[entry.fileName, entry.kindWords]
                            .filter((part) => part !== "")
                            .join(" · ")}
                        >
                          {evidenceTitle(entry)}
                        </span>
                      </th>
                    ))}
                    <th scope="col" className="is-state">
                      Result
                    </th>
                    <th scope="col" className="is-basis">
                      Basis
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.rows.map((row) => (
                    <tr key={row.id}>
                      <th scope="row" className="is-first">
                        <span className="dw-grid-attr">
                          <span className="dw-attr">{row.code}</span>
                          <span>
                            {row.text}
                            {row.basis !== "" ? (
                              <span className="dw-grid-basis">{row.basis}</span>
                            ) : null}
                            {row.stray !== "" ? (
                              <span className="dw-stray">{row.stray}</span>
                            ) : null}
                          </span>
                        </span>
                      </th>
                      {row.cells.map((cell) => {
                        const entry = matrix.columns.find(
                          (item) => item.ref === cell.ref,
                        );
                        return (
                          <td key={cell.ref} className="is-file">
                            {cell.mark === null || entry === undefined ? (
                              <span className="dw-cell is-none">
                                <span aria-hidden="true">·</span>
                                <span className="sr-only">{cell.word}</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                className={`dw-cell is-${cell.tone}`}
                                title={`${cell.ref}: ${evidenceTitle(entry)}`}
                                onClick={() =>
                                  actions.onRef({
                                    ...refChip(cell.ref, paper.evidence),
                                    annotationId: cell.annotationId,
                                  })
                                }
                              >
                                <span className="dw-dot" aria-hidden="true">
                                  {cell.symbol}
                                </span>
                                <span className="dw-cell-word">
                                  {cell.word}
                                </span>
                                <span className="sr-only">
                                  , {cell.ref} for attribute {row.code}
                                </span>
                              </button>
                            )}
                          </td>
                        );
                      })}
                      <td className="is-state">
                        <StatePill {...row.state} />
                      </td>
                      <td className="is-basis">{row.basis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {matrix.key.length > 0 ? (
              <p className="dw-key">
                {matrix.key.map((item) => (
                  <span key={item.mark}>
                    <i className={`dw-dot is-${item.tone}`} aria-hidden="true">
                      {item.symbol}
                    </i>
                    {item.meaning}
                  </span>
                ))}
                <span className="dw-quiet">
                  Select a mark to open the evidence at that passage.
                </span>
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className="card dw-card">
        <header className="dw-card-head">
          <h5>Walkthrough of the instance</h5>
          <EditLink
            section="walkthrough"
            what="the walkthrough"
            actions={actions}
            editable={editable.has("walkthrough")}
          />
        </header>
        <div className="dw-track-scroll">
          <Timeline paper={paper} actions={actions} across />
        </div>
      </section>

      <section className="card dw-card">
        <header className="dw-card-head">
          <h5>Information produced by the entity</h5>
          <EditLink
            section="reports"
            what="the reports relied on"
            actions={actions}
            editable={editable.has("reports")}
          />
        </header>
        {paper.reports.length === 0 ? (
          <p className="dw-none">No report is listed in this workpaper.</p>
        ) : (
          <ul className="dw-list">
            {keyed(paper.reports, (item) => `${item.ref} ${item.report}`).map(
              ({ key, item: report }) => (
                <li key={key}>
                  {report.ref !== "" ? (
                    <Refs refs={[report.ref]} paper={paper} actions={actions} />
                  ) : null}
                  <span>
                    <b>{report.report}</b>
                    {report.source !== "" ? `, ${report.source}` : ""}.{" "}
                    {report.procedure}
                    <Inspected paper={paper} report={report} />
                  </span>
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      <section className="card dw-card">
        <header className="dw-card-head">
          <h5>Evidence</h5>
        </header>
        {paper.evidence.length === 0 ? (
          <p className="dw-none">
            No evidence is in force yet. Files appear here as the design and
            implementation requests receive them.
          </p>
        ) : (
          <ul className="dw-thumbs">
            {paper.evidence.map((entry) => (
              <li key={entry.ref}>
                <button
                  type="button"
                  className="dw-thumb"
                  title={entry.fileName}
                  onClick={() =>
                    actions.onRef(refChip(entry.ref, paper.evidence))
                  }
                >
                  <span className="dw-thumb-pic">
                    {entry.image ? (
                      // biome-ignore lint/performance/noImgElement: evidence bytes are shown as they are, never optimised.
                      <img
                        src={previewUrl(scope, entry.fileId)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <FileBadge name={entry.fileName} />
                    )}
                  </span>
                  <span className="dw-thumb-cap">
                    <span className="dw-ref" aria-hidden="true">
                      {entry.ref}
                    </span>
                    <span className="sr-only">Open {entry.ref}: </span>
                    {evidenceTitle(entry)}
                    {entry.leftOut !== null ? (
                      <small className="dw-left-out">
                        Left out of the check
                      </small>
                    ) : null}
                    {notReliedOnLine(entry) !== "" ? (
                      <small className="dw-not-relied">{NOT_RELIED_ON}</small>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* Evidence: the workpaper with its evidence beside it ----------------------------------- */

function EvidenceSplit({
  paper,
  scope,
  actions,
  selection,
  from,
  pick,
  paneRef,
  revision,
  returnFocus,
  onReview,
}: {
  paper: Paper;
  scope: WorkpaperScope;
  actions: Actions;
  selection: Selection | null;
  /** The statement the reference in view was selected on. */
  from: string;
  pick: { id: string } | null;
  paneRef: RefObject<HTMLDivElement | null>;
  /** Changes when the file's annotations may have: the pane then reads them again. */
  revision: number;
  /** The reference chip an annotation was opened from, to go back to on Escape. */
  returnFocus: () => HTMLElement | null;
  onReview: (entry: EvidenceEntry) => void;
}) {
  const conclusion = conclusionOf(paper);
  const editable = editableSections(paper);
  const entry =
    selection === null
      ? null
      : (paper.evidence.find((item) => item.ref === selection.ref) ?? null);
  const current: Current | undefined =
    entry === null ? undefined : { ref: entry.ref, from };
  const left = paper.canSettle ? unsettled(paper.points) : [];
  const decisions = decisionsWords(left.length);
  const first = left[0] ?? null;
  return (
    <div className="card dw-evi">
      <ViewHead paper={paper} />
      <div className="dw-split">
        <div className="dw-paper">
          <section>
            <header className="dw-card-head">
              <h5>
                {conclusion.signed
                  ? "Signed conclusion"
                  : conclusion.recorded
                    ? "Recorded conclusion"
                    : conclusion.proposed
                      ? "Proposed conclusion"
                      : "Conclusion"}
              </h5>
              <EditLink
                section="conclusion"
                what="the conclusion"
                actions={actions}
                editable={editable.has("conclusion")}
              />
            </header>
            <Verdict
              conclusion={conclusion}
              label="Design and implementation"
            />
            {/* To the preparer only, what is left before they sign, with the way to
                the first at its place (section 3.9); nothing to others. */}
            {decisions !== "" && first !== null && actions.onPoint !== null ? (
              <p className="dw-open">
                <button
                  type="button"
                  className="dw-edit"
                  onClick={() => actions.onPoint?.(first.key)}
                >
                  {decisions}
                  <span className="sr-only">
                    : go to the first in the document
                  </span>
                </button>
              </p>
            ) : null}
            {/* The text and the choice are the document's section 6 (section 3.5):
                the way there, never the text again. */}
            {actions.onConclusion !== null ? (
              <ToConclusion onOpen={actions.onConclusion} />
            ) : null}
            <OutOfDate reasons={conclusion.outOfDate} />
          </section>

          <section>
            <header className="dw-card-head">
              <h5>Attributes tested</h5>
              <EditLink
                section="attributes"
                what="the notes on the attributes"
                actions={actions}
                editable={editable.has("attributes")}
              />
            </header>
            {paper.attributes.length === 0 ? (
              <p className="dw-none">
                No approved attribute yet. They are listed here once the test
                plan is approved.
              </p>
            ) : (
              <ul className="dw-arows">
                {withoutCheck(paper) ? (
                  <li className="dw-none">
                    No current check covers these attributes yet. Run the check
                    on the design and implementation evidence and each one's
                    basis and references appear here.
                  </li>
                ) : null}
                {paper.attributes.map((attribute) => (
                  <li
                    key={attribute.id}
                    className={`dw-arow${from === `attribute-${attribute.id}` ? " is-on" : ""}`}
                  >
                    <span className="dw-attr">{attribute.code}</span>
                    <div>
                      <p className="dw-arow-text">{attribute.text}</p>
                      {attribute.basis !== "" ? (
                        <p className="dw-arow-basis">{attribute.basis}</p>
                      ) : null}
                      {strayLine(attribute) !== "" ? (
                        <p className="dw-stray">{strayLine(attribute)}</p>
                      ) : null}
                      {attribute.checks.length > 0 ? (
                        <ul className="dw-checks">
                          {keyed(attribute.checks, (item) => item).map(
                            ({ key, item }) => (
                              <li key={key}>{item}</li>
                            ),
                          )}
                        </ul>
                      ) : null}
                      <Refs
                        refs={attribute.refs}
                        paper={paper}
                        actions={actions}
                        current={current ?? { ref: "", from: "" }}
                        from={`attribute-${attribute.id}`}
                      />
                    </div>
                    <StatePill {...stateOf(attribute)} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <header className="dw-card-head">
              <h5>Walkthrough</h5>
              <EditLink
                section="walkthrough"
                what="the walkthrough"
                actions={actions}
                editable={editable.has("walkthrough")}
              />
            </header>
            <Timeline
              paper={paper}
              actions={actions}
              current={current ?? { ref: "", from: "" }}
            />
          </section>
        </div>

        <section className="dw-viewer" ref={paneRef} aria-label="Evidence">
          {entry === null ? (
            <p className="dw-none">
              No evidence is in force yet. A file selected on the left is shown
              here once the design and implementation requests receive one.
            </p>
          ) : (
            <>
              <ul className="dw-files" aria-label="Evidence files">
                {paper.evidence.map((item) => (
                  <li key={item.ref}>
                    <button
                      type="button"
                      className={`dw-file${item.ref === entry.ref ? " is-on" : ""}`}
                      aria-pressed={item.ref === entry.ref}
                      title={[item.fileName, item.kindWords]
                        .filter((part) => part !== "")
                        .join(" · ")}
                      onClick={() =>
                        actions.onRef(refChip(item.ref, paper.evidence))
                      }
                    >
                      <b>{item.ref}</b>
                      <span>{evidenceTitle(item)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="dw-viewer-head">
                <p>
                  <b>
                    {entry.ref} · {entry.fileName}
                  </b>
                  <small>{evidenceLine(entry)}</small>
                </p>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => onReview(entry)}
                >
                  {entry.annotations > 0 ? "Open to review" : "Open the file"}
                </button>
              </div>
              {entry.leftOut !== null ? (
                <p className="dw-left-out is-line">
                  Left out of the check: {entry.leftOut}
                </p>
              ) : null}
              {notReliedOnLine(entry) !== "" ? (
                <p className="dw-not-relied is-line">
                  {notReliedOnLine(entry)}
                </p>
              ) : null}
              <EvidencePane
                key={`${entry.fileId}:${revision}`}
                returnFocus={returnFocus}
                scope={scope}
                entry={entry}
                pick={pick}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/** Nothing is reviewed from the pane: it shows. A review is made in the preview. */
const READ_ONLY = async () =>
  ({
    ok: false,
    problem:
      "Annotations are reviewed in the preview. Open the file to review it.",
  }) as const;

/**
 * The selected file with its annotations, through the preview's own viewer: the same
 * boxes, legend and basis, read only. Only this file is read, and only once the evidence
 * view is shown.
 */
function EvidencePane({
  scope,
  entry,
  pick,
  returnFocus,
}: {
  scope: WorkpaperScope;
  entry: EvidenceEntry;
  pick: { id: string } | null;
  returnFocus: () => HTMLElement | null;
}) {
  const { organizationId, projectId, controlId } = scope;
  const { fileId, fileName, requirementId } = entry;
  const where = useMemo(
    () =>
      requirementId === null
        ? null
        : { organizationId, projectId, controlId, requirementId, fileId },
    [organizationId, projectId, controlId, requirementId, fileId],
  );
  const notes = useEvidenceAnnotations(where);
  const file = useMemo(() => ({ id: fileId, fileName }), [fileId, fileName]);
  const shown = useMemo(
    () =>
      notes.set === null || notes.set.annotations.length === 0
        ? null
        : { ...notes.set, canEdit: false },
    [notes.set],
  );
  if (notes.status === "loading") {
    return (
      <div className="dw-pane is-loading">
        <div className="dw-pane-wait" aria-hidden="true" />
        <AnnotationsLoading />
      </div>
    );
  }
  return (
    <div className="dw-pane">
      <AnnotatedEvidence
        file={file}
        query={fileQuery(organizationId, projectId)}
        set={shown}
        busy={null}
        act={READ_ONLY}
        headSlot={null}
        pick={pick}
        inline
        returnFocus={returnFocus}
      />
      {shown === null ? (
        <p className="dw-pane-note">
          {notes.status === "failed"
            ? "The annotations could not be loaded. The file is shown without them."
            : "No annotations on this file yet. They appear once the check has read it."}
        </p>
      ) : null}
    </div>
  );
}
