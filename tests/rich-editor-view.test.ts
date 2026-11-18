import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parseRich, plainText } from "../apps/web/src/rich-text-model.ts";

// Formatting in a text section (docs/design-workpaper.md, section 3.3; product owner, 15
// November 2026), read from the screen's own files. What must hold however the box and
// its toolbar look: only the formats the workpaper's text has are on; the box says and
// takes the stored text, never HTML; nothing here sets HTML; the text section alone has
// the formatted box (a cell and a note stay plain); and every place that shows a text
// section shows it through the one reader. How it behaves in a browser (typing, pasting,
// the caret, the saved body) is the browser check's, not this file's.

const read = (path: string) => readFileSync(path, "utf8");
const box = read("apps/web/src/rich-editor.tsx");
const reader = read("apps/web/src/rich-text.tsx");
const editors = read("apps/web/src/section-editor.tsx");
const view = read("apps/web/src/design-workpaper-view.tsx");
const card = read("apps/web/src/workpaper-view.tsx");
const css = read("apps/web/app/design-workpaper.css");
const globals = read("apps/web/app/globals.css");

/** A function's source: from its declaration to the next top-level one. */
const component = (source: string, name: string) => {
  const from = source.search(
    new RegExp(`\\n(?:export )?(?:async )?function ${name}\\b`),
  );
  assert.ok(from >= 0, name);
  const next = source
    .slice(from + 1)
    .search(/\n(?:export )?(?:async )?(?:function |const [A-Z_]+\b|type )/);
  return source.slice(from, next < 0 ? undefined : from + 1 + next);
};

const count = (source: string, pattern: RegExp) =>
  source.match(pattern)?.length ?? 0;

/** What of the kit stays on, and what is switched off. Together they are everything the
 * installed kit can register: a kit that grows is noticed here. */
const ON = [
  "bold",
  "bulletList",
  "document",
  "hardBreak",
  "italic",
  "listItem",
  "listKeymap",
  "orderedList",
  "paragraph",
  "text",
  "underline",
  "undoRedo",
];
const OFF = [
  "blockquote",
  "code",
  "codeBlock",
  "dropcursor",
  "gapcursor",
  "heading",
  "horizontalRule",
  "link",
  "strike",
  "trailingNode",
];

