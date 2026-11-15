// Editing a section of the D&I workpaper where it is (docs/design-workpaper.md, section
// 3.2). Pure: what an editor starts from (the workpaper's own stored section, never the
// assembled view), the draft a person types, its limits, what a save sends, and the write
// the route validates. The server decides who may edit and what it takes; nothing here is
// a decision.

import {
  type DesignWorkpaper,
  type EditableSection,
  sectionKeyFor,
} from "./design-workpaper-model.ts";
import {
  CREDENTIAL,
  type Workpaper,
  type WorkpaperSection,
} from "./workpaper-model.ts";

/** The server's own limits (workpaper_service.EditBody, workpaper_fill.Section). */
export const EDIT_LIMITS = {
  text: 12_000,
  rows: 300,
  cell: 1_000,
  columns: 20,
} as const;

/** The stored workpaper an edit is based on. */
export type EditSource = {
  workpaperId: string;
  /** The version the editor shows: a save is refused if it is no longer the latest. */
  basedOn: number;
  sections: readonly WorkpaperSection[];
};

/** One attribute's note, as the notes editor shows it. */
export type NoteItem = {
  /** The attribute's id in the view. */
  id: string;
  code: string;
  text: string;
  /** The attribute's row in the stored section; null where it has none yet. */
  row: number | null;
  note: string;
};

type Common = {
  section: EditableSection;
  /** The stored section's key: where the save goes. */
  key: string;
  title: string;
  /** The template's own guidance for the section; "" where it has none. */
  guidance: string;
};

export type TextEditor = Common & { kind: "text"; text: string };
export type GridEditor = Common & {
  kind: "grid";
  columns: string[];
  rows: string[][];
  /** "Add a step". */
  addLabel: string;
  /** "step": "Remove step 2". */
  rowWord: string;
  /** What of the Document's table is not edited here, in one sentence. */
  note: string;
};
export type NotesEditor = Common & {
  kind: "notes";
  columns: string[];
  rows: string[][];
  /** The "Notes" column of the stored section. */
  noteAt: number;
  items: NoteItem[];
};
export type SectionEditor = TextEditor | GridEditor | NotesEditor;

export type Draft =
  | { kind: "text"; text: string }
  | { kind: "grid"; rows: string[][] }
  | { kind: "notes"; notes: Record<string, string> };

const flat = (value: string) =>
  value.split(/\s+/).filter(Boolean).join(" ").toLowerCase();

/**
 * The stored workpaper the views' "Edit" may open in place: the D&I workpaper of the
 * page's records, only while it is the one the views show (same id and latest version),
 * a draft, not being drafted, and shown at its latest version. null otherwise: "Edit"
 * then opens the fold, whose editor applies the server's rule itself.
 */
export function editSource(
  papers: ReadonlyArray<
    Pick<
      Workpaper,
      | "id"
      | "stage"
      | "status"
      | "drafting"
      | "currentVersion"
      | "shownVersion"
      | "sections"
    >
  > | null,
  paper: Pick<DesignWorkpaper, "workpaper"> | null,
): EditSource | null {
  const shown = paper?.workpaper ?? null;
  if (shown === null) {
    return null;
  }
  const stored = (papers ?? []).find(
    (item) => item.stage === "DESIGN" && item.id === shown.id,
  );
  if (
    stored === undefined ||
    stored.status !== "DRAFT" ||
    stored.drafting ||
    stored.currentVersion < 1 ||
    stored.currentVersion !== shown.currentVersion ||
    stored.shownVersion !== stored.currentVersion
  ) {
    return null;
  }
  return {
    workpaperId: stored.id,
    basedOn: stored.currentVersion,
    sections: stored.sections,
  };
}

/**
 * The page's records hold an earlier version of the workpaper than the views show: a
 * save's reading of the records has not landed yet. "Edit" is off for that moment, in
 * place and in the fold alike: the fold's editor would open on the text before the save.
 */
export function recordsBehind(
  papers: ReadonlyArray<
    Pick<Workpaper, "id" | "stage" | "currentVersion">
  > | null,
  paper: Pick<DesignWorkpaper, "workpaper"> | null,
): boolean {
  const shown = paper?.workpaper ?? null;
  if (shown === null) {
    return false;
  }
  const stored = (papers ?? []).find(
    (item) => item.stage === "DESIGN" && item.id === shown.id,
  );
  return stored !== undefined && stored.currentVersion < shown.currentVersion;
}

const GRID_WORDS: Partial<
  Record<EditableSection, { addLabel: string; rowWord: string; note: string }>
