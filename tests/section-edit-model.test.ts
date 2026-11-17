import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { DesignWorkpaper } from "../apps/web/src/design-workpaper-model.ts";
import {
  addRow,
  attributeRow,
  CREDENTIAL_PROBLEM,
  changed,
  cleanCell,
  DISCARD_QUESTION,
  draftOf,
  draftProblem,
  EDIT_LIMITS,
  type EditSource,
  editorFor,
  editSource,
  type GridEditor,
  type NotesEditor,
  notesRows,
  recordsBehind,
  recordVersionBehind,
  removeRow,
  SAVED,
  SAVING,
  savePayload,
  saveProblem,
  saveRequest,
  sectionWrite,
  setCell,
  type TextEditor,
  UNSAVED,
} from "../apps/web/src/section-edit-model.ts";
import type { WorkpaperSection } from "../apps/web/src/workpaper-model.ts";

// Editing a section of the D&I workpaper where it is (docs/design-workpaper.md, section
// 3.2; product owner, 15 November 2026: "Not a great UX that when the edit is clicked, it
// brings the user at the bottom", then "I like the option a better"). The model must
// never: open an editor on a version the views do not show, send anything but the stored
// section with the person's change, lose a row or a cell nobody touched, or word a save
// as done before the server confirmed it. Synthetic data only.

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ORG, PROJECT, PAPER] = [uuid(1), uuid(2), uuid(7)] as const;

const section = (over: Partial<WorkpaperSection>): WorkpaperSection => ({
  key: "",
  title: "",
  kind: "text",
  guidance: "",
  fields: [],
  text: "",
  citations: [],
  columns: [],
  rows: [],
  source: "AGENT",
  narrative: false,
  tab: "design",
  period: "design",
  review: null,
  ...over,
});

const SECTIONS: WorkpaperSection[] = [
  section({
    key: "control",
    title: "Control",
    kind: "fields",
    fields: [{ label: "Owner", value: "Dana Lee" }],
  }),
  section({
    key: "understanding-of-the-control",
    title: "Understanding of the control",
    guidance: "Say how the control works.",
    text: "HR records each termination.\n\nThe administrator removes access [^1].",
  }),
  section({
    key: "walkthrough-of-one-instance",
    title: "Walkthrough of one instance",
    kind: "table",
    columns: ["Step", "Who", "Evidence inspected", "Result"],
    rows: [
      ["HR starts the termination", "L. Moreno", "History", "Initiated"],
      ["Access is removed", "M. Santos"],
      ["", "", "", ""],
    ],
  }),
  section({
    key: "design-attributes",
    title: "Design attributes",
    kind: "table",
    source: "RECORDS",
    columns: ["Attribute", "Designed to address the risk", "Notes"],
    rows: [
      ["A. Access is disabled", "Yes", "Seen on the account screen"],
      ["b)  Every   account is removed", "Yes", ""],
      ["A row nobody matches", "Kept", "Kept too"],
    ],
  }),
  section({
    key: "information-produced-by-the-entity",
    title: "Information produced by the entity",
    kind: "table",
    columns: ["Report", "Source", "Completeness and accuracy"],
    rows: [["signons.csv", "Workday", "Parameters inspected"]],
  }),
  section({
    key: "design-conclusion",
    title: "Design conclusion",
    text: "The control is designed to address the risk.",
  }),
];

const stored = (over: Record<string, unknown> = {}) => ({
  id: PAPER,
  stage: "DESIGN" as const,
  status: "DRAFT" as const,
  drafting: false,
  currentVersion: 3,
  shownVersion: 3,
  sections: SECTIONS,
  ...over,
});

const shown = (
  over: Record<string, unknown> = {},
): Pick<DesignWorkpaper, "workpaper"> => ({
  workpaper: {
    id: PAPER,
    reference: "ITGC-AC-02-WORK-TOD",
    status: "DRAFT",
    drafting: false,
    version: 9,
    shownVersion: 3,
    currentVersion: 3,
    preparedBy: null,
    preparedAt: null,
    ...over,
  },
});

