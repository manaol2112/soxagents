import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Workpaper review notes on the screen (docs/workpaper-review.md, section 6), read from
// the screen's own files. What must hold however it looks: nothing is set as HTML (the
// highlighted words are marks built as elements from the text); a write is shown as done
// only once the server confirmed it, and the notes are read again after it; the route
// answers in JSON with the session's cookie only, never a redirect, and logs nothing;
// colour is the criticality's only, and nowhere else; and the notes are wired in the
// four places the contract names (the Document view's rail and fields, the Notes view,
// the reviewer's step), never on the printed sheet. How it behaves in a browser is the
// harness's (notes-built).

const read = (path: string) => readFileSync(path, "utf8");
const view = read("apps/web/src/review-notes.tsx");
const model = read("apps/web/src/review-notes-model.ts");
const route = read("apps/web/app/workspace/review-notes/route.ts");
const css = read("apps/web/app/review-notes.css");
const sheet = read("apps/web/src/design-workpaper-view.tsx");
const sheetModel = read("apps/web/src/design-workpaper-model.ts");
const sheetCss = read("apps/web/app/design-workpaper.css");
const panel = read("apps/web/src/design-conclusion-panel.tsx");
const globals = read("apps/web/app/globals.css");
const layout = read("apps/web/app/layout.tsx");
const makefile = read("Makefile");

/** The source without its spaces, line breaks and trailing commas: what is written
 * matches however the formatter wraps it. */
const squash = (source: string) =>
  source.replace(/\s+/g, "").replace(/,(?=[)\]}>])/g, "");
/** Whether the source holds what is written. A placeholder of the source is written
 * `@{...}` here, so that no string of these tests holds one. */
const has = (source: string, written: string, label = written) =>
  assert.ok(
    squash(source).includes(squash(written.replaceAll("@{", "${"))),
    label,
  );
const count = (source: string, pattern: RegExp) =>
  (source.match(pattern) ?? []).length;
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
const rule = (sheetText: string, selector: string) => {
  const from = sheetText.indexOf(`${selector} {`);
  assert.ok(from >= 0, selector);
  return sheetText.slice(from, sheetText.indexOf("}", from));
};

