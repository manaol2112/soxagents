import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// The D&I workpaper in three views (docs/design-workpaper.md, sections 1 and 3.1), read
// from the screen's own files. What must hold whatever the views look like: there are
// three of them under one switcher; today's workpaper card, with every existing action,
// is kept once per mount, unchanged, in the fold under them; the views themselves decide
// nothing (no form, no write, no sign-off, no preparing); the document prints by itself;
// and the proxy route refuses anything that is not three ids.

const read = (path: string) => readFileSync(path, "utf8");
const view = read("apps/web/src/design-workpaper-view.tsx");
const model = read("apps/web/src/design-workpaper-model.ts");
const css = read("apps/web/app/design-workpaper.css");
const route = read("apps/web/app/workspace/design-workpaper/route.ts");
const controls = read("apps/web/src/controls-view.tsx");
const card = read("apps/web/src/workpaper-view.tsx");
const layout = read("apps/web/app/layout.tsx");
const viewer = read("apps/web/src/evidence-annotations.tsx");
// Changed 14 November 2026 (docs/evidence-annotations.md, section 5a). Old: the dialog
// in evidence-preview.tsx (EvidencePreview). New: the one viewer's dialog in
// evidence-opener.tsx (AnnotatedDialog), the old viewer retired.
const preview = read("apps/web/src/evidence-opener.tsx");

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