const ATTRIBUTES = [
  { id: uuid(11), code: "A", text: "Access is disabled" },
  { id: uuid(12), code: "B", text: "Every account is removed" },
  { id: uuid(13), code: "C", text: "Removed within 1 business day" },
] as unknown as DesignWorkpaper["attributes"];
const paper = { attributes: ATTRIBUTES };

const SOURCE: EditSource = {
  workpaperId: PAPER,
  basedOn: 3,
  sections: SECTIONS,
};

const text = (name: "understanding" | "conclusion") =>
  editorFor(name, SOURCE, paper) as TextEditor;
const grid = (name: "walkthrough" | "reports") =>
  editorFor(name, SOURCE, paper) as GridEditor;
const notes = () => editorFor("attributes", SOURCE, paper) as NotesEditor;

describe("what an edit is based on", () => {
  it("is the stored D&I workpaper the views show, at its latest version", () => {
    assert.deepEqual(editSource([stored()], shown()), SOURCE);
    // The testing workpaper is never the one.
    assert.equal(
      editSource([stored({ stage: "EFFECTIVENESS" })], shown()),
      null,
    );
  });

  it("is nothing where the page's records and the views are not the same version", () => {
    for (const [papers, view] of [
      [null, shown()],
      [[], shown()],
      [[stored()], null],
      [[stored()], { workpaper: null }],
      [[stored({ id: uuid(8) })], shown()],
      // The views read a newer version than the page's records hold (a save's refresh
      // has not landed yet), or an older one.
      [[stored()], shown({ currentVersion: 4 })],
      [[stored({ currentVersion: 4, shownVersion: 4 })], shown()],
      // An earlier version is on screen, a prepared one, one being drafted, none yet.
      [[stored({ shownVersion: 2 })], shown()],
      [[stored({ status: "PREPARED" })], shown()],
      [[stored({ drafting: true })], shown()],
      [
        [stored({ currentVersion: 0, shownVersion: 0 })],
        shown({ currentVersion: 0 }),
      ],
    ] as const) {
      assert.equal(
        editSource(
          papers as Parameters<typeof editSource>[0],
          view as Parameters<typeof editSource>[1],
        ),
        null,
      );
    }
  });
});

describe("the moment after a save", () => {
  it("says the page's records are behind only while they hold an earlier version than the views show", () => {
    assert.equal(recordsBehind([stored()], shown()), false);
    assert.equal(recordsBehind([stored()], shown({ currentVersion: 4 })), true);
    // Ahead of the views, another workpaper, the testing one, none: not "behind".
    assert.equal(
      recordsBehind([stored({ currentVersion: 4 })], shown()),
      false,
    );
    assert.equal(
      recordsBehind([stored({ id: uuid(8) })], shown({ currentVersion: 4 })),
      false,
    );
    assert.equal(
      recordsBehind(
        [stored({ stage: "EFFECTIVENESS" })],
        shown({ currentVersion: 4 }),
      ),
      false,
    );
    assert.equal(recordsBehind(null, shown()), false);
    assert.equal(recordsBehind([stored()], { workpaper: null }), false);
    // While they are behind, no editor opens in place either.
    assert.equal(editSource([stored()], shown({ currentVersion: 4 })), null);
  });
});

describe("the moment after a recorded conclusion", () => {
  it("says the page's records are behind by the record's own version, which a recorded conclusion moves", () => {
    // Recording the preparer's conclusion bumps `workpapers.version` (no section
    // changes): until the page's records are read again, Prepare would post the
    // version before it (docs/design-workpaper.md section 3.6, "Tightened after the independent review").
    const record = { id: PAPER, stage: "DESIGN" as const, version: 9 };
    const records = [record];
    assert.equal(recordVersionBehind(records, shown()), false);
    assert.equal(recordVersionBehind(records, shown({ version: 10 })), true);
    assert.equal(
      recordVersionBehind([{ ...record, version: 11 }], shown({ version: 10 })),
      false,
    );
    assert.equal(
      recordVersionBehind(
        [{ ...record, stage: "EFFECTIVENESS" as const }],
        shown({ version: 10 }),
      ),
      false,
    );
    assert.equal(recordVersionBehind(null, shown({ version: 10 })), false);
    assert.equal(recordVersionBehind(records, { workpaper: null }), false);
  });
});

