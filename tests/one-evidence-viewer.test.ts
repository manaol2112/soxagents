import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CITED_WORDS,
  citedCitations,
  citedMarks,
  citedName,
  citedPageMarks,
  citedUnboxedLine,
  isCitedId,
  KIND_WORDS,
  MARK_TOKEN,
  noAnnotations,
  pickTarget,
  textStageLine,
} from "../apps/web/src/evidence-annotations-model.ts";
import {
  type EvidenceCitation,
  previewKind,
} from "../apps/web/src/evidence-preview-model.ts";

// One evidence viewer (docs/evidence-annotations.md, section 5a; product owner, 14
// November 2026: "I want the old evidence viewer to be retired. I want the one you
// created today."). The annotation viewer shows every file in the app; the passages a
// screen cites are a kind of their own, "Cited", in its legend. Synthetic data only.

const FILE = "66666666-6666-7666-8666-666666666666";
const OTHER = "77777777-7777-7777-8777-777777777777";

const cite = (over: Partial<EvidenceCitation> = {}): EvidenceCitation => ({
  fileId: FILE,
  fileName: "ticket.pdf",
  quote: "Account Disabled Yes",
  found: true,
  location: "Page 1",
  page: 1,
  box: null,
  label: "A1",
  ...over,
});

describe("the cited kind", () => {
  it("is named in words with a mark and a tone of its own, never colour alone", () => {
    assert.equal(CITED_WORDS.label, "Cited");
    assert.equal(CITED_WORDS.mark, "tag");
    assert.equal(CITED_WORDS.tone, "cited");
    // Not one of the annotation kinds, in words, mark or tone.
    for (const kind of Object.values(KIND_WORDS)) {
      assert.notEqual(kind.label, CITED_WORDS.label);
      assert.notEqual(kind.tone, CITED_WORDS.tone);
    }
    assert.equal(MARK_TOKEN.cited, "--mark-cited");
  });

  it("numbers the citations after the file's annotations, in the screen's order", () => {
    const citations = [
      cite({ quote: "Worker Status: Terminated" }),
      cite({ fileId: OTHER, fileName: "shot.png", quote: "Disabled On" }),
    ];
    // With no annotations: 1, 2 as the old list numbered them.
    assert.deepEqual(
      citedMarks(citations, FILE, []).map((mark) => [mark.id, mark.number]),
      [
        ["cited-0", 1],
        ["cited-1", 2],
      ],
    );
    // Beside three annotations: 4, 5, so no two marks in view share a number.
    const three = [{ quote: "a b c" }, { quote: "d e f" }, { quote: "g h i" }];
    assert.deepEqual(
      citedMarks(citations, FILE, three).map((mark) => mark.number),
      [4, 5],
    );
    // What the screen calls each, and where it is, are kept as they were cited.
    const [first] = citedMarks(citations, FILE, []);
    assert.equal(first?.label, "A1");
    assert.equal(first?.location, "Page 1");
    assert.equal(first?.fileId, FILE);
    assert.ok(isCitedId(first?.id ?? ""));
    assert.ok(!isCitedId("00000000-0000-4000-8000-000000000201"));
  });

  it("does not box twice the words an annotation of the shown file already marks", () => {
    const citations = [
      cite({ quote: "Account  disabled YES." }),
      cite({ quote: "Something else entirely" }),
      // The same words in another file are that file's, and kept.
      cite({ fileId: OTHER, quote: "Account Disabled Yes" }),
    ];
    const marks = citedMarks(citations, FILE, [
      { quote: "Account Disabled Yes" },
    ]);
    assert.deepEqual(
      marks.map((mark) => [mark.id, mark.number]),
      [
        ["cited-1", 2],
        ["cited-2", 3],
      ],
    );
  });

  it("boxes a citation where its words are: an image's own box, or a PDF's runs on its page", () => {
    const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.05 };
    const image = citedMarks([cite({ page: null, box })], FILE, []);
    assert.deepEqual(citedPageMarks(image, null), [
      { id: "cited-0", rects: [box] },
    ]);
    // A PDF: the runs found for it, by its place after the annotations (offset 2).
    const pdf = citedMarks(
      [cite({ page: 2 }), cite({ page: null, quote: "x y z" })],
      FILE,
      [],
    );
    const found = [
      { index: 2, box: { x: 0.1, y: 0.5, w: 0.2, h: 0.02 } },
      { index: 2, box: { x: 0.31, y: 0.5, w: 0.1, h: 0.02 } },
      { index: 0, box: { x: 0.5, y: 0.5, w: 0.1, h: 0.02 } },
    ];
    const onTwo = citedPageMarks(pdf, 2, found, 2);
    assert.equal(onTwo[0]?.rects.length, 1, "two runs on one line are one box");
    assert.deepEqual(onTwo[1]?.rects, []);
    // On another page a citation of page 2 has no box there.
    assert.deepEqual(citedPageMarks(pdf, 1, found, 2)[0]?.rects, []);
    // Its words as the viewers look for them: unchanged.
    assert.deepEqual(
      citedCitations(pdf).map((each) => [each.quote, each.page]),
      [
        ["Account Disabled Yes", 2],
        ["x y z", null],
      ],
    );
  });

  it("says in one line where a citation has no box, and names each for a screen reader", () => {
    const marks = citedMarks(
      [cite({ page: null }), cite({ page: null, quote: "y" })],
      FILE,
      [],
    );
    const none = citedPageMarks(marks, null);
    assert.equal(
      citedUnboxedLine(marks, null, none),
      "2 cited passages are listed beside the file without a box: their words were not found on this page.",
    );
    assert.equal(
      citedUnboxedLine(marks.slice(0, 1), null, none),
      "1 cited passage is listed beside the file without a box: its words were not found on this page.",
    );
    assert.equal(
      citedUnboxedLine(marks, null, [
        { id: "cited-0", rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }] },
        { id: "cited-1", rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }] },
      ]),
      null,
    );
    const [first] = marks;
    assert.ok(first !== undefined);
    assert.equal(citedName(first), "Cited 1 A1: Account Disabled Yes");
    const long = citedMarks([cite({ quote: "w ".repeat(60) })], FILE, [])[0];
    assert.ok(long !== undefined && citedName(long).endsWith("…"));
  });

  it("puts in view the mark a page asks for: by its id, or by its words", () => {
    const annotations = [
      {
        id: "00000000-0000-4000-8000-000000000201",
        quote: "Account Disabled Yes",
      },
    ];
    const cited = [{ id: "cited-0", quote: "Worker Status: Terminated" }];
    assert.equal(pickTarget(null, annotations, cited), null);
    assert.equal(pickTarget({ id: "cited-0" }, annotations, cited), "cited-0");
    assert.equal(pickTarget({ id: "cited-9" }, annotations, cited), null);
    // A citation selected elsewhere on the page: its cited mark, else the annotation that
    // marks the same words (one boxed once, above).
    assert.equal(
      pickTarget({ quote: "worker status:  terminated" }, annotations, cited),
      "cited-0",
    );
    assert.equal(
      pickTarget({ quote: "Account disabled yes." }, annotations, cited),
      annotations[0]?.id,
    );
    assert.equal(pickTarget({ quote: "  " }, annotations, cited), null);
  });

  it("is never an annotation: a file with none offers nothing to review", () => {
    const set = noAnnotations(FILE);
    assert.equal(set.canEdit, false);
    assert.deepEqual(set.annotations, []);
    assert.deepEqual(set.attributes, []);
    assert.equal(set.fileId, FILE);
  });
});

