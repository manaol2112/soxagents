"use client";

import {
  type ComponentProps,
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

import {
  type ConclusionView,
  conclusionOf,
  designWorkpaperQuery,
  type EditableSection,
  type EvidenceEntry,
  editableSections,
  evidenceLine,
  evidenceTitle,
  foldStartsOpen,
  headerOf,
  keyed,
  loadProblem,
  matrixOf,
  matterWords,
  NOT_RELIED_ON,
  notReliedOnLine,
  openMatters,
  type DesignWorkpaper as Paper,
  PROPOSED_BY_AGENT,
  paragraphs,
  parseDesignWorkpaper,
  previewUrl,
  type RefChip,
  type Reference,
  recordKey,
  refChip,
  refChips,
  rememberedView,
  rememberView,
  reportInspected,
  type Selection,
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
import { type IconName, UiIcon } from "./ui-icon";
import { WorkpapersTab } from "./workpaper-view";

/**
 * The D&I workpaper in three views (docs/design-workpaper.md): the formal document, the
 * test matrix, and the workpaper with its evidence beside it. One record and one read of
 * it; a person switches between the views on the page, and the browser remembers which.
 *
 * Nothing here is a decision. A view shows what the server assembled; the conclusion reads
 * as proposed until the server says a reviewer signed it; and editing, drafting, preparing,
 * reopening and the versions stay the existing workpaper card's, in the fold under the
 * views.
 */

const VIEW_ICONS: Record<ViewKey, IconName> = {
  document: "file",
  matrix: "grid",
  evidence: "panel",
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
  /** "Edit" on a section a preparer may edit: opens the fold at that section. */
  onEdit: ((section: EditableSection) => void) | null;
  /** The count of open matters under a verdict: goes to the document's section 6. */
  onMatters: (() => void) | null;
};

/* The mount: the views, and the existing card in a fold under them ---------------------- */

type CardProps = Omit<
  ComponentProps<typeof WorkpapersTab>,
  "stage" | "compact"
>;

/**
 * Where the D&I workpaper is shown (docs/design-workpaper.md, section 3.1): the three
 * views first, and under them one fold holding today's workpaper card unchanged, with the
 * section editor, Draft again, Prepare, Reopen, the versions and the Excel export. It
 * takes the card's own props.
 */
export function DesignWorkpaperStep(props: CardProps) {
  const { ids, papers, notice, viewing } = props;
  const starts = foldStartsOpen({ papers, notice, viewing });
  const [open, setOpen] = useState(starts);
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
        onEdit={reveal}
        onDraft={() => reveal(null)}
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
              The section editor, drafting, Prepare, Reopen, the version history
              and the Excel export
            </small>
          </span>
        </summary>
        <div className="dw-fold-body">
          <WorkpapersTab compact {...props} stage="DESIGN" />
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

export function DesignWorkpaper({
  scope,
  recordKey: record = "",
  onEdit,
  onDraft,
}: {
  scope: WorkpaperScope;
  /** Changes when the workpaper record does: the views then read again. */
  recordKey?: string;
  onEdit?: (section: EditableSection) => void;
  /** Shows where the existing "Draft" action is, for a control with no workpaper yet. */
  onDraft?: () => void;
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
  const [opened, setOpened] = useState<Opened | null>(null);
  const [selection, setSelection] = useState<
    (Selection & { from: string }) | null
  >(null);
  const [printing, setPrinting] = useState(false);
  // "N matters open": the document's section 6 is where they are read.
  const [seeking, setSeeking] = useState(false);
  const tabs = useRef(new Map<ViewKey, HTMLButtonElement>());
  const pane = useRef<HTMLDivElement>(null);
  // The reference chip that last showed a file in the pane: Escape from its annotation
  // goes back to it.
  const opener = useRef<HTMLElement | null>(null);
  // "Try again" was pressed: when the banner it is in goes, the focus is not left
  // nowhere.
  const retried = useRef(false);

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
      setState((before) =>
        paper !== null
          ? { paper, problem: null, loading: false }
          : {
              // What was on screen stays there; the sentence says the read failed.
              paper: before.paper,
              problem:
                loadProblem(status) ??
                "The workpaper views could not be read. Nothing was changed: try again.",
              loading: false,
            },
      );
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

  // The document's section 6, once the document is the view shown.
  useEffect(() => {
    if (!seeking || view !== "document") {
      return;
    }
    setSeeking(false);
    const heading = document
      .getElementById(`${uid}-matters`)
      ?.querySelector<HTMLElement>("h5");
    heading?.scrollIntoView({
      block: "start",
      behavior: calm() ? "auto" : "smooth",
    });
    heading?.focus({ preventScroll: true });
  }, [seeking, view, uid]);

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
  const editable = useMemo(
    () =>
      paper === null ? new Set<EditableSection>() : editableSections(paper),
    [paper],
  );
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
            if (editable.has(section)) {
              onEdit(section);
            }
          },
    onMatters: () => {
      choose("document");
      setSeeking(true);
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
            you to edit and prepare.
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
      <DocumentSheet
        paper={paper}
        actions={actions}
        mattersId={`${uid}-matters`}
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
    <section className="dw" aria-label="Design and implementation workpaper">
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
                </button>
              );
            })}
          </div>
          <p className="dw-bar-note" aria-live="polite">
            {state.loading && paper !== null
              ? "Reading the workpaper again"
              : ""}
          </p>
          {view === "document" && paper !== null ? (
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
          files={[{ id: opened.entry.fileId, fileName: opened.entry.fileName }]}
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
      {printing && !stale && paper !== null && paper.workpaper !== null
        ? createPortal(
            <div className="dw-print-root">
              <DocumentSheet paper={paper} actions={null} />
            </div>,
            document.body,
          )
        : null}
    </section>
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

/** "Edit" on a section a preparer may edit: it opens the existing editor in the fold. */
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
  return (
    <button type="button" className="dw-edit" onClick={() => onEdit(section)}>
      Edit<span className="sr-only"> {what}</span>
    </button>
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

/* Document: the classic workpaper ------------------------------------------------------- */

function Section({
  number,
  title,
  edit,
  anchor,
  children,
}: {
  number?: number;
  title: string;
  edit?: ReactNode;
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
        {edit}
      </header>
      {children}
    </section>
  );
}

function DocumentSheet({
  paper,
  actions,
  mattersId,
}: {
  paper: Paper;
  /** Null on the printed sheet: references are text, and nothing is offered. */
  actions: Actions | null;
  /** The id of section 6 on the page (not on the printed copy, which is a second one). */
  mattersId?: string;
}) {
  const head = headerOf(paper);
  const editable = editableSections(paper);
  const conclusion = conclusionOf(paper);
  const dated = walkthroughIsDated(paper.walkthrough);
  const columns = walkthroughHeaders(paper.walkthrough.columns);
  const legend = tickmarkLegend(paper);
  const understanding = paragraphs(paper.understanding);
  const { workpaper } = paper;
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

      <Section
        number={1}
        title="Objective, risk and control"
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
        <div className="dw-two">
          <div>
            <h6>Risk addressed</h6>
            <p>{paper.risk || "Not stated on the control."}</p>
          </div>
          <div>
            <h6>Control activity</h6>
            <p>{paper.activity || "Not stated on the control."}</p>
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
        {understanding.length > 0 ? (
          <div className="dw-prose">
            <h6>Understanding of the control</h6>
            {keyed(understanding, (part) => part).map(({ key, item }) => (
              <p key={key}>{item}</p>
            ))}
          </div>
        ) : null}
      </Section>

      <Section number={2} title="Procedures performed">
        {paper.procedures.length === 0 ? (
          <p className="dw-none">
            No procedure is on record yet. They are listed here as the evidence
            is inspected.
          </p>
        ) : (
          <ol className="dw-proc">
            {keyed(paper.procedures, (item) => item).map(({ key, item }) => (
              <li key={key}>{item}</li>
            ))}
          </ol>
        )}
      </Section>

      <Section
        number={3}
        title="Walkthrough of one instance"
        edit={
          <EditLink
            section="walkthrough"
            what="the walkthrough"
            actions={actions}
            editable={editable.has("walkthrough")}
          />
        }
      >
        {paper.walkthrough.steps.length === 0 ? (
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
                    {dated ? <td className="is-when">{step.when}</td> : null}
                    <td>{step.step}</td>
                    <td>{step.who}</td>
                    <td>{step.evidence}</td>
                    <td>{step.result}</td>
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
        number={4}
        title="Attributes tested"
        edit={
          <EditLink
            section="attributes"
            what="the notes on the attributes"
            actions={actions}
            editable={editable.has("attributes")}
          />
        }
      >
        {paper.attributes.length === 0 ? (
          <p className="dw-none">
            No approved attribute yet. They are listed here once the test plan
            is approved.
          </p>
        ) : (
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
                  return (
                    <tr key={attribute.id}>
                      <th scope="row" className="is-attr">
                        <b>{attribute.code}. </b>
                        {attribute.text}
                      </th>
                      <td>
                        {attribute.basis || (
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
                        {attribute.notes !== "" ? (
                          <p className="dw-note">
                            <b>Preparer's note.</b> {attribute.notes}
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
                        <StatePill {...stateOf(attribute)} />
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        number={5}
        title="Information produced by the entity"
        edit={
          <EditLink
            section="reports"
            what="the reports relied on"
            actions={actions}
            editable={editable.has("reports")}
          />
        }
      >
        {paper.reports.length === 0 ? (
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
                ).map(({ key, item: report }) => (
                  <tr key={key}>
                    <th scope="row" className="is-attr">
                      {report.ref !== "" ? (
                        <Refs
                          refs={[report.ref]}
                          paper={paper}
                          actions={actions}
                        />
                      ) : null}{" "}
                      {report.report}
                    </th>
                    <td>{report.source || "Not stated"}</td>
                    <td>
                      {report.procedure ||
                        (reportInspected(paper, report) === null ? (
                          <span className="dw-quiet">
                            No procedure on record yet.
                          </span>
                        ) : null)}
                      <Inspected paper={paper} report={report} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section number={6} title="Matters for the reviewer" anchor={mattersId}>
        {paper.matters.length === 0 ? (
          <p className="dw-none">Nothing for the reviewer on record.</p>
        ) : (
          <div className="dw-table-wrap">
            <table className="dw-table is-matters">
              <thead className="sr-only">
                <tr>
                  <th scope="col">State</th>
                  <th scope="col">Matter</th>
                  <th scope="col">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {keyed(
                  paper.matters,
                  (item) => `${item.kind} ${item.text}`,
                ).map(({ key, item: matter }) => {
                  const words = matterWords(matter);
                  return (
                    <tr key={key}>
                      <td className="is-state">
                        <StatePill words={words.state} tone={words.tone} />
                      </td>
                      <td>
                        {words.kind !== "" ? <b>{words.kind}. </b> : null}
                        {matter.text}
                      </td>
                      <td className="is-refs">
                        <Refs
                          refs={matter.refs}
                          paper={paper}
                          actions={actions}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        number={7}
        title="Conclusion"
        edit={
          <EditLink
            section="conclusion"
            what="the conclusion"
            actions={actions}
            editable={editable.has("conclusion")}
          />
        }
      >
        <div className="dw-concl">
          <Verdict conclusion={conclusion} label="Design and implementation" />
          <div className="dw-concl-text">
            {conclusion.text === "" ? (
              <p className="dw-quiet">
                No conclusion is written yet. The agent drafts it with the
                workpaper; the verdict is proposed once the workpaper is
                prepared, and a reviewer signs it.
              </p>
            ) : (
              keyed(paragraphs(conclusion.text), (part) => part).map(
                ({ key, item }) => <p key={key}>{item}</p>,
              )
            )}
            <OutOfDate reasons={conclusion.outOfDate} />
          </div>
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
          <ul aria-label="Evidence index">
            {paper.evidence.length === 0 ? (
              <li className="dw-quiet">
                No evidence is in force yet. Files are listed here as the design
                and implementation requests receive them.
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
                  </span>
                </li>
              ))
            )}
          </ul>
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

      <div className="dw-halves">
        <section className="card dw-card">
          <header className="dw-card-head">
            <h5>Matters for the reviewer</h5>
          </header>
          {paper.matters.length === 0 ? (
            <p className="dw-none">Nothing for the reviewer on record.</p>
          ) : (
            <ul className="dw-list">
              {keyed(paper.matters, (item) => `${item.kind} ${item.text}`).map(
                ({ key, item: matter }) => {
                  const words = matterWords(matter);
                  return (
                    <li key={key}>
                      <StatePill words={words.state} tone={words.tone} />
                      <span>
                        {words.kind !== "" ? <b>{words.kind}. </b> : null}
                        {matter.text}{" "}
                        <Refs
                          refs={matter.refs}
                          paper={paper}
                          actions={actions}
                        />
                      </span>
                    </li>
                  );
                },
              )}
            </ul>
          )}
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
                      <Refs
                        refs={[report.ref]}
                        paper={paper}
                        actions={actions}
                      />
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
      </div>

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
  const matters = openMatters(paper);
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
            {/* A verdict is never read without what still waits on a person. */}
            <p className="dw-open">
              {matters.count === 0 || actions.onMatters === null ? (
                matters.words
              ) : (
                <button
                  type="button"
                  className="dw-edit"
                  onClick={actions.onMatters}
                >
                  {matters.words}
                  <span className="sr-only">: read them in the document</span>
                </button>
              )}
            </p>
            {conclusion.text !== "" ? (
              <details className="dw-more">
                <summary>Read the conclusion</summary>
                {keyed(paragraphs(conclusion.text), (part) => part).map(
                  ({ key, item }) => (
                    <p key={key}>{item}</p>
                  ),
                )}
              </details>
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
