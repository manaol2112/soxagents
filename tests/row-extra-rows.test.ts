import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

// A form or a detail opened under a table's row is a full-width row. Drawn as a bare
// `<td colSpan>` it is as wide as the table, so where the table is wider than its
// sideways-scrolling box (a phone, a narrow panel) the form is cut off at the box's edge
// and moves away with the scroll. The shared row (RowExtra, src/row-extra.tsx, and
// .row-extra in globals.css) sizes its body to the scroll box and keeps it in view
// (owner, 18 November 2026: the Planning page's detail rows and the Controls page's row
// detail, after the same defect on the Withdrawn list). Measured in a browser at 390 and
// 1440 px; this check keeps a bare full-width row from coming back.

const src = new URL("../apps/web/src/", import.meta.url);
const app = new URL("../apps/web/app/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, src), "utf8");
const css = readdirSync(app)
  .filter((name) => name.endsWith(".css"))
  .map((name) => readFileSync(new URL(name, app), "utf8"))
  .join("\n");

type Row = { file: string; head: string };

/** Every row whose first cell with content spans columns: `<tr>`, any empty `<td />`
    indent cells, then `<td colSpan>`. `head` runs from `<tr` to the spanning cell's tag. */
function fullWidthRows(file: string, text: string): Row[] {
  const rows: Row[] = [];
  // A spanning cell with content: an empty `<td colSpan={2} />` is an indent cell.
  for (const cell of text.matchAll(/<td\b[^>]*\bcolSpan=[^>]*[^/]>/g)) {
    const at = cell.index ?? 0;
    const before = text.slice(0, at);
    const tr = Math.max(
      before.lastIndexOf("<tr>"),
      before.lastIndexOf("<tr "),
      before.lastIndexOf("<tr\n"),
    );
    if (tr < 0) {
      continue;
    }
    const between = text.slice(tr, at);
    // A cell with content before it closes: the spanning cell is not the row's first.
    if (/<\/t[dh]>/.test(between)) {
      continue;
    }
    rows.push({ file, head: text.slice(tr, at + cell[0].length) });
  }
  return rows;
}

// Full-width rows that are not RowExtra, each with its reason. A converted row is removed
// from this list; a new one is not added without the owner.
const KNOWN: Array<{
  file: string;
  marker: string;
  count: number;
  why: string;
}> = [
  {
    file: "design-workpaper-view.tsx",
    marker: 'className="dw-point-tr"',
    count: 2,
    why: "a point under a row: kept in the scroll box by its own sticky rule (.dw-table-wrap .dw-point-tr > td > .dw-points); to be moved to RowExtra",
  },
  {
    file: "scope-table.tsx",
    marker: 'className="st-detail"',
    count: 1,
    why: "outstanding (18 November 2026): a system's detail in a sideways scroller (.st-scroll), not converted in the Planning and Controls change",
  },
  {
    file: "section-editor.tsx",
    marker: 'className="dw-quiet"',
    count: 1,
    why: "an empty table's one-line notice, not a form",
  },
];

describe("full-width rows under a table's row", () => {
  it("are the shared row, apart from the listed ones", () => {
    const files = readdirSync(src).filter(
      (name) => name.endsWith(".tsx") && name !== "row-extra.tsx",
    );
    const found = files.flatMap((file) => fullWidthRows(file, read(file)));
    const left = found.filter(
      (row) =>
        !KNOWN.some(
          (known) => known.file === row.file && row.head.includes(known.marker),
        ),
    );
    assert.deepEqual(
      left.map((row) => `${row.file}: ${row.head.replace(/\s+/g, " ")}`),
      [],
      "a full-width row drawn as a bare <td colSpan>: use RowExtra (src/row-extra.tsx)",
    );
    for (const known of KNOWN) {
      assert.equal(
        found.filter(
          (row) => row.file === known.file && row.head.includes(known.marker),
        ).length,
        known.count,
        `${known.file} ${known.marker}: update the list (${known.why})`,
      );
    }
  });

  it("finds a bare row, with or without an indent cell", () => {
    // The two shapes the Planning page used before 18 November 2026.
    const indented = `<tr className="pp-detail">\n  <td />\n  <td colSpan={8}>\n`;
    const two = `<tr className="pp-detail">\n  <td colSpan={2} />\n  <td colSpan={6}>\n`;
    const bare = `<tr className="cpg-detail-row">\n  <td colSpan={TABLE_COLUMNS}>\n`;
    const cell = `<tr>\n  <td>One</td>\n  <td colSpan={3}>\n`;
    assert.equal(fullWidthRows("x", indented).length, 1);
    assert.equal(fullWidthRows("x", two).length, 1);
    assert.equal(fullWidthRows("x", bare).length, 1);
    assert.equal(fullWidthRows("x", cell).length, 0);
  });

  it("on Planning and Controls span every column of a table whose parent scrolls", () => {
    for (const [file, scroll] of [
      ["planning-view.tsx", "pp-scroll"],
      ["controls-page.tsx", "cpg-scroll"],
    ] as const) {
      const text = read(file);
      const extras = [
        ...text.matchAll(
          /<RowExtra\s+columns=\{([^}]+)\}\s+className="([^"]+)"/g,
        ),
      ];
      assert.ok(extras.length > 0, file);
      for (const extra of extras) {
        const at = extra.index ?? 0;
        // The row's table: the one it is written in, or, for a row drawn by a function
        // of its own (the Controls page's), the next one.
        const open = text.lastIndexOf("<table", at);
        const table =
          open >= 0 && text.indexOf("</table>", open) > at
            ? open
            : text.indexOf("<table", at);
        assert.ok(table >= 0, `${file}: ${extra[2]} has a table`);
        // The table's parent is its scroll box: the box RowExtra's body is measured
        // against (`:has(> table > tbody > tr.row-extra)` in globals.css).
        assert.ok(
          new RegExp(`<div className="${scroll}">\\s*$`).test(
            text.slice(0, table),
          ),
          `${file}: ${extra[2]} is in a table whose parent is .${scroll}`,
        );
        const head = text.slice(table, text.indexOf("</thead>", table));
        const columns = (head.match(/<th scope="col"/g) ?? []).length;
        const given =
          extra[1] === "TABLE_COLUMNS"
            ? Number(/const TABLE_COLUMNS = (\d+);/.exec(text)?.[1])
            : Number(extra[1]);
        assert.equal(given, columns, `${file}: ${extra[2]} spans every column`);
      }
      assert.match(
        css,
        new RegExp(`\\.${scroll} \\{[^}]*overflow-x: auto;`),
        `${scroll} scrolls sideways`,
      );
    }
    // The Planning rows' indent, once a cell of its own, is the body's padding, so the body
    // spans the scroll box rather than the box less the indent.
    assert.match(
      css,
      /\.pp-detail \.row-extra-body \{\n {2}padding: 0 0\.3rem 0 1\.8rem;/,
    );
    assert.match(css, /\.cpg-detail-row \.row-extra-body \{\n {2}padding: 0;/);
  });
});