describe("each kind of file", () => {
  const view = readFileSync("apps/web/src/evidence-annotations.tsx", "utf8");
  const stages = readFileSync("apps/web/src/evidence-stages.tsx", "utf8");

  it("is drawn by its own stage under the one viewer", () => {
    // An image, a PDF, and any other file (a spreadsheet, a Word document, text) as the
    // text read from it.
    assert.equal(previewKind("capture.PNG"), "image");
    assert.equal(previewKind("ticket.pdf"), "pdf");
    for (const name of [
      "users.xlsx",
      "users.csv",
      "policy.docx",
      "notes.txt",
    ]) {
      assert.equal(previewKind(name), "text", name);
    }
    assert.match(
      view,
      /\{kind === "image" \? \(\s*<ImageStage url=\{url\} download=\{download\} name=\{file\.fileName\}>\s*\{layer\(null, \[\], true\)\}\s*<\/ImageStage>\s*\) : kind === "pdf" \? \(\s*<PdfStage/,
    );
    assert.match(
      view,
      /<TextStage\s+url=\{reading\}\s+download=\{download\}\s+citations=\{stageCitations\}/,
    );
    // The file's own routes: the preview for an image or a PDF, the read text for the
    // rest, and the original to download.
    assert.match(
      view,
      /const url = `\/workspace\/evidence-files\/\$\{file\.id\}\/preview\?\$\{query\}`;/,
    );
    assert.match(
      view,
      /const reading = `\/workspace\/evidence-files\/\$\{file\.id\}\/reading\?\$\{query\}`;/,
    );
    assert.match(
      view,
      /const download = `\/workspace\/evidence-files\/\$\{file\.id\}\?\$\{query\}`;/,
    );
  });

  it("keeps the PDF's paging and zoom, and the spreadsheet's tables", () => {
    for (const label of [
      'aria-label="Previous page"',
      'aria-label="Next page"',
      'aria-label="Zoom out"',
      'aria-label="Zoom in"',
      'title="Fit the width"',
      'type="number"',
    ]) {
      assert.ok(stages.includes(label), label);
    }
    // Forms and scripts in a PDF are never run.
    assert.match(stages, /pdfjs\.getDocument\(\{ data, enableXfa: false \}\)/);
    assert.match(stages, /<table className="table data-grid text-table">/);
    assert.match(
      stages,
      /quotes\.some\(\s*\(quote\) => findSpan\(row\.join\(" \| "\), quote\) !== null,\s*\)\s*\? "is-cited"/,
    );
  });

  it("says plainly when a file cannot be shown, with the original to download", () => {
    for (const words of [
      "This image could not be shown.",
      "This PDF could not be shown.",
      "The text of this file could not be loaded.",
      "Nothing was read from this file yet, so it cannot be shown here.",
    ]) {
      assert.ok(stages.includes(words), words);
    }
    assert.equal(stages.match(/<NotShown download=\{download\}>/g)?.length, 4);
    assert.match(
      stages,
      /<a className="btn btn-secondary btn-sm" href=\{download\}>\s*Download the file\s*<\/a>/,
    );
  });

  it("words a file shown as its text by what is marked in it", () => {
    assert.equal(textStageLine(false, false), "");
    assert.match(textStageLine(true, false), /the annotated words are marked/);
    assert.match(textStageLine(false, true), /the cited words are marked/);
    assert.match(textStageLine(true, true), /the annotated and cited words/);
  });

  it("never writes, stores or reviews a citation", () => {
    // The viewer's only calls are the annotations' read and the review's post.
    assert.equal(view.match(/fetch\(/g)?.length, 2);
    // The stages only read the file.
    for (const call of stages.match(/fetch\([^)]*\)/g) ?? []) {
      assert.match(call, /fetch\(url, \{ cache: "no-store" \}\)/);
    }
    assert.ok(!/method:/.test(stages));
    // A cited passage's callout has no review action.
    const from = view.indexOf("function CitedBasis(");
    const basis = view.slice(from, view.indexOf("\n/** Confirm & next", from));
    assert.ok(basis.length > 200);
    for (const word of ["Confirm", "onEdit", "onRemove", "act(", "run("]) {
      assert.ok(!basis.includes(word), word);
    }
  });

  it("marks a cited passage by its edge and its word too, in tokens of both themes", () => {
    const css = readFileSync("apps/web/app/evidence-annotations.css", "utf8");
    const tokens = readFileSync("apps/web/app/globals.css", "utf8");
    assert.match(
      css,
      /\.ea-tone-cited \{\s*--ea-c: var\(--warning\);\s*--ea-mark: var\(--mark-cited\);\s*\}/,
    );
    assert.match(
      css,
      /button\.ea-box\.is-cited \{\s*border-style: dashed;\s*\}/,
    );
    assert.equal(tokens.match(/--mark-cited: #a16207;/g)?.length, 2);
    assert.match(view, /\{CITED_WORDS\.label\}/);
  });
});

describe("the old viewer is retired", () => {
  const sources = [
    ...readdirSync("apps/web/src")
      .filter((name) => /\.tsx?$/.test(name))
      .map((name) => `apps/web/src/${name}`),
  ];
  const read = (path: string) => readFileSync(path, "utf8");

  it("has no file and no components left", () => {
    assert.equal(existsSync("apps/web/src/evidence-preview.tsx"), false);
    for (const path of sources) {
      const source = read(path);
      for (const name of [
        "EvidenceViewer",
        "PreviewDialog",
        "EvidencePreview",
        "AnnotatedPreview",
        "ImageViewer",
        "PdfViewer",
        "TextViewer",
      ]) {
        assert.ok(
          !new RegExp(`\\b${name}\\b`).test(source),
          `${path} names ${name}`,
        );
      }
      assert.ok(
        !/function (Viewer|Highlight)\b|<(Viewer|Highlight)\b/.test(source),
        `${path} has the old Viewer or Highlight`,
      );
    }
  });

  it("is imported by no file", () => {
    for (const path of sources) {
      assert.ok(!/from "\.\/evidence-preview(\.tsx)?"/.test(read(path)), path);
    }
  });

  it("leaves its styles behind: no highlight box, no list of sources", () => {
    const css = readdirSync("apps/web/app")
      .filter((name) => name.endsWith(".css"))
      .map((name) => read(`apps/web/app/${name}`))
      .join("\n");
    for (const selector of [
      ".hl-box",
      ".hl-tag",
      ".preview-sources",
      ".source-item",
      ".preview-body.has-sources",
      ".preview-stage.is-inline",
    ]) {
      assert.ok(!css.includes(selector), selector);
    }
  });

  it("opens every former caller's file in the one viewer", () => {
    const opener = read("apps/web/src/evidence-opener.tsx");
    for (const [path, name] of [
      ["apps/web/src/evidence-workspace-view.tsx", "PreviewButton"],
      ["apps/web/src/evidence-view.tsx", "PreviewButton"],
      ["apps/web/src/controls-view.tsx", "PreviewButton"],
      ["apps/web/src/evidence-wizard.tsx", "PreviewButton"],
      ["apps/web/src/sheet-view.tsx", "PreviewButton"],
      ["apps/web/src/evidence-dialog.tsx", "PreviewButton"],
      ["apps/web/src/evidence-dialog.tsx", "AnnotatedFile"],
      ["apps/web/src/console-chat.tsx", "AnnotatedDialog"],
      ["apps/web/src/design-workpaper-view.tsx", "AnnotatedDialog"],
    ] as const) {
      const source = read(path);
      assert.match(
        source,
        new RegExp(
          `import \\{[^}]*\\b${name}\\b[^}]*\\} from "\\./evidence-opener";`,
        ),
        path,
      );
      assert.match(source, new RegExp(`<${name}\\b`), path);
    }
    // The workpaper's pane draws the viewer itself, read only.
    assert.match(
      read("apps/web/src/design-workpaper-view.tsx"),
      /<AnnotatedEvidence\b[\s\S]{0,200}act=\{READ_ONLY\}/,
    );
    // Each opener is the one viewer, and only it.
    assert.equal(opener.match(/<AnnotatedEvidence\b/g)?.length, 2);
    assert.match(
      opener,
      /<AnnotatedDialog \{\.\.\.dialog\} onClose=\{\(\) => setOpen\(false\)\} \/>/,
    );
    // The focus goes back to what opened the dialog.
    assert.match(
      opener,
      /const previous = document\.activeElement as HTMLElement \| null;[\s\S]{0,1200}previous\?\.focus\(\);/,
    );
  });
});
