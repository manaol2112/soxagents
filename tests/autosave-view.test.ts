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
    assert.match(
      body,
      /const working = useWorkingCopies\(\s*scope,\s*source\?\.workpaperId \?\? null,\s*source\?\.basedOn \?\? null,\s*editing\?\.editor\.key \?\? null,\s*\);/,
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

  it("reads them cautiously, and a failed read is quiet and never blocks editing", () => {
    const reader = component(hook, "useWorkingCopies");
    assert.match(
      reader,
      /found = body\.status === 200 \? parseWorkingCopies\(body\.result\) : null;/,
    );
    assert.match(reader, /\} catch \{\s*found = null;\s*\}/);
    assert.match(
      reader,
      /if \(!current \|\| found === null\) \{\s*return;\s*\}/,
    );
    // Nothing about the read is said on the page, and nothing waits for it.
    assert.ok(!/role="alert"|setProblem|problem/.test(reader));
    // The open editor's own writes are what the page knows of its section.
    assert.match(
      reader,
      /\.\.\.read\.filter\(\(copy\) => copy\.section !== key\),\s*\.\.\.before\.filter\(\(copy\) => copy\.section === key\),/,
    );
  });

  it("reads them again after a save and after a discard", () => {
    assert.match(
      body,
      /keeper\.saved\(scope, open\.source\.workpaperId, open\.editor\.key\);\s*working\.reread\(\);\s*confirmed\.current = open\.section;/,
    );
    assert.match(body, /onGone: working\.reread,/);
    assert.equal(count(hook, /told\.current\.onGone\(\);/g), 2);
  });
});

describe("opening with a working copy", () => {
  it("opens with the copy, restored, where copyFor finds one", () => {
    assert.match(body, /const copy = copyFor\(editor, copies\);/);
    assert.match(
      body,
      /draft:\s*copy === null \? draftOf\(editor\) : restoredDraft\(editor, copy\),\s*phase: "editing",\s*refusal: "",\s*restored: copy,/,
    );
  });

  it("says it was restored, and that the section may have changed, over the box", () => {
    assert.match(
      body,
      /restored:\s*editing\.restored === null\s*\? null\s*: \{\s*words: restoredWords\(editing\.restored\),\s*stale: copyIsStale\(editing\.restored, editing\.source\),\s*onDiscard: discardRestored,\s*\},/,
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
      /wait\.current = window\.setTimeout\(\(\) => \{\s*void keeper\.request\(\);\s*\}, KEEP_AFTER_MS\);\s*return \(\) => window\.clearTimeout\(wait\.current\);\s*\}, \[session, key, phase, hasCopy, keeper\]\);/,
    );
    // No pause of its own: the model's.
    assert.ok(!/\b1500\b|\b15_?000\b/.test(hook));
    assert.ok(!/\b1500\b|\b15_?000\b/.test(view));
  });

  it("is paused while a save is out or the views read again, and never keeps for a closed editor", () => {
    assert.match(
      hook,
      /const now = latest\.current;\s*if \(now === null \|\| now\.phase !== "editing" \|\| blocked\.current\) \{\s*return;\s*\}\s*const action = keepAction\(now\.editor, now\.draft, now\.hasCopy\);/,
    );
    const sync = hook.slice(hook.indexOf("const sync = async"));
    assert.match(
      sync,
      /queued\.current = false;\s*const now = latest\.current;\s*if \(now === null \|\| now\.phase !== "editing" \|\| blocked\.current\) \{\s*return;\s*\}/,
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
    assert.match(
      hook,
      /const \{ editor, draft, scope, source \} = now;\s*const action = keepAction\(editor, draft, now\.hasCopy\);/,
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
    assert.match(
      body,
      /onKept: working\.remember,\s*onDiscarded: working\.forget,/,
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
    assert.match(
      bar,
      /keeping\.state === "failed"\s*\? "se-keeping is-failed"\s*: "se-keeping"/,
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
    assert.match(
      body,
      /setEditing\(\{ \.\.\.open, phase: "saving", refusal: "" \}\);\s*(?:\/\/ [^\n]*\n\s*)+await keeper\.settle\(SETTLE_MS\);\s*const answer = await sendSection\(/,
    );
    assert.match(body.length > 0 ? view : "", /const SETTLE_MS = 2000;/);
    // A keep that was still out when the save was taken is discarded once it lands.
    assert.match(
      hook,
      /const saved = \(scope: Scope, workpaperId: string, section: string\) => \{\s*kept\.current = null;\s*told\.current\.onDiscarded\(section\);\s*if \(pending\.current > 0\) \{\s*void enqueue\(discardOp\(scope, workpaperId, section\)\);\s*\}\s*\};/,
    );
  });

  it("Cancel discards the working copy, after asking where something changed", () => {
    assert.match(
      body,
      /setEditing\(null\);\s*setClosed\(editing\.section\);\s*(?:\/\/ [^\n]*\n\s*)+keeper\.discard\(\s*scope,\s*editing\.source\.workpaperId,\s*editing\.editor\.key,\s*copies\.some\(\(copy\) => copy\.section === editing\.editor\.key\),\s*\);/,
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
  it("asks only while an editor is open with changes (or the dialog is open), and lets go after", () => {
    assert.match(
      body,
      /const guarding =\s*\(editing !== null &&\s*editing\.phase === "editing" &&\s*changed\(editing\.editor, editing\.draft\)\) \|\|\s*askingNow;/,
    );
    assert.match(
      body,
      /useEffect\(\(\) => \{\s*if \(!guarding\) \{\s*return;\s*\}\s*(?:\/\/ [^\n]*\n\s*)+return setLeaveAsker\(\(next\) => \{\s*proceed\.current = next;\s*setAsking\(true\);\s*\}\);\s*\}, \[guarding\]\);\s*useGuardedLinks\(guarding\);/,
    );
    // Going on happens once: the pending destination is taken before it is used.
    assert.match(
      body,
      /const goOn = \(\) => \{\s*const next = proceed\.current;\s*proceed\.current = null;\s*setAsking\(false\);\s*next\?\.\(\);\s*\};/,
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

  it("Leave without saving sends the latest at once and waits about a second at most", () => {
    assert.match(
      body,
      /onLeave=\{async \(\) => \{\s*(?:\/\/ [^\n]*\n\s*)+await keeper\.flush\(LEAVE_WAIT_MS\);\s*goOn\(\);\s*\}\}/,
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
    assert.match(box, /<p id=\{`\$\{id\}-body`\}>\{LEAVE\.body\}<\/p>/);
    const save = box.indexOf("LEAVE.save}");
    const leave = box.indexOf("{LEAVE.leave}");
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

  it("sends what is not kept yet with keepalive as the page goes", () => {
    assert.match(
      body,
      /const going = \(\) => keeper\.beacon\(\);\s*window\.addEventListener\("beforeunload", ask\);\s*window\.addEventListener\("pagehide", going\);/,
    );
    assert.match(body, /window\.removeEventListener\("pagehide", going\);/);
    assert.match(hook, /beacon: \(\) => send\(true\),/);
    assert.match(
      hook,
      /void sendCopy\(\s*keepRequest\(now\.scope, now\.source, now\.editor, now\.draft\),\s*keepalive,\s*\);/,
    );
    // Only what may be kept is sent; a credential or a limit passed is never.
    assert.match(
      hook,
      /!unkept\(\) \|\|\s*keepAction\(now\.editor, now\.draft, now\.hasCopy\) !== "keep"/,
    );
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