describe("one switcher, three views", () => {
  it("offers Document, Matrix and Evidence as a tab list", () => {
    for (const label of ["Document", "Matrix", "Evidence"]) {
      assert.match(model, new RegExp(`label: "${label}"`));
    }
    const body = component(view, "DesignWorkpaper");
    assert.equal(count(body, /role="tablist"/g), 1);
    assert.match(body, /role="tablist"\s+aria-label="Workpaper view"/);
    assert.match(body, /\{VIEWS\.map\(\(item\) => \{/);
    assert.match(body, /role="tab"/);
    assert.match(body, /aria-selected=\{on\}/);
    // Roving focus: only the selected tab is in the tab order, and the arrows move it.
    assert.match(body, /tabIndex=\{on \? 0 : -1\}/);
    assert.match(body, /const next = viewForKey\(view, event\.key\);/);
    assert.match(body, /tabs\.current\.get\(next\)\?\.focus\(\);/);
    assert.match(body, /role="tabpanel"/);
    assert.match(body, /aria-labelledby=\{`\$\{uid\}-tab-\$\{view\}`\}/);
    // Each view is drawn only while it is the one shown.
    // Rewritten 15 November 2026 (docs/workpaper-review.md, section 6). Old: the
    // Document view was the sheet alone, and the views were Document, Matrix, Evidence.
    // New: the Document view is the sheet with the review notes' rail beside it while
    // the rail is on, and a fourth view, Notes (All notes), comes before the Matrix in
    // the chain of views drawn; each is still drawn only while it is the one shown.
    // Rewritten again. Old: the sheet's box was `<div ref={sheetRef}>` around the sheet
    // alone. New: the box is `rn-sheet` (widened padding while the notes are on) and
    // holds the notes' margin, `<NotesMargin />`, after the sheet. Product owner, 16
    // November 2026: note card B, margin icon, form on the right.
    assert.match(
      body,
      /view === "document" \? \(\s*<div className=\{railOn \? "rn-with-rail" : undefined\}>\s*<div\s+ref=\{sheetRef\}\s+className=\{`rn-sheet\$\{notesShown \? " is-noting" : ""\}`\}\s*>\s*<DocumentSheet[\s\S]{0,320}<NotesMargin \/>\s*<\/div>\s*\{railOn \? <NotesRail id=\{`\$\{uid\}-rail`\} \/> : null\}\s*<\/div>\s*\) : view === "notes" \? \(\s*<AllNotesView[\s\S]{0,240}\) : view === "matrix" \? \(\s*<MatrixBoard[\s\S]{0,160}\) : \(\s*<EvidenceSplit/,
    );
  });

  it("remembers the choice in the browser, and leaves the address bar alone", () => {
    const body = component(view, "DesignWorkpaper");
    assert.match(body, /rememberView\(\(\) => window\.localStorage, next\);/);
    assert.match(
      body,
      /setView\(rememberedView\(\(\) => window\.localStorage\)\);/,
    );
    // The first paint is the document on the server and in the browser alike.
    assert.match(body, /useState<ViewKey>\("document"\)/);
    assert.equal(count(view, /localStorage/g), 2);
    for (const source of [view, model]) {
      assert.ok(
        !/useRouter|router\.|history\.(push|replace)State|location\.(href|assign|replace|reload|search|hash)|window\.location/.test(
          source,
        ),
      );
    }
  });

  it("reads the workpaper once, and drops an answer a newer read overtook", () => {
    const body = component(view, "DesignWorkpaper");
    assert.equal(count(view, /fetch\(/g), 1);
    assert.match(
      body,
      /fetch\(`\/workspace\/design-workpaper\?\$\{query\}`, \{\s*cache: "no-store",\s*signal: control\.signal,\s*\}\)/,
    );
    assert.match(body, /const control = new AbortController\(\);/);
    assert.match(body, /if \(!current\) \{\s*return;\s*\}/);
    assert.match(
      body,
      /return \(\) => \{\s*current = false;\s*control\.abort\(\);\s*\};\s*\}, \[query, record, attempt\]\);/,
    );
    // Only an answer the parser accepts is shown; a failed read keeps what was there
    // and says so, with a way to try again.
    assert.match(
      body,
      /const paper = status === 200 \? parseDesignWorkpaper\(result\) : null;/,
    );
    assert.match(body, /paper: before\.paper,/);
    assert.match(body, /role="alert"/);
    assert.match(body, /Try again/);
    assert.match(body, /<Outline \/>/);
    assert.match(component(view, "Outline"), /role="status"/);
    assert.match(body, /No design workpaper yet/);
  });
});

describe("the existing workpaper card, kept once per mount", () => {
  it("holds today's card for the D&I stage in the fold, unchanged", () => {
    const step = component(view, "DesignWorkpaperStep");
    assert.equal(count(view, /<WorkpapersTab\b/g), 1);
    // Rewritten (independent review, 15 November 2026, docs/design-workpaper.md section 3.6).
    // Old: `<WorkpapersTab compact {...props} stage="DESIGN" />`. New: the same card with
    // `prepareHeld={behind}`: a recorded conclusion moves the workpaper's version, and
    // Prepare waits until the page's records are read again.
    assert.match(
      step,
      /<details\s+ref=\{fold\}\s+className="dw-fold"[\s\S]*<strong>Edit, prepare and versions<\/strong>[\s\S]*<div className="dw-fold-body">\s*<WorkpapersTab\s+compact\s+\{\.\.\.props\}\s+stage="DESIGN"\s+prepareHeld=\{behind\}\s*\/>\s*<\/div>\s*<\/details>/,
    );
    // The views come first, the fold under them.
    assert.ok(step.indexOf("<DesignWorkpaper\n") < step.indexOf("<details"));
    assert.equal(count(step, /<DesignWorkpaper\n/g), 1);
    // It takes the card's own props, and opens by the model's rule.
    assert.match(
      view,
      /type CardProps = Omit<\s*ComponentProps<typeof WorkpapersTab>,\s*"stage" \| "compact"\s*>;/,
    );
    assert.match(
      step,
      /const starts = foldStartsOpen\(\{ papers, notice, viewing \}\);/,
    );
    assert.match(step, /open=\{open\}/);
    // The card itself is as it was: the editor, Draft, Prepare, Reopen, the versions and
    // the export are still its own.
    for (const kept of [
      'intent="draft"',
      'intent="prepare"',
      'intent="reopen"',
      'intent="edit"',
      "Draft again",
      "Version history",
      "Download .xlsx",
      "Save as a new version",
    ]) {
      assert.ok(card.includes(kept), kept);
    }
    assert.ok(!card.includes("design-workpaper"));
  });

  it("is mounted at the two D&I places, and nowhere is the card mounted twice", () => {
    assert.equal(
      count(controls, /<DesignWorkpaperStep \{\.\.\.workpaperProps\} \/>/g),
      2,
    );
    assert.equal(count(controls, /<DesignWorkpaperStep\b/g), 2);
    // The D&I card is no longer mounted directly: only through the step, once each.
    assert.equal(count(controls, /stage="DESIGN"/g), 0);
    // The testing workpaper is not changed: its three mounts are as they were.
    assert.equal(count(controls, /<WorkpapersTab\b/g), 3);
    assert.equal(count(controls, /stage="EFFECTIVENESS"/g), 3);
    assert.match(
      controls,
      /<h4 className="stp-subhead">Design and implementation<\/h4>\s*<DesignWorkpaperStep \{\.\.\.workpaperProps\} \/>\s*<h4 className="stp-subhead">Operating effectiveness<\/h4>\s*<WorkpapersTab compact \{\.\.\.workpaperProps\} stage="EFFECTIVENESS" \/>/,
    );
    assert.match(
      controls,
      /title="Walkthrough and design workpaper"[\s\S]{0,260}<DesignWorkpaperStep \{\.\.\.workpaperProps\} \/>\s*<\/PhaseStep>/,
    );
  });

  it("opens the fold at a section's own editor from an Edit link", () => {
    const step = component(view, "DesignWorkpaperStep");
    assert.match(step, /onEdit=\{reveal\}/);
    assert.match(step, /node\.open = true;/);
    assert.match(step, /'input\[type="hidden"\]\[name="section"\]'/);
    assert.match(step, /sectionKeyFor\(\s*section,/);
    assert.match(step, /landing\?\.focus\(\{ preventScroll: true \}\);/);
    // The link is offered only where the model says the section may be edited, and it
    // submits nothing itself.
    const link = component(view, "EditLink");
    assert.match(
      link,
      /if \(onEdit === null \|\| !editable\) \{\s*return null;/,
    );
    assert.match(link, /type="button"/);
    // Changed (product owner, 15 November 2026, docs/design-workpaper.md section 3.2).
    // Old: "Edit" on an editable section always opened the fold
    // (`if (editable.has(section)) { onEdit(section); }`). New: "Edit" turns the section
    // into its editor where the document shows it, and opens the fold only where the
    // model gives the page no editor for it (tests/section-edit-view.test.ts has the
    // rest). Kept: nothing happens for a section the model does not say may be edited.
    assert.match(
      component(view, "DesignWorkpaper"),
      /if \(\s*!editable\.has\(section\) \|\|\s*editing !== null \|\|\s*paper === null \|\|\s*behind\s*\) \{\s*return;\s*\}\s*const editor = editorFor\(section, source, paper\);\s*if \(source === null \|\| editor === null\) \{\s*\/\/ [^\n]*\n\s*onEdit\(section\);\s*return;\s*\}/,
    );
  });
});

describe("nothing in a view is a decision", () => {
  it("defines no form and no write in the new files", () => {
    for (const [name, source] of [
      ["view", view],
      ["model", model],
    ] as const) {
      for (const pattern of [
        /<form\b/,
        /\bmethod[=:]\s*["'{]/,
        /\baction=["'{]/,
        /"POST"|"PUT"|"PATCH"|"DELETE"/,
        /type="submit"/,
        /<input\b/,
        /<textarea\b/,
        /name="intent"|intent="/,
        /\/workspace\/workpapers/,
        /design-conclusions/,
        // Rewritten (product owner, 15 November 2026, docs/design-workpaper.md section
        // 3.7). Old: no `signOff` at all in the view. New: the preparer signs at the end
        // of section 7, so the view hands the sign-off its ids and its "done" callback
        // (`signOff`); the form and the write are preparer-signoff.tsx's, tested there,
        // and the view itself still defines no form and no write.
        /\bonSign\b|\bonPrepare\b|\bonApprove\b|\bonReopen\b/,
      ]) {
        assert.ok(!pattern.test(source), `${name}: ${pattern}`);
      }
    }
    assert.equal(count(view, /\bsignOff\b/g) >= 1, true);
    assert.equal(count(model, /\bsignOff\b/g), 0);
    // Every button a view defines is a plain button: it opens, selects or prints.
    assert.equal(count(view, /<button\b/g), count(view, /\btype="button"/g));
    assert.equal(count(model, /fetch\(/g), 0);
  });

  it("reads the evidence pane's annotations without offering their review", () => {
    const pane = component(view, "EvidencePane");
    // The preview's own viewer, not a second one.
    assert.equal(count(view, /<AnnotatedEvidence\b/g), 1);
    assert.match(pane, /const notes = useEvidenceAnnotations\(where\);/);
    assert.match(pane, /\{ \.\.\.notes\.set, canEdit: false \}/);
    assert.match(pane, /act=\{READ_ONLY\}/);
    assert.match(pane, /headSlot=\{null\}/);
    assert.match(pane, /\binline\b/);
    assert.ok(!/notes\.act\b/.test(view));
    // The viewer gives a reader no action, and hears its keys only inside itself when
    // it is shown in a page.
    assert.match(viewer, /set\.canEdit \? \(\s*<ReviewActions\b/);
    assert.match(
      viewer,
      /if \(\s*inline &&\s*!\(event\.target instanceof Node && here\.contains\(event\.target\)\)\s*\) \{\s*return;/,
    );
    // Changed 14 November 2026 (section 5a). Old: `pick?: { id: string } | null`. New: a
    // pick is an annotation or a cited passage (ViewerPick); the pane still passes an
    // annotation's id.
    assert.match(viewer, /pick\?: ViewerPick \| null;/);
    assert.match(
      read("apps/web/src/evidence-annotations-model.ts"),
      /export type ViewerPick = \{ id: string \} \| \{ quote: string \};/,
    );
    // Only the selected file is read, and only once the evidence view is shown.
    assert.equal(count(view, /<EvidencePane\b/g), 1);
    assert.match(component(view, "EvidenceSplit"), /<EvidencePane\b/);
  });

  it("opens a reference in the existing preview, at the annotation it names", () => {
    assert.equal(count(view, /<AnnotatedDialog\b/g), 1);
    assert.equal(count(view, /<EvidencePreview\b|<EvidenceViewer\b/g), 0);
    assert.match(
      view,
      /<AnnotatedDialog[\s\S]{0,420}annotations=\{\s*opened\.entry\.requirementId === null\s*\? undefined\s*: \{\s*controlId: scope\.controlId,\s*requirementId: opened\.entry\.requirementId,\s*\}\s*\}\s*startAnnotationId=\{opened\.annotationId \?\? undefined\}/,
    );
    assert.match(preview, /startAnnotationId\?: string \| undefined;/);
    assert.match(preview, /pick=\{pick\}/);
    // In the evidence view the same selection shows the file in the pane instead.
    assert.match(
      component(view, "DesignWorkpaper"),
      /if \(view !== "evidence"\) \{\s*setOpened\(\{ entry: chip\.entry, annotationId: chip\.annotationId \}\);\s*return;\s*\}\s*opener\.current = element \?\? null;\s*setSelection\(/,
    );
  });

  it("words the conclusion from the model, which never signs", () => {
    assert.match(view, /const conclusion = conclusionOf\(paper\);/);
    assert.match(model, /"Proposed by the agent, not signed"/);
    assert.match(model, /signed: conclusion\.signed === true,/);
    // A proposal carries the agent's tone; green is only for a standing sign-off.
    assert.match(
      model,
      /tone: stale \? "warning" : proposed \? "ai" : "neutral",/,
    );
    assert.ok(!/Signed off by|Approved by/.test(view));
  });

  it("loads a thumbnail lazily, and only for an image", () => {
    const board = component(view, "MatrixBoard");
    assert.match(
      board,
      /\{entry\.image \? \([\s\S]{0,220}<img\s+src=\{previewUrl\(scope, entry\.fileId\)\}\s+alt=""\s+loading="lazy"/,
    );
    assert.match(board, /<FileBadge name=\{entry\.fileName\} \/>/);
    assert.equal(count(view, /<img\b/g), 1);
    // The matrix is a real table, with a header for every row and column and a word in
    // every cell.
    assert.match(board, /<caption className="sr-only">/);
    assert.match(board, /<th scope="row" className="is-first">/);
    assert.match(
      board,
      /<th scope="col" className="is-file" key=\{entry\.ref\}>/,
    );
    assert.match(board, /<span className="sr-only">\{cell\.word\}<\/span>/);
    assert.match(
      board,
      /<span className="dw-cell-word">\s*\{cell\.word\}\s*<\/span>/,
    );
  });
});

describe("print or save as PDF", () => {
  it("prints only the sheet", () => {
    const body = component(view, "DesignWorkpaper");
    assert.match(body, /Print or save as PDF/);
    assert.match(body, /root\.classList\.add\("dw-printing"\);/);
    assert.match(body, /window\.print\(\);/);
    assert.match(body, /window\.addEventListener\("afterprint", done\);/);
    assert.match(body, /root\.classList\.remove\("dw-printing"\);/);
    // The sheet is drawn at the end of the page while it prints, with nothing to press.
    assert.match(
      body,
      /createPortal\(\s*<div className="dw-print-root">\s*<DocumentSheet paper=\{paper\} actions=\{null\} \/>\s*<\/div>,\s*document\.body,\s*\)/,
    );
    const sheet = component(view, "DocumentSheet");
    for (const section of [
      'number={1}\n        title="Objective, risk and control"',
      'number={2} title="Procedures performed"',
      // Rewritten 15 November 2026. Old: section 3 "Walkthrough of one instance". New:
      // "Implementation: walkthrough of one instance", saying which part of the D&I
      // assessment is the implementation (product owner, 15 November 2026,
      // docs/design-workpaper.md section 3.5/3.6).
      'number={3}\n        title="Implementation: walkthrough of one instance"',
      'number={4}\n        title="Attributes tested"',
      'number={5}\n        title="Information produced by the entity"',
      'number={6} title="Matters for the reviewer" anchor={mattersId}',
      'number={7}\n        title="Conclusion"',
      'title="Tickmarks and evidence"',
    ]) {
      assert.ok(sheet.includes(section), section);
    }
  });

  it("has a print stylesheet: the app is taken off the paper, on a light page", () => {
    assert.equal(count(css, /@media print/g), 1);
    const print = css.slice(css.indexOf("@media print"));
    // The margins belong to the sheet's own named page: no other print of the app
    // changes.
    assert.match(print, /@page dw \{\s*margin: 16mm 14mm;\s*\}/);
    assert.equal(count(css, /@page\b/g), 1);
    assert.ok(!/@page\s*\{/.test(css));
    assert.match(
      print,
      /html\.dw-printing body > \*:not\(\.dw-print-root\) \{\s*display: none !important;/,
    );
    assert.match(
      print,
      /html\.dw-printing \.dw-print-root \{[\s\S]*display: block;/,
    );
    // No dark ground: the paper and its ink are the --mark tokens, one value in both
    // themes.
    assert.match(print, /background: var\(--mark-paper\) !important;/);
    assert.match(print, /--surface: var\(--mark-paper\);/);
    assert.match(print, /--text: var\(--mark-ink\);/);
    // A table row is never split across two pages, and a table's header repeats.
    assert.match(print, /\.dw-print-root tr,[\s\S]*break-inside: avoid;/);
    assert.match(
      print,
      /\.dw-print-root thead \{\s*display: table-header-group;/,
    );
    assert.match(
      print,
      /\.dw-print-root \.dw-sec-head \{\s*break-after: avoid;/,
    );
    // Off the screen until then.
    assert.match(css, /\n\.dw-print-root \{\s*display: none;\s*page: dw;\s*\}/);
    // The stylesheet is loaded, before the glass layer.
    assert.ok(layout.includes('import "./design-workpaper.css";'));
    assert.ok(
      layout.indexOf('import "./design-workpaper.css";') <
        layout.indexOf('import "./glass.css";'),
    );
  });
});

describe("the stylesheet", () => {
  it("uses the tokens: no colour of its own", () => {
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css));
    assert.ok(!/\brgba?\(|\bhsla?\(/.test(css));
    assert.ok(!/(?<![\w-])color:\s*var\(--(accent|ink)\)/.test(css));
    for (const token of [
      "--surface",
      "--text-strong",
      "--border",
      "--accent-text",
      "--success",
      "--ai",
    ]) {
      assert.ok(css.includes(`var(${token})`), token);
    }
  });

  it("turns its motion off for people who ask, and keeps it short otherwise", () => {
    const reduced = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)"),
      css.indexOf("/* Print or save as PDF"),
    );
    assert.ok(reduced.length > 0);
    /** A duration in milliseconds, written in `ms` or in `s`. */
    const durations = (text: string) =>
      [...text.matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g)].map(
        (match) => Number(match[1]) * (match[2] === "s" ? 1000 : 1),
      );
    // Every rule that moves: its selectors, and how long it takes.
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
      selectors: (match[1] ?? "")
        .split(",")
        .map((selector) => selector.trim())
        .filter((selector) => selector !== ""),
      body: match[2] ?? "",
    }));
    const transitions = rules.filter(
      (rule) =>
        /\btransition:/.test(rule.body) && !/transition: none/.test(rule.body),
    );
    const animations = rules.filter(
      (rule) =>
        /\banimation:/.test(rule.body) && !/animation: none/.test(rule.body),
    );
    assert.ok(transitions.length > 0);
    // A transition is hover and press (100 to 150 ms) or expand and collapse (150 to
    // 250 ms).
    for (const rule of transitions) {
      const times = durations(rule.body);
      assert.ok(times.length > 0, rule.selectors.join());
      assert.ok(
        times.every((time) => time >= 100 && time <= 250),
        `${rule.selectors.join()}: ${times.join()}`,
      );
    }
    // The only animations are the two skeletons, which pulse for as long as something
    // is being read (1.2 s a pulse, written in seconds), and both stop for a person
    // who asks for less motion.
    assert.deepEqual(
      animations.map((rule) => [rule.selectors.join(), durations(rule.body)]),
      [
        [".dw-skel", [1200]],
        [".dw-pane-wait", [1200]],
      ],
    );
    assert.match(
      reduced,
      /\.dw-skel,\s*\.dw-pane-wait \{\s*animation: none;\s*\}/,
    );
    for (const rule of animations) {
      for (const selector of rule.selectors) {
        assert.ok(reduced.includes(selector), selector);
      }
    }
    // Every transition is turned off there too.
    for (const rule of transitions) {
      for (const selector of rule.selectors) {
        assert.ok(reduced.includes(selector), selector);
      }
    }
    assert.match(reduced, /transition: none;/);
    // No duration anywhere else in the sheet escapes the two checks above.
    const all = durations(css);
    assert.ok(
      all.every((time) => (time >= 100 && time <= 250) || time === 1200),
    );
  });

  it("lays the views out by their own width, and stacks the evidence when narrow", () => {
    assert.match(css, /container: dw \/ inline-size;/);
    assert.match(
      css,
      /@container dw \(max-width: 900px\) \{\s*\.dw-split \{\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
    // The matrix scrolls inside its own container, its first column in view.
    assert.match(css, /\.dw-grid-scroll \{[^}]*overflow-x: auto;/);
    assert.match(css, /\.dw-grid \.is-first \{\s*position: sticky;\s*left: 0;/);
    // Every control the views add shows the focus ring.
    for (const control of [
      "dw-tab",
      "dw-ref",
      "dw-cell",
      "dw-thumb",
      "dw-file",
      "dw-edit",
    ]) {
      assert.match(
        css,
        new RegExp(
          `button\\.${control}:focus-visible:not\\(:disabled\\) \\{\\s*box-shadow: var\\(--ring\\);`,
        ),
        control,
      );
    }
  });
});

describe("the proxy route", () => {
  it("reads only, with the session, and only for three ids", () => {
    assert.match(route, /export async function GET\(request: Request\)/);
    assert.equal(count(route, /export async function/g), 1);
    assert.ok(!/POST|PUT|PATCH|DELETE/.test(route));
    assert.match(
      route,
      /const path = designWorkpaperPath\(new URL\(request\.url\)\.searchParams\);\s*if \(path === null\) \{\s*return NextResponse\.json\(\{ status: 422, detail: "", result: null \}\);\s*\}/,
    );
    // The path is built only from ids the model accepted.
    assert.match(
      model,
      /return `\/organizations\/\$\{organization\}\/projects\/\$\{project\}\/controls\/\$\{control\}\/design-workpaper`;/,
    );
    assert.match(model, /return UUID\.test\(value\) \? value : null;/);
    assert.match(
      route,
      /fetch\(`\$\{apiBaseUrl\(\)\}\$\{path\}`, \{\s*method: "GET",/,
    );
    assert.match(route, /headers\.set\("cookie", `aw_session=\$\{session\}`\)/);
    assert.match(route, /cache: "no-store"/);
    assert.match(route, /signal: AbortSignal\.timeout\(30000\)/);
    // The session is never logged or sent back, and a 200 always carries the workpaper.
    assert.ok(
      !/console\.|session[,}]\s*\)|result: session|detail: session/.test(route),
    );
    assert.match(route, /status = status === 200 \? 502 : status;/);
    assert.match(
      route,
      /return NextResponse\.json\(\{ status, detail, result \}\);/,
    );
  });
});

describe("the copy", () => {
  it("says the organization, plainly, as the neighbouring screens do", () => {
    for (const source of [view, model]) {
      assert.ok(!/\bthe client\b/i.test(source));
      assert.ok(!source.includes("—"));
    }
    assert.match(view, /Edit, prepare and versions/);
    assert.match(view, /No design workpaper yet/);
  });

  it("claims only what the page can know, and spells out design and implementation", () => {
    /** The file's copy: no comments. */
    const copyOf = (source: string) =>
      source
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/^\s*\*.*$/gm, "");
    for (const source of [copyOf(view), copyOf(model)]) {
      // The page cannot claim every statement is cited.
      assert.ok(!/Every statement cites/.test(source));
      // Nor that a control relies on no report: only that none is listed here.
      assert.ok(!/No report is relied on/.test(source));
      // In a sentence it is "design and implementation".
      assert.ok(!/D&amp;I|D&I/.test(source));
    }
    assert.match(
      view,
      /References \(E1, E2, …\) name the evidence a statement rests on\./,
    );
    assert.equal(count(view, /No report is listed in this workpaper\./g), 2);
    assert.match(view, /design and\s+implementation requests receive/);
    // The compact labels stay, and the tickmark column says what it is.
    assert.match(model, /label: "W\/P reference"/);
    assert.match(
      view,
      /<th\s+scope="col"\s+className="is-tm"\s+aria-label="Tickmark"\s+title="Tickmark"\s*>\s*TM\s*<\/th>/,
    );
  });
});

describe("the review's fixes, in the screen's own files", () => {
  const body = component(view, "DesignWorkpaper");

  it("starts a fresh view for another control", () => {
    assert.match(
      component(view, "DesignWorkpaperStep"),
      /<DesignWorkpaper\s+\/\/ [^\n]*\n\s*key=\{scope\.controlId\}/,
    );
  });

  it("never lets the evidence pane take the focus by itself", () => {
    // In a page the viewer's callout takes the focus only for what a person selected in
    // it: not when it appears, when its annotations arrive, or for a reference chosen
    // outside it.
    // Changed 14 November 2026 (docs/evidence-annotations.md, section 5a). Old: a pick
    // named an annotation by its id, so it was "asked" as soon as it was given. New: a
    // pick names an annotation or a cited passage, by id or by its words (ViewerPick); it
    // is "asked" once it names a mark of the file, and a pick given while the annotations
    // are read is acted on once they are here. The rule is the same: asked from outside,
    // the callout stays quiet in a page.
    assert.match(
      viewer,
      /const \[asked, setAsked\] = useState\(\s*pickTarget\(pick, annotations, citedHere\) !== null,\s*\);/,
    );
    assert.match(
      viewer,
      /if \(pick === null \|\| loading\) \{\s*return;\s*\}\s*const target = pickTarget\(pick, annotations, citedHere\);\s*if \(target !== null\) \{\s*setAsked\(true\);/,
    );
    assert.match(
      viewer,
      /function select\(id: string \| null\) \{\s*setAsked\(false\);/,
    );
    // Changed 14 November 2026 (section 5b). Old: quiet={inline && asked}. New: also quiet
    // for a passage "About this file" asked to see (`fromAbout`): it is put in view on the
    // file while the focus stays in the tab the person is working in.
    assert.match(viewer, /quiet=\{\(inline \|\| fromAbout\) && asked\}/);
    const hook = component(viewer, "useCalloutFocus");
    assert.match(hook, /if \(quiet\) \{\s*return;\s*\}/);
    // Changed 14 November 2026 (review of the one viewer, item 4a). Old: the hook took
    // `key` and `quiet`, and in the dialog put the focus on the callout's first action,
    // which for a proposed annotation is "Confirm & next". New: it also takes `asked`, and
    // a callout the viewer was opened on (a reference, a citation) puts the focus on its
    // heading, never on a review action; `quiet` still keeps it out of a page.
    assert.match(hook, /\}, \[key, quiet, asked\]\);/);
    // In the dialog nothing changes: `quiet` is off unless `inline` is on.
    assert.match(
      viewer,
      /function useCalloutFocus<T extends HTMLElement>\(\s*key: string,\s*quiet = false,\s*asked = false,\s*\)/,
    );
    assert.match(hook, /asked \? "\[data-heading\]" : "\[data-first\]"/);
    // The views never focus the pane either, and it is not a focus stop.
    assert.ok(!/node\.focus\(/.test(body));
    assert.ok(!/pane\.current\?\.focus|paneRef\.current\?\.focus/.test(view));
    assert.ok(
      !/tabIndex=\{-1\}\s*aria-label="Evidence"/.test(
        component(view, "EvidenceSplit"),
      ),
    );
    // Changing view, and closing the preview, forget the annotation a reference opened.
    const drop =
      /setSelection\(\(before\) =>\s*before === null \|\| before\.annotationId === null\s*\? before\s*: \{ \.\.\.before, annotationId: null \},\s*\);/g;
    assert.equal(count(body, drop), 2);
    assert.match(
      body,
      /const choose = \(next: ViewKey, focus = false\) => \{[\s\S]{0,420}annotationId: null \}/,
    );
    assert.match(
      body,
      /onClose=\{\(\) => \{\s*setOpened\(null\);[\s\S]{0,420}annotationId: null \}/,
    );
    // Escape from an annotation a chip opened goes back to that chip.
    assert.match(
      viewer,
      /const back = asked \? \(returnFocus\?\.\(\) \?\? null\) : null;\s*select\(null\);\s*\(back \?\? line \?\? dialogOf\(\)\)\?\.focus\(\);/,
    );
    assert.match(
      component(view, "Refs"),
      /actions\.onRef\(chip, from, event\.currentTarget\)/,
    );
    assert.match(
      body,
      /\(\) => \(opener\.current\?\.isConnected \? opener\.current : null\)/,
    );
    assert.match(
      component(view, "EvidencePane"),
      /returnFocus=\{returnFocus\}/,
    );
  });

  it("keeps the focus on Try again while it tries, and puts it on the tab after", () => {
    // The banner stays while the retry is out, so the button pressed is still there.
    assert.match(
      body,
      /\{state\.problem !== null \? \(\s*\/\/ [^\n]*\n\s*<p className="banner banner-warning dw-problem" role="alert">/,
    );
    assert.match(
      body,
      /if \(!state\.loading\) \{\s*retried\.current = true;\s*setAttempt\(/,
    );
    assert.match(
      body,
      /if \(active === null \|\| active === document\.body\) \{\s*tabs\.current\.get\(view\)\?\.focus\(\);/,
    );
  });

  it("does not print a paper it could not read again", () => {
    assert.match(
      body,
      /const stale = paper !== null && state\.problem !== null;/,
    );
    assert.match(body, /disabled=\{stale\}/);
    assert.match(body, /if \(!stale\) \{\s*setPrinting\(true\);/);
    assert.match(
      body,
      /\{printing && !stale && paper !== null && paper\.workpaper !== null/,
    );
    assert.match(
      body,
      /\{stale \? staleProblem\(state\.problem\) : state\.problem\}/,
    );
  });

  it("labels the panel by a tab only while the tabs are there", () => {
    assert.match(
      body,
      /const tabbed = paper === null \|\| paper\.workpaper !== null;/,
    );
    assert.match(
      body,
      /\{tabbed \? \(\s*<div\s+className="dw-panel"\s+role="tabpanel"[\s\S]{0,160}aria-labelledby=\{`\$\{uid\}-tab-\$\{view\}`\}[\s\S]{0,120}\) : \(\s*\/\/ [^\n]*\n\s*<div className="dw-panel" aria-busy=\{state\.loading\}>/,
    );
    assert.equal(count(body, /role="tabpanel"/g), 1);
    assert.equal(count(body, /aria-labelledby=/g), 1);
    // A horizontal tab list: the model moves on Left, Right, Home and End only.
    assert.ok(!/ArrowUp|ArrowDown/.test(model));
    assert.ok(!/ArrowUp|ArrowDown/.test(view));
  });

  it("keys the facts and the steps by their place, and never draws an empty letter", () => {
    const sheet = component(view, "DocumentSheet");
    assert.match(sheet, /keyed\(paper\.facts, \(item\) => item\.label\)/);
    assert.match(
      sheet,
      /keyed\(paper\.walkthrough\.steps, \(item\) =>\s*String\(item\.number\),?\s*\)/,
    );
    assert.match(
      component(view, "Timeline"),
      /keyed\(stops, \(item\) => String\(item\.number\)\)/,
    );
    assert.ok(
      !/key=\{fact\.label\}|key=\{step\.number\}|key=\{stop\.number\}/.test(
        view,
      ),
    );
    assert.match(model, /key: `\$\{index \+ 1\}:\$\{wordsOf\(item\)\}`/);
    // An attribute always has a mark to show: its letter, or its place in the list.
    assert.match(
      model,
      /item\.code === "" \? \{ \.\.\.item, code: String\(index \+ 1\) \} : item/,
    );
    assert.ok(!/attribute\.code !== ""/.test(view));
  });

  it("shows a matter's kind in the matrix as in the document, and an exception with no file", () => {
    const kind = /\{words\.kind !== "" \? <b>\{words\.kind\}\. <\/b> : null\}/g;
    assert.equal(count(component(view, "DocumentSheet"), kind), 1);
    assert.equal(count(component(view, "MatrixBoard"), kind), 1);
    for (const name of ["DocumentSheet", "EvidenceSplit"]) {
      assert.match(
        component(view, name),
        /\{strayLine\(attribute\) !== "" \? \(\s*<p className="dw-stray">\{strayLine\(attribute\)\}<\/p>/,
        name,
      );
    }
    assert.match(
      component(view, "MatrixBoard"),
      /\{row\.stray !== "" \? \(\s*<span className="dw-stray">\{row\.stray\}<\/span>/,
    );
    assert.match(css, /\.dw-stray \{[^}]*color: var\(--danger\);/);
  });

  it("never shows a verdict beside the evidence without the open matters", () => {
    const split = component(view, "EvidenceSplit");
    assert.match(split, /const matters = openMatters\(paper\);/);
    assert.match(
      split,
      /<Verdict[\s\S]{0,120}\/>\s*\{\/\* [^\n]*\*\/\}\s*<p className="dw-open">/,
    );
    assert.match(split, /onClick=\{actions\.onMatters\}/);
    // The count leads to the document's section 6.
    assert.match(
      body,
      /onMatters: \(\) => \{\s*choose\("document"\);\s*setSeeking\(true\);/,
    );
    assert.match(body, /getElementById\(`\$\{uid\}-matters`\)/);
    assert.match(body, /mattersId=\{`\$\{uid\}-matters`\}/);
    assert.match(
      component(view, "Section"),
      /<section className="dw-sec" id=\{anchor\}>/,
    );
    // The printed copy is a second sheet: it does not repeat the id.
    assert.match(body, /<DocumentSheet paper=\{paper\} actions=\{null\} \/>/);
  });
});

describe("the independent review of 16 November 2026, in the screen's own files", () => {
  it("3: holds the sign-off and Prepare from a recorded conclusion until the views read its version", () => {
    const body = component(view, "DesignWorkpaper");
    // Recorded: the views are read again, and nothing posts the version before.
    assert.match(
      body,
      /conclusion: \{ \.\.\.before\.paper\.conclusion, choice \},[\s\S]{0,120}?setRereading\(true\);\s*setAttempt\(\(n\) => n \+ 1\);/,
    );
    // A read that lands with a paper is the one that holds the new version.
    assert.match(
      body,
      /if \(paper !== null\) \{[\s\S]{0,200}?setRereading\(false\);\s*\}/,
    );
    // The sign-off is held as the fold's Prepare is: by `held`, never `behind` alone.
    assert.match(body, /behind: held \|\| rereading,/);
    assert.match(body, /onBehind\?\.\(held \|\| rereading\);/);
  });

  it("4: offers Reopen to change only to a viewer who may act, as the fold's Reopen", () => {
    assert.match(
      component(view, "SignOffOf"),
      /mayAct=\{\s*paper\.canEdit \|\| \(workpaper\.status === "PREPARED" && sign\.canAct\)\s*\}/,
    );
    assert.doesNotMatch(
      view,
      /mayAct=\{paper\.canEdit \|\| workpaper\.status === "PREPARED"\}/,
    );
    assert.match(
      component(view, "DesignWorkpaperStep"),
      /canAct=\{props\.canAct\}/,
    );
    assert.match(component(view, "DesignWorkpaper"), /\bcanAct,\n/);
    // The step's canAct is the card's: the role, and the engagement open.
    assert.match(
      controls,
      /const canAct =\s*canRequestEvidence\(model\.organization\.role\) &&\s*model\.selectedProject\?\.status === "ACTIVE";/,
    );
  });

  it("8: prints each result's sentence and the agent's reasons, open, with no toggle", () => {
    const results = component(view, "Results");
    assert.match(
      results,
      /const any = reasons\.length > 0 \|\| more\.length > 0;/,
    );
    assert.match(results, /\{any && why \? \(\s*<button/);
    assert.match(results, /hidden=\{why && !open\}/);
    // The printed sheet is the document with no actions: `why` is false there.
    assert.match(view, /<Results paper=\{paper\} why=\{actions !== null\} \/>/);
  });

  it("9: the fold no longer sends the preparer to a Prepare that is not there", () => {
    const step = component(view, "DesignWorkpaperStep");
    assert.doesNotMatch(step, /drafting, Prepare,/);
    assert.match(
      step,
      /The section editor, drafting, Reopen, the version history and the\s+Excel export/,
    );
    const body = component(view, "DesignWorkpaper");
    assert.doesNotMatch(body, /for you to edit and prepare/);
    assert.match(body, /The preparer signs at the end of section 7/);
  });
});