describe("what Edit opens in place", () => {
  it("opens the stored text of the understanding and of the conclusion", () => {
    assert.deepEqual(text("understanding"), {
      section: "understanding",
      key: "understanding-of-the-control",
      title: "Understanding of the control",
      guidance: "Say how the control works.",
      kind: "text",
      text: "HR records each termination.\n\nThe administrator removes access [^1].",
    });
    assert.equal(text("conclusion").key, "design-conclusion");
    assert.equal(
      text("conclusion").text,
      "The control is designed to address the risk.",
    );
  });

  it("opens a table's own columns and rows, each row as wide as the columns", () => {
    const made = grid("walkthrough");
    assert.equal(made.kind, "grid");
    assert.equal(made.key, "walkthrough-of-one-instance");
    assert.deepEqual(made.columns, [
      "Step",
      "Who",
      "Evidence inspected",
      "Result",
    ]);
    assert.deepEqual(made.rows[1], ["Access is removed", "M. Santos", "", ""]);
    assert.equal(made.rows.length, 3);
    assert.equal(made.addLabel, "Add a step");
    assert.equal(made.rowWord, "step");
    assert.match(made.note, /time and its evidence references are read/);
    const reports = grid("reports");
    assert.equal(reports.key, "information-produced-by-the-entity");
    assert.equal(reports.addLabel, "Add a report");
    // The editor's rows are its own: the stored section is never changed through them.
    made.rows[0]?.splice(0, 1, "changed");
    assert.equal(SECTIONS[2]?.rows[0]?.[0], "HR starts the termination");
  });

  it("opens each attribute's note, found in its row as the server finds it", () => {
    const made = notes();
    assert.equal(made.kind, "notes");
    assert.equal(made.noteAt, 2);
    assert.deepEqual(
      made.items.map((item) => [item.code, item.row, item.note]),
      [
        ["A", 0, "Seen on the account screen"],
        ["B", 1, ""],
        ["C", null, ""],
      ],
    );
  });

  it("finds an attribute's row by its wording, and by its letter only where the cell is a letter alone", () => {
    const rows = [
      ["B. Access is disabled"],
      ["a"],
      ["Removed within 1 business day"],
      ["C. Something else"],
    ];
    // By wording, whatever letter stands before it.
    assert.equal(attributeRow(rows, "A", "Access  is DISABLED"), 0);
    // A letter alone is taken by its letter.
    assert.equal(attributeRow(rows, "A", "Wording not in any row"), 1);
    // Wording alone in the cell.
    assert.equal(attributeRow(rows, "D", "Removed within 1 business day"), 2);
    // A letter before other wording is not the attribute's row.
    assert.equal(attributeRow(rows, "C", "Not the same wording"), null);
    assert.equal(attributeRow(rows, "A", ""), null);
    assert.equal(attributeRow([], "A", "Access is disabled"), null);
  });

  it("opens nothing where the stored section is missing or of another kind: the fold is the way", () => {
    const without = (key: string): EditSource => ({
      ...SOURCE,
      sections: SECTIONS.filter((item) => item.key !== key),
    });
    const as = (key: string, over: Partial<WorkpaperSection>): EditSource => ({
      ...SOURCE,
      sections: SECTIONS.map((item) =>
        item.key === key ? { ...item, ...over } : item,
      ),
    });
    assert.equal(editorFor("understanding", null, paper), null);
    assert.equal(
      editorFor(
        "understanding",
        without("understanding-of-the-control"),
        paper,
      ),
      null,
    );
    assert.equal(
      editorFor(
        "conclusion",
        as("design-conclusion", { kind: "table", columns: ["A"] }),
        paper,
      ),
      null,
    );
    assert.equal(
      editorFor(
        "walkthrough",
        as("walkthrough-of-one-instance", { kind: "text" }),
        paper,
      ),
      null,
    );
    assert.equal(
      editorFor(
        "walkthrough",
        as("walkthrough-of-one-instance", { columns: [] }),
        paper,
      ),
      null,
    );
    assert.equal(
      editorFor(
        "reports",
        as("information-produced-by-the-entity", {
          columns: Array<string>(21).fill("c"),
        }),
        paper,
      ),
      null,
    );
    // The attributes need a "Notes" column, and attributes to note.
    assert.equal(
      editorFor(
        "attributes",
        as("design-attributes", { columns: ["Attribute", "Designed"] }),
        paper,
      ),
      null,
    );
    assert.equal(editorFor("attributes", SOURCE, { attributes: [] }), null);
    // A "Notes" column that is the first one has no cell left to name the attribute.
    assert.equal(
      editorFor(
        "attributes",
        as("design-attributes", { columns: ["Notes", "Attribute"] }),
        paper,
      ),
      null,
    );
  });
});

