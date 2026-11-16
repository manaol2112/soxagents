"use client";

import { useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  type ReactNode,
  startTransition,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { keyed } from "./design-workpaper-model";
import { RichTextBox } from "./rich-editor";
import {
  addRow,
  changed,
  cleanCell,
  type Draft,
  draftProblem,
  EDIT_LIMITS,
  type GridEditor,
  type NoteItem,
  removeRow,
  SAVING,
  type SectionEditor,
  setCell,
  UNSAVED,
} from "./section-edit-model";
import { UiIcon } from "./ui-icon";
import {
  DISCARD_COPY,
  type Keeping,
  keepingWords,
  STALE_COPY,
  USE_COPY,
} from "./working-copy-model";

/**
 * A section of the D&I workpaper edited where it is (docs/design-workpaper.md, section
 * 3.2): the text editor (its box is the formatted one, rich-editor.tsx, section 3.3), the
 * grid editor, the box of an attribute's note, and the bar they share. What an editor
 * starts from, what may be saved and what a save sends are the model's
 * (section-edit-model.ts); the server decides whether a save is taken. Nothing here says
 * "saved": the view does, once the server confirmed and the workpaper was read again.
 */

/** Where an open editor stands: typed in, sent and waiting for the server, or confirmed and
 * waiting for the views to read the workpaper again. */
export type EditPhase = "editing" | "saving" | "refreshing";

/** What an editor shows, and what a person may do in it. */
export type EditorProps = {
  editor: SectionEditor;
  draft: Draft;
  phase: EditPhase;
  /** Why the last save was not taken, in one sentence; "" where none was refused. */
  refusal: string;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  /** "Cancel", and Escape from inside the editor. */
  onCancel: () => void;
  /** Where the working copy of what is typed stands (section 3.4). */
  keeping: Keeping;
  /** The editor opened with a working copy: what it says, until it closes or the copy is
   * discarded; null otherwise. */
  restored: Restored | null;
};

/** Over an editor that opened with the person's working copy (section 3.4). */
export type Restored = {
  /** "Your changes from 14 Nov, 10:42 AM are restored." */
  words: string;
  /** The workpaper has another version than the one the copy was started from. */
  stale: boolean;
  /** "Discard them": back to what is stored (or, for a copy found after the editor opened,
   * that copy is discarded and what is typed stays). */
  onDiscard: () => void;
  /** "Use them": a copy found after the editor opened is offered, never put in place of
   * what the editor holds until the person chooses (independent review, 15 November
   * 2026). Absent for the copy the editor opened with. */
  onUse?: () => void;
};

/** The one request a save sends, through the page's own route, which never redirects. An
 * answer that cannot be read, or none, is status 0: nothing is taken as saved. */
export async function sendSection(
  body: Record<string, unknown>,
): Promise<{ status: number; detail: string }> {
  try {
    const response = await fetch("/workspace/workpapers/section", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const answer = (await response.json()) as {
      status?: unknown;
      detail?: unknown;
    };
    return {
      status: typeof answer.status === "number" ? answer.status : 0,
      detail: typeof answer.detail === "string" ? answer.detail : "",
    };
  } catch {
    return { status: 0, detail: "" };
  }
}

/** Reads the page's records again in the background, so the workpaper card and its version
 * are current after a save. No page is loaded again and the address does not change. The
 * transition is React's own, not a component's, so it may be asked for after the view that
 * saved has gone. */
export function useRecordsRefresh(): () => void {
  const router = useRouter();
  return useCallback(() => startTransition(() => router.refresh()), [router]);
}

/* A box that is as tall as what is in it ------------------------------------------------- */

/** The box's height from its content: its scroll height and its own borders. */
function fit(area: HTMLTextAreaElement) {
  area.style.height = "auto";
  area.style.height = `${area.scrollHeight + area.offsetHeight - area.clientHeight}px`;
}

function AutoArea({
  value,
  label,
  className,
  readOnly,
  describedBy,
  cell,
  onChange,
}: {
  value: string;
  /** The box's accessible name. */
  label: string;
  className: string;
  readOnly: boolean;
  describedBy?: string | undefined;
  /** A grid cell's place ("row:column"), so the grid can put the focus on it. */
  cell?: string | undefined;
  onChange: (value: string) => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the height follows the value.
  useLayoutEffect(() => {
    if (box.current !== null) {
      fit(box.current);
    }
  }, [value]);
  // The same words wrap differently in a narrower box: it is measured again when its
  // width changes, on the next frame so the measuring is not itself a resize in the loop.
  useEffect(() => {
    const area = box.current;
    if (area === null || typeof ResizeObserver === "undefined") {
      return;
    }
    let width = area.offsetWidth;
    let frame = 0;
    const watch = new ResizeObserver(() => {
      if (area.offsetWidth === width) {
        return;
      }
      width = area.offsetWidth;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => fit(area));
    });
    watch.observe(area);
    return () => {
      window.cancelAnimationFrame(frame);
      watch.disconnect();
    };
  }, []);
  return (
    <textarea
      ref={box}
      className={className}
      rows={1}
      value={value}
      aria-label={label}
      aria-describedby={describedBy}
      readOnly={readOnly}
      autoComplete="off"
      data-cell={cell}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

/* The bar: where the draft stands, Cancel and Save --------------------------------------- */

function EditorBar({
  editor,
  draft,
  phase,
  refusal,
  keeping,
  onSave,
  onCancel,
}: Omit<EditorProps, "onChange" | "restored">) {
  const uid = useId();
  const busy = phase !== "editing";
  const dirty = changed(editor, draft);
  const problem = draftProblem(editor, draft);
  // The working copy's line: never "saved", it is not the workpaper.
  const kept = keepingWords(keeping);
  return (
    <div className="se-bar">
      <div className="se-status">
        <p role="status" id={`${uid}-state`}>
          {busy ? (
            SAVING
          ) : (
            <>
              {dirty ? (
                <span className="se-unsaved">
                  <span className="se-dot" aria-hidden="true" />
                  {UNSAVED}
                </span>
              ) : null}
              {kept !== "" ? (
                <span
                  className={
                    keeping.state === "failed" || keeping.state === "off"
                      ? "se-keeping is-failed"
                      : "se-keeping"
                  }
                >
                  {kept}
                </span>
              ) : null}
              {problem !== "" ? (
                <span className="se-problem">{problem}</span>
              ) : null}
            </>
          )}
        </p>
        {refusal !== "" && !busy ? (
          <p className="se-refusal" role="alert">
            {refusal}
          </p>
        ) : null}
      </div>
      <div className="se-actions">
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn-sm"
          disabled={busy || !dirty || problem !== ""}
          aria-describedby={`${uid}-state`}
          onClick={onSave}
        >
          Save
        </button>
      </div>
    </div>
  );
}

/** Over the box of an editor that opened with a working copy: when it is from, that the
 * section may have changed since, and "Discard them". */
function RestoredNote({
  restored,
  busy,
}: {
  restored: Restored | null;
  busy: boolean;
}) {
  if (restored === null) {
    return null;
  }
  return (
    <div className="se-restored">
      <p>
        {restored.words}
        {restored.stale ? (
          <span className="se-restored-stale"> {STALE_COPY}</span>
        ) : null}
      </p>
      {restored.onUse !== undefined ? (
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={busy}
          onClick={restored.onUse}
        >
          {USE_COPY}
        </button>
      ) : null}
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={busy}
        onClick={restored.onDiscard}
      >
        {DISCARD_COPY}
      </button>
    </div>
  );
}

/** The editor's own frame. Escape inside it is "Cancel", and closes nothing else. */
function Frame({
  title,
  phase,
  onCancel,
  children,
}: {
  title: string;
  phase: EditPhase;
  onCancel: () => void;
  children: ReactNode;
}) {
  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  };
  return (
    <section
      className="se-frame"
      aria-label={`Editing: ${title}`}
      aria-busy={phase !== "editing"}
      data-section-editor=""
      onKeyDown={onKey}
    >
      {children}
    </section>
  );
}

/* The grid: the stored section's own columns and rows ------------------------------------ */

function GridBox({
  editor,
  rows,
  busy,
  onChange,
}: {
  editor: GridEditor;
  rows: string[][];
  busy: boolean;
  onChange: (draft: Draft) => void;
}) {
  const heads = keyed(editor.columns, (column) => column);
  // A row keeps its key while rows above it are removed, so a box keeps what is typed.
  const [ids, setIds] = useState(() => rows.map((_, at) => at));
  const next = useRef(rows.length);
  const keys = ids.length === rows.length ? ids : rows.map((_, at) => at);
  const grid = useRef<HTMLDivElement>(null);
  // Where the focus goes once a row is added or removed: never left on a button that went.
  const wanted = useRef<string | null>(null);
  useEffect(() => {
    const selector = wanted.current;
    if (selector === null) {
      return;
    }
    wanted.current = null;
    grid.current?.querySelector<HTMLElement>(selector)?.focus();
  });
  const full = rows.length >= EDIT_LIMITS.rows;
  const add = () => {
    wanted.current = `[data-cell="${rows.length}:0"]`;
    setIds([...keys, next.current]);
    next.current += 1;
    onChange({ kind: "grid", rows: addRow(rows, editor.columns.length) });
  };
  const remove = (at: number) => {
    wanted.current =
      rows.length > 1
        ? `[data-remove="${Math.min(at, rows.length - 2)}"]`
        : "[data-add]";
    setIds(keys.filter((_, index) => index !== at));
    onChange({ kind: "grid", rows: removeRow(rows, at) });
  };
  return (
    <div ref={grid}>
      <div className="se-grid-wrap">
        <table className="dw-table se-grid">
          <thead>
            <tr>
              <th scope="col" className="is-num">
                #
              </th>
              {heads.map(({ key, item: column }) => (
                <th scope="col" key={key}>
                  {column}
                </th>
              ))}
              <th scope="col" className="se-col-x">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="dw-quiet" colSpan={editor.columns.length + 2}>
                  No {editor.rowWord} yet.
                </td>
              </tr>
            ) : (
              rows.map((cells, at) => (
                <tr key={keys[at]}>
                  <td className="is-num">{at + 1}</td>
                  {heads.map(({ key, item: column }, index) => (
                    <td key={key}>
                      <AutoArea
                        className="se-cell"
                        label={`${column}, ${editor.rowWord} ${at + 1}`}
                        value={cells[index] ?? ""}
                        readOnly={busy}
                        cell={`${at}:${index}`}
                        onChange={(value) =>
                          onChange({
                            kind: "grid",
                            rows: setCell(rows, at, index, value),
                          })
                        }
                      />
                    </td>
                  ))}
                  <td className="se-col-x">
                    <button
                      type="button"
                      className="se-x"
                      aria-label={`Remove ${editor.rowWord} ${at + 1}`}
                      title={`Remove ${editor.rowWord} ${at + 1}`}
                      data-remove={at}
                      disabled={busy}
                      onClick={() => remove(at)}
                    >
                      <UiIcon name="x" size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="se-grid-foot">
        <button
          type="button"
          className="btn-secondary btn-sm"
          data-add=""
          disabled={busy || full}
          title={full ? `The most is ${EDIT_LIMITS.rows} rows.` : undefined}
          onClick={add}
        >
          <UiIcon name="plus" size={13} /> {editor.addLabel}
        </button>
        <p className="dw-quiet">{editor.note}</p>
      </div>
    </div>
  );
}

/* The editors ---------------------------------------------------------------------------- */

/**
 * A section's text, or its rows, edited where the section is shown: one box that grows
 * with the text and shows its formatting, or one plain box per cell under the stored
 * section's own columns.
 */
export function SectionEditorPanel({
  heading,
  ...props
}: EditorProps & {
  /** The words over the box, where the section's own heading is not right above it. */
  heading?: string | undefined;
}) {
  const uid = useId();
  const { editor, draft, phase, restored, onChange, onCancel } = props;
  const busy = phase !== "editing";
  const hint = editor.guidance !== "" ? `${uid}-hint` : undefined;
  return (
    <Frame title={editor.title} phase={phase} onCancel={onCancel}>
      {heading !== undefined ? <h6 className="se-heading">{heading}</h6> : null}
      {hint !== undefined ? (
        <p className="se-hint dw-quiet" id={hint}>
          {editor.guidance}
        </p>
      ) : null}
      <RestoredNote restored={restored} busy={busy} />
      {editor.kind === "text" && draft.kind === "text" ? (
        <RichTextBox
          label={editor.title}
          value={draft.text}
          readOnly={busy}
          describedBy={hint}
          onChange={(text) => onChange({ kind: "text", text })}
        />
      ) : editor.kind === "grid" && draft.kind === "grid" ? (
        <GridBox
          editor={editor}
          rows={draft.rows}
          busy={busy}
          onChange={onChange}
        />
      ) : null}
      <EditorBar {...props} />
    </Frame>
  );
}

/**
 * The notes on the attributes: the attributes' own table stays as it is inside the frame
 * (each row holding its NoteBox), with the bar under it.
 */
export function NotesEditorPanel({
  children,
  ...props
}: EditorProps & { children: ReactNode }) {
  const { editor, phase, restored, onCancel } = props;
  return (
    <Frame title={editor.title} phase={phase} onCancel={onCancel}>
      {editor.guidance !== "" ? (
        <p className="se-hint dw-quiet">{editor.guidance}</p>
      ) : null}
      <RestoredNote restored={restored} busy={phase !== "editing"} />
      {children}
      <EditorBar {...props} />
    </Frame>
  );
}

/** One attribute's preparer's note, in its row: one line that grows with what is typed. */
export function NoteBox({
  item,
  notes,
  phase,
  onChange,
}: {
  item: NoteItem;
  /** The notes as typed so far, by attribute. */
  notes: Readonly<Record<string, string>>;
  phase: EditPhase;
  onChange: (draft: Draft) => void;
}) {
  return (
    <div className="se-note">
      <span aria-hidden="true">Preparer's note</span>
      <AutoArea
        className="se-cell"
        label={`Preparer's note, attribute ${item.code}`}
        value={notes[item.id] ?? item.note}
        readOnly={phase !== "editing"}
        onChange={(value) =>
          onChange({
            kind: "notes",
            notes: { ...notes, [item.id]: cleanCell(value) },
          })
        }
      />
    </div>
  );
}
