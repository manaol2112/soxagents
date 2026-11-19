import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { INTERNAL } from "./copy-rules.ts";

const VIEWS = new URL("../apps/web/src/", import.meta.url);

/** The visible text of a view: string literals and JSX text, without comments. */
function copyOf(source: string): string {
  // Only real comments: a block comment that opens a line, a JSX comment, a line
  // comment. A "/*" inside a string, such as accept="image/*", is copy, not a comment.
  return source
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("client-facing copy", () => {
  const files = readdirSync(VIEWS).filter((name) => name.endsWith(".tsx"));

  it("finds the views to check", () => {
    assert.ok(files.length > 10);
  });

  for (const name of files) {
    it(`${name} shows no internal or developer wording`, () => {
      const text = copyOf(readFileSync(new URL(name, VIEWS), "utf8"));
      for (const pattern of INTERNAL) {
        const match = text.match(pattern);
        assert.equal(
          match,
          null,
          `${name} shows "${match?.[0] ?? ""}" (${pattern})`,
        );
      }
    });
  }
});
