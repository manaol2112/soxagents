import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

// The browser does not offer to autocomplete the app's fields: every form says so. The
// public demo request and the evidence portal keep the browser's help for a visitor's
// own name, email, and one-time code.
const ROOTS = ["apps/web/src", "apps/web/app"];
const ALLOWED = new Set(["welcome-view.tsx", "portal-view.tsx"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return files(full);
    }
    return name.endsWith(".tsx") && !ALLOWED.has(name) ? [full] : [];
  });
}

/** The opening tag starting at `start`: up to the first ">" outside braces and quotes. */
function openingTag(source: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i += 1) {
    const c = source[i];
    if (quote !== null) {
      if (c === quote) {
        quote = null;
      }
    } else if (c === '"' || c === "'" || c === "`") {
      quote = c;
    } else if (c === "{") {
      depth += 1;
    } else if (c === "}") {
      depth -= 1;
    } else if (c === ">" && depth === 0) {
      return source.slice(start, i);
    }
  }
  return source.slice(start);
}

describe("autocomplete", () => {
  it("is off on every form in the app", () => {
    const missing: string[] = [];
    let forms = 0;
    for (const file of ROOTS.flatMap(files)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<form\b/g)) {
        forms += 1;
        const tag = openingTag(source, match.index ?? 0);
        if (!/autoComplete="off"/.test(tag)) {
          const line = source.slice(0, match.index).split("\n").length;
          missing.push(`${file}:${line}`);
        }
      }
    }
    assert.ok(forms > 50, `found only ${forms} forms`);
    assert.deepEqual(missing, []);
  });
});