describe("the draft", () => {
  it("starts as what is stored, and is not changed until something is", () => {
    for (const editor of [
      text("understanding"),
      grid("walkthrough"),
      grid("reports"),
      notes(),
    ]) {
      const draft = draftOf(editor);
      assert.equal(changed(editor, draft), false, editor.key);
      assert.equal(draftProblem(editor, draft), "", editor.key);
    }
  });

  it("keeps a cell on one line, and never touches the rows it was given", () => {
    assert.equal(cleanCell("one\r\ntwo\n\nthree"), "one two three");
    const rows = [
      ["a", "b"],
      ["c", "d"],
    ];
    assert.deepEqual(setCell(rows, 1, 0, "x\ny"), [
      ["a", "b"],
      ["x y", "d"],
    ]);
    assert.deepEqual(addRow(rows, 2), [
      ["a", "b"],
      ["c", "d"],
      ["", ""],
    ]);
    assert.deepEqual(removeRow(rows, 0), [["c", "d"]]);
    assert.deepEqual(rows, [
      ["a", "b"],
      ["c", "d"],
    ]);
    // Never past the server's limit of rows.
    const full = Array.from({ length: EDIT_LIMITS.rows }, () => ["x"]);
    assert.equal(addRow(full, 1).length, EDIT_LIMITS.rows);
  });

  it("says a text or a grid changed only where a save would change what is stored", () => {
    const understanding = text("understanding");
    assert.equal(
      changed(understanding, {
        kind: "text",
        text: `${understanding.text} More.`,
      }),
      true,
    );
    // Spaces the server drops are no change (review, 15 November 2026): a save of them
    // would be a new version, and an audit entry, of the same words.
    for (const same of [
      `${understanding.text} `,
      `\n${understanding.text}\n\n`,
      understanding.text.replace(/\n/g, "\r\n"),
      understanding.text.replace("\n\n", "  \n\n\n\n"),
    ]) {
      assert.equal(changed(understanding, { kind: "text", text: same }), false);
    }
    const walk = grid("walkthrough");
    // An empty row added and left empty is no change: it is not a step.
    assert.equal(
      changed(walk, { kind: "grid", rows: addRow(walk.rows, 4) }),
      false,
    );
    assert.equal(
      changed(walk, {
        kind: "grid",
        rows: setCell(walk.rows, 1, 3, "Removed"),
      }),
      true,
    );
    assert.equal(
      changed(walk, {
        kind: "grid",
        rows: setCell(walk.rows, 1, 1, "  M.   Santos "),
      }),
      false,
    );
    assert.equal(
      changed(notes(), {
        kind: "notes",
        notes: { [uuid(11)]: " Seen on the  account screen " },
      }),
      false,
    );
    assert.equal(
      changed(walk, { kind: "grid", rows: removeRow(walk.rows, 0) }),
      true,
    );
  });
});

