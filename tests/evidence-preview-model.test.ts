import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findSpan,
  markParts,
  parseCitations,
  pdfRuns,
  previewKind,
  readingBlocks,
} from "../apps/web/src/evidence-preview-model.ts";
import { cellCitations } from "../apps/web/src/sheet-model.ts";

const file = "66666666-6666-7666-8666-666666666666";

describe("evidence preview", () => {
  it("chooses a viewer by file type", () => {
    assert.equal(previewKind("ISS-07.PDF"), "pdf");
    assert.equal(previewKind("PWD-01.png"), "image");
    assert.equal(previewKind("shot.jpeg"), "image");
    assert.equal(previewKind("users.csv"), "text");
    assert.equal(previewKind("policy.docx"), "text");
  });

  it("finds a quote however its spaces, quotes, and case are written", () => {
    const text = "Minimum   password\nlength “12” characters.";
    const span = findSpan(text, 'minimum password length "12"');
    assert.ok(span !== null);
    assert.equal(
      text.slice(span[0], span[1]),
      "Minimum   password\nlength “12”",
    );
    assert.equal(findSpan(text, "ab"), null);
    assert.equal(findSpan(text, "not there"), null);
  });

  it("finds the PDF text runs a quote spans", () => {
    const runs = [
      "4.1 Passwords",
      "Minimum password",
      "length 12",
      "characters",
      "",
    ];
    assert.deepEqual(pdfRuns(runs, "minimum password length 12"), [1, 2]);
    assert.deepEqual(pdfRuns(runs, "nowhere"), []);
  });

  it("marks every quoted passage once, in order", () => {
    const parts = markParts("Lockout 0, max age 180, history 5", [
      "history 5",
      "Lockout 0",
    ]);
    assert.deepEqual(
      parts.filter((part) => part.mark).map((part) => part.text),
      ["Lockout 0", "history 5"],
    );
    assert.equal(
      parts.map((part) => part.text).join(""),
      "Lockout 0, max age 180, history 5",
    );
  });

  it("reads sheets, pages, and tables from the read text", () => {
    const blocks = readingBlocks(
      "## Sheet: Users\nUser ID | Name\nu0001 | Ann\n\nNotes below\n[Page 2]\nMore",
    );
    assert.deepEqual(
      blocks.map((block) => block.kind),
      ["heading", "table", "text", "heading", "text"],
    );
    const table = blocks[1];
    assert.ok(table?.kind === "table");
    assert.deepEqual(table.rows, [
      ["User ID", "Name"],
      ["u0001", "Ann"],
    ]);
  });

  it("keeps only well-formed citations, with boxes inside the image", () => {
    const parsed = parseCitations([
      {
        file_id: file,
        quote: "ok",
        box: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
        page: 2,
      },
      {
        file_id: file,
        quote: "outside",
        box: { x: 0.9, y: 0.2, w: 0.3, h: 0.1 },
      },
      { file_id: "x", quote: "bad id" },
    ]);
    assert.equal(parsed.length, 2);
    assert.deepEqual(parsed[0]?.box, { x: 0.1, y: 0.2, w: 0.3, h: 0.1 });
    assert.equal(parsed[0]?.page, 2);
    assert.equal(parsed[1]?.box, null);
  });

  it("labels a result's citations with its attribute", () => {
    const cited = cellCitations(
      [
        {
          file_id: file,
          file_name: "PWD-02.png",
          quote: "MinPasswordLength 8",
          found: true,
          location: "Screenshot",
          page: null,
          box: { x: 0.1, y: 0.4, w: 0.3, h: 0.05 },
        },
      ],
      1,
    );
    assert.equal(cited[0]?.label, "A2");
    assert.equal(cited[0]?.box?.w, 0.3);
    assert.deepEqual(cellCitations("nope", 0), []);
  });
});