> = {
  walkthrough: {
    addLabel: "Add a step",
    rowWord: "step",
    note: "A step's time and its evidence references are read from what its cells say.",
  },
  reports: {
    addLabel: "Add a report",
    rowWord: "report",
    note: "A report's evidence reference is read from the file name its cells state.",
  },
};

const widened = (row: readonly string[], width: number) =>
  [...row, ...Array<string>(width).fill("")].slice(0, width);

/** The row of the stored attribute section that is an attribute's, found as the server
 * finds it (design_workpaper.attribute_notes): by the attribute's wording, after a letter
 * or alone; a cell that is a letter alone is taken by its letter. null where none is. */
export function attributeRow(
  rows: ReadonlyArray<readonly string[]>,
  code: string,
  text: string,
): number | null {
  const letter = flat(code);
  const wording = flat(text);
  if (wording === "") {
    return null;
  }
  const at = rows.findIndex((row) => {
    const first = flat(row[0] ?? "");
    const lettered = /^([a-z]{1,2})[.)]\s*(.*)$/.exec(first);
    const given =
      lettered !== null ? lettered[1] : first === letter ? first : "";
    const rest =
      lettered !== null ? lettered[2] : first === letter ? "" : first;
    return rest !== "" ? rest === wording : given !== "" && given === letter;
  });
  return at < 0 ? null : at;
}

/**
 * What "Edit" on a section of a view opens in place; null where it cannot (no stored
 * section of that name, or one of another kind), and "Edit" then opens the fold.
 */
export function editorFor(
  section: EditableSection,
  source: EditSource | null,
  paper: Pick<DesignWorkpaper, "attributes">,
): SectionEditor | null {
  if (source === null) {
    return null;
  }
  const key = sectionKeyFor(
    section,
    source.sections.map((item) => item.key),
  );
  const stored = source.sections.find((item) => item.key === key);
  if (key === null || stored === undefined) {
    return null;
  }
  const common: Common = {
    section,
    key,
    title: stored.title,
    guidance: stored.guidance,
  };
  if (section === "understanding" || section === "conclusion") {
    return stored.kind === "text"
      ? { ...common, kind: "text", text: stored.text }
      : null;
  }
  const width = stored.columns.length;
  if (stored.kind !== "table" || width < 1 || width > EDIT_LIMITS.columns) {
    return null;
  }
  const rows = stored.rows.map((row) => widened(row, width));
  if (section === "attributes") {
    const noteAt = stored.columns.findIndex((head) => flat(head) === "notes");
    // The first column names the attribute: a "Notes" column there has no row to find.
    if (noteAt < 1 || paper.attributes.length === 0) {
      return null;
    }
    return {
      ...common,
      kind: "notes",
      columns: [...stored.columns],
      rows,
      noteAt,
      items: paper.attributes.map((attribute): NoteItem => {
        const row = attributeRow(rows, attribute.code, attribute.text);
        return {
          id: attribute.id,
          code: attribute.code,
          text: attribute.text,
          row,
          note: row === null ? "" : (rows[row]?.[noteAt] ?? ""),
        };
      }),
    };
  }
  const words = GRID_WORDS[section];
  if (words === undefined) {
    return null;
  }
  return {
    ...common,
    kind: "grid",
    columns: [...stored.columns],
    rows,
    ...words,
  };
}

/** The draft an editor starts with: what is stored. */
export function draftOf(editor: SectionEditor): Draft {
  if (editor.kind === "text") {
    return { kind: "text", text: editor.text };
  }
  if (editor.kind === "grid") {
    return { kind: "grid", rows: editor.rows.map((row) => [...row]) };
  }
  return {
    kind: "notes",
    notes: Object.fromEntries(editor.items.map((item) => [item.id, item.note])),
  };
}

