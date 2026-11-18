import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Product owner, 14 November 2026: "I'm clicking the select the folder that's why PNG are
// not showing up. That button is confusing. Can you also add another button that shows
// select file in addition to select folder?" A folder picker greys out single files; the
// drop zone offers files first, then a folder, each with its own input.

const view = readFileSync(
  new URL("../apps/web/src/evidence-wizard.tsx", import.meta.url),
  "utf8",
);

describe("the D&I evidence wizard's pickers", () => {
  it("offers Choose files before Choose a folder", () => {
    // The buttons' own labels, each alone on its line (not a comment that names them).
    const files = view.search(/\n\s*Choose files\n/);
    const folder = view.search(/\n\s*Choose a folder\n/);
    assert.ok(files > 0 && folder > files, "Choose files comes first");
    assert.match(
      view,
      /onClick=\{\(\) => filesInput\.current\?\.click\(\)\}\s*>\s*<UiIcon name="file" size=\{13\} \/>\s*Choose files/,
    );
  });

  it("only the folder input picks folders; the files input takes any file", () => {
    assert.match(
      view,
      /folderInput\.current\?\.setAttribute\("webkitdirectory", ""\)/,
    );
    assert.doesNotMatch(
      view,
      /filesInput\.current\?\.setAttribute\("webkitdirectory"/,
    );
    const filesInput = view.slice(view.indexOf("ref={filesInput}"));
    const tag = filesInput.slice(0, filesInput.indexOf("/>"));
    assert.doesNotMatch(tag, /accept=/, "no file type is greyed out");
  });
});

describe("a file that needs placing can also be removed (product owner, 14 November 2026)", () => {
  // "Right now the only option is to classify it. What if the user decides that's not
  // needed in this control?" A file waiting to be placed offered only Place file; Remove
  // was reachable only from the Move menu of a file already placed or kept out.
  it("offers Remove beside Place file, through the existing withdrawal", () => {
    // One label wherever the window offers it.
    assert.match(view, /const REMOVE_LABEL = "Remove from this upload";/);
    assert.match(view, /label: REMOVE_LABEL,/);
    // The row that needs a person passes the wizard's own remove to the chooser.
    assert.match(
      view,
      /onPlace=\{\(choice\) => wizard\.place\(line, choice\)\}\s*remove=\{\s*line\.fileId === null\s*\? undefined\s*: \{\s*onRemove: \(\) => wizard\.remove\(line\.fileId\),\s*unavailable: line\.movable \? null : STILL_READING_FILE,/,
    );
    // The press only opens the existing withdrawal form (its reason, its custody record
    // kept): the chooser itself sends nothing.
    const start = view.indexOf("function Choose(");
    const chooser = view.slice(start, view.indexOf("function SuggestionView("));
    assert.ok(start > 0 && chooser.length > 0);
    assert.match(chooser, /onClick=\{remove\.onRemove\}/);
    assert.doesNotMatch(chooser, /fetch\(|<form|method=/);
    assert.match(view, /view\.removing === line\.fileId \? \(\s*<Withdraw /);
    assert.match(view, /start="withdraw"/);
    // A real, named button, quiet beside the row's main action, off while the file is
    // still being read.
    assert.match(
      chooser,
      /className="btn btn-ghost btn-sm wz-choose-remove"\s*disabled=\{busy \|\| remove\.unavailable !== null\}/,
    );
    assert.match(chooser, /aria-label=\{`\$\{REMOVE_LABEL\}: \$\{name\}`\}/);
  });
});
