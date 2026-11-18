import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

// Product owner, 17 November 2026: the "System name" field in Add system turned black on
// hover. The global button hover is the primary fill (black in light, white in dark). Written
// as `button:hover` it outweighed a component's own resting rule, so every button restyled by
// its own class — a field, a link, a chip — took the primary fill on hover unless it repeated
// a hover of its own (29 did not). Written as `:where(button):hover` it weighs no more than a
// single class, and a component's rule, loaded after globals.css, keeps its own look. These
// tests hold that, so the leak cannot come back one button at a time.

const app = join(import.meta.dirname, "..", "apps", "web", "app");
const read = (name: string) =>
  readFileSync(join(app, name), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
const globals = read("globals.css");
const sheets = readdirSync(app).filter((name) => name.endsWith(".css"));

// A selector list split at its top-level commas only (not inside :is(), :not() …).
function selectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of list) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current.trim());
  return parts.filter(Boolean);
}

function rules(css: string): { selector: string; body: string }[] {
  return [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].flatMap((match) =>
    selectors(match[1] ?? "").map((selector) => ({
      selector,
      body: match[2] ?? "",
    })),
  );
}

const paints = (body: string) =>
  /(^|;|\s)(background(-color)?|color|border-color)\s*:/.test(body);

describe("a restyled button keeps its own look on hover", () => {
  it("the primary hover is written at the lowest weight, :where(button):hover", () => {
    const primary = rules(globals).filter(
      ({ selector, body }) =>
        /:hover/.test(selector) &&
        /var\(--accent-hover\)/.test(body) &&
        /(^|\s|,)(:where\()?button\)?:hover$/.test(selector),
    );
    assert.deepEqual(
      primary.map((rule) => rule.selector),
      [":where(button):hover"],
    );
  });

  it("no stylesheet paints every button on hover with a bare `button:hover`", () => {
    const bare = sheets.flatMap((name) =>
      rules(read(name))
        .filter(
          ({ selector, body }) =>
            /^button(:not\([^)]*\))*:hover(:not\([^)]*\))*$/.test(selector) &&
            paints(body),
        )
        .map(({ selector }) => `${name}: ${selector}`),
    );
    assert.deepEqual(bare, []);
  });

  it("the System name field, the owner's report, keeps the field's surface on hover", () => {
    const field = rules(read("controls-setup.css")).find(
      ({ selector }) => selector === ".snf-trigger:hover",
    );
    assert.ok(field);
    assert.match(field.body, /background:\s*var\(--surface\)/);
    assert.match(field.body, /border-color:\s*var\(--border-control\)/);
  });
});
