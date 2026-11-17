import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Editing a section of the D&I workpaper where it is (docs/design-workpaper.md, section
// 3.2), read from the screen's own files. What must hold however the editors look: one
// section at a time, in the document; what is edited and what may be saved come from the
// model; a save is one request, and nothing reads as saved until the server confirmed it
// and the views read the workpaper again; a refusal keeps what was typed; the fold and
// its card are what "Edit" falls back to, unchanged.

const read = (path: string) => readFileSync(path, "utf8");
const view = read("apps/web/src/design-workpaper-view.tsx");
const editor = read("apps/web/src/section-editor.tsx");
const model = read("apps/web/src/section-edit-model.ts");
const css = read("apps/web/app/design-workpaper.css");

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

const body = component(view, "DesignWorkpaper");

describe("Edit opens the section's editor where the document shows it", () => {
  it("gives the views the page's stored workpaper, and edits only that", () => {
    assert.match(
      component(view, "DesignWorkpaperStep"),
      /<DesignWorkpaper\n[\s\S]{0,260}papers=\{papers\}\s+onEdit=\{reveal\}/,
    );
    assert.match(
      body,
      /const source = useMemo\(\(\) => editSource\(papers, paper\), \[papers, paper\]\);/,
    );
    // The model says where "Edit" may open in place: the same workpaper, at the version
    // the views show, a draft that is not being drafted.
    assert.match(model, /item\.stage === "DESIGN" && item\.id === shown\.id/);
    assert.match(
      model,
      /stored\.currentVersion !== shown\.currentVersion \|\|/,
    );
  });

  it("opens in place where the model gives an editor, and the fold where it does not", () => {
    assert.match(
      body,
      /if \(\s*!editable\.has\(section\) \|\|\s*editing !== null \|\|\s*paper === null \|\|\s*behind\s*\) \{\s*return;\s*\}\s*const editor = editorFor\(section, source, paper\);\s*if \(source === null \|\| editor === null\) \{\s*\/\/ [^\n]*\n\s*onEdit\(section\);\s*return;\s*\}/,
    );
    // From the Matrix and the Evidence views it shows the Document, as a tab does.
    // Rewritten for autosave (product owner, 15 November 2026, docs/design-workpaper.md
    // section 3.4). Old expectation: the editor always opens on `draftOf(editor)`, what
    // is stored. New expectation: it opens on the person's working copy where `copyFor`
    // finds one (`restoredDraft`), and on what is stored otherwise; the copy it opened
    // with is kept with it for the restored notice.
    // Rewritten again after the independent review (15 November 2026). Old expectation:
    // the editor opens at once on `copyFor(editor, copies)`, whatever the read of the
    // copies had answered. New expectation: it waits while that read is out (`gate` is
    // "wait"); where the read failed it opens on what is stored, keeping off ("unknown"),
    // and reads them again; only after a read that answered does it open on the copy.
    assert.match(
      body,
      /if \(gate === "wait"\) \{\s*return;\s*\}\s*if \(view !== "document"\) \{\s*choose\("document"\);\s*\}\s*(?:\/\/ [^\n]*\n\s*)+const copy = gate === "open" \? copyFor\(editor, copies\) : null;\s*if \(gate === "unread"\) \{\s*working\.reread\(\);\s*\}\s*setSaved\(null\);\s*setEditing\(\{\s*section,\s*source,\s*editor,\s*draft:\s*copy === null \? draftOf\(editor\) : restoredDraft\(editor, copy\),\s*phase: "editing",\s*refusal: "",\s*restored: copy,\s*known: gate === "open" \? KNOWN : \{ state: "unknown" \},\s*\}\);/,
    );
    // The fold's own way in is as it was.
    const step = component(view, "DesignWorkpaperStep");
    assert.match(step, /onEdit=\{reveal\}/);
    // Rewritten (independent review, 15 November 2026, docs/design-workpaper.md section 3.6).
    // Old: `<WorkpapersTab compact {...props} stage="DESIGN" />`. New: the same card with
    // `prepareHeld={behind}`: a recorded conclusion moves the workpaper's version, and
    // Prepare waits until the page's records are read again.
    assert.match(
      step,
      /<WorkpapersTab\s+compact\s+\{\.\.\.props\}\s+stage="DESIGN"\s+prepareHeld=\{behind\}\s*\/>/,
    );
  });

  it("keeps one editor at a time: the other links are off, this one reads Editing", () => {
    assert.equal(count(body, /useState<Editing \| null>\(null\)/g), 1);
    const link = component(view, "EditLink");
    assert.match(
      link,
      /if \(editing !== null && editing\.section === section\) \{\s*return \(\s*<span className="pill tone-info dw-editing">\s*Editing<span className="sr-only"> \{what\}<\/span>/,
    );
    // Rewritten after the independent review (15 November 2026). Old expectation: off
    // while another editor is open or the records are behind. New expectation: also off
    // while the working copies are read (`checking`), so no editor opens without them.
    assert.match(
      link,
      /<button\s+type="button"\s+className="dw-edit"\s+data-edit=\{section\}\s+disabled=\{editing !== null \|\| actions\?\.behind === true \|\| checking\}\s+onClick=\{\(\) => onEdit\(section\)\}/,
    );
    // Still only where the model says the section may be edited.
    assert.match(
      link,
      /if \(onEdit === null \|\| !editable\) \{\s*return null;/,
    );
  });

  it("draws the editors in the document only, never in the other views or on paper", () => {
    const sheet = component(view, "DocumentSheet");
    // The understanding, the walkthrough, the reports and the conclusion: the text or
    // the grid, in the place of what it edits.
    assert.equal(count(sheet, /<SectionEditorPanel\b/g), 4);
    // Rewritten (docs/design-workpaper.md, section 3.10; product owner, 16 November 2026:
    // procedures first, the understanding as their result). Old: the panel was given
    // heading="Understanding of the control", the words over the box where the section's
    // own heading (then section 1's) was not right above it. New: the understanding is
    // section 3 of its own, its heading right above the box, so no heading is passed;
    // the same panel, in the same place of what it edits.
    assert.match(
      sheet,
      /\{understood !== null \? \(\s*<SectionEditorPanel \{\.\.\.understood\} \/>\s*\) : understanding\.length > 0 \? \(\s*<div className="dw-prose">/,
    );
    assert.match(
      sheet,
      /\{walking !== null \? \(\s*<SectionEditorPanel \{\.\.\.walking\} \/>\s*\) : paper\.walkthrough\.steps\.length === 0 \? \(/,
    );
    assert.match(
      sheet,
      /\{reporting !== null \? \(\s*<SectionEditorPanel \{\.\.\.reporting\} \/>\s*\) : paper\.reports\.length === 0 \? \(/,
    );
    // Rewritten 15 November 2026. Old: the verdict (`<Verdict conclusion={conclusion}
    // label="Design and implementation" />`) directly beside the conclusion's editor.
    // New: section 7 is one card, top to bottom: the agent's proposal or the preparer's
    // conclusion (ConclusionHead), the design and implementation results, the choice,
    // then the text with its one editor (product owner, 15 November 2026,
    // docs/design-workpaper.md section 3.5/3.6). The editor stays in the text's place.
    // Rewritten again (product owner, 16 November 2026: section 7 lighter, option A).
    // Old: `<ConclusionHead/> <Results/> <ConclusionChoiceOf/>` as siblings before the
    // text, and `<OutOfDate>` closing the text's block. New: ConclusionChoiceOf draws the
    // head, the results and the choice; why a sign-off is out of date is quietly under
    // the head (ConclusionHead); the text's block ends with "Edit conclusion". The
    // editor still stays in the text's place.
    assert.match(
      sheet,
      /<\/ConclusionChoiceOf>\s*<div className="dw-concl-text">\s*\{concluding !== null \? \(\s*<SectionEditorPanel \{\.\.\.concluding\} \/>\s*\) : conclusion\.text === "" \? \(/,
    );
    assert.match(
      component(view, "ConclusionHead"),
      /<OutOfDate reasons=\{conclusion\.outOfDate\} \/>\s*<\/div>/,
    );
    // The attributes' table stays as it is, inside the notes editor; each attribute's
    // note is a box in its own row, in the place of the note's paragraph.
    assert.equal(count(sheet, /<NotesFrame open=\{noting\}>/g), 1);
    assert.match(
      sheet,
      /\{notes !== null && item !== null \? \(\s*<NoteBox\s+item=\{item\}\s+notes=\{notes\.typed\}\s+phase=\{notes\.phase\}\s+onChange=\{notes\.onChange\}\s*\/>\s*\) : attribute\.notes !== "" \? \(\s*<p className="dw-note">/,
    );
    assert.match(
      sheet,
      /notes\?\.items\.find\(\(entry\) => entry\.id === attribute\.id\) \?\?\s*null;/,
    );
    assert.match(
      component(view, "NotesFrame"),
      /return open === null \? \(\s*children\s*\) : \(\s*<NotesEditorPanel \{\.\.\.open\}>\{children\}<\/NotesEditorPanel>/,
    );
    // The section open is read from the actions, which the printed sheet does not have.
    assert.match(sheet, /const open = actions\?\.editing \?\? null;/);
    assert.match(body, /<DocumentSheet paper=\{paper\} actions=\{null\} \/>/);
    for (const name of ["MatrixBoard", "EvidenceSplit", "Timeline"]) {
      assert.ok(
        !/SectionEditorPanel|NotesFrame|NotesEditorPanel|NoteBox/.test(
          component(view, name),
        ),
        name,
      );
    }
    // The view itself still defines no box and no write: they are the editors' file's.
    assert.ok(!/<textarea\b|<input\b|<form\b|"POST"/.test(view));
    assert.equal(count(view, /fetch\(/g), 1);
  });

  it("puts the focus in the editor when it opens, and back on the Edit link when it closes", () => {
    assert.match(
      body,
      /root\.current\?\.querySelector<HTMLElement>\("\[data-section-editor\]"\) \?\? null;/,
    );
    // Rewritten for the formatted text box (product owner, 15 November 2026,
    // docs/design-workpaper.md section 3.3). Old expectation: the first box is looked for
    // as a `textarea` only. New expectation: the text section's box is a textbox that is
    // not a textarea, so the first of either takes the focus; the grid's and the notes'
    // first box is still their first textarea.
    assert.match(
      body,
      /frame\.querySelector<HTMLElement>\('\[role="textbox"\], textarea'\) \?\?\s*frame\.querySelector<HTMLElement>\("button:not\(:disabled\)"\);\s*first\?\.focus\(\{ preventScroll: true \}\);\s*frame\.scrollIntoView\(\{[\s\S]{0,200}behavior: calm\(\) \? "auto" : "smooth",/,
    );
    assert.match(body, /\}, \[openSection, view\]\);/);
    // Back to the link, unless the person has already moved on.
    assert.match(
      body,
      /if \(closed === null \|\| editing !== null\) \{\s*return;\s*\}\s*setClosed\(null\);\s*const active = document\.activeElement;\s*if \(active !== null && active !== document\.body\) \{\s*return;\s*\}/,
    );
    assert.match(body, /`button\[data-edit="\$\{closed\}"\]`/);
    assert.match(
      body,
      /\(link \?\? tabs\.current\.get\(view\)\)\?\.focus\(\);/,
    );
  });

  it("does not print while a section is open in its editor", () => {
    assert.match(
      body,
      /\{view === "document" && paper !== null && editing !== null \? \(\s*(?:\/\/ [^\n]*\n\s*)+<button\s+type="button"\s+className="btn-secondary btn-sm"\s+disabled\s+title="Save or cancel the section you are editing before printing\."\s*>/,
    );
    assert.equal(count(body, /\/> Print or save as PDF/g), 2);
    assert.equal(count(body, /setPrinting\(true\)/g), 1);
  });
});

describe("Cancel, Escape and leaving the page", () => {
  it("asks before giving up what was typed, and only then", () => {
    assert.match(
      body,
      /const cancel = \(\) => \{\s*if \(editing === null \|\| editing\.phase !== "editing"\) \{\s*return;\s*\}\s*if \(\s*changed\(editing\.editor, editing\.draft\) &&\s*!window\.confirm\(DISCARD_QUESTION\)\s*\) \{\s*return;\s*\}\s*setEditing\(null\);\s*setClosed\(editing\.section\);/,
    );
    // Rewritten for autosave (product owner, 15 November 2026, docs/design-workpaper.md
    // section 3.4). Old expectation: one `window.confirm` in the view (Cancel's). New
    // expectation: two, Cancel's and "Discard them" over a restored working copy, both
    // asking DISCARD_QUESTION only where something changed.
    // Rewritten after the independent review (15 November 2026). Old expectation: two.
    // New expectation: three, with "Use them" over a working copy found after the editor
    // opened, which also gives up what was typed only where the person says so.
    assert.equal(count(view, /window\.confirm\(/g), 3);
    assert.equal(count(view, /!window\.confirm\(DISCARD_QUESTION\)/g), 3);
    assert.match(
      model,
      /DISCARD_QUESTION = "Discard your changes to this section\?"/,
    );
  });

  it("takes Escape inside the editor as Cancel, and lets it close nothing else", () => {
    const frame = component(editor, "Frame");
    assert.match(
      frame,
      /if \(event\.key !== "Escape" \|\| event\.nativeEvent\.isComposing\) \{\s*return;\s*\}\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*onCancel\(\);/,
    );
    assert.match(frame, /data-section-editor=""\s+onKeyDown=\{onKey\}/);
    assert.match(frame, /aria-label=\{`Editing: \$\{title\}`\}/);
    assert.match(frame, /aria-busy=\{phase !== "editing"\}/);
    // Both editors are drawn inside that frame.
    assert.equal(count(editor, /<Frame title=\{editor\.title\}/g), 2);
  });

  it("asks before the page is left only while something is typed and not kept", () => {
    // Rewritten for autosave (product owner, 15 November 2026, docs/design-workpaper.md
    // section 3.4). Old expectation: the browser's prompt whenever something changed and
    // the editor was not refreshing. New expectation: while an editor is open and not
    // refreshing, the prompt only while the latest change is not kept as the working copy
    // (`keeper.unkept()`); a kept copy is there on return. tests/autosave-view.test.ts
    // pins what "not kept" means.
    assert.match(
      body,
      /const open = editing !== null && editing\.phase !== "refreshing";\s*useEffect\(\(\) => \{\s*if \(!open\) \{\s*return;\s*\}\s*const ask = \(event: BeforeUnloadEvent\) => \{\s*if \(keeper\.unkept\(\)\) \{\s*event\.preventDefault\(\);\s*\}\s*\};/,
    );
    assert.match(body, /window\.addEventListener\("beforeunload", ask\);/);
    assert.match(body, /window\.removeEventListener\("beforeunload", ask\);/);
    assert.equal(count(view, /"beforeunload"/g), 2);
  });
});

describe("saving", () => {
  it("sends one request, as JSON, through the page's own route", () => {
    assert.equal(count(editor, /fetch\(/g), 1);
    assert.match(
      component(editor, "sendSection"),
      /fetch\("\/workspace\/workpapers\/section", \{\s*method: "POST",\s*headers: \{ "content-type": "application\/json" \},\s*body: JSON\.stringify\(body\),\s*\}\);/,
    );
    // What is sent is the model's request, on the workpaper the editor was opened on:
    // its version is what the server checks, so a newer one is never written over.
    // Rewritten for redrafting a section a person has edited (product owner, 16 November
    // 2026, docs/design-workpaper.md section 3.11). Old expectation: the model's request is
    // sent as it is. New expectation: the same request, which names the agent's draft the
    // editor holds (withProposal, namedDraft: none where it holds none or is back to the
    // person's own text), so the version's note and audit event say the text began as the
    // agent's and a person saved it.
    assert.match(
      body,
      /const answer = await sendSection\(\s*(?:\/\/ [^\n]*\n\s*)?withProposal\(\s*saveRequest\(scope, open\.source, open\.editor, open\.draft\),\s*namedDraft\(usedNow\),\s*\),\s*\);/,
    );
    assert.equal(count(view, /sendSection\(/g), 1);
    assert.match(model, /based_on: source\.basedOn,/);
    // Nothing here posts a form, redirects or changes the address.
    for (const source of [view, editor]) {
      assert.ok(
        !/<form\b|type="submit"|\baction=["'{]|history\.(push|replace)State|location\.(href|assign|replace|reload)|\.push\(["'`/]/.test(
          source,
        ),
      );
    }
  });

  it("takes an answer it cannot read, or none, as not saved", () => {
    const send = component(editor, "sendSection");
    assert.match(
      send,
      /status: typeof answer\.status === "number" \? answer\.status : 0,\s*detail: typeof answer\.detail === "string" \? answer\.detail : "",/,
    );
    assert.match(
      send,
      /\} catch \{\s*return \{ status: 0, detail: "" \};\s*\}/,
    );
    assert.match(
      model,
      /export function saveProblem\(status: number, detail: string\): string \{\s*if \(status === 200\) \{\s*return "";\s*\}/,
    );
  });

  it("sends only what the model allows, once however often Save is pressed", () => {
    assert.match(
      body,
      /const save = async \(\) => \{\s*const open = editing;\s*if \(\s*open === null \|\|\s*open\.phase !== "editing" \|\|\s*sending\.current \|\|\s*!changed\(open\.editor, open\.draft\) \|\|\s*draftProblem\(open\.editor, open\.draft\) !== ""\s*\) \{\s*return;\s*\}\s*sending\.current = true;\s*setEditing\(\{ \.\.\.open, phase: "saving", refusal: "" \}\);/,
    );
    // The button says the same: off until something changed, while a limit is passed,
    // and while a save is out.
    const bar = component(editor, "EditorBar");
    assert.match(bar, /const busy = phase !== "editing";/);
    assert.match(bar, /const dirty = changed\(editor, draft\);/);
    assert.match(bar, /const problem = draftProblem\(editor, draft\);/);
    assert.match(
      bar,
      /disabled=\{busy \|\| !dirty \|\| problem !== ""\}\s+aria-describedby=\{`\$\{uid\}-state`\}\s+onClick=\{onSave\}\s*>\s*Save\s*<\/button>/,
    );
    assert.match(
      bar,
      /disabled=\{busy\}\s+onClick=\{onCancel\}\s*>\s*Cancel\s*<\/button>/,
    );
  });

  it("keeps the editor and what was typed when the server refuses, and says why", () => {
    // Rewritten after the independent review (15 November 2026). Old expectation: the
    // refusal is set straight after the mounted check. New expectation: a way out taken
    // while the save was out is taken up first (`afterSave`), and on a refusal the dialog
    // opens with it; the editor and what was typed stay as before.
    // Rewritten again for redrafting (product owner, 16 November 2026, section 3.11). Old
    // expectation: after a 409 the records and the views are read again, and nothing else.
    // New expectation: the same, and where the 409 says the agent's draft the save named
    // changed, the editor keeps its text, no longer named as that draft, and the proposal
    // is read again.
    assert.match(
      body,
      /sending\.current = false;\s*const refusal = saveProblem\(answer\.status, answer\.detail\);[\s\S]{0,420}if \(!mounted\.current\) \{\s*return;\s*\}\s*(?:\/\/ [^\n]*\n\s*)+const then = afterSave\.current;\s*afterSave\.current = null;\s*if \(refusal !== ""\) \{\s*setEditing\(\(before\) =>\s*before === null \? before : \{ \.\.\.before, phase: "editing", refusal \},\s*\);\s*if \(then !== null\) \{\s*(?:\/\/ [^\n]*\n\s*)+proceed\.current = then;\s*setWaited\(false\);\s*setAsking\(true\);\s*\}\s*if \(answer\.status === 409\) \{\s*(?:\/\/ [^\n]*\n\s*)+refreshRecords\(\);\s*setAttempt\(\(count\) => count \+ 1\);\s*\}\s*(?:\/\/ [^\n]*\n\s*)+if \(draftChanged\(answer\.status, answer\.detail\)\) \{\s*setUsed\(null\);\s*setProposalRead\(\(count\) => count \+ 1\);\s*\}\s*return;\s*\}/,
    );
    const bar = component(editor, "EditorBar");
    assert.match(
      bar,
      /\{refusal !== "" && !busy \? \(\s*<p className="se-refusal" role="alert">\s*\{refusal\}\s*<\/p>\s*\) : null\}/,
    );
    assert.equal(count(editor, /role="alert"/g), 1);
  });

  it("never says saved before the server confirmed and the views read again", () => {
    // Confirmed: the editor stays, read-only, and the views and the page's records are
    // read again.
    assert.match(
      body,
      /confirmed\.current = open\.section;\s*setEditing\(\(before\) =>\s*before === null \? before : \{ \.\.\.before, phase: "refreshing" \},\s*\);\s*(?:\/\/ [^\n]*\n\s*)+setAttempt\(\(count\) => count \+ 1\);\s*\};/,
    );
    // The editor closes, and the section says it was saved, in one place only: after a
    // read that began once the save was confirmed has finished, whichever read that is
    // (the records' change starts a second one, which stops the first).
    assert.match(
      body,
      /let current = true;\s*(?:\/\/ [^\n]*\n\s*)+const shows = confirmed\.current;\s*setState\(\(before\) => \(\{ \.\.\.before, loading: true \}\)\);/,
    );
    assert.match(
      body,
      /if \(!current\) \{\s*return;\s*\}[\s\S]*if \(shows !== null && confirmed\.current === shows\) \{\s*confirmed\.current = null;\s*setEditing\(null\);\s*setSaved\(shows\);\s*setClosed\(shows\);\s*\}\s*\}\)\(\);/,
    );
    assert.equal(count(view, /setSaved\(/g), 2);
    assert.equal(count(view, /setSaved\(shows\)/g), 1);
    assert.equal(count(view, /setSaved\(null\)/g), 1);
    assert.equal(count(view, /confirmed\.current = /g), 2);
    // The words are the model's, said in a line that is there from the start, and the
    // editors' own file never says them.
    assert.equal(count(view, /\bSAVED\b/g), 2);
    assert.match(
      component(view, "DocumentSheet"),
      /actions === null \|\| !editable\.has\(section\)\s*\? undefined\s*: actions\.saved === section\s*\? SAVED\s*: "";/,
    );
    assert.match(
      component(view, "Section"),
      /\{said !== undefined \? \(\s*<p className="dw-saved" role="status">\s*\{said\}\s*<\/p>\s*\) : null\}/,
    );
    assert.ok(!/\bSAVED\b|Saved as/.test(editor));
    assert.match(
      model,
      /export const SAVED = "Saved as a new version of the draft\.";/,
    );
  });

  it("is read-only and says Saving while the save is out", () => {
    const bar = component(editor, "EditorBar");
    assert.match(
      bar,
      /<p role="status" id=\{`\$\{uid\}-state`\}>\s*\{busy \? \(\s*SAVING\s*\) : \(/,
    );
    // Rewritten for autosave (product owner, 15 November 2026, docs/design-workpaper.md
    // section 3.4). Old expectation: "Unsaved changes" and then the limit's problem. New
    // expectation: "Unsaved changes" stays (the workpaper does not have them), then where
    // the working copy stands (`keepingWords`, never "saved"), then the limit's problem.
    assert.match(
      bar,
      /\{dirty \? \(\s*<span className="se-unsaved">\s*<span className="se-dot" aria-hidden="true" \/>\s*\{UNSAVED\}\s*<\/span>\s*\) : null\}\s*\{kept !== "" \? \([\s\S]{0,400}\{kept\}\s*<\/span>\s*\) : null\}\s*\{problem !== "" \? \(\s*<span className="se-problem">\{problem\}<\/span>\s*\) : null\}/,
    );
    assert.equal(count(editor, /readOnly=\{busy\}/g), 2);
    assert.match(
      component(editor, "NoteBox"),
      /readOnly=\{phase !== "editing"\}/,
    );
    // Typing changes nothing while it is not "editing".
    assert.match(
      body,
      /before === null \|\| before\.phase !== "editing"\s*\? before\s*: \{ \.\.\.before, draft \},/,
    );
  });

  it("reads the page's records again in the background, without loading a page", () => {
    assert.match(
      component(editor, "useRecordsRefresh"),
      /const router = useRouter\(\);\s*return useCallback\(\s*\(\) => startTransition\(\(\) => router\.refresh\(\)\),\s*\[router\],?\s*\);/,
    );
    assert.equal(count(editor, /router\./g), 1);
    // Only for a save the server took, and then whatever became of the view that sent
    // it: the records are the page's.
    assert.match(
      body,
      /const refusal = saveProblem\(answer\.status, answer\.detail\);\s*if \(refusal === ""\) \{\s*(?:\/\/ [^\n]*\n\s*)+refreshRecords\(\);\s*\}\s*(?:\/\/ [^\n]*\n\s*)+if \(!mounted\.current\) \{\s*return;\s*\}/,
    );
    // And once more after a 409 (the workpaper is not as the page has it), so "Edit"
    // after "Cancel" opens the latest (review, 15 November 2026): never for any other
    // refusal.
    // Rewritten (product owner, 15 November 2026, docs/design-workpaper.md section 3.7).
    // Old: 2 (a confirmed save, a 409). New: 3, the third after the preparer's sign-off
    // or reopening was confirmed (the `signOff.onDone` of the view). Rewritten again
    // (section 3.9). Old: 3. New: 4, the fourth after a consideration of a point was
    // recorded or withdrawn (`points.onSettled`): it moves the workpaper's version, as a
    // recorded conclusion does.
    assert.equal(count(view, /refreshRecords\(\)/g), 4);
    assert.match(
      view,
      /onDone: \(\) => \{\s*setAttempt\(\(n\) => n \+ 1\);\s*refreshRecords\(\);\s*\}/,
    );
    assert.match(
      body,
      /if \(answer\.status === 409\) \{\s*(?:\/\/ [^\n]*\n\s*)+refreshRecords\(\);/,
    );
  });

  it("keeps Edit off while the page's records are behind the views, and the fold's box fresh", () => {
    // Review, 15 November 2026: right after a save the views show the new version while
    // the page's records still hold the one before. "Edit" used to fall back to the fold
    // then, whose box held the text before the save and could write it over the save.
    assert.match(
      body,
      /const behind = useMemo\(\(\) => recordsBehind\(papers, paper\), \[papers, paper\]\);/,
    );
    // Rewritten (docs/design-workpaper.md, section 3.9). Old: `behind,` then `onMatters:`.
    // New: the matters' link is gone; `onPoint:` (a point at its place) follows.
    assert.match(body, /\n\s*behind,\n\s*onPoint:/);
    // The card's editor of a section is another one for each version: an uncontrolled
    // box keeps what it was mounted with, and the records now change under it.
    assert.match(
      read("apps/web/src/workpaper-view.tsx"),
      /<SectionView\s*(?:\/\/ [^\n]*\n\s*)+key=\{`\$\{section\.key\}:\$\{paper\.currentVersion\}`\}/,
    );
  });

  it("says a confirmed save that could not be read again as saved, never as 'nothing was changed'", () => {
    assert.match(
      body,
      /shows !== null\s*\? SAVED_NOT_READ\s*: \(loadProblem\(status\) \?\?/,
    );
  });

  it("never leaves an editor with nowhere to be drawn", () => {
    // The notes editor is drawn in the attributes' table: with no attribute left after a
    // read, its frame and its bar (Cancel) are still there.
    assert.match(
      component(view, "DocumentSheet"),
      /paper\.attributes\.length === 0 && noting === null \? \(/,
    );
  });

  it("drops an answer that arrives after the view has gone to another control", () => {
    assert.match(
      component(view, "DesignWorkpaperStep"),
      /key=\{scope\.controlId\}/,
    );
    assert.match(
      body,
      /useEffect\(\(\) => \{\s*mounted\.current = true;\s*return \(\) => \{\s*mounted\.current = false;\s*\};\s*\}, \[\]\);/,
    );
  });
});

describe("the editors", () => {
  it("decide nothing: what is edited, its limits and its rows are the model's", () => {
    assert.match(editor, /from "\.\/section-edit-model";/);
    assert.match(editor, /rows: setCell\(rows, at, index, value\),/);
    assert.match(editor, /rows: addRow\(rows, editor\.columns\.length\)/);
    assert.match(editor, /rows: removeRow\(rows, at\)/);
    assert.match(
      editor,
      /notes: \{ \.\.\.notes, \[item\.id\]: cleanCell\(value\) \},/,
    );
    assert.match(editor, /const full = rows\.length >= EDIT_LIMITS\.rows;/);
    // No limit of its own, and no rule about who may edit.
    assert.ok(!/12[_,]?000|\b1[_,]000\b|\b300\b/.test(editor));
    assert.ok(
      !/canEdit|can_edit|status === "DRAFT"|editableSections/.test(editor),
    );
  });

  it("names every box, and makes every control a real button", () => {
    // One box component, always named.
    assert.equal(count(editor, /<textarea\b/g), 1);
    assert.match(
      component(editor, "AutoArea"),
      /<textarea\s+ref=\{box\}\s+className=\{className\}\s+rows=\{1\}\s+value=\{value\}\s+aria-label=\{label\}/,
    );
    // Rewritten for the formatted text box (product owner, 15 November 2026,
    // docs/design-workpaper.md section 3.3). Old expectation: three plain boxes (the
    // text, a grid cell, a note). New expectation: two plain boxes (a grid cell, a note)
    // and the text section's formatted one; every one of the three is still named.
    assert.equal(count(editor, /<AutoArea\b/g), 2);
    assert.equal(count(editor, /<RichTextBox\b/g), 1);
    assert.equal(count(editor, /(?<![\w-])label=\{/g), 3);
    assert.match(editor, /label=\{editor\.title\}/);
    assert.match(
      editor,
      /label=\{`\$\{column\}, \$\{editor\.rowWord\} \$\{at \+ 1\}`\}/,
    );
    assert.match(
      editor,
      /label=\{`Preparer's note, attribute \$\{item\.code\}`\}/,
    );
    assert.equal(
      count(editor, /<button\b/g),
      count(editor, /\btype="button"/g),
    );
    // Rewritten for autosave (product owner, 15 November 2026, docs/design-workpaper.md
    // section 3.4). Old expectation: four buttons (Cancel, Save, Remove, Add). New
    // expectation: five, with "Discard them" over an editor that opened with a working
    // copy.
    // Rewritten after the independent review (15 November 2026). Old expectation: five.
    // New expectation: six, with "Use them" over a working copy found after the editor
    // opened (offered, never put in place of what the editor holds).
    assert.equal(count(editor, /<button\b/g), 6);
    assert.match(
      editor,
      /aria-label=\{`Remove \$\{editor\.rowWord\} \$\{at \+ 1\}`\}/,
    );
  });

  it("shows the grid as #, the stored columns and a remove button, with the model's words", () => {
    const grid = component(editor, "GridBox");
    assert.match(
      grid,
      /<th scope="col" className="is-num">\s*#\s*<\/th>\s*\{heads\.map\(\(\{ key, item: column \}\) => \(\s*<th scope="col" key=\{key\}>\s*\{column\}\s*<\/th>\s*\)\)\}\s*<th scope="col" className="se-col-x">\s*<span className="sr-only">Remove<\/span>/,
    );
    assert.match(grid, /<td className="is-num">\{at \+ 1\}<\/td>/);
    assert.match(
      grid,
      /<UiIcon name="plus" size=\{13\} \/> \{editor\.addLabel\}/,
    );
    assert.match(grid, /<p className="dw-quiet">\{editor\.note\}<\/p>/);
    assert.match(grid, /disabled=\{busy \|\| full\}/);
    // A row keeps its own key while rows above it go, and the focus is never left on a
    // button that went.
    assert.match(grid, /<tr key=\{keys\[at\]\}>/);
    assert.match(
      grid,
      /wanted\.current = `\[data-cell="\$\{rows\.length\}:0"\]`;/,
    );
    assert.match(
      grid,
      /rows\.length > 1\s*\? `\[data-remove="\$\{Math\.min\(at, rows\.length - 2\)\}"\]`\s*: "\[data-add\]";/,
    );
    assert.match(model, /addLabel: "Add a step"/);
    assert.match(model, /addLabel: "Add a report"/);
  });

  it("shows the section's guidance as a hint that describes the box", () => {
    const panel = component(editor, "SectionEditorPanel");
    assert.match(
      panel,
      /const hint = editor\.guidance !== "" \? `\$\{uid\}-hint` : undefined;/,
    );
    assert.match(
      panel,
      /<p className="se-hint dw-quiet" id=\{hint\}>\s*\{editor\.guidance\}\s*<\/p>/,
    );
    assert.match(panel, /describedBy=\{hint\}/);
    assert.match(
      component(editor, "NotesEditorPanel"),
      /\{editor\.guidance !== "" \? \(\s*<p className="se-hint dw-quiet">\{editor\.guidance\}<\/p>/,
    );
  });

  it("makes a box as tall as what is in it", () => {
    assert.match(
      component(editor, "fit"),
      /area\.style\.height = "auto";\s*area\.style\.height = `\$\{area\.scrollHeight \+ area\.offsetHeight - area\.clientHeight\}px`;/,
    );
    const area = component(editor, "AutoArea");
    assert.match(
      area,
      /useLayoutEffect\(\(\) => \{\s*if \(box\.current !== null\) \{\s*fit\(box\.current\);\s*\}\s*\}, \[value\]\);/,
    );
    // And again when its width changes, off the observer's own turn.
    assert.match(area, /new ResizeObserver\(/);
    assert.match(
      area,
      /frame = window\.requestAnimationFrame\(\(\) => fit\(area\)\);/,
    );
    assert.match(area, /watch\.disconnect\(\);/);
    assert.match(
      css,
      /\.se-frame textarea \{\s*display: block;\s*overflow: hidden;\s*resize: none;\s*\}/,
    );
  });

  it("says the organization plainly: no client, no dash", () => {
    for (const source of [editor, model]) {
      assert.ok(!/\bthe client\b/i.test(source));
      assert.ok(!source.includes("—"));
    }
  });
});

describe("the editors' styles", () => {
  /** Every rule of the sheet: its selectors and its declarations. */
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? "").trim(),
    body: match[2] ?? "",
  }));
  const own = rules.filter((rule) =>
    /\.se-|\.dw-editing|\.dw-saved|\.dw-edit:disabled/.test(rule.selectors),
  );

  it("move nothing, so there is nothing to turn off under reduced motion", () => {
    assert.ok(own.length >= 20);
    for (const rule of own) {
      assert.ok(
        !/\b(transition|animation)(-[a-z]+)?:/.test(rule.body),
        rule.selectors,
      );
    }
  });

  it("use the tokens only", () => {
    for (const rule of own) {
      assert.ok(
        !/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(rule.body),
        rule.selectors,
      );
    }
    assert.match(
      css,
      /\.se-frame \{[^}]*border: 1\.5px solid var\(--accent\);/,
    );
    assert.match(css, /\.se-refusal \{\s*color: var\(--danger\);/);
    assert.match(css, /\.dw-saved \{\s*color: var\(--success\);/);
  });

  it("keep the grid inside its own frame, and let the bar wrap", () => {
    assert.match(
      css,
      /\.se-grid-wrap \{[^}]*position: relative;\s*overflow-x: auto;\s*\}/,
    );
    assert.match(css, /\.se-bar \{\s*display: flex;\s*flex-wrap: wrap;/);
    assert.match(css, /\.se-frame \{\s*min-width: 0;/);
    assert.match(css, /\.se-status \{[^}]*min-width: 0;/);
    // The document's own tables keep what only a screen reader hears inside their
    // scroll as well, so a narrow page is never widened by them. Rewritten after the
    // screenshot check of 3.9 (16 November 2026). Old: the rule ended at overflow-x;
    // new: it also makes the wrap a size container, so a point under a row is as wide as
    // the window onto the table at 390 px. The scroll inside the frame is unchanged.
    assert.match(
      css,
      /\.dw-table-wrap \{[^}]*position: relative;\s*margin-top: 0\.75rem;\s*overflow-x: auto;[^}]*container-type: inline-size;\s*\}/,
    );
  });

  it("show the focus on the remove button, and the other Edit links as off", () => {
    assert.match(
      css,
      /button\.se-x:focus-visible:not\(:disabled\) \{\s*box-shadow: var\(--ring\);/,
    );
    assert.match(
      css,
      /button\.dw-edit:disabled,\s*button\.dw-edit:disabled:hover \{\s*color: var\(--text-tertiary\);\s*text-decoration: none;/,
    );
    // The line a save is said in takes no room until it has words.
    assert.match(css, /\.dw-saved:not\(:empty\) \{\s*margin-top: 0\.5rem;/);
  });
});
