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