describe("what a save sends", () => {
  it("sends the text as typed", () => {
    assert.deepEqual(
      savePayload(text("conclusion"), { kind: "text", text: "New words." }),
      { text: "New words." },
    );
  });

  it("sends a grid's rows without the empty ones, each as wide as the columns", () => {
    const walk = grid("walkthrough");
    const rows = setCell(addRow(walk.rows, 4), 3, 0, "A new step | with a bar");
    assert.deepEqual(savePayload(walk, { kind: "grid", rows }), {
      rows: [
        ["HR starts the termination", "L. Moreno", "History", "Initiated"],
        ["Access is removed", "M. Santos", "", ""],
        // A "|" in a cell is the cell's own text now: it no longer splits it.
        ["A new step | with a bar", "", "", ""],
      ],
    });
  });

  it("puts each note in its attribute's row and leaves every other row and cell as stored", () => {
    const editor = notes();
    const sent = notesRows(editor, {
      [uuid(11)]: "  Seen on the account screen, and in the log ",
      [uuid(12)]: "Line one\nline two",
      [uuid(13)]: "",
    });
    assert.deepEqual(sent, [
      [
        "A. Access is disabled",
        "Yes",
        "Seen on the account screen, and in the log",
      ],
      ["b)  Every   account is removed", "Yes", "Line one line two"],
      ["A row nobody matches", "Kept", "Kept too"],
    ]);
    // An attribute with no row gets one only where a note was written.
    const added = notesRows(editor, { [uuid(13)]: "Checked in code" });
    assert.equal(added.length, 4);
    assert.deepEqual(added[3], [
      "C. Removed within 1 business day",
      "",
      "Checked in code",
    ]);
    // A note nobody touched stays as stored.
    assert.equal(added[0]?.[2], "Seen on the account screen");
    assert.equal(changed(editor, { kind: "notes", notes: {} }), false);
    assert.equal(
      changed(editor, { kind: "notes", notes: { [uuid(12)]: "A note" } }),
      true,
    );
    // The editor's own rows are never changed by a save's rows.
    assert.equal(editor.rows.length, 3);
    assert.equal(editor.rows[1]?.[2], "");
  });

  it("posts the ids, the section, the version it is based on, and the text or the rows", () => {
    const scope = { organizationId: ORG, projectId: PROJECT };
    const conclusion = text("conclusion");
    assert.deepEqual(
      saveRequest(scope, SOURCE, conclusion, { kind: "text", text: "New." }),
      {
        organization_id: ORG,
        project_id: PROJECT,
        workpaper_id: PAPER,
        section: "design-conclusion",
        based_on: 3,
        text: "New.",
      },
    );
    const reports = grid("reports");
    const body = saveRequest(scope, SOURCE, reports, draftOf(reports));
    assert.equal(body.section, "information-produced-by-the-entity");
    assert.deepEqual(body.rows, [
      ["signons.csv", "Workday", "Parameters inspected"],
    ]);
    assert.equal("text" in body, false);
    // What the page posts is what the route takes: the seam, crossed.
    const write = sectionWrite(JSON.parse(JSON.stringify(body)));
    assert.ok(!("error" in write));
    assert.equal(
      write.path,
      `/organizations/${ORG}/projects/${PROJECT}/workpapers/${PAPER}/sections/information-produced-by-the-entity`,
    );
    assert.deepEqual(write.body, {
      based_on: 3,
      rows: [["signons.csv", "Workday", "Parameters inspected"]],
    });
  });
});