describe("nothing sets HTML", () => {
  it("builds elements only, in the box, the reader, the editors, the views and the card", () => {
    for (const [name, source] of [
      ["rich-editor.tsx", box],
      ["rich-text.tsx", reader],
      ["section-editor.tsx", editors],
      ["design-workpaper-view.tsx", view],
      ["workpaper-view.tsx", card],
    ] as const) {
      assert.ok(
        !/dangerouslySetInnerHTML|\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment/.test(
          source,
        ),
        name,
      );
    }
  });

  it("gives the editor a document and takes one back: never an HTML string", () => {
    // The start and every later text go in as the model's document.
    assert.match(
      box,
      /const doc = docFromText\(value\);\s*return \{ doc, value, written: textFromDoc\(doc\) \};/,
    );
    assert.match(box, /content: start\.doc,/);
    assert.match(
      box,
      /const written = \(editor: Editor\) => textFromDoc\(editor\.getJSON\(\) as DocNode\);/,
    );
    assert.ok(!/getHTML\(|getText\(/.test(box));
    assert.equal(count(box, /setContent\(/g), 1);
    assert.match(box, /\.setContent\(doc, \{ emitUpdate: false \}\)/);
  });

  it("reads a text that looks like markup as that text", () => {
    for (const text of [
      "<img src=x onerror=alert(1)>",
      "&lt;b&gt; &amp; <script>alert(1)</script>",
      '<a href="javascript:alert(1)">x</a>',
    ]) {
      assert.deepEqual(parseRich(text), [
        { type: "p", lines: [[{ t: text }]] },
      ]);
      assert.equal(plainText(text), text);
    }
    // And the reader puts a run's words on the page as a child, nowhere else.
    assert.match(
      component(reader, "Runs"),
      /let made: ReactNode = cite \? cited\(run\.t\) : run\.t;/,
    );
    assert.equal(count(reader, /run\.t\b/g), 2);
  });
});

describe("what is on", () => {
  it("takes the kit and switches off everything a workpaper's text does not have", () => {
    const configured =
      /const EXTENSIONS = \[\s*StarterKit\.configure\(\{([^}]*)\}\),\s*\];/.exec(
        box,
      );
    assert.ok(configured);
    const options = [...(configured[1] ?? "").matchAll(/(\w+): (\w+),/g)].map(
      (match) => [match[1], match[2]],
    );
    assert.deepEqual(
      options,
      OFF.map((name) => [name, "false"]),
    );
    assert.match(box, /extensions: EXTENSIONS,/);
    assert.equal(count(box, /extensions:/g), 1);
  });

  it("adds no extension of its own: the kit, the React binding and the editor's own parts", () => {
    const imported = [...box.matchAll(/from "(@tiptap\/[^"]+)";/g)].map(
      (match) => match[1],
    );
    assert.deepEqual(imported.sort(), [
      "@tiptap/pm/history",
      "@tiptap/react",
      "@tiptap/starter-kit",
    ]);
    assert.ok(
      !/\.extend\(|Extension\.create|Node\.create|Mark\.create/.test(box),
    );
    for (const source of [reader, editors, view, card]) {
      assert.ok(!source.includes("@tiptap/"));
    }
  });

  it("accounts for every extension the installed kit can register", () => {
    const types = "apps/web/node_modules/@tiptap/starter-kit/dist/index.d.ts";
    assert.ok(existsSync(types), `${types}: run pnpm install`);
    const kit =
      /export interface StarterKitOptions \{([\s\S]*?)\n\}/.exec(
        read(types),
      )?.[1] ?? "";
    const known = [...kit.matchAll(/\n {2}(\w+): /g)].map((match) => match[1]);
    assert.deepEqual([...known].sort(), [...ON, ...OFF].sort());
  });

  it("is made in the browser, with the product's own styles, and turns no typed mark into formatting", () => {
    assert.match(box, /^"use client";/);
    assert.match(box, /immediatelyRender: false,/);
    assert.match(box, /injectCSS: false,/);
    assert.match(box, /enableInputRules: false,/);
    assert.match(box, /enablePasteRules: false,/);
  });

  it("pins the editor to one exact version, in the manifest and in the lockfile", () => {
    const manifest = JSON.parse(read("apps/web/package.json")) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...manifest.dependencies, ...manifest.devDependencies };
    assert.deepEqual(
      Object.entries(all)
        .filter(([name]) => name.startsWith("@tiptap/"))
        .sort(),
      [
        ["@tiptap/pm", "3.32.2"],
        ["@tiptap/react", "3.32.2"],
        ["@tiptap/starter-kit", "3.32.2"],
      ],
    );
    const locked = new Set(
      [
        ...read("pnpm-lock.yaml").matchAll(/@tiptap\/[a-z-]+@(\d+\.\d+\.\d+)/g),
      ].map((match) => match[1]),
    );
    assert.deepEqual([...locked], ["3.32.2"]);
  });
});

describe("the box", () => {
  const main = component(box, "RichTextBox");

  it("is a named, multi-line textbox with the look of the box it stands for", () => {
    assert.match(
      main,
      /attributes: \{\s*role: "textbox",\s*"aria-multiline": "true",\s*"aria-label": label,\s*"aria-readonly": readOnly \? "true" : "false",\s*\.\.\.\(describedBy === undefined\s*\? \{\}\s*: \{ "aria-describedby": describedBy \}\),\s*class: "se-text se-rich",\s*\},/,
    );
    // The text stands in the box's place, as it reads, until the editor is made: the
    // same name and the same look, so the focus the view gives it is passed on.
    assert.match(
      main,
      /<div\s+className="se-text se-rich"\s+role="textbox"\s+aria-multiline="true"\s+aria-readonly="true"\s+aria-label=\{label\}\s+aria-describedby=\{describedBy\}\s+tabIndex=\{0\}/,
    );
    assert.match(main, /<RichText text=\{value\} \/>/);
    // On the next frame, and only if the person has not moved the focus since.
    assert.match(
      main,
      /const frame = window\.requestAnimationFrame\(\(\) => \{\s*asked\.current = false;\s*const active = document\.activeElement;\s*if \(\s*!editor\.isDestroyed &&\s*\(active === null \|\| active === document\.body\)\s*\) \{\s*editor\.view\.focus\(\);/,
    );
    assert.match(main, /return \(\) => window\.cancelAnimationFrame\(frame\);/);
  });

  it("says each change as the stored text, once", () => {
    assert.match(
      main,
      /onUpdate: \(\{ editor: changed \}\) => \{\s*const text = written\(changed\);\s*const next = text === given\.current\.written \? given\.current\.value : text;\s*if \(next !== held\.current\) \{\s*held\.current = next;\s*onChange\(next\);\s*\}\s*\},/,
    );
    assert.equal(count(box, /onChange\(/g), 1);
  });

  it("takes a text put in from outside without saying it, and never puts back what it just said", () => {
    assert.match(
      main,
      /useLayoutEffect\(\(\) => \{\s*if \(editor === null \|\| value === held\.current\) \{\s*return;\s*\}\s*held\.current = value;\s*const doc = docFromText\(value\);\s*const text = textFromDoc\(doc\);\s*given\.current = \{ value, written: text \};\s*if \(written\(editor\) !== text\) \{/,
    );
    assert.match(main, /\}, \[editor, value\]\);/);
  });

  it("is not editable while its owner says read-only, and says nothing of the change", () => {
    assert.match(main, /editable: !readOnly,/);
    assert.match(
      main,
      /useLayoutEffect\(\(\) => \{\s*editor\?\.setEditable\(!readOnly, false\);\s*\}, \[editor, readOnly\]\);/,
    );
    assert.match(
      main,
      /<Tools\s+key=\{editor === null \? "waiting" : "made"\}\s+editor=\{editor\}\s+readOnly=\{readOnly\}\s*\/>/,
    );
  });

  it("leaves Escape to the editor's frame, and never holds the Tab key", () => {
    // Escape is "Cancel", in the frame (section-editor.tsx): the box does not hear it.
    assert.ok(!/Escape|"Enter"/.test(box));
    assert.match(
      component(editors, "Frame"),
      /if \(event\.key !== "Escape" \|\| event\.nativeEvent\.isComposing\) \{\s*return;\s*\}\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*onCancel\(\);/,
    );
    // Tab is kept from the editor (which would put a list inside a list), not from the
    // browser: the focus moves on.
    assert.match(
      main,
      /const leave = \(event: KeyboardEvent<HTMLDivElement>\) => \{\s*if \(\s*event\.key === "Tab" &&\s*!event\.altKey &&\s*!event\.ctrlKey &&\s*!event\.metaKey\s*\) \{\s*event\.stopPropagation\(\);\s*\}\s*\};/,
    );
    assert.match(
      main,
      /<EditorContent editor=\{editor\} onKeyDownCapture=\{leave\} \/>/,
    );
  });
});

describe("the toolbar", () => {
  const tools = component(box, "Tools");

  it("is a toolbar named Formatting, of real buttons, each named and titled", () => {
    assert.match(
      tools,
      /<div\s+ref=\{bar\}\s+className="se-tools"\s+role="toolbar"\s+aria-label="Formatting"\s+onKeyDown=\{move\}/,
    );
    assert.equal(count(box, /role="toolbar"/g), 1);
    assert.equal(count(box, /<button\b/g), 1);
    assert.match(
      tools,
      /<button\s+key=\{tool\.name\}\s+type="button"\s+className="se-tool"\s+aria-label=\{tool\.name\}\s+aria-pressed=\{tool\.pressed\}\s+aria-keyshortcuts=\{tool\.keys\}\s+title=\{tool\.title\}\s+tabIndex=\{at === reachable \? 0 : -1\}\s+disabled=\{!tool\.enabled\}/,
    );
    const named = [
      ...tools.matchAll(/name: "([^"]+)",\s*title: "([^"]+)",/g),
    ].map((match) => [match[1], match[2]]);
    assert.deepEqual(named, [
      ["Bold", "Bold (Ctrl/⌘+B)"],
      ["Italic", "Italic (Ctrl/⌘+I)"],
      ["Underline", "Underline (Ctrl/⌘+U)"],
      ["Bulleted list", "Bulleted list"],
      ["Numbered list", "Numbered list"],
      ["Undo", "Undo (Ctrl/⌘+Z)"],
      ["Redo", "Redo (Ctrl/⌘+Shift+Z)"],
      ["Clear formatting", "Clear formatting"],
    ]);
  });

  it("says which formats the selection has, and is off where it can do nothing", () => {
    for (const [key, name] of [
      ["bold", "bold"],
      ["italic", "italic"],
      ["underline", "underline"],
      ["bullets", "bulletList"],
      ["numbers", "orderedList"],
    ]) {
      assert.ok(tools.includes(`${key}: now.isActive("${name}"),`), key);
      assert.ok(tools.includes(`pressed: state?.${key} ?? false,`), key);
    }
    assert.equal(count(tools, /pressed: /g), 5);
    assert.match(tools, /const on = state !== null && !readOnly;/);
    assert.match(tools, /undo: now\.can\(\)\.undo\(\),/);
    assert.match(tools, /redo: now\.can\(\)\.redo\(\),/);
    assert.match(tools, /enabled: on && state\.undo,/);
    assert.match(tools, /enabled: on && state\.redo,/);
    assert.match(tools, /enabled: on && state\.clear,/);
    assert.equal(count(tools, /enabled: on,/g), 5);
  });

  it("keeps the selection in the text: the press takes no focus, and each tool gives it back", () => {
    assert.match(
      tools,
      /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/,
    );
    assert.equal(count(tools, /run: \(now\) =>/g), 8);
    assert.equal(count(tools, /\.chain\(\)\s*\.focus\(\)/g), 8);
    for (const command of [
      "toggleBold()",
      "toggleItalic()",
      "toggleUnderline()",
      "toggleBulletList()",
      "toggleOrderedList()",
      "undo()",
      "redo()",
      "unsetAllMarks()",
      "clearNodes()",
    ]) {
      assert.ok(tools.includes(`.${command}`), command);
    }
  });

  it("is one stop for the Tab key, with the arrow keys moving inside it", () => {
    assert.match(
      tools,
      /const reachable = tools\[stop\]\?\.enabled\s*\? stop\s*: tools\.findIndex\(\(tool\) => tool\.enabled\);/,
    );
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
      assert.ok(tools.includes(`event.key === "${key}"`), key);
    }
    assert.match(tools, /onFocus=\{\(\) => setStop\(at\)\}/);
  });
});

describe("where the formatted box is used", () => {
  it("is the text section's box, and only that", () => {
    assert.match(editors, /import \{ RichTextBox \} from "\.\/rich-editor";/);
    // Rewritten for redrafting a section a person has edited (product owner, 16 November
    // 2026, docs/design-workpaper.md section 3.11). Old expectation: the box is given the
    // label, the text, read-only, the hint and onChange, and nothing else. New
    // expectation: the same, and "Redraft with the agent" at the right of its formatting
    // bar (`aside`) where the editor's owner offers the redraft; the box itself stays the
    // same box, and the draft's text reaches it as any other text its owner gives.
    assert.match(
      component(editors, "SectionEditorPanel"),
      /\{editor\.kind === "text" && draft\.kind === "text" \? \(\s*<RichTextBox\s+label=\{editor\.title\}\s+value=\{draft\.text\}\s+readOnly=\{busy\}\s+describedBy=\{hint\}\s+onChange=\{\(text\) => onChange\(\{ kind: "text", text \}\)\}\s+aside=\{\s*offer === null \? undefined : \(\s*<RedraftButton\s+redraft=\{redraft\}\s+busy=\{busy\}\s+used=\{offer\.used !== null\}\s*\/>\s*\)\s*\}\s*\/>\s*\) : editor\.kind === "grid" && draft\.kind === "grid" \? \(\s*<GridBox/,
    );
    assert.equal(count(editors, /<RichTextBox\b/g), 1);
    // A cell and a note stay one plain line.
    for (const name of ["GridBox", "NoteBox"]) {
      const source = component(editors, name);
      assert.equal(count(source, /<AutoArea\b/g), 1, name);
      assert.ok(!/RichTextBox|RichText\b/.test(source), name);
    }
    for (const source of [view, card]) {
      assert.ok(!/RichTextBox|rich-editor/.test(source));
    }
  });

  it("is found by the view when an editor opens, as a plain box is", () => {
    assert.match(
      view,
      /frame\.querySelector<HTMLElement>\('\[role="textbox"\], textarea'\) \?\?\s*frame\.querySelector<HTMLElement>\("button:not\(:disabled\)"\);/,
    );
  });
});

describe("where a text section is read", () => {
  it("draws paragraphs, line breaks, lists, bold, italic and underline from the parsed text", () => {
    assert.match(
      reader,
      /import \{ parseRich, type Run \} from "\.\/rich-text-model";/,
    );
    assert.match(
      component(reader, "RichText"),
      /return parseRich\(text\)\.map\(\(block, at\) => \{/,
    );
    for (const element of [
      /<p key=\{at\}>/,
      /\{index > 0 \? <br \/> : null\}/,
      /const List = block\.type;/,
      /<List key=\{at\}>/,
      /<li key=\{index\}>/,
      /made = <u>\{made\}<\/u>;/,
      /made = <em>\{made\}<\/em>;/,
      /made = <strong>\{made\}<\/strong>;/,
    ]) {
      assert.match(reader, element);
    }
    // It is drawn by the server too (the card), so it is no client component and has no
    // state of its own.
    assert.ok(!reader.includes("use client"));
    assert.ok(!/\buse[A-Z]\w*\(/.test(reader));
  });

  it("shows a citation mark as the card's number only where it is asked to", () => {
    assert.match(reader, /const CITATION = \/\(\\\[\\\^\\d\{1,2\}\\\]\)\/;/);
    assert.match(
      component(reader, "cited"),
      /<sup key=\{at\} className="wp-cite">\s*\{number\}\s*<\/sup>/,
    );
    assert.match(reader, /cite = false,/);
  });

  it("is how the Document, the printed sheet and the Evidence view show the understanding and the conclusion", () => {
    assert.match(view, /import \{ RichText \} from "\.\/rich-text";/);
    const sheet = component(view, "DocumentSheet");
    // Rewritten 15 November 2026 (docs/workpaper-review.md, sections 3 and 6). Old: the
    // understanding's RichText directly in its block. New: the same RichText, inside the
    // review notes' field (`understanding`), which draws it as it is while the notes are
    // off (and on the printed sheet), and with its highlighted words while they are on;
    // the text is still shown formatted, by the same reader.
    // Rewritten (docs/design-workpaper.md, section 3.10; product owner, 16 November 2026:
    // procedures first, the understanding as their result). Old: the block opened with
    // its own <h6>Understanding of the control</h6>, inside section 1. New: the
    // understanding is section 3 of its own, whose heading says "Understanding of the
    // control", so the block has no sub-heading; the same NoteField and RichText.
    assert.match(
      sheet,
      /title="Understanding of the control"[\s\S]*?<div className="dw-prose">\s*<NoteField field=\{UNDERSTANDING\} text=\{understanding\} rich>\s*<RichText text=\{understanding\} \/>\s*<\/NoteField>\s*<\/div>/,
    );
    assert.doesNotMatch(sheet, /<h6>Understanding of the control<\/h6>/);
    assert.match(sheet, /const \{ understanding \} = paper;/);
    // Rewritten 15 November 2026. Old: the conclusion's RichText directly before
    // <OutOfDate>, and the Evidence view repeating the text under "Read the conclusion"
    // (three RichText in the view). New: section 7 is the one place the conclusion is
    // read and written; "Edit conclusion" stands between the text and what is out of
    // date, and the Evidence view links to section 7 instead of repeating the text (two
    // RichText) (product owner, 15 November 2026, docs/design-workpaper.md section
    // 3.5/3.6). The text is still shown formatted, by the same reader.
    // Rewritten again 15 November 2026 (docs/workpaper-review.md, sections 3 and 6).
    // Old: the conclusion's RichText directly in that place. New: the same RichText
    // inside the review notes' field (`conclusion`), drawn as it is while the notes are
    // off and with its highlighted words while they are on; the order around it (the
    // text, "Edit conclusion", what is out of date) is unchanged.
    // Rewritten again (product owner, 16 November 2026: section 7 lighter, option A).
    // Old: "Edit conclusion" followed by `<OutOfDate>` in the text's block. New: the
    // text's block ends with "Edit conclusion"; why a sign-off is out of date is quietly
    // under the conclusion's head (ConclusionHead). The text, in its note field, and
    // "Edit conclusion" after it are unchanged.
    assert.match(
      sheet,
      /\) : conclusion\.text === "" \? \([\s\S]{0,400}\) : \(\s*<NoteField field=\{CONCLUSION\} text=\{conclusion\.text\} rich>\s*<RichText text=\{conclusion\.text\} \/>\s*<\/NoteField>\s*\)\}\s*\{concluding === null \? \(\s*<EditConclusion[\s\S]{0,160}\) : null\}\s*<\/div>/,
    );
    assert.equal(
      /Read the conclusion|RichText text=\{conclusion/.test(
        component(view, "EvidenceSplit"),
      ),
      false,
    );
    assert.equal(count(view, /<RichText\b/g), 2);
    // The plain splitting into paragraphs is gone from the views: the printed sheet is
    // the Document's own component, so it reads the same.
    assert.ok(!/\bparagraphs\(/.test(view));
    assert.match(view, /<DocumentSheet paper=\{paper\} actions=\{null\} \/>/);
  });

  it("is how the workpaper card shows a text section, with its citations", () => {
    assert.match(card, /import \{ RichText \} from "\.\/rich-text";/);
    const section = component(card, "SectionView");
    assert.match(
      section,
      /\) : section\.kind === "text" \? \(\s*<>\s*<div className="wp-text">\s*<RichText text=\{section\.text\} cite \/>\s*<\/div>\s*\{section\.citations\.length > 0 \? \(\s*<ol className="wp-sources">/,
    );
    assert.equal(count(card, /<RichText\b/g), 1);
    // The card's own plain editor shows the marks as text.
    assert.match(
      section,
      /defaultValue=\{\s*section\.kind === "text"\s*\? section\.text\s*: rowsToText\(section\.rows\)\s*\}/,
    );
  });
});

describe("the styles", () => {
  /** A rule's declarations, by its selectors. */
  const rule = (sheet: string, selectors: string) => {
    const at = sheet.indexOf(`\n${selectors} {`);
    assert.ok(at >= 0, selectors);
    return sheet.slice(at, sheet.indexOf("}", at));
  };

  it("make the box as tall as what is in it, with the plain box's look", () => {
    const own = rule(css, ".se-rich");
    assert.match(own, /min-height: 4\.5rem;/);
    assert.ok(!/\n\s*(max-)?height:/.test(own));
    assert.ok(!/overflow(-y)?: (auto|scroll|hidden)/.test(own));
    assert.match(own, /border: 1px solid var\(--border-control\);/);
    assert.match(own, /background-color: var\(--surface\);/);
    // The editor needs the spaces kept as typed to place the caret.
    assert.match(own, /white-space: pre-wrap;/);
    assert.match(
      rule(css, ".se-rich:focus"),
      /border-color: var\(--accent\);\s*outline: 0;\s*box-shadow: var\(--ring\);/,
    );
    assert.match(
      rule(css, '.se-rich[contenteditable="false"]'),
      /color: var\(--text-secondary\);\s*background-color: var\(--surface-muted\);/,
    );
  });

  it("let the toolbar wrap, and mark the format the selection has", () => {
    assert.match(rule(css, ".se-tools"), /display: flex;\s*flex-wrap: wrap;/);
    assert.match(
      rule(css, 'button.se-tool[aria-pressed="true"]'),
      /color: var\(--accent-strong\);\s*background: var\(--accent-soft\);/,
    );
    assert.match(
      rule(css, "button.se-tool:focus-visible:not(:disabled)"),
      /box-shadow: var\(--ring\);/,
    );
  });

  it("give a text section's lists their place where it is read, on paper and in the card", () => {
    assert.match(
      css,
      /\.dw-prose > :is\(ul, ol\),\s*\.dw-concl-text > :is\(ul, ol\):not\(\.dw-stale\),\s*\.dw-more > :is\(ul, ol\) \{\s*margin: 0;\s*padding-left: 1\.375rem;\s*\}/,
    );
    const print = css.slice(css.indexOf("@media print"));
    assert.match(
      print,
      /\.dw-print-root \.dw-prose li,\s*\.dw-print-root \.dw-concl-text li \{\s*break-inside: avoid;\s*\}/,
    );
    // Nothing takes the bullets, the numbers, the weight or the line away.
    for (const sheet of [css, globals]) {
      assert.ok(
        !/\.(se-rich|dw-prose|dw-concl-text|dw-more|wp-text)[^{]*\{[^}]*(list-style: none|font-weight: (normal|400)|text-decoration: none|font-style: normal)/.test(
          sheet,
        ),
      );
    }
    assert.match(
      globals,
      /\.wp-text > :is\(ul, ol\) \{\s*margin: 0;\s*padding-left: 1\.375rem;\s*\}/,
    );
    assert.match(
      globals,
      /\.wp-text > :is\(p, ul, ol\) \+ :is\(p, ul, ol\) \{\s*margin-top: 1\.6em;\s*margin-top: 1lh;\s*\}/,
    );
  });
});

describe("the words", () => {
  it("say the organization plainly: no client, no dash", () => {
    for (const source of [box.replace('"use client";', ""), reader]) {
      assert.ok(!/\bclient\b/i.test(source));
      assert.ok(!source.includes("—"));
    }
  });
});
