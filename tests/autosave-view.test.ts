import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Autosave, and leaving with changes (docs/design-workpaper.md, section 3.4; product owner,
// 15 November 2026), read from the screen's own files. What must hold however the page
// looks: what is typed is kept as the person's working copy (never called saved), 1.5 s
// after the last change, one request at a time with the latest text; a version is added
// only by Save, confirmed by the server; Cancel discards the copy; going elsewhere in the
// app with changes asks first, and goes on only as the person chose; closing the tab asks
// only while the latest is not kept, and sends it as the page goes. The browser checks
// (headless, synthetic data) are the scratchpad harness's; this file pins the wiring.

const read = (path: string) => readFileSync(path, "utf8");
const view = read("apps/web/src/design-workpaper-view.tsx");
const editor = read("apps/web/src/section-editor.tsx");
const hook = read("apps/web/src/working-copy.ts");
const dialog = read("apps/web/src/leave-dialog.tsx");
const css = read("apps/web/app/design-workpaper.css");
const makefile = read("Makefile");

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

describe("the working copies are read", () => {
  it("for the stored workpaper Edit opens in place, again when its id or version changes", () => {
    // Rewritten after the independent review (15 November 2026). Old expectation: the open editor's
    // section is always passed, so a read that lands after it opened drops the server's
    // copy of it. New expectation: only for an editor that knows what the server holds;
    // for one that does not, the read is taken as it is and offered (`afterRead`).
    assert.match(
      body,
      /const working = useWorkingCopies\(\s*scope,\s*source\?\.workpaperId \?\? null,\s*source\?\.basedOn \?\? null,\s*editing !== null && editing\.known\.state === "known"\s*\? editing\.editor\.key\s*: null,\s*\);\s*const \{ copies \} = working;\s*const gate = editGate\(working\.read\);/,
    );
    const reader = component(hook, "useWorkingCopies");
    assert.match(
      reader,
      /if \(workpaperId === null\) \{\s*return;\s*\}\s*const control = new AbortController\(\);\s*let current = true;/,
    );
    assert.match(
      reader,
      /fetch\(\s*`\$\{ROUTE\}\?\$\{copiesQuery\(\{ organizationId, projectId \}, workpaperId\)\}`,\s*\{ cache: "no-store", signal: control\.signal \},\s*\)/,
    );
    assert.match(
      reader,
      /\}, \[organizationId, projectId, workpaperId, version, attempt\]\);/,
    );
    assert.match(
      reader,
      /return \(\) => \{\s*current = false;\s*control\.abort\(\);\s*\};/,
    );
    assert.match(hook, /const ROUTE = "\/workspace\/workpapers\/draft";/);
  });

  it("reads them cautiously, and a failed read never blocks editing", () => {
    const reader = component(hook, "useWorkingCopies");
    assert.match(
      reader,
      /found = body\.status === 200 \? parseWorkingCopies\(body\.result\) : null;/,
    );
    assert.match(reader, /\} catch \{\s*found = null;\s*\}/);
    // Rewritten after the independent review (15 November 2026). Old expectation: a failed read
    // returns and says nothing, so "Edit" opened as if there were no copy. New
    // expectation: it is said to the page ("failed", unless a read of this workpaper's
    // copies answered), where "Edit" opens with keeping off; the page waits only
    // while the read is out ("reading").
    assert.match(
      reader,
      /if \(!current\) \{\s*return;\s*\}\s*if \(found === null\) \{\s*(?:\/\/ [^\n]*\n\s*)+setStatus\(\(before\) =>\s*before\.target === asked && before\.read === "read"\s*\? before\s*: \{ target: asked, read: "failed" \},\s*\);\s*return;\s*\}/,
    );
    assert.match(
      reader,
      /setStatus\(\{ target: asked, read: "read" \}\);\s*setAnswered\(\(count\) => count \+ 1\);/,
    );
    assert.match(
      reader,
      /const read = status\.target === target \? status\.read : "reading";/,
    );
    // Nothing about the read is said as an alert.
    assert.ok(!/role="alert"|setProblem|problem/.test(reader));
    // The open editor's own writes are what the page knows of its section.
    assert.match(
      reader,
      /\.\.\.read\.filter\(\(copy\) => copy\.section !== key\),\s*\.\.\.before\.filter\(\(copy\) => copy\.section === key\),/,
    );
  });

  it("reads them again after a save and after a discard", () => {
    // Rewritten after the independent review (15 November 2026). Old expectation: `saved` takes the
    // section. New expectation: also the keeps counted as the save was sent (`atSave`),
    // and a way out taken while the save was out goes on once it is confirmed.
    assert.match(
      body,
      /keeper\.saved\(scope, open\.source\.workpaperId, open\.editor\.key, atSave\);\s*working\.reread\(\);\s*(?:\/\/ [^\n]*\n\s*)+then\?\.\(\);\s*confirmed\.current = open\.section;/,
    );
    assert.match(body, /onGone: working\.reread,/);
    assert.equal(count(hook, /told\.current\.onGone\(\);/g), 2);
  });
});

