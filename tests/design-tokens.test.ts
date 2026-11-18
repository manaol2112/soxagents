import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * The workspace's look stays on the design system (product owner, 17 November 2026: "I like
 * shadcn/ui. Please implement that across."). Every workspace stylesheet sizes text with the
 * type scale, weighs it 400, 500 or 600, rounds corners with the radius scale, and sets one
 * typeface. A value off the system fails here, so screens cannot drift apart again. The
 * public landing and sign-in pages keep their own marketing styles (docs/design-system.md).
 */

const DIR = new URL("../apps/web/app/", import.meta.url);
const MARKETING = new Set(["welcome.css", "sign-in.css"]);
const sheets = readdirSync(DIR)
  .filter((name) => name.endsWith(".css") && !MARKETING.has(name))
  .map((name) => ({
    name,
    css: readFileSync(new URL(name, DIR), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    ),
  }));

/** The rgb() and rgba() colours still hand-typed outside globals.css (17 November 2026). */
const RGB_LIMIT = 18;

/** Each declaration of a property, as "file: value". */
function values(property: RegExp): string[] {
  return sheets.flatMap(({ name, css }) =>
    [...css.matchAll(property)].map((m) => `${name}: ${m[1]?.trim()}`),
  );
}

describe("the workspace stays on the design system", () => {
  it("reads the stylesheets", () => {
    assert.ok(sheets.length >= 30, `${sheets.length} stylesheets`);
  });

  it("sizes text with the type scale, never a hand-typed pixel size", () => {
    const off = values(/font-size:\s*([^;]+);/g).filter((entry) =>
      /\d(?:\.\d+)?px\b/.test(entry.split(": ")[1] ?? ""),
    );
    assert.deepEqual(off, []);
  });

  it("weighs text 400, 500 or 600", () => {
    const off = values(/font-weight:\s*([^;]+);/g).filter(
      (entry) =>
        !/^(400|500|600|inherit|normal)(\s*!important)?$/.test(
          entry.split(": ")[1] ?? "",
        ),
    );
    assert.deepEqual(off, []);
  });

  it("rounds corners with the radius scale (a hairline under 4px and a full pill aside)", () => {
    // 17 November 2026 (shadcn/ui, product owner): the rule also reads rem and em. Before,
    // it checked px alone, so a corner of 1.6rem (the console's composer) passed; now a rem
    // or em corner of 4px or more (at 16px to the rem) fails unless it is a full pill.
    const off = values(/border(?:-[a-z]+)*-radius:\s*([^;]+);/g).filter(
      (entry) =>
        (entry.split(": ")[1] ?? "").split(/\s+/).some((part) => {
          const px = /^(\d+(?:\.\d+)?)px$/.exec(part);
          if (px !== null) {
            return Number(px[1]) >= 4 && Number(px[1]) < 20;
          }
          const rem = /^(\d*\.?\d+)r?em$/.exec(part);
          return (
            rem !== null &&
            Number(rem[1]) * 16 >= 4 &&
            Number(rem[1]) * 16 < 999
          );
        }),
    );
    assert.deepEqual(off, []);
  });

  it("sets one typeface in the workspace: no serif", () => {
    const off = values(/font-family:\s*([^;]+);/g).filter((entry) =>
      /serif\b|georgia|times/i.test(
        entry.split(": ")[1]?.replace(/sans-serif/gi, "") ?? "",
      ),
    );
    assert.deepEqual(off, []);
    const globals =
      sheets.find((sheet) => sheet.name === "globals.css")?.css ?? "";
    assert.match(globals, /--font-display:\s*var\(--font-ui\)/);
    assert.match(globals, /--font-ui:\s*var\(--font-sans\)/);
  });

  it("marks state with fill and border, never a coloured stripe", () => {
    // The colours the owner decided carry meaning keep their stripe: review-note
    // criticality (docs/workpaper-review.md, section 6) and the evidence annotation marks.
    const meaningful = new Set([
      "review-notes.css",
      "evidence-annotations.css",
    ]);
    const off = sheets
      .filter((sheet) => !meaningful.has(sheet.name))
      .flatMap(({ name, css }) =>
        [
          ...css.matchAll(/border-left:\s*([3-9]px[^;]*);/g),
          ...css.matchAll(/box-shadow:[^;]*\b(inset\s+[2-9]px\s+0\s+0[^,;]*)/g),
        ]
          .map((m) => `${name}: ${m[1]}`)
          .filter((entry) => !entry.includes("var(--dw-c")),
      );
    assert.deepEqual(off, []);
  });

  it("adds no colour outside the tokens (113 older ones, to be moved onto tokens)", () => {
    const stray = sheets
      .filter((sheet) => sheet.name !== "globals.css")
      .reduce(
        (sum, sheet) =>
          sum + (sheet.css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length,
        0,
      );
    // A ratchet: the count only goes down.
    assert.ok(stray <= 113, `${stray} hand-typed colours outside globals.css`);
  });

  it("adds no rgb() colour outside the tokens (a ratchet, as the hex count above)", () => {
    // 17 November 2026 (shadcn/ui, product owner): the colour ratchet counted hex alone,
    // so a hand-typed rgb() or rgba() shadow or tint passed. This counts those too; the
    // limit is the count after the shell and shared-component sweep, and only goes down.
    const stray = sheets
      .filter((sheet) => sheet.name !== "globals.css")
      .reduce(
        (sum, sheet) => sum + (sheet.css.match(/\brgba?\(/g) ?? []).length,
        0,
      );
    assert.ok(
      stray <= RGB_LIMIT,
      `${stray} hand-typed rgb() colours outside globals.css`,
    );
  });
});
