import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  type Block,
  blocksFromDoc,
  type DocNode,
  docFromText,
  isFormatted,
  parseLine,
  parseRich,
  plainText,
  richToText,
  textFromDoc,
} from "../apps/web/src/rich-text-model.ts";

// A formatted text section (docs/design-workpaper.md, section 3.3; product owner, 15
// November 2026: "I want some formatting like bold, italic, underline"). The text is
// stored as plain text with marks. What the model must never do: read what a person typed
// as a mark they did not make, lose words on the way to the editor and back, or disagree
// with the server about which marks are marks (the shared cases). Synthetic text only.

type Case = { name: string; text: string; blocks: Block[]; plain: string };
const { cases } = JSON.parse(
  readFileSync("tests/fixtures/rich-text/cases.json", "utf8"),
) as { cases: Case[] };

const visible = (blocks: readonly Block[]) =>
  blocks.map((block) =>
    (block.type === "p" ? block.lines : block.items).map((runs) =>
      runs.map((run) => run.t).join(""),
    ),
  );

describe("the shared cases", () => {
  it("has them", () => {
    assert.ok(cases.length >= 27);
  });

  for (const item of cases) {
    it(`reads: ${item.name}`, () => {
      assert.deepEqual(parseRich(item.text), item.blocks);
      assert.equal(plainText(item.text), item.plain);
    });

    it(`writes back what it read: ${item.name}`, () => {
      const written = richToText(item.blocks);
      // The same words, the same formatting, and writing it again changes nothing.
      assert.deepEqual(visible(parseRich(written)), visible(item.blocks));
      assert.equal(richToText(parseRich(written)), written);
      assert.equal(plainText(written), plainText(item.text));
    });

    it(`goes to the editor and back: ${item.name}`, () => {
      const doc = docFromText(item.text);
      assert.equal(doc.type, "doc");
      assert.ok((doc.content ?? []).length >= 1);
      const back = textFromDoc(doc);
      assert.equal(back, richToText(item.blocks));
      assert.deepEqual(visible(parseRich(back)), visible(item.blocks));
    });
  }
});

describe("what a person types is what is read back", () => {
  const typed = (
    text: string,
    marks: Array<"bold" | "italic" | "underline"> = [],
  ) =>
    ({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            marks.length === 0
              ? { type: "text", text }
              : { type: "text", text, marks: marks.map((type) => ({ type })) },
          ],
        },
      ],
    }) satisfies DocNode;

  it("never turns typed characters into formatting", () => {
    for (const text of [
      "a **b** c",
      "''quoted''",
      "C++ and ++x++",
      "**",
      "*",
      "'",
      "it's the users' role",
      "5 * 3 ** 2",
      "- not an item",
      "12. not an item",
      "C:\\Users\\dlee\\.ssh\\*",
      "a\\",
      "\\*\\*",
      "ends with a star*",
      "+starts with a plus",
      "[^1] and _under_score_",
    ]) {
      const stored = textFromDoc(typed(text));
      const read = parseRich(stored);
      assert.deepEqual(visible(read), [[text]], `${text} -> ${stored}`);
      assert.equal(isFormatted(stored), false, stored);
      assert.equal(plainText(stored), text, stored);
    }
  });

  it("keeps typed mark characters plain inside and beside formatting", () => {
    for (const text of ["a**b", "*", "x''", "++", "\\", "a\\"]) {
      for (const marks of [
        ["bold"],
        ["italic"],
        ["underline"],
        ["bold", "italic", "underline"],
      ] as const) {
        const doc: DocNode = {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "before*" },
                { type: "text", text, marks: marks.map((type) => ({ type })) },
                { type: "text", text: "'after" },
              ],
            },
          ],
        };
        const stored = textFromDoc(doc);
        const [block] = parseRich(stored);
        assert.ok(block !== undefined && block.type === "p", stored);
        const runs = block.lines[0] ?? [];
        assert.equal(
          runs.map((run) => run.t).join(""),
          `before*${text}'after`,
          stored,
        );
        const middle = runs.find((run) => run.t === text);
        assert.ok(middle !== undefined, stored);
        assert.equal(
          middle.b === true,
          marks.includes("bold" as never),
          stored,
        );
        assert.equal(
          middle.i === true,
          marks.includes("italic" as never),
          stored,
        );
        assert.equal(
          middle.u === true,
          marks.includes("underline" as never),
          stored,
        );
        assert.equal(runs[0]?.b ?? runs[0]?.i ?? runs[0]?.u, undefined, stored);
      }
    }
  });

  it("puts the spaces at the ends of a formatted stretch outside its marks", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "A " },
            { type: "text", text: " bold  ", marks: [{ type: "bold" }] },
            { type: "text", text: "word" },
          ],
        },
      ],
    };
    assert.equal(textFromDoc(doc), "A  **bold**  word");
    assert.deepEqual(parseLine("A  **bold**  word"), [
      { t: "A  " },
      { t: "bold", b: true },
      { t: "  word" },
    ]);
  });

  it("reads lists, line breaks and what the editor may hold besides", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        { type: "paragraph" },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "one" },
            { type: "hardBreak" },
            { type: "hardBreak" },
            { type: "text", text: "two", marks: [{ type: "strike" }] },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "first" }],
                },
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "still first" }],
                },
                {
                  type: "orderedList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "inner" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            { type: "listItem", content: [{ type: "paragraph" }] },
          ],
        },
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "1. typed" }],
                },
              ],
            },
          ],
        },
        {
          type: "heading",
          content: [{ type: "text", text: "A heading is its words" }],
        },
      ],
    };
    // Lists are not nested, an empty item or paragraph is not written, a mark this page
    // does not keep is dropped, and an unknown block is read for its words.
    assert.equal(
      textFromDoc(doc),
      "one\ntwo\n\n- first still first\n- inner\n\n1. 1\\. typed\n\nA heading is its words",
    );
    assert.deepEqual(blocksFromDoc(docFromText("")), [
      { type: "p", lines: [[]] },
    ]);
    assert.equal(textFromDoc(docFromText("")), "");
  });

  it("stays fast on text made to be slow", () => {
    const started = Date.now();
    for (const text of [
      "*".repeat(12_000),
      "**a ".repeat(3_000),
      "**''++".repeat(2_000),
      `${"**x".repeat(3_000)}**`,
      "\\".repeat(12_000),
    ]) {
      parseRich(text);
      plainText(text);
      richToText(parseRich(text));
    }
    assert.ok(Date.now() - started < 2_000, String(Date.now() - started));
  });
});
