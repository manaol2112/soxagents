import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Phrases that belong to the build, not to the people using it. A page that shows one
// of these is not client-ready: environment variables, storage details, internal
// identifiers, and placeholder plurals.
const INTERNAL = [
  /MODEL_PROVIDER|MODEL_API_KEY|PREVIEW_LOGIN|GOOGLE_CLIENT/,
  /next deploy/i,
  /test mailbox/i,
  /checks? the hash|declared hash|is immutable/i,
  /OCR engine/i,
  /model provider/i,
  /Claude re-performed/,
  /control instances?\b/i,
  /registered actions/i,
  /reviewed (?:keyword )?rules/i,
  /\b(?:note|item|request|control|file)\(s\)/,
  /Secret-looking/,
  /agent definition/i,
  /managed by the platform/i,
  / tier`/,
  /\bAcme\b/,
  /\bClaude\b/,
];

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