describe("nothing is set as HTML", () => {
  it("builds the highlighted words, the notes and the thread as elements", () => {
    for (const [name, source] of [
      ["review-notes.tsx", view],
      ["review-notes-model.ts", model],
      ["route.ts", route],
    ] as const) {
      assert.ok(
        !/dangerouslySetInnerHTML|\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment/.test(
          source,
        ),
        name,
      );
    }
    // A highlight is a <mark> element whose child is the text's own piece.
    const words = component(view, "PaintedWords");
    has(
      words,
      "<mark key={piece.at} className={markClass(piece.painted, selected)}",
    );
    has(words, "{piece.text} </mark>");
    has(words, "piecesOf(words, offset, painted)");
    // A formatted text is parsed and drawn as RichText draws it, never as markup.
    has(
      component(view, "PaintedRich"),
      "return parseRich(text).map((block) => {",
    );
    // A person's words are children, never attributes or markup.
    has(view, '<p className="rn-text-body">{note.text}</p>');
    has(view, '<q className="rn-quote">{note.quote}</q>');
  });

  it("highlights in the criticality's colour: the words and a thin underline, no background", () => {
    const mark = rule(css, "mark.rn-hl");
    assert.match(mark, /color: var\(--rn-c\);/);
    assert.match(mark, /background: none;/);
    assert.match(mark, /text-decoration-line: underline;/);
    assert.match(mark, /text-decoration-color: var\(--rn-c\);/);
    assert.match(mark, /text-decoration-thickness: 1px;/);
    // The criticalities' colours, defined in the theme (light and dark), used only
    // through --rn-c.
    for (const [tone, token] of [
      ["urgent", "--note-urgent"],
      ["normal", "--note-normal"],
      ["follow-up", "--note-follow-up"],
    ] as const) {
      assert.match(
        rule(css, `.rn-${tone}`),
        new RegExp(`--rn-c: var\\(${token}\\);`),
      );
      assert.equal(count(css, new RegExp(`var\\(${token}\\)`, "g")), 1, token);
      assert.match(globals, new RegExp(`${token}: `));
    }
    assert.match(globals, /--note-urgent: var\(--danger\);/);
    assert.match(globals, /--note-normal: var\(--accent-strong\);/);
    // --rn-c colours only the dot, the card's rule, the highlighted words and their
    // underline.
    const uses = [...css.matchAll(/([^{}]+)\{[^{}]*var\(--rn-c[^{}]*\}/g)].map(
      (match) => (match[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "").trim(),
    );
    assert.deepEqual(uses, [
      "mark.rn-hl",
      ".rn-dot",
      ".rn-card::before,\n.rn-detail-note::before",
    ]);
    // No filled pill, no accent fill.
    assert.ok(!/var\(--accent\)/.test(css));
    assert.match(
      rule(css, "button.rn-btn.is-primary"),
      /background: var\(--text-strong\);/,
    );
  });
});

describe("a write is shown as done only once the server confirmed it", () => {
  const hook = component(view, "useReviewNotes");

  it("takes the note the server answered with, then reads the notes again", () => {
    has(
      hook,
      "const confirmed = answer.status === 200 ? parseNote(answer.result) : null;",
    );
    const refused = hook.indexOf("if (confirmed === null) {");
    const merged = hook.indexOf("withNote(current.set, confirmed)");
    assert.ok(refused > 0 && merged > refused);
    // A note that changed under the person: the notes are read again.
    has(hook, "if (answer.status === 409 || answer.status === 404) {");
    // The latest read wins; a late answer is dropped.
    has(hook, "const run = ++latest.current;");
    has(hook, "if (run !== latest.current) { return; }");
    // Nothing is put on screen before the request answers.
    assert.ok(hook.indexOf("withNote(") > hook.indexOf("await call({"));
  });

  it("closes the form and says it was added only after the answer", () => {
    const form = component(view, "RaiseForm");
    const sent = form.indexOf("await ui.notes.act({");
    const refused = form.indexOf("if (!result.ok) {");
    const done = form.indexOf(
      'ui.announce(doneWords("raise", result.note.number));',
    );
    const closed = form.indexOf("ui.endRaise();", done);
    assert.ok(sent > 0 && refused > sent && done > refused && closed > done);
    const body = component(view, "NoteBody");
    const asked = body.indexOf("const result = await ui.notes.act(action);");
    assert.ok(asked > 0 && body.indexOf("if (!result.ok) {") > asked);
    assert.ok(
      body.indexOf("ui.announce(doneWords(action.intent, note.number));") >
        asked,
    );
  });

  it("offers only what the server's `can` allows", () => {
    const actions = component(view, "NoteActions");
    for (const flag of [
      "reply",
      "respond",
      "clear",
      "reopen",
      "dismiss",
      "owner",
      "criticality",
    ]) {
      assert.match(actions, new RegExp(`can\\.${flag}\\b`), flag);
    }
    has(
      component(view, "OnField"),
      "const canRaise = ui.set?.canRaise === true;",
    );
    // A compact menu (the existing RowMenu), not a row of buttons.
    has(actions, "<RowMenu");
  });

  it("says refusals in role=alert", () => {
    assert.ok(count(view, /className="rn-problem" role="alert"/g) >= 2);
  });
});

describe("the route", () => {
  it("answers in JSON with the session's cookie, never a redirect, and logs nothing", () => {
    assert.ok(!/redirect\(|NextResponse\.redirect|console\./.test(route));
    has(route, 'headers.set("cookie", `aw_session=@{session}`);');
    has(route, 'redirect: "manual",');
    has(route, "const write = reviewNoteWrite(fields);");
    has(
      route,
      'return NextResponse.json({ status: 422, detail: "", result: null });',
    );
    has(route, "notesReadPath(new URL(request.url).searchParams)");
    // Who the session is, for "Mine": its id only.
    has(route, 'forward("/auth/me", { method: "GET" })');
    assert.ok(!/email/.test(route));
  });
});

describe("keyboard, screen reader and phone", () => {
  it("makes the rail a list, the chips toggles and the form labelled", () => {
    const rail = component(view, "NotesRail");
    has(rail, '<aside className="rn-rail" id={id} aria-label="Review notes"');
    has(rail, '<ol className="rn-list">');
    has(rail, "aria-pressed={ui.chips[chip.key]}");
    const form = component(view, "RaiseForm");
    has(form, 'role="dialog"');
    has(form, "aria-labelledby={`@{id}-head`}");
    has(form, "useFocusTrap(box);");
    has(form, 'event.key === "Escape"');
    assert.ok(count(form, /htmlFor=/g) >= 2);
    // The criticality is three labelled radios in a fieldset with its legend.
    const choice = component(view, "CriticalityChoice");
    has(choice, "<legend>Criticality</legend>");
    has(choice, 'type="radio"');
    // A field's "Add review note" is a button, reachable from the keyboard.
    has(
      component(view, "OnField"),
      "aria-label={`Add review note on @{where}`}",
    );
    assert.match(css, /button\.rn-add:focus-visible \{\s*opacity: 1;/);
  });

  it("keeps the filters for the session in the browser, not in the address", () => {
    has(view, "window.sessionStorage.getItem(filtersKey(workpaperId))");
    has(
      view,
      "window.sessionStorage.setItem(filtersKey(workpaperId), JSON.stringify(filters));",
    );
    assert.equal(count(view, /sessionStorage/g), 2);
    assert.ok(
      !/history\.(push|replace)State|location\.(href|assign|replace|search)/.test(
        view,
      ),
    );
    for (const name of ["readFilters", "keepFilters"]) {
      has(component(view, name), "try {");
    }
  });

  it("keeps motion short and lays out at a phone's width", () => {
    const times = [...css.matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g)].map(
      (match) => Number(match[1]) * (match[2] === "s" ? 1000 : 1),
    );
    assert.ok(times.length > 0);
    assert.ok(
      times.every((time) => time <= 250),
      times.join(),
    );
    assert.match(css, /@media \(max-width: 640px\)/);
    assert.match(
      css,
      /@media \(max-width: 1100px\) \{\s*\.rn-with-rail \{\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
    // And none of it is printed.
    assert.match(
      css,
      /@media print \{\s*\.rn-rail,\s*\.rn-corner,\s*\.rn-offer,\s*\.rn-pop \{\s*display: none !important;/,
    );
    assert.match(layout, /import "\.\/review-notes\.css";/);
  });
});

describe("wired in the four places", () => {
  it("the Document view: a Notes switch and the rail beside the sheet", () => {
    const body = component(sheet, "DesignWorkpaper");
    has(body, "const reviewNotes = useReviewNotes(notesScope);");
    has(body, 'className={`dw-notes-switch@{railOn ? " is-on" : ""}`}');
    has(body, "aria-pressed={railOn}");
    has(body, "{railOn ? <NotesRail id={`@{uid}-rail`} /> : null}");
    has(body, "<ReviewNotesProvider");
    // The printed sheet carries none of it.
    has(body, "!printing &&");
    has(body, "<DocumentSheet paper={paper} actions={null} />");
    assert.match(sheetCss, /button\.dw-notes-switch \{/);
  });

  it("the fields: markers and highlights where the contract lists them", () => {
    const doc = component(sheet, "DocumentSheet");
    for (const written of [
      "<NoteField field={UNDERSTANDING} text={understanding} rich>",
      "<NoteField field={CONCLUSION} text={conclusion.text} rich>",
      'field={controlKey("risk")}',
      'field={controlKey("activity")}',
      "field={procedureKey(index + 1)}",
      "field={walkthroughKey(step.number, stored.step)}",
      "field={walkthroughKey(step.number, stored.who)}",
      "field={walkthroughKey(step.number, stored.evidence)}",
      "field={walkthroughKey(step.number, stored.result)}",
      'field={attributeKey(attribute.id, "basis")}',
      'field={attributeKey(attribute.id, "note")}',
      '<NoteField field={attributeKey(attribute.id, "result")}>',
      "field={reportKey(index + 1, 1)}",
      "field={reportKey(index + 1, 2)}",
      "field={reportKey(index + 1, 3)}",
      "field={matterKey(index + 1)}",
    ]) {
      has(doc, written);
    }
  });

  it("the Notes view, fourth beside Document, Matrix and Evidence", () => {
    has(sheetModel, 'key: "notes", label: "Notes",');
    const body = component(sheet, "DesignWorkpaper");
    has(body, ') : view === "notes" ? ( <AllNotesView');
    has(
      body,
      '{item.key === "notes" && openNotes > 0 ? ` · @{openNotes}` : ""}',
    );
    has(body, "} else if (openedAtNotes()) {");
  });

  it("the reviewer's step: how many are open and urgent, with the way to them", () => {
    has(panel, "<dt>Review notes</dt>");
    has(panel, "<ReviewNotesLine");
    has(panel, "href={notesHref(assessmentHref)}");
    has(component(view, "ReviewNotesLine"), "{openLine(counts)}");
  });

  it("runs with the fast tier", () => {
    assert.match(
      makefile,
      /tests\/review-notes-model\.test\.ts tests\/review-notes-view\.test\.ts/,
    );
  });
});
