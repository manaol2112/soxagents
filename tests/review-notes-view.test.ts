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
// Rewritten. Old: the "D&I Conclusion and Review" step's panel. New: section 7's Sign-off,
// where the reviewer signs (product owner, 16 November 2026, docs/design-workpaper.md section 3.8).
const panel = read("apps/web/src/review-signoff.tsx");
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
    // --rn-c colours only the dots, the highlighted words and their underline.
    // Rewritten. Old: ["mark.rn-hl", ".rn-card::before", ".rn-dot-pick:has(input:checked)
    // .rn-dot", ".rn-dot"]: the card's rule and the ring of the current dot as well. New:
    // the highlighted words and the dot alone (on the note's line, the pill, its menu);
    // the open note's rule is the ink's, not a colour. Product owner, 16 November 2026: notes rail, inbox (option 3).
    const uses = [...css.matchAll(/([^{}]+)\{[^{}]*var\(--rn-c[^{}]*\}/g)].map(
      (match) => (match[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "").trim(),
    );
    assert.deepEqual(uses, ["mark.rn-hl", ".rn-dot"]);
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
    // Rewritten. Old: one NoteActions menu held every action (reply, respond, clear,
    // reopen, dismiss, owner, criticality). New: the reply box (reply or respond, by
    // replyMode), Resolve (can.clear), the dots (can.criticality) and a small "···" menu
    // for the rest (owner, dismiss, reopen). Product owner, 16 November 2026: note card
    // B, margin icon, form on the right.
    const menu = component(view, "NoteMenu");
    for (const flag of ["reopen", "dismiss", "owner"]) {
      assert.match(menu, new RegExp(`can\\.${flag}\\b`), flag);
    }
    // A compact menu (the existing RowMenu), not a row of buttons.
    has(menu, "<RowMenu");
    const body = component(view, "NoteBody");
    has(body, "const answer = replyMode(note);");
    has(body, 'responds: answer === "respond"');
    has(body, "{note.can.clear ? (");
    has(body, "if (!selected || !note.can.criticality) {");
    // Rewritten. Old: the card's three dots (CritDots), the current one alone where
    // `can.criticality` was false. New: the open note's criticality pill, drawn only where
    // `can.criticality`. Product owner, 16 November 2026: notes rail, inbox (option 3).
    has(body, "{note.can.criticality ? ( <CritPill");
    for (const flag of ["respond", "reply"]) {
      assert.match(
        component(model, "replyMode"),
        new RegExp(`can\\.${flag}\\b`),
        flag,
      );
    }
    has(
      component(view, "OnField"),
      "const canRaise = ui.set?.canRaise === true;",
    );
    has(
      component(view, "NotesMargin"),
      "const canRaise = ui?.set?.canRaise === true;",
    );
  });

  it("changes the criticality in one press, shown only once confirmed", () => {
    // Rewritten. Old: three radio dots on the card, the checked one the note's
    // criticality (CritDots: checked={item === note.criticality}). New: a pill whose menu
    // lists Urgent, Normal, Follow-up as menuitemradio, the checked one the note's
    // criticality as the server has it; a pick asks the server and nothing moves before
    // it answers. Product owner, 16 November 2026: notes rail, inbox (option 3).
    const pill = component(view, "CritPill");
    has(pill, 'role="menuitemradio"');
    has(pill, "aria-checked={item === value}");
    has(pill, "if (item !== value) { onPick(item); }");
    has(pill, "{CRITICALITY_WORDS[value]}");
    const body = component(view, "NoteBody");
    has(body, "<CritPill value={note.criticality}");
    has(
      body,
      'run({ intent: "criticality", noteId: note.id, version: note.version, criticality: value, })',
    );
    // Keys 1, 2, 3 on the selected card, never while typing.
    has(body, "const value = criticalityForKey(event.key);");
    has(body, "typingIn(event.target)");
  });

  it("resolves with a typed reply: the reply first, then the clearing, each confirmed", () => {
    const body = squash(component(view, "NoteBody"));
    const at = (written: string) => body.indexOf(squash(written));
    const replied = at("const replied = await reply();");
    const stop = at("if (replied === null) { return; }");
    const moved = at("version = replied.version;");
    const clear = at(
      'await run({ intent: "clear", noteId: note.id, version });',
    );
    assert.ok(replied > 0, "the reply first");
    assert.ok(stop > replied, "stops at the first refusal");
    // The clearing goes on the version the reply's answer gave.
    assert.ok(moved > stop && clear > moved, "then the clearing");
  });

  it("shows in the thread only words people wrote, and no quote on the card", () => {
    has(component(view, "Thread"), "const events = threadEvents(note);");
    const card = `${component(view, "NoteCard")}${component(view, "NoteBody")}${component(view, "Thread")}`;
    assert.ok(!/note\.quote|rn-quote/.test(card), "no highlighted words");
    assert.ok(!/eventWords|CRITICALITY"|"OWNER"|"CLEARED"/.test(card));
    // Rewritten. Old: a resolved note's card folded to one line of its first words until
    // selected (NoteCard: `if (isClosed(note) && !selected)`, `{firstWords(note.text)}`).
    // New: every note is one line (its first words), a resolved one with a check, and the
    // selected one opens in place with a bold first line. Product owner, 16 November 2026: notes rail, inbox (option 3).
    const body = component(view, "NoteBody");
    has(
      body,
      '{closed ? ( <span className="rn-check" aria-hidden="true"> ✓ </span>',
    );
    has(body, "{selected ? headLine(note.text) : firstWords(note.text, 90)}");
    has(body, '{selected ? ( <div className="rn-item-body">');
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
  it("makes the rail a list, the switch toggles and the form labelled", () => {
    const rail = component(view, "NotesRail");
    has(rail, '<aside className="rn-rail" id={id} aria-label="Review notes"');
    // Rewritten. Old: one list of cards in NotesRail and four chips, each a toggle
    // (aria-pressed={ui.chips[chip.key]}). New: the notes grouped by criticality, each
    // group a labelled list of one-line buttons that the arrow keys move between, the
    // open one closed by Escape with the focus back on its line; and one switch, Open ·
    // Mine · Resolved, each a toggle. Product owner, 16 November 2026: notes rail, inbox (option 3).
    has(rail, "<RailList ui={ui} />");
    const list = component(view, "RailList");
    has(list, '<ol className="rn-list">{group.notes.map(card)}</ol>');
    has(list, "aria-labelledby={`@{id}-@{group.key}`}");
    has(
      component(view, "RailHead"),
      "aria-pressed={ui.railView.tab === tab.key}",
    );
    const moves = component(view, "moveInList");
    has(moves, '["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)');
    has(moves, "lines[next]?.focus();");
    const card = component(view, "NoteCard");
    has(card, 'event.key !== "Escape" ||');
    has(card, 'ui.select(null, "rail"); line?.focus({ preventScroll: true });');
    has(
      component(view, "NoteBody"),
      'aria-expanded={place === "rail" ? selected : undefined}',
    );
    const form = component(view, "RaiseForm");
    // Rewritten. Old: the form was a modal dialog over the document (role="dialog",
    // useFocusTrap(box), drawn through createPortal). New: a card in the rail's column
    // (a sheet at the bottom on a narrow window), never over the document, so the page
    // stays readable; labelled, with Escape to close. Product owner, 16 November 2026:
    // note card B, margin icon, form on the right.
    assert.ok(!/role="dialog"|useFocusTrap|createPortal/.test(form));
    assert.ok(!/createPortal/.test(view));
    has(form, "<form ref={box}");
    has(form, "aria-labelledby={`@{id}-head`}");
    has(form, 'event.key === "Escape"');
    assert.ok(count(form, /htmlFor=/g) >= 2);
    // It opens in the rail, which a note started while it is off turns on.
    has(component(view, "NotesRail"), "<RaiseForm");
    has(component(view, "ReviewNotesProvider"), "if (!railOn) { onRailOn(); }");
    assert.match(
      css,
      /@media \(max-width: 1100px\) \{[\s\S]*?\.rn-new \{\s*position: fixed;\s*right: 0;\s*bottom: 0;\s*left: 0;/,
    );
    // Rewritten. Old: the form's criticality was three labelled radios in a fieldset with
    // its legend (CriticalityChoice). New: the same pill as the open note's, Normal to
    // start, a labelled button that opens a menu of the three. Product owner, 16 November 2026: notes rail, inbox (option 3).
    has(form, '<CritPill value={criticality} label="Criticality"');
    const pill = component(view, "CritPill");
    has(pill, 'aria-haspopup="menu"');
    has(pill, 'role="menu"');
    has(pill, "aria-label={`@{label}: @{CRITICALITY_WORDS[value]}`}");
    has(
      component(view, "ReviewNotesProvider"),
      'setPendingCriticality("NORMAL");',
    );
    // A field's "Add review note" is a button, reachable from the keyboard.
    // Rewritten (independent review, 16 November 2026). Old: its label was always
    // `aria-label={`Add review note on ${where}`}`, as it always noted the whole field.
    // New: the same label where no words are selected in the field, given through
    // `addLabel`, which names the selected words where some are (finding 12).
    has(component(view, "OnField"), ": `Add review note on @{where}`;");
    has(component(view, "OnField"), "aria-label={addLabel}");
    // Rewritten. Old: a "+" on the field's corner, shown with the pointer or the focus
    // (button.rn-add:focus-visible { opacity: 1 }). New: the field's button takes no
    // room, and while the focus is in the field the margin shows its comment icon,
    // ringed, level with it; with the pointer, the icon follows the field pointed at.
    // Product owner, 16 November 2026: note card B, margin icon, form on the right.
    const margin = component(view, "NotesMargin");
    has(margin, 'root.addEventListener("focusin", focusIn);');
    has(
      margin,
      'root.addEventListener("pointermove", move, { passive: true });',
    );
    has(margin, 'document.addEventListener("selectionchange", check);');
    assert.match(margin, /"Add review note"/);
    assert.match(
      css,
      /button\.rn-margin-add\.is-focus \{\s*box-shadow: var\(--ring\);/,
    );
    assert.ok(!/rn-corner|rn-offer/.test(view + css), "no corner +");
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
    // Rewritten. Old: .rn-rail, .rn-corner, .rn-offer, .rn-pop. New: the rail, the
    // margin, the fields' keyboard buttons and the new note's form. Product owner, 16
    // November 2026: note card B, margin icon, form on the right.
    assert.match(
      css,
      /@media print \{\s*\.rn-rail,\s*\.rn-margin,\s*\.rn-add,\s*\.rn-new \{\s*display: none !important;/,
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
    // The margin is drawn inside the sheet's box; the provider turns the rail on.
    has(body, "<NotesMargin />");
    has(body, "railOn={railOn} onRailOn={showRail}");
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
    // Added (independent review, 16 November 2026): section 3 lists the conclusion
    // chosen too, `conclusion.choice`, which was in the model and never wired. A note on
    // it is on the field (it has no words to highlight).
    has(
      component(sheet, "ConclusionHead"),
      "<NoteField field={CONCLUSION_CHOICE}> <strong>{named}</strong> </NoteField>",
    );
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

  // Rewritten. Old: "the reviewer's step": its own read of the notes (ReviewNotesLine,
  // "3 review notes open · 1 urgent") with a link to All notes. New: section 7's Sign-off
  // says how many are open and urgent from the workpaper's one read of its notes, opens
  // the Notes view, and says the urgent ones hold the sign-off (product owner, 16 November 2026, docs/design-workpaper.md section 3.8).
  it("the reviewer's sign-off: how many are open and urgent, with the way to them", () => {
    has(panel, "<dt>Notes</dt>");
    has(panel, "notesWords(notes.open, notes.urgent)");
    has(panel, "onClick={onNotes}");
    has(panel, "{URGENT_HOLD}");
    const body = component(sheet, "DesignWorkpaper");
    has(body, "urgent: reviewNotes.set.counts.urgentOpen");
    has(body, 'onNotes: () => choose("notes")');
    assert.equal(/ReviewNotesLine/.test(view), false);
  });

  it("runs with the fast tier", () => {
    assert.match(
      makefile,
      /tests\/review-notes-model\.test\.ts tests\/review-notes-view\.test\.ts/,
    );
  });
});

describe("the independent review of 16 November 2026", () => {
  it("10: a write in doubt reads the notes again and says it may be saved", () => {
    const hook = component(view, "useReviewNotes");
    has(
      hook,
      'if (writeInDoubt(answer.status, false)) { // It may be on record: never "nothing was changed". The notes are read again, // so the list shows what the server holds before anyone tries again. read(true).catch(() => undefined); return { ok: false, problem: WRITE_IN_DOUBT, status: answer.status }; }',
    );
    // Before the 409 and 404 branch, which stays as it was.
    assert.ok(
      hook.indexOf("writeInDoubt(answer.status, false)") <
        hook.indexOf("if (answer.status === 409 || answer.status === 404) {"),
    );
  });

  it("11: a closed card says who closed it and when, and the history opens on request", () => {
    const body = component(view, "NoteBody");
    has(
      body,
      '{isClosed(note) && closedLine(note) !== "" ? ( // Who closed it and when: the evidence of review, on the card (section 2). <p className="rn-card-line rn-closed-line">{closedLine(note)}</p> ) : null}',
    );
    // Rewritten. Old: on the selected card, a "History" disclosure
    // (`{selected ? <History note={note} /> : null}`, <details> with its <summary>). New:
    // History is in the open note's "···" and shows the same rows under the note.
    // Product owner, 16 November 2026: notes rail, inbox (option 3).
    has(body, "{history ? <History note={note} /> : null}");
    has(
      component(view, "NoteMenu"),
      'label: history ? "Hide history" : "History", icon: "clock", onSelect: onHistory',
    );
    const history = component(view, "History");
    has(history, "const rows = historyOf(note);");
    has(history, '<p className="rn-history-head">History</p>');
    // Plain text only, as the thread.
    has(history, "<span>{row.words}</span>");
  });

  it("12: the field's keyboard button notes the words selected in it", () => {
    const field = component(view, "OnField");
    has(field, "const offer = offerOf(ui.rootRef.current, ui.texts);");
    has(
      field,
      "return offer !== null && offer.field === field ? offer : null;",
    );
    has(
      field,
      'if (offer?.anchor != null) { ui.startRaise({ anchorKind: "TEXT", field, anchor: offer.anchor,',
    );
    has(field, "? `Add review note on the selected words in @{where}`");
    has(field, "aria-label={addLabel}");
    // The keyboard button is still reached by Tab: no tabIndex of -1 on it.
    const button = field.slice(
      field.indexOf('className="rn-add"'),
      field.indexOf("/>", field.indexOf('className="rn-add"')),
    );
    assert.doesNotMatch(button, /tabIndex/);
  });

  it("13: the focus goes to the new note's card, and stays with a note just resolved or dismissed", () => {
    const form = component(view, "RaiseForm");
    const done = form.indexOf("ui.endRaise();");
    assert.ok(form.indexOf("focusCard(result.note.id, target.opener);") > done);
    const focus = component(view, "focusCard");
    has(focus, '`[data-rn-card="@{noteId}"] .rn-card-pick`');
    has(
      focus,
      "if (at !== null && at !== document.body && at.isConnected) { return; }",
    );
    const body = component(view, "NoteBody");
    has(
      body,
      'if (action.intent === "clear" || action.intent === "dismiss") {',
    );
    has(body, "focusCard(note.id);");
    // The rail keeps the selected note listed, as the document draws it.
    const provider = component(view, "ReviewNotesProvider");
    has(
      provider,
      "return selected === null || chosen.some((note) => note.id === selected) ? chosen",
    );
  });

  it("15: a note being written is kept when its form is replaced, and no pending highlight outlives the rail", () => {
    const provider = component(view, "ReviewNotesProvider");
    has(provider, "const drafts = useRef(new Map<string, string>());");
    has(
      provider,
      "if (railWas.current && !railOn) { setRaising(null); } railWas.current = railOn;",
    );
    const form = component(view, "RaiseForm");
    has(
      form,
      'const [text, setText] = useState(() => ui?.draftFor(key) ?? "");',
    );
    has(form, "ui.keepDraft(key, event.target.value);");
    // Cancel lets it go; Escape only closes.
    has(form, 'const cancel = () => { ui?.keepDraft(key, ""); close(); };');
    has(form, "onClick={cancel}");
    has(
      form,
      'if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); close();',
    );
    // The rail keys the form by the same place.
    has(component(view, "NotesRail"), "key={raiseKey(ui.raising)}");
  });

  it("16: too many words selected: the icon says so and notes nothing", () => {
    const margin = component(view, "NotesMargin");
    has(margin, "const tooLong = offer !== null && offer.anchor === null;");
    has(margin, "if (field === null || tooLong) { return; }");
    has(margin, 'aria-disabled={tooLong ? "true" : undefined}');
    has(margin, '{tooLong ? TOO_LONG_WORDS : "Add review note"}');
    const offer = component(view, "offerOf");
    has(offer, "if (anchor === null && !selectionTooLong(text, from, to)) {");
    // The keyboard button says it too, and does not note the field instead.
    const field = component(view, "OnField");
    has(field, "ui.announce(`@{TOO_LONG_WORDS}.`);");
    assert.match(rule(css, "button.rn-margin-add.is-refused"), /dashed/);
  });
});