describe("opening with a working copy", () => {
  it("opens with the copy, restored, where copyFor finds one", () => {
    // Rewritten after the independent review (15 November 2026). Old expectation: `copyFor` whatever
    // the read had answered. New expectation: only once the read answered.
    assert.match(
      body,
      /const copy = gate === "open" \? copyFor\(editor, copies\) : null;/,
    );
    assert.match(
      body,
      /draft:\s*copy === null \? draftOf\(editor\) : restoredDraft\(editor, copy\),\s*phase: "editing",\s*refusal: "",\s*restored: copy,\s*known: gate === "open" \? KNOWN : \{ state: "unknown" \},/,
    );
  });

  it("says it was restored, and that the section may have changed, over the box", () => {
    // Rewritten after the independent review (15 November 2026). Old expectation: the note only for
    // the copy the editor opened with. New expectation: first, a copy found by a read
    // that landed after it opened is offered (Use them, Discard them).
    assert.match(
      body,
      /restored:\s*editing\.known\.state === "found"\s*\? \{\s*words: foundWords\(editing\.known\.copy\),\s*stale: copyIsStale\(editing\.known\.copy, editing\.source\),\s*onDiscard: discardFound,\s*onUse: useFound,\s*\}\s*: editing\.restored === null\s*\? null\s*: \{\s*words: restoredWords\(editing\.restored\),\s*stale: copyIsStale\(editing\.restored, editing\.source\),\s*onDiscard: discardRestored,\s*\},/,
    );
    const note = component(editor, "RestoredNote");
    assert.match(
      note,
      /\{restored\.stale \? \(\s*<span className="se-restored-stale"> \{STALE_COPY\}<\/span>/,
    );
    assert.match(note, /\{DISCARD_COPY\}/);
    assert.match(note, /disabled=\{busy\}\s+onClick=\{restored\.onDiscard\}/);
    // Inside the frame, under the guidance, before the box: in both editors.
    assert.match(
      component(editor, "SectionEditorPanel"),
      /\{editor\.guidance\}\s*<\/p>\s*\) : null\}\s*<RestoredNote restored=\{restored\} busy=\{busy\} \/>\s*\{editor\.kind === "text"/,
    );
    assert.match(
      component(editor, "NotesEditorPanel"),
      /\) : null\}\s*<RestoredNote restored=\{restored\} busy=\{phase !== "editing"\} \/>\s*\{children\}/,
    );
  });

  it("Discard them asks only where it gives up a change, then shows what is stored and discards", () => {
    const discard = body.slice(body.indexOf("const discardRestored = () => {"));
    assert.match(
      discard,
      /if \(open === null \|\| open\.phase !== "editing" \|\| open\.restored === null\) \{\s*return;\s*\}\s*if \(changed\(open\.editor, open\.draft\) && !window\.confirm\(DISCARD_QUESTION\)\) \{\s*return;\s*\}\s*setEditing\(\{\s*\.\.\.open,\s*draft: draftOf\(open\.editor\),\s*restored: null,\s*refusal: "",\s*\}\);\s*keeper\.discard\(scope, open\.source\.workpaperId, open\.editor\.key, true\);/,
    );
  });
});

