import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// The Planning page's rows (design review, 18 November 2026): a refusal shows on the row
// it refused, in the danger tone, until the next edit; a zero reads neutral; at 390 px an
// open row is not a tall narrow column; the evidence detail under the compact table's row
// keeps only what the row does not show (product owner, "remove the repetition").

const view = readFileSync(
  new URL("../apps/web/src/planning-view.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../apps/web/app/control-plan.css", import.meta.url),
  "utf8",
);
const slice = (from: string, to: string) =>
  view.slice(view.indexOf(from), view.indexOf(to, view.indexOf(from)));

describe("the Planning page's row feedback", () => {
  it("shows an attribute's refusal in the form that caused it, never at the section's top", () => {
    // The wording's refusal showed above the table as `form-error`, a class no
    // stylesheet defines (body text, not the danger tone), whatever was open.
    assert.doesNotMatch(view, /className="form-error"/);
    assert.doesNotMatch(view, /\{change\.problem !== null \? \(/);
    const wording = slice(
      'className="pa-wording"',
      "{isOpen ? (\n                      <RowExtra",
    );
    assert.match(
      wording,
      /<Problem text=\{problemAt\(`edit:\$\{item\.id\}`\)\} \/>/,
    );
    // Cleared on the next edit.
    assert.match(wording, /onChange=\{\(event\) => \{\s*clearProblem\(\);/);
    assert.match(view, /<Problem text=\{problemAt\("add"\)\} \/>/);
    // Changed 19 November 2026 (E1 design review, round 6). Old: the removal's refusal
    // under a confirm bar at the section's top. New: in the confirm on the attribute's
    // own row (RemoveAttributeConfirm).
    assert.match(view, /problem=\{problemAt\(`retire:\$\{item\.id\}`\)\}/);
    assert.match(view, /<Problem text=\{problem\} \/>/);
  });

  it("shows an evidence item's removal refusal on the item, an undo's by the undo", () => {
    assert.doesNotMatch(view, /removal\.action\.problem/);
    assert.match(view, /<Problem text=\{removal\.problemAt\("undo"\)\} \/>/);
    assert.match(view, /<Problem text=\{removal\.problemAt\(item\.id\)\} \/>/);
    // The compact table's menu opens the item it refused.
    assert.match(
      view,
      /removal\.remove\(item\)\.then\(\(ok\) => \{\s*if \(!ok\) \{\s*toggle\(row\.id, true\);/,
    );
  });

  it("keeps under the compact table's row only what the row does not show", () => {
    const body = slice("function EvidenceBody(", "function EvidenceTable(");
    assert.match(
      body,
      /underRow \? null : \(\s*<>\s*<span className="pp-pill">\{row\.typeLabel\}/,
    );
    assert.match(body, /underRow \? null : \(\s*<Mark/);
    const table = slice("function EvidenceTable(", "// History");
    assert.match(table, /onSelect=\{onSelect\}\s*underRow\s*\/>/);
  });

  it("reads a zero neutral, and says why a form's button is off", () => {
    assert.match(
      view,
      /className=\{`pr-review\$\{readiness\.warnZero \? " is-none" : ""\}`\}/,
    );
    assert.match(
      css,
      /\.pr-ready\.is-none,\n\.pr-review\.is-none \{\n {2}color: var\(--text-strong\);/,
    );
    const remove = slice(
      'mode === "remove" ? (',
      "<Problem text={action.problem} />",
    );
    assert.match(remove, /hint="At least 10 characters\."/);
    assert.match(
      remove,
      /note="Removing revises the plan; an approved plan goes back for review\."/,
    );
  });

  it("keeps an open row's text column two lines where the table scrolls, the text in its detail", () => {
    // The narrow rules come after the rules they override, in the file's last block: a
    // container query adds no weight, so placed earlier they lost to the open row's
    // unclamped text and to `.pp-detail-text { display: none }` (found in the browser
    // check, 18 November 2026).
    const at = css.lastIndexOf("@container (max-width: 639.98px) {");
    const narrow = css.slice(at);
    assert.ok(at > css.indexOf(".pp-row.is-open .pp-text strong,\n.pp-row"));
    assert.ok(at > css.indexOf("\n.pp-detail-text {"));
    assert.match(
      narrow,
      /\.pp-row\.is-open \.pp-text strong,\n {2}\.pp-row\.is-open \.pp-text small \{\n {4}display: -webkit-box;\n {4}-webkit-line-clamp: 2;/,
    );
    assert.match(narrow, /\.pp-detail-text \{\n {4}display: grid;/);
    assert.match(css, /\n\.pp-detail-text \{\n {2}display: none;/);
    assert.equal(view.match(/<div className="pp-detail-text">/g)?.length, 2);
    // The wording grows with what it holds, within reason.
    assert.match(
      css,
      /\.pl-edit textarea\.pa-wording \{[^}]*max-height: 12rem;[^}]*field-sizing: content;/,
    );
  });
});