describe("the limits, said before a save", () => {
  it("says a text that is too long, and one that reads as a credential", () => {
    const editor = text("understanding");
    assert.equal(
      draftProblem(editor, {
        kind: "text",
        text: "x".repeat(EDIT_LIMITS.text),
      }),
      "",
    );
    assert.equal(
      draftProblem(editor, {
        kind: "text",
        text: "x".repeat(EDIT_LIMITS.text + 1),
      }),
      "The text is 12,001 characters; the most is 12,000.",
    );
    assert.equal(
      draftProblem(editor, { kind: "text", text: "the password: hunter2" }),
      CREDENTIAL_PROBLEM,
    );
  });

  it("says a cell that is too long, by its row, and a credential in a cell or a note", () => {
    const walk = grid("walkthrough");
    assert.equal(
      draftProblem(walk, {
        kind: "grid",
        rows: setCell(walk.rows, 1, 2, "y".repeat(EDIT_LIMITS.cell + 1)),
      }),
      "A cell of row 2 is longer than 1,000 characters.",
    );
    assert.equal(
      draftProblem(walk, {
        kind: "grid",
        rows: setCell(walk.rows, 1, 0, "api_key in the ticket"),
      }),
      // By its row, so it can be found (review, 15 November 2026: it was the bare
      // sentence, with no row said).
      "Row 2 reads as a credential (a password, key or token). Remove it to save.",
    );
    assert.equal(
      draftProblem(notes(), {
        kind: "notes",
        notes: { [uuid(12)]: "client_secret seen" },
      }),
      "The note on attribute B reads as a credential (a password, key or token). Remove it to save.",
    );
    // A stored cell nobody typed is said by its row, also in the notes editor.
    const kept = editorFor(
      "attributes",
      {
        ...SOURCE,
        sections: SECTIONS.map((item) =>
          item.key === "design-attributes"
            ? {
                ...item,
                rows: [
                  ...item.rows,
                  ["Another row", "password: [redacted]", ""],
                ],
              }
            : item,
        ),
      },
      paper,
    ) as NotesEditor;
    assert.equal(
      draftProblem(kept, draftOf(kept)),
      "Row 4 reads as a credential (a password, key or token). Remove it to save.",
    );
  });
});

describe("the write the route sends", () => {
  const base = {
    organization_id: ORG,
    project_id: PROJECT,
    workpaper_id: PAPER,
    section: "design-conclusion",
    based_on: 3,
  };

  it("takes a text or rows, to the section's own path", () => {
    assert.deepEqual(sectionWrite({ ...base, text: "Words." }), {
      path: `/organizations/${ORG}/projects/${PROJECT}/workpapers/${PAPER}/sections/design-conclusion`,
      body: { based_on: 3, text: "Words." },
    });
    assert.deepEqual(sectionWrite({ ...base, rows: [["a\nb", ""]] }), {
      path: `/organizations/${ORG}/projects/${PROJECT}/workpapers/${PAPER}/sections/design-conclusion`,
      body: { based_on: 3, rows: [["a b", ""]] },
    });
    // No rows at all is a table emptied: the server's to take.
    assert.ok(!("error" in sectionWrite({ ...base, rows: [] })));
  });

  it("refuses what is not three ids, a key, a version, and one of a text or rows within the limits", () => {
    const bad: Array<Record<string, unknown>> = [
      {},
      { ...base },
      { ...base, text: "a", rows: [["a"]] },
      { ...base, organization_id: "1", text: "a" },
      { ...base, project_id: `${PROJECT}/../x`, text: "a" },
      { ...base, workpaper_id: 7, text: "a" },
      { ...base, section: "../prepare", text: "a" },
      { ...base, section: "Design Conclusion", text: "a" },
      { ...base, section: "", text: "a" },
      { ...base, based_on: 0, text: "a" },
      { ...base, based_on: "3", text: "a" },
      { ...base, based_on: 1.5, text: "a" },
      { ...base, text: 7 },
      { ...base, text: "x".repeat(EDIT_LIMITS.text + 1) },
      { ...base, text: "refresh_token in here" },
      { ...base, rows: "a | b" },
      { ...base, rows: [[]] },
      { ...base, rows: ["a"] },
      { ...base, rows: [[1]] },
      { ...base, rows: [Array<string>(EDIT_LIMITS.columns + 1).fill("a")] },
      { ...base, rows: [["x".repeat(EDIT_LIMITS.cell + 1)]] },
      { ...base, rows: [["a private_key b"]] },
      {
        ...base,
        rows: Array.from({ length: EDIT_LIMITS.rows + 1 }, () => ["a"]),
      },
    ];
    for (const fields of bad) {
      assert.deepEqual(
        sectionWrite(fields),
        { error: "invalid" },
        JSON.stringify(fields).slice(0, 80),
      );
    }
  });
});