describe("keeping as they type", () => {
  it("waits 1.5 s after the last change, and the timer goes with the editor that set it", () => {
    assert.match(
      hook,
      // Rewritten after the independent review (15 November 2026). Old expectation: no `off` in what
      // starts the pause again. New expectation: keeping off, and back on, does too.
      /wait\.current = window\.setTimeout\(\(\) => \{\s*void keeper\.request\(\);\s*\}, KEEP_AFTER_MS\);\s*return \(\) => window\.clearTimeout\(wait\.current\);\s*\}, \[session, key, phase, hasCopy, off, keeper\]\);/,
    );
    // No pause of its own: the model's.
    assert.ok(!/\b1500\b|\b15_?000\b/.test(hook));
    assert.ok(!/\b1500\b|\b15_?000\b/.test(view));
  });

  it("is paused while a save is out or the views read again, and never keeps for a closed editor", () => {
    // Rewritten after the independent review (15 November 2026). Old expectation: the pause and the
    // sync look at the phase and a refusal only. New expectation: the pause also stops
    // where keeping is off (and says so), and every send asks `mayKeep` (the phase,
    // keeping off, a refusal, a save the server confirmed), tested in the model.
    assert.match(
      hook,
      /const now = latest\.current;\s*if \(now === null \|\| now\.phase !== "editing" \|\| blocked\.current\) \{\s*return;\s*\}\s*if \(now\.off !== null\) \{\s*(?:\/\/ [^\n]*\n\s*)+setKeeping\(\s*changed\(now\.editor, now\.draft\)\s*\? \{ state: "off", why: now\.off \}\s*: \{ state: "none" \},\s*\);\s*return;\s*\}\s*const action = keepAction\(now\.editor, now\.draft, now\.hasCopy\);/,
    );
    const sync = hook.slice(hook.indexOf("const sync = async"));
    assert.match(
      sync,
      /queued\.current = false;\s*const now = latest\.current;\s*if \(now === null \|\| !may\(now\)\) \{\s*return;\s*\}/,
    );
    assert.match(
      hook,
      /const may = \(now: KeepingOpen\) =>\s*mayKeep\(now, \{\s*blocked: blocked\.current,\s*saved: savedFor\.current === now\.editor,\s*\}\);/,
    );
    // A new editor (or none) starts again: its own timers gone, nothing kept but its copy.
    assert.match(
      hook,
      /useEffect\(\(\) => \{\s*window\.clearTimeout\(retry\.current\);\s*window\.clearTimeout\(wait\.current\);\s*kept\.current = null;/,
    );
  });

  it("sends one request at a time, the latest text when it is sent, never an older one after it", () => {
    // One queue for every write of the page.
    assert.match(
      hook,
      /const next = chain\.current\s*\.then\(op\)\s*\.catch\(\(\) => undefined\)\s*\.finally\(\(\) => \{\s*pending\.current -= 1;\s*\}\);\s*chain\.current = next;/,
    );
    // One sync waiting at a time, and it reads the latest when it runs.
    assert.match(
      hook,
      /const request = \(\): Promise<void> => \{\s*if \(queued\.current\) \{\s*return chain\.current;\s*\}\s*queued\.current = true;\s*return enqueue\(sync\);\s*\};/,
    );
    // Rewritten after the independent review (15 November 2026). Old expectation: the editor's own
    // source. New expectation: `keepBasis`, so a restored copy keeps the version it was
    // started from (tested in the model).
    assert.match(
      hook,
      /const \{ editor, draft, scope \} = now;\s*(?:\/\/ [^\n]*\n\s*)+const source = keepBasis\(now\.source, now\.restored\);\s*const action = keepAction\(editor, draft, now\.hasCopy\);/,
    );
    // What the server holds is not sent again.
    assert.match(
      hook,
      /if \(key === kept\.current \|\| \(gone\.current && key === beaconed\.current\)\) \{/,
    );
    // An answer for an editor that has closed changes nothing on its bar.
    assert.match(
      hook,
      /const same = \(editor: SectionEditor\) => latest\.current\?\.editor === editor;/,
    );
  });

  it("sends the model's bodies through the page's route, never a save", () => {
    assert.match(
      hook,
      /sendCopy\(keepRequest\(scope, source, editor, draft\)\)/,
    );
    assert.match(hook, /sendCopy\(discardRequest\(scope, source, editor\)\)/);
    assert.match(
      component(hook, "sendCopy"),
      /fetch\(ROUTE, \{\s*method: "POST",\s*headers: \{ "content-type": "application\/json" \},\s*body: JSON\.stringify\(body\),\s*cache: "no-store",\s*keepalive,\s*\}\);/,
    );
    assert.match(
      component(hook, "sendCopy"),
      /\} catch \{\s*return \{ status: 0, detail: "", updatedAt: null \};\s*\}/,
    );
    assert.ok(!/workpapers\/section/.test(hook));
    assert.equal(count(view, /sendSection\(/g), 1);
  });

  it("says failed in the model's words, tries again where it may, and stops where the server refused", () => {
    assert.match(
      hook,
      /const problem = keepProblem\(answer\.status, answer\.detail\);/,
    );
    assert.match(
      hook,
      /setKeeping\(\{ state: "failed", detail: problem\.detail \}\);\s*window\.clearTimeout\(retry\.current\);\s*if \(problem\.retry\) \{\s*retry\.current = window\.setTimeout\(\(\) => \{\s*void request\(\);\s*\}, KEEP_RETRY_MS\);\s*\} else \{\s*blocked\.current = true;\s*\}/,
    );
    // Kept: the time the server gave, and the copy known locally (so a change back is a
    // discard).
    assert.match(
      hook,
      /const at = answer\.updatedAt \?\? new Date\(\)\.toISOString\(\);/,
    );
    assert.match(
      hook,
      /told\.current\.onKept\(\{\s*section: editor\.key,\s*basedOn: source\.basedOn,/,
    );
    // Rewritten after the independent review (15 November 2026). Old expectation: a discard only
    // forgets the copy. New expectation: it also drops the restored note (`dropRestored`).
    assert.match(
      body,
      /onKept: working\.remember,\s*(?:\/\/ [^\n]*\n\s*)+onDiscarded: \(section\) => \{\s*working\.forget\(section\);\s*setEditing\(\(before\) => dropRestored\(before, section\)\);\s*\},/,
    );
  });
});

describe("the bar", () => {
  it("says where the working copy stands after Unsaved changes, and never Saved", () => {
    const bar = component(editor, "EditorBar");
    assert.match(bar, /const kept = keepingWords\(keeping\);/);
    assert.match(
      bar,
      /\{UNSAVED\}\s*<\/span>\s*\) : null\}\s*\{kept !== "" \? \(/,
    );
    // Rewritten after the independent review (15 November 2026). Old expectation: only a failed keep
    // reads as a warning. New expectation: keeping off does too.
    assert.match(
      bar,
      /keeping\.state === "failed" \|\| keeping\.state === "off"\s*\? "se-keeping is-failed"\s*: "se-keeping"/,
    );
    assert.match(
      component(editor, "EditorBar"),
      /<p role="status" id=\{`\$\{uid\}-state`\}>\s*\{busy \? \(\s*SAVING\s*\) : \(/,
    );
    assert.match(
      editor,
      /\/\*\* Where the working copy of what is typed stands \(section 3\.4\)\. \*\/\s*keeping: Keeping;/,
    );
    assert.match(body, /keeping: keeper\.keeping,/);
    // No word of "saved" in what the editors, the hook or the dialog show (their code,
    // without the comments that say so).
    const code = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const source of [editor, hook, dialog]) {
      assert.ok(!/\bSAVED\b/.test(code(source)));
      assert.ok(
        !/"[^"\n]*\bsaved\b[^"\n]*"|>[^<\n]*\bsaved\b/i.test(code(source)),
      );
    }
  });
});

describe("saving, and Cancel", () => {
  it("lets a working copy on its way land before the save, which deletes it", () => {
    // Rewritten after the independent review (15 November 2026). Old expectation: the save is sent
    // after the settle, and `saved` discards only while a keep is still pending. New
    // expectation: the keeps are counted as the save is sent (`mark`), and `saved`
    // discards whenever a keep was out then or sent since (`copyMayOutliveSave`, tested in
    // the model), even one that answered before the save did; nothing is kept after.
    assert.match(
      body,
      /setEditing\(\{ \.\.\.open, phase: "saving", refusal: "" \}\);\s*(?:\/\/ [^\n]*\n\s*)+await keeper\.settle\(SETTLE_MS\);\s*(?:\/\/ [^\n]*\n\s*)+const atSave = keeper\.mark\(\);\s*const answer = await sendSection\(/,
    );
    assert.match(body.length > 0 ? view : "", /const SETTLE_MS = 2000;/);
    assert.match(
      hook,
      /const saved = \(\s*scope: Scope,\s*workpaperId: string,\s*section: string,\s*atSave: KeepCount,\s*\) => \{\s*kept\.current = null;\s*savedFor\.current = latest\.current\?\.editor \?\? null;\s*window\.clearTimeout\(wait\.current\);\s*window\.clearTimeout\(retry\.current\);\s*told\.current\.onDiscarded\(section\);\s*if \(copyMayOutliveSave\(atSave, count\.current\)\) \{\s*void enqueue\(discardOp\(scope, workpaperId, section\)\);\s*\}\s*\};/,
    );
    // Every keep is counted as it is sent and as it answers.
    assert.match(
      hook,
      /count\.current = \{ \.\.\.count\.current, sent: count\.current\.sent \+ 1 \};\s*const answer = await sendCopy\(keepRequest\(scope, source, editor, draft\)\);\s*count\.current = \{\s*\.\.\.count\.current,\s*answered: count\.current\.answered \+ 1,\s*\};/,
    );
  });

  it("Cancel discards the working copy, after asking where something changed", () => {
    // Rewritten after the independent review (15 November 2026). Old expectation: Cancel always
    // discards. New expectation: never a copy the editor did not know of (the read
    // failed, or one was found and the person has not chosen).
    assert.match(
      body,
      /setEditing\(null\);\s*setClosed\(editing\.section\);\s*(?:\/\/ [^\n]*\n\s*)+if \(editing\.known\.state !== "known"\) \{\s*return;\s*\}\s*keeper\.discard\(\s*scope,\s*editing\.source\.workpaperId,\s*editing\.editor\.key,\s*copies\.some\(\(copy\) => copy\.section === editing\.editor\.key\),\s*\);/,
    );
    // Known to be there, or a keep on its way: discarded, after it.
    assert.match(
      hook,
      /if \(known \|\| pending\.current > 0\) \{\s*void enqueue\(discardOp\(scope, workpaperId, section\)\);\s*\}/,
    );
  });
});

describe("the Edit link of a section with a working copy", () => {
  it("reads Continue editing, with Unsaved changes beside it, where Edit is offered", () => {
    const link = component(view, "EditLink");
    assert.match(
      link,
      /if \(onEdit === null \|\| !editable\) \{\s*return null;/,
    );
    assert.match(
      link,
      /const copied = actions\?\.copied\.has\(section\) === true;/,
    );
    assert.match(
      link,
      /\{copied \? CONTINUE_EDITING : "Edit"\}\s*<span className="sr-only"> \{what\}<\/span>/,
    );
    assert.match(
      link,
      /<span className="dw-edit-group">\s*<span className="pill tone-neutral dw-has-copy">\{HAS_COPY\}<\/span>\s*\{link\}\s*<\/span>/,
    );
    // The open section's link still reads Editing, before any of this.
    assert.ok(
      link.indexOf('className="pill tone-info dw-editing"') <
        link.indexOf("const copied"),
    );
    // Only for a section of the stored workpaper Edit opens in place.
    assert.match(body, /if \(source === null\) \{\s*return found;\s*\}/);
  });
});

describe("leaving with changes", () => {
  it("asks while an editor is open with changes, while its save is out, or the dialog is open, and lets go after", () => {
    // Rewritten after the independent review (15 November 2026). Old expectation: only while the
    // phase is "editing" with changes (or the dialog is open), so a way out taken while
    // a save was out went unasked. New expectation: the model's `guarding` (tested in
    // leave-guard.test.ts) also holds it while the save is out, and a way out taken then
    // waits for the save's answer (`whenAsked`, `afterSave`).
    assert.match(
      body,
      /const guarding =\s*editing !== null &&\s*guardingNow\(\{\s*phase: editing\.phase,\s*changed: changed\(editing\.editor, editing\.draft\),\s*asking: askingNow,\s*\}\);/,
    );
    assert.match(
      body,
      /useEffect\(\(\) => \{\s*if \(!guarding\) \{\s*return;\s*\}\s*(?:\/\/ [^\n]*\n\s*)+return setLeaveAsker\(\(next\) => \{\s*const now = asked\.current;\s*if \(\s*now\.phase !== null &&\s*whenAsked\(\{ phase: now\.phase, asking: now\.asking \}\) === "after-save"\s*\) \{\s*afterSave\.current = next;\s*return;\s*\}\s*proceed\.current = next;\s*setWaited\(false\);\s*setAsking\(true\);\s*\}\);\s*\}, \[guarding\]\);\s*useGuardedLinks\(guarding\);/,
    );
    // Going on happens once: the pending destination is taken before it is used.
    assert.match(
      body,
      /const goOn = \(\) => \{\s*const next = proceed\.current;\s*proceed\.current = null;\s*setAsking\(false\);\s*setWaited\(false\);\s*next\?\.\(\);\s*\};/,
    );
  });

  it("goes on after Save only once the server confirmed it, and stays on a refusal", () => {
    assert.match(
      body,
      /onSave=\{async \(\) => \{\s*const section = editing\.section;\s*await save\(\);\s*(?:\/\/ [^\n]*\n\s*)+if \(confirmed\.current === section\) \{\s*goOn\(\);\s*\} else \{\s*stay\(\);\s*\}\s*\}\}/,
    );
    // The same save as the bar's: one request, never a second path.
    assert.equal(count(view, /sendSection\(/g), 1);
  });

  it("Leave without saving sends the latest at once, waits about a second at most, and goes on only once it is kept", () => {
    // Rewritten after the independent review (15 November 2026). Old expectation: after the flush the
    // page goes on whatever happened. New expectation: only where the keep was confirmed,
    // or where the person was told the changes are not kept and chose to lose them;
    // otherwise the dialog stays and says so (`waited`, worded by `leaveWords`).
    assert.match(
      body,
      /onLeave=\{async \(lose\) => \{\s*(?:\/\/ [^\n]*\n\s*)+await keeper\.flush\(LEAVE_WAIT_MS\);\s*if \(lose \|\| !keeper\.unkept\(\)\) \{\s*goOn\(\);\s*\} else \{\s*setWaited\(true\);\s*\}\s*\}\}/,
    );
    assert.match(
      body,
      /words=\{leaveWords\(\{\s*keeping: keeper\.keeping,\s*problem: draftProblem\(editing\.editor, editing\.draft\),\s*unkept: keeper\.unkept\(\),\s*waited,\s*\}\)\}/,
    );
    assert.match(view, /const LEAVE_WAIT_MS = 1000;/);
    assert.match(
      hook,
      /const flush = async \(limit: number\): Promise<void> => \{\s*window\.clearTimeout\(wait\.current\);\s*await Promise\.race\(\[request\(\), pause\(limit\)\]\);\s*\};/,
    );
  });

  it("the dialog: modal, labelled and described, Save first, then Leave without saving, then Keep editing", () => {
    const box = component(dialog, "LeaveDialog");
    assert.match(
      box,
      /<dialog\s+ref=\{box\}\s+className="confirm-dialog leave-dialog"\s+aria-modal="true"\s+aria-labelledby=\{`\$\{id\}-title`\}\s+aria-describedby=\{`\$\{id\}-body`\}/,
    );
    assert.match(
      box,
      /<h2 id=\{`\$\{id\}-title`\}>\{LEAVE\.title\(section\)\}<\/h2>/,
    );
    // Rewritten after the independent review (15 November 2026). Old expectation: the fixed
    // LEAVE.body and LEAVE.leave. New expectation: the model's words for where the
    // working copy stands (`leaveWords`), and the refusal of a save, if any.
    assert.match(box, /<p id=\{`\$\{id\}-body`\}>\{words\.body\}<\/p>/);
    assert.match(
      box,
      /\{refusal !== "" \? <p className="leave-problem">\{refusal\}<\/p> : null\}/,
    );
    assert.match(
      box,
      /onClick=\{\(\) => run\("leave", \(\) => onLeave\(words\.lose\)\)\}\s*>\s*\{words\.leave\}/,
    );
    const save = box.indexOf("LEAVE.save}");
    const leave = box.indexOf("{words.leave}");
    const stay = box.indexOf("{LEAVE.stay}");
    assert.ok(
      save > 0 && save < leave && leave < stay,
      `${save} ${leave} ${stay}`,
    );
    // Save is the primary button; the other two are secondary.
    assert.match(
      box,
      /<button\s+type="button"\s+disabled=\{doing !== null \|\| problem !== ""\}\s+onClick=\{\(\) => run\("save", onSave\)\}\s*>/,
    );
    assert.equal(count(box, /className="btn-secondary"/g), 2);
    assert.equal(count(box, /<button\b/g), 3);
    assert.match(box, /useFocusTrap\(box\);/);
    assert.match(box, /element\.showModal\(\);/);
  });

  it("the dialog: Escape is Keep editing, the focus returns, and a second press does nothing", () => {
    const box = component(dialog, "LeaveDialog");
    assert.match(
      box,
      /onCancel=\{\(event\) => \{\s*(?:\/\/ [^\n]*\n\s*)+event\.preventDefault\(\);\s*stay\(\);\s*\}\}/,
    );
    assert.match(
      box,
      /if \(before\?\.isConnected\) \{\s*before\.focus\(\{ preventScroll: true \}\);\s*\}/,
    );
    assert.match(
      box,
      /const run = \(what: "save" \| "leave", work: \(\) => Promise<void>\) => \{\s*if \(busy\.current\) \{\s*return;\s*\}\s*busy\.current = true;/,
    );
    // Drawn outside the editor's frame, so Escape in it never reaches the editor's Cancel.
    assert.ok(body.indexOf("<LeaveDialog") > body.indexOf("{body}"));
  });
});

describe("guarded navigation", () => {
  const files = {
    workflow: read("apps/web/src/control-workflow.tsx"),
    page: read("apps/web/src/controls-page.tsx"),
    toolbar: read("apps/web/src/controls-toolbar.tsx"),
    overview: read("apps/web/src/controls-overview.tsx"),
  };

  it("the step switcher, the panel's close, the control switcher and the toolbar go through useGuardedRouter", () => {
    for (const [name, source] of Object.entries(files)) {
      assert.match(
        source,
        /import \{ useGuardedRouter \} from "\.\/guarded-router";/,
        name,
      );
    }
    assert.equal(count(files.workflow, /useGuardedRouter\(\)/g), 2);
    assert.ok(!/useRouter\b/.test(files.workflow));
    assert.match(
      files.workflow,
      /\(key: StepKey\) => router\.push\(hrefs\[key\], \{ scroll: false \}\)/,
    );
    assert.match(
      files.workflow,
      /router\.push\(closeHref, \{ scroll: false \}\);/,
    );
    assert.equal(count(files.page, /useGuardedRouter\(\)/g), 1);
    assert.ok(!/useRouter\b/.test(files.page));
    assert.match(files.page, /router\.push\(controlHref\(ids, item\.id\)\);/);
    assert.equal(count(files.toolbar, /useGuardedRouter\(\)/g), 1);
    assert.ok(!/useRouter\b/.test(files.toolbar));
  });

  it("the overview's layout memory goes through it; its other routers only refresh", () => {
    const memory = component(files.overview, "LayoutMemory");
    assert.match(memory, /const router = useGuardedRouter\(\);/);
    assert.match(memory, /router\.replace\(tableHref, \{ scroll: false \}\);/);
    assert.equal(count(files.overview, /useRouter\(\)/g), 2);
    assert.equal(
      count(files.overview, /router\.(push|replace|back|forward)\(/g),
      1,
    );
  });
});

describe("closing or reloading the tab", () => {
  it("prompts only while the latest change is not kept", () => {
    assert.match(
      body,
      /const ask = \(event: BeforeUnloadEvent\) => \{\s*if \(keeper\.unkept\(\)\) \{\s*event\.preventDefault\(\);\s*\}\s*\};/,
    );
    assert.match(
      hook,
      /const unkept = \(\): boolean => \{\s*const now = latest\.current;\s*return \(\s*now !== null &&\s*now\.phase !== "refreshing" &&\s*changed\(now\.editor, now\.draft\) &&\s*keyOf\(now\.editor, now\.draft\) !== kept\.current\s*\);\s*\};/,
    );
  });

  it("sends what is not kept yet with keepalive as the page goes, and a large body as the tab is hidden", () => {
    // Rewritten after the independent review (15 November 2026). Old expectation: pagehide sends a
    // keepalive keep of any size, and the editor going without being asked sends one
    // outside the queue, even while a save is out. New expectation: what is sent is
    // `goingKeep`'s (tested in the model): keepalive within its limit; a larger body is
    // kept, in the queue, as the tab is hidden; the Back button keeps in the queue; never
    // while a save is out, after one, or with keeping off. Kept only once answered.
    assert.match(
      body,
      /const going = \(\) => keeper\.beacon\(\);\s*(?:\/\/ [^\n]*\n\s*)+const hidden = \(\) => \{\s*if \(document\.visibilityState === "hidden"\) \{\s*keeper\.hidden\(\);\s*\}\s*\};\s*window\.addEventListener\("beforeunload", ask\);\s*window\.addEventListener\("pagehide", going\);\s*document\.addEventListener\("visibilitychange", hidden\);/,
    );
    assert.match(body, /window\.removeEventListener\("pagehide", going\);/);
    assert.match(
      body,
      /document\.removeEventListener\("visibilitychange", hidden\);/,
    );
    assert.match(hook, /beacon: \(\) => send\("pagehide"\),/);
    assert.match(hook, /hidden: \(\) => send\("hidden"\),/);
    assert.match(hook, /leave: \(\) => send\("unmount"\),/);
    assert.match(
      hook,
      /const plan = goingKeep\(\{\s*when,\s*may: may\(now\),\s*unkept: unkept\(\),\s*action: keepAction\(now\.editor, now\.draft, now\.hasCopy\),\s*key,\s*beaconed: beaconed\.current,\s*sending: sending\.current,\s*bytes: bodyBytes\(body\),\s*\}\);\s*if \(plan === "keepalive"\) \{\s*beaconed\.current = key;\s*void sendCopy\(body, true\);\s*\} else if \(plan === "queue"\) \{\s*(?:\/\/ [^\n]*\n\s*)+window\.clearTimeout\(wait\.current\);\s*void request\(\);\s*\}/,
    );
    // A keepalive keep is never sent outside `goingKeep`.
    assert.equal(count(hook, /sendCopy\([^)]*true\)/g), 1);
  });
});

describe("the styles, the words and the fast tier", () => {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => ({
      selectors: (match[1] ?? "").trim(),
      body: match[2] ?? "",
    }))
    .filter((rule) =>
      /\.se-keeping|\.se-restored|\.dw-edit-group|\.leave-dialog/.test(
        rule.selectors,
      ),
    );

  it("use the tokens, and move nothing", () => {
    assert.ok(rules.length >= 6);
    for (const rule of rules) {
      assert.ok(
        !/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(rule.body),
        rule.selectors,
      );
      assert.ok(
        !/\b(transition|animation)(-[a-z]+)?:/.test(rule.body),
        rule.selectors,
      );
    }
  });

  it("say the organization plainly", () => {
    for (const source of [hook, dialog]) {
      assert.ok(!/\bthe client\b/i.test(source));
      assert.ok(!source.includes("—"));
    }
  });

  it("is in make test-fast", () => {
    assert.match(makefile, /FAST_NODE \?=.* tests\/autosave-view\.test\.ts/);
  });
});
