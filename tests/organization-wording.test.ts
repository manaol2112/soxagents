import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// The product says "the organization", never "the client" (product owner, 13 November 2026:
// "I don't want to say the client. Cause internal audit may use this tool and they are not
// pertaining to their org as client."). Code names (the API client, "use client", client_id,
// routes such as /workspace/clients) are not copy and are not checked.

const ROOTS = ["../apps/web/src/", "../apps/web/app/"].map((path) =>
  fileURLToPath(new URL(path, import.meta.url)),
);

/** "client" written as prose: after an article or preposition, possessive, or as a label. */
const PROSE = [
  /\b(?:the|a|an|your|each|every|this|that|no|which|for|to|with|from|by|of|per|and|or|new|one)\s+clients?\b(?![-_.(])/i,
  /\bclients?(?:'s|&apos;s|’s|s')/i,
  /(?:>|["'`])\s*Clients?\b(?![-_.(/])/,
  /\bClients?\s+(?:[a-z]+)\b/,
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|mts)$/.test(name) ? [path] : [];
  });
}

/** The file's copy: no comments, no imports, no directives. */
function copyOf(source: string): string {
  return source
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*\*.*$/gm, "")
    .replace(/^\s*import\s[\s\S]*?from\s+["'][^"']+["'];?$/gm, "")
    .replace(/["']use client["'];?/g, "");
}

describe("the product says the organization, not the client", () => {
  const files = ROOTS.flatMap(sources);

  it("finds the web sources", () => {
    assert.ok(files.length > 50);
  });

  for (const file of files) {
    const name = file.slice(file.indexOf("apps/web/"));
    it(`${name} never calls the organization "the client"`, () => {
      const lines = copyOf(readFileSync(file, "utf8")).split("\n");
      const found = lines.filter((line) =>
        PROSE.some((pattern) => pattern.test(line)),
      );
      assert.deepEqual(
        found.map((line) => line.trim()),
        [],
      );
    });
  }
});