describe("what the editor says", () => {
  it("says nothing for a confirmed save, and why for every other answer", () => {
    assert.equal(saveProblem(200, ""), "");
    assert.match(
      saveProblem(
        409,
        "the workpaper changed; refresh and edit the latest version",
      ),
      /^Not saved: the workpaper changed after you opened this editor\. Copy what you typed/,
    );
    assert.equal(
      saveProblem(409, "the workpaper is prepared; reopen it to change it"),
      "Not saved: the workpaper is prepared. Reopen it to change it.",
    );
    assert.match(
      saveProblem(409, "the agent is drafting it"),
      /the agent is drafting this workpaper/,
    );
    assert.equal(
      saveProblem(409, "the section is too long"),
      "Not saved: the section is too long.",
    );
    // A refusal this page does not know, in the server's words; none, in the page's.
    assert.equal(
      saveProblem(409, "a text section takes text. "),
      "Not saved: a text section takes text.",
    );
    assert.equal(
      saveProblem(409, ""),
      "Not saved: the workpaper cannot be changed now.",
    );
    assert.match(
      saveProblem(401, ""),
      /^Not saved: your session has ended\. Sign in again .* what you typed is still here\.$/,
    );
    for (const status of [403, 404]) {
      assert.match(saveProblem(status, ""), /you may not edit this workpaper/);
    }
    assert.match(saveProblem(422, ""), /did not take this as written/);
    for (const status of [0, 500, 502, 201, 302]) {
      assert.match(
        saveProblem(status, "ignored"),
        /could not be reached\. What you typed is still here/,
        String(status),
      );
    }
    // Every refusal starts "Not saved" and keeps what was typed: never a success word.
    for (const status of [0, 401, 403, 404, 409, 422, 500]) {
      assert.match(saveProblem(status, "x"), /^Not saved: /);
    }
  });

  it("words the bar plainly, and never says 'the client'", () => {
    assert.equal(SAVING, "Saving…");
    assert.equal(SAVED, "Saved as a new version of the draft.");
    assert.equal(UNSAVED, "Unsaved changes");
    assert.equal(DISCARD_QUESTION, "Discard your changes to this section?");
    const model = readFileSync("apps/web/src/section-edit-model.ts", "utf8");
    assert.equal(/the client/i.test(model), false);
  });
});

describe("the route", () => {
  const route = readFileSync(
    "apps/web/app/workspace/workpapers/section/route.ts",
    "utf8",
  );

  it("validates with the model, answers as JSON, and never redirects", () => {
    assert.match(route, /const write = sectionWrite\(fields\);/);
    assert.match(
      route,
      /if \("error" in write\) \{\s*return NextResponse\.json\(\{ status: 422, detail: "" \}\);/,
    );
    assert.match(route, /fetch\(`\$\{apiBaseUrl\(\)\}\$\{write\.path\}`/);
    assert.match(route, /body: JSON\.stringify\(write\.body\)/);
    assert.match(route, /status = response\.ok \? 200 : response\.status;/);
    assert.match(route, /return NextResponse\.json\(\{ status, detail \}\);/);
    assert.equal(
      /redirect/.test(route.replace(/\/\*\*[\s\S]*?\*\//, "")),
      false,
    );
    assert.equal(
      /export async function (GET|PUT|DELETE|PATCH)/.test(route),
      false,
    );
  });

  it("sends the session and nothing else of the browser's, and logs nothing", () => {
    assert.match(
      route,
      /headers\.set\("cookie", `aw_session=\$\{session\}`\);/,
    );
    assert.equal(/console\./.test(route), false);
    assert.equal(/request\.headers/.test(route), false);
  });
});