/** A cell is one line: the server makes a line break a space, so the box does too. */
export function cleanCell(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

export function setCell(
  rows: ReadonlyArray<readonly string[]>,
  row: number,
  column: number,
  value: string,
): string[][] {
  return rows.map((cells, at) =>
    at === row
      ? cells.map((cell, index) => (index === column ? cleanCell(value) : cell))
      : [...cells],
  );
}

/** Another empty row at the end, up to the server's limit. */
export function addRow(
  rows: ReadonlyArray<readonly string[]>,
  width: number,
): string[][] {
  const kept = rows.map((cells) => [...cells]);
  return kept.length >= EDIT_LIMITS.rows
    ? kept
    : [...kept, Array<string>(width).fill("")];
}

export function removeRow(
  rows: ReadonlyArray<readonly string[]>,
  at: number,
): string[][] {
  return rows.filter((_, index) => index !== at).map((cells) => [...cells]);
}

const blank = (row: readonly string[]) =>
  row.every((cell) => cell.trim() === "");

/** The rows a notes editor sends: every stored row and cell as it is, with each
 * attribute's note in the "Notes" cell of its row; an attribute that has no row gets one
 * ("A. wording", the note) only where a note was written. */
export function notesRows(
  editor: NotesEditor,
  notes: Readonly<Record<string, string>>,
): string[][] {
  const rows = editor.rows.map((row) => [...row]);
  const width = editor.columns.length;
  for (const item of editor.items) {
    const note = cleanCell(notes[item.id] ?? item.note).trim();
    if (item.row !== null) {
      const row = rows[item.row];
      if (row !== undefined) {
        row[editor.noteAt] = note;
      }
    } else if (note !== "") {
      const row = Array<string>(width).fill("");
      row[0] = `${item.code}. ${item.text}`.slice(0, EDIT_LIMITS.cell);
      row[editor.noteAt] = note;
      rows.push(row);
    }
  }
  return rows;
}

/** What a save sends: the text, or the rows (a row with nothing in it is not one). */
export function savePayload(
  editor: SectionEditor,
  draft: Draft,
): { text: string } | { rows: string[][] } {
  if (editor.kind === "text") {
    return { text: draft.kind === "text" ? draft.text : editor.text };
  }
  if (editor.kind === "grid") {
    const rows = draft.kind === "grid" ? draft.rows : editor.rows;
    return {
      rows: rows
        .filter((row) => !blank(row))
        .map((row) => widened(row.map(cleanCell), editor.columns.length)),
    };
  }
  return {
    rows: notesRows(editor, draft.kind === "notes" ? draft.notes : {}),
  };
}

/** A text as the server keeps it (inbound.clean_text): line ends alike, no spaces at a
 * line's end, no more than one blank line, none around the text. */
const keptText = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
/** A cell as the server keeps it (inbound.clean_line): one line, single spaces. */
const keptCell = (cell: string) => cell.split(/\s+/).filter(Boolean).join(" ");
const keptRows = (rows: ReadonlyArray<readonly string[]>) =>
  JSON.stringify(rows.map((row) => row.map(keptCell)));

/** Whether a save would change what is stored: "Save" is off until it would. Spaces the
 * server drops are no change: a save of them would be a new version of the same words. */
export function changed(editor: SectionEditor, draft: Draft): boolean {
  const sent = savePayload(editor, draft);
  if ("text" in sent) {
    return (
      editor.kind === "text" && keptText(sent.text) !== keptText(editor.text)
    );
  }
  const stored =
    editor.kind === "text"
      ? []
      : editor.kind === "grid"
        ? editor.rows.filter((row) => !blank(row))
        : editor.rows;
  return keptRows(sent.rows) !== keptRows(stored);
}

export const CREDENTIAL_PROBLEM =
  "This reads as a credential (a password, key or token). Remove it to save.";
/** The same, of a row of a table: which row is said, so it can be found. */
export const credentialInRow = (row: number) =>
  `Row ${row} reads as a credential (a password, key or token). Remove it to save.`;
export const credentialInNote = (code: string) =>
  `The note on attribute ${code} reads as a credential (a password, key or token). Remove it to save.`;

/** Why the draft cannot be saved as it is, in one sentence; "" where it can. */
export function draftProblem(editor: SectionEditor, draft: Draft): string {
  const sent = savePayload(editor, draft);
  if ("text" in sent) {
    if (sent.text.length > EDIT_LIMITS.text) {
      return `The text is ${sent.text.length.toLocaleString("en-US")} characters; the most is ${EDIT_LIMITS.text.toLocaleString("en-US")}.`;
    }
    return CREDENTIAL.test(sent.text) ? CREDENTIAL_PROBLEM : "";
  }
  if (sent.rows.length > EDIT_LIMITS.rows) {
    return `There are ${sent.rows.length} rows; the most is ${EDIT_LIMITS.rows}.`;
  }
  const long = sent.rows.findIndex((row) =>
    row.some((cell) => cell.length > EDIT_LIMITS.cell),
  );
  if (long >= 0) {
    return `A cell of row ${long + 1} is longer than ${EDIT_LIMITS.cell.toLocaleString("en-US")} characters.`;
  }
  if (editor.kind === "notes") {
    // What was typed is said by its attribute; a stored cell nobody typed, by its row.
    const typed = draft.kind === "notes" ? draft.notes : {};
    const note = editor.items.find((item) =>
      CREDENTIAL.test(typed[item.id] ?? item.note),
    );
    if (note !== undefined) {
      return credentialInNote(note.code);
    }
  }
  const secret = sent.rows.findIndex((row) =>
    row.some((cell) => CREDENTIAL.test(cell)),
  );
  return secret >= 0 ? credentialInRow(secret + 1) : "";
}

/** The body the page posts to `/workspace/workpapers/section`. */
export function saveRequest(
  scope: { organizationId: string; projectId: string },
  source: EditSource,
  editor: SectionEditor,
  draft: Draft,
): Record<string, unknown> {
  return {
    organization_id: scope.organizationId,
    project_id: scope.projectId,
    workpaper_id: source.workpaperId,
    section: editor.key,
    based_on: source.basedOn,
    ...savePayload(editor, draft),
  };
}

/* The route's side ---------------------------------------------------------------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SectionWrite =
  | { error: "invalid" }
  | {
      path: string;
      body:
        | { based_on: number; text: string }
        | { based_on: number; rows: string[][] };
    };

/**
 * The API call for a section's save, from what the page posted: three ids, the section's
 * key, the version it is based on, and either the text or the rows, within the server's
 * limits and never a credential. Anything else is refused here and never sent.
 */
export function sectionWrite(fields: Record<string, unknown>): SectionWrite {
  const id = (name: string) => {
    const value = fields[name];
    return typeof value === "string" && UUID.test(value) ? value : null;
  };
  const organization = id("organization_id");
  const project = id("project_id");
  const paper = id("workpaper_id");
  const key = fields.section;
  const basedOn = fields.based_on;
  if (
    organization === null ||
    project === null ||
    paper === null ||
    typeof key !== "string" ||
    !/^[a-z0-9-]{1,60}$/.test(key) ||
    typeof basedOn !== "number" ||
    !Number.isInteger(basedOn) ||
    basedOn < 1
  ) {
    return { error: "invalid" };
  }
  const path = `/organizations/${organization}/projects/${project}/workpapers/${paper}/sections/${key}`;
  const { text, rows } = fields;
  if (typeof text === "string" && rows === undefined) {
    return text.length > EDIT_LIMITS.text || CREDENTIAL.test(text)
      ? { error: "invalid" }
      : { path, body: { based_on: basedOn, text } };
  }
  if (!Array.isArray(rows) || text !== undefined) {
    return { error: "invalid" };
  }
  if (rows.length > EDIT_LIMITS.rows) {
    return { error: "invalid" };
  }
  const sent: string[][] = [];
  for (const row of rows) {
    if (
      !Array.isArray(row) ||
      row.length < 1 ||
      row.length > EDIT_LIMITS.columns ||
      !row.every(
        (cell): cell is string =>
          typeof cell === "string" &&
          cell.length <= EDIT_LIMITS.cell &&
          !CREDENTIAL.test(cell),
      )
    ) {
      return { error: "invalid" };
    }
    sent.push(row.map(cleanCell));
  }
  return { path, body: { based_on: basedOn, rows: sent } };
}

/* What the editor says ------------------------------------------------------------------- */

export const SAVING = "Saving…";
export const SAVED = "Saved as a new version of the draft.";
export const UNSAVED = "Unsaved changes";
/** After a save the server confirmed, where the views could not read the workpaper
 * again: the save stands, and the page says what it could not do. */
export const SAVED_NOT_READ =
  "Your change was saved as a new version, but the workpaper could not be read again. Try again to see it.";
export const DISCARD_QUESTION = "Discard your changes to this section?";

/**
 * Why a save was not taken, in one sentence, from the route's answer; "" for a save the
 * server confirmed. What was typed is always kept. A refusal the server words (409) is
 * said in this page's words where it is one this page knows, otherwise in the server's.
 */
export function saveProblem(status: number, detail: string): string {
  if (status === 200) {
    return "";
  }
  if (status === 409) {
    const said = detail.trim();
    if (/changed/i.test(said)) {
      return "Not saved: the workpaper changed after you opened this editor. Copy what you typed, cancel, and edit the latest version.";
    }
    if (/prepared/i.test(said)) {
      return "Not saved: the workpaper is prepared. Reopen it to change it.";
    }
    if (/drafting/i.test(said)) {
      return "Not saved: the agent is drafting this workpaper. Try again when it has finished.";
    }
    if (/too long/i.test(said)) {
      return "Not saved: the section is too long.";
    }
    return said === ""
      ? "Not saved: the workpaper cannot be changed now."
      : `Not saved: ${said.replace(/[.\s]+$/, "")}.`;
  }
  if (status === 401) {
    return "Not saved: your session has ended. Sign in again in another tab, then press Save: what you typed is still here.";
  }
  if (status === 403 || status === 404) {
    return "Not saved: you may not edit this workpaper, or it is no longer here.";
  }
  if (status === 422) {
    return "Not saved: the server did not take this as written. Check its length and try again.";
  }
  return "Not saved: the server could not be reached. What you typed is still here: try again.";
}
