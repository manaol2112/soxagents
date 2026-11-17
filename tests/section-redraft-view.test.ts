import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Redrafting a section a person has edited (docs/design-workpaper.md, section 3.11), read
// from the screen's own files. What must hold however it looks: the button is in the
// editor of a text section the agent drafts and nowhere else; the proposal is the agent's
// and nothing of it reaches the workpaper until the person's own Save, which names it;
// "Use the draft" goes through the editor's own box and is an unsaved change like any
// other (kept as a working copy, asked about on leaving); "Keep mine" takes the draft away
// only once the server confirmed; nothing is set as HTML.

const read = (path: string) => readFileSync(path, "utf8");
const view = read("apps/web/src/design-workpaper-view.tsx");
const editor = read("apps/web/src/section-editor.tsx");
const box = read("apps/web/src/rich-editor.tsx");
const redraft = read("apps/web/src/section-redraft.tsx");
const model = read("apps/web/src/section-redraft-model.ts");
const call = read("apps/web/src/proposal-route.ts");
const routes = {
  redraft: read("apps/web/app/workspace/workpapers/redraft/route.ts"),
  proposal: read("apps/web/app/workspace/workpapers/proposal/route.ts"),
  keepMine: read("apps/web/app/workspace/workpapers/keep-mine/route.ts"),
};
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
const panel = component(editor, "SectionEditorPanel");
const card = component(redraft, "RedraftCard");
const button = component(redraft, "RedraftButton");
const hook = component(redraft, "useSectionRedraft");

describe("where Redraft with the agent is offered", () => {
  it("only in the editor of a text section the agent drafts, at the version the views show", () => {
    assert.match(
      body,
      /const redraftOffer =\s*editing !== null &&\s*editing\.editor\.kind === "text" &&\s*workpaperVersion >= 1 &&\s*redraftable\(storedSection, "DESIGN"\)\s*\?/,
    );
    assert.match(
      body,
      /const storedSection =\s*editing === null\s*\? undefined\s*: editing\.source\.sections\.find\(\s*\(item\) => item\.key === editing\.editor\.key,?\s*\);/,
    );
    assert.match(
      body,
      /const workpaperVersion = editing\?\.source\.basedOn \?\? 0;/,
    );
    assert.match(body, /redraft: redraftOffer,/);
    // The model's rule is drafted_by_agent's without its source.
    assert.match(
      component(model, "redraftable"),
      /section\.kind === "text" &&\s*section\.narrative === true &&\s*!\(stage === "EFFECTIVENESS" && section\.key\.includes\("conclusion"\)\)/,
    );
  });

  it("is the text editor's only: never a grid's or the attributes' notes", () => {
    assert.match(
      panel,
      /const offer = editor\.kind === "text" \? props\.redraft : null;\s*const redraft = useSectionRedraft\(offer\);/,
    );
    assert.match(
      panel,
      /aside=\{\s*offer === null \? undefined : \(\s*<RedraftButton/,
    );
    assert.equal(count(editor, /<RedraftButton\b/g), 1);
    assert.equal(count(editor, /<RedraftCard\b/g), 1);
    const notes = component(editor, "NotesEditorPanel");
    assert.ok(!/Redraft|useSectionRedraft/.test(notes));
    assert.ok(!/Redraft|useSectionRedraft/.test(component(editor, "GridBox")));
  });

  it("stands at the right of the formatting bar, outside the toolbar's own keys", () => {
    assert.match(
      box,
      /<div className="se-tools-row">\s*\{tools\}\s*<div className="se-tools-aside">\{aside\}<\/div>\s*<\/div>/,
    );
    // The toolbar is still one stop for the Tab key with its own buttons only.
    assert.equal(count(box, /role="toolbar"/g), 1);
    assert.equal(count(box, /<button\b/g), 1);
    assert.match(css, /\.se-tools-aside \{\s*flex: none;\s*margin-left: auto;/);
    assert.match(
      button,
      /<UiIcon name="sparkles" size=\{13\} \/> \{drafting \? DRAFTING : REDRAFT\}/,
    );
    assert.match(model, /export const REDRAFT = "Redraft with the agent";/);
    assert.match(model, /export const DRAFTING = "Drafting…";/);
  });
});

describe("its states", () => {
  it("says Drafting… while the agent drafts, and leaves the editor usable", () => {
    assert.match(
      button,
      /const drafting = redraft\.asking \|\| redraft\.proposal\?\.status === "PENDING";/,
    );
    // Off, never disabled outright: it keeps the focus and does nothing.
    assert.match(button, /aria-disabled=\{off\}/);
    assert.ok(!/[^-]disabled=/.test(button));
    assert.match(
      button,
      /onClick=\{\(\) => \{\s*if \(!off\) \{\s*redraft\.ask\(\);\s*\}\s*\}\}/,
    );
    // Drafting does not make the box read-only: only a save does.
    assert.match(panel, /readOnly=\{busy\}/);
    assert.ok(!/asking|PENDING/.test(panel));
  });

  it("reads the proposal when the editor opens, and again every 3 s while it drafts", () => {
    assert.match(
      hook,
      /useEffect\(\(\) => \{\s*void read\(\);\s*\}, \[read, reread\]\);/,
    );
    assert.match(
      hook,
      /const delay = pollDelay\(proposal\);\s*if \(delay === null\) \{\s*return;\s*\}\s*const timer = window\.setTimeout\(\(\) => void read\(\), delay\);\s*return \(\) => window\.clearTimeout\(timer\);/,
    );
    // A later answer wins; nothing is used once the editor has gone.
    assert.match(
      hook,
      /const back = answered\(sequence\.current, going\.number, "read"\);\s*sequence\.current = back\.sequence;\s*if \(!live\.current \|\| !back\.use\) \{\s*return;\s*\}/,
    );
    assert.match(hook, /if \(!on \|\| !mayRead\(sequence\.current\)\) \{/);
    assert.match(
      hook,
      /call\(\s*`\/workspace\/workpapers\/proposal\?\$\{proposalQuery\(/,
    );
  });

  it("shows a READY draft with its words, its references, two paragraphs, and the two choices", () => {
    assert.match(card, /<h6 id=\{`\$\{uid\}-title`\}>\{PROPOSAL_TITLE\}<\/h6>/);
    assert.match(card, /<span>\{proposalMeta\(proposal\)\}<\/span>/);
    assert.match(card, /<RichText text=\{text\} cite \/>/);
    assert.match(
      card,
      /const text = all \|\| !fold\.more \? proposal\.text : fold\.head;/,
    );
    assert.match(card, /aria-expanded=\{all\}/);
    assert.match(card, /\{all \? SHOW_LESS : SHOW_ALL\}/);
    assert.match(card, /className="wp-sources se-proposal-sources"/);
    assert.match(
      card,
      /\{proposal\.removedNote !== "" \? \(\s*<p className="se-proposal-note">\{proposal\.removedNote\}<\/p>/,
    );
    assert.match(card, /\{KEEP_MINE\}/);
    assert.match(card, /\{USE_DRAFT\}/);
    assert.match(model, /export const PROPOSAL_TITLE = "The agent's draft";/);
  });

  it("says a failed run in one line with Try again", () => {
    assert.match(
      card,
      /if \(proposal\.status === "FAILED"\) \{\s*return line\(\s*problem !== "" \? problem : failureLine\(proposal\),\s*<button[\s\S]{0,260}onClick=\{redraft\.ask\}\s*>\s*\{TRY_AGAIN\}/,
    );
  });

  it("tells a screen reader, politely, as it drafts and when it is ready", () => {
    assert.match(
      component(redraft, "RedraftAnnouncer"),
      /<p className="sr-only" role="status" aria-live="polite">\s*\{redraft\.announce\}\s*<\/p>/,
    );
    assert.match(panel, /<RedraftAnnouncer redraft=\{redraft\} \/>/);
    assert.match(hook, /announce: proposalAnnouncement\(proposal, asking\),/);
  });

  it("is shown folded again for another proposal", () => {
    assert.match(
      panel,
      /<RedraftCard\s+key=\{redraft\.proposal\?\.id \?\? "none"\}/,
    );
  });
});

describe("the choices", () => {
  it("Use the draft hands the text to the editor's owner, which puts it in the editor's own box", () => {
    assert.match(
      card,
      /onClick=\{\(\) => \{\s*offer\.onUse\(proposal\);\s*focusBox\(here\);\s*\}\}/,
    );
    // The owner replaces the draft the editor holds: the same draft the working copy is
    // kept from and the leave guard asks about, written as the editor writes it back.
    assert.match(
      component(view, "DesignWorkpaper"),
      /const made = draftUsed\(proposal, open\.draft\.text\);\s*setEditing\(\{\s*\.\.\.open,\s*draft: \{ kind: "text", text: made\.text \},\s*refusal: "",\s*\}\);\s*setUsed\(\{ \.\.\.made, editor: open\.editor \}\);/,
    );
    assert.match(
      component(model, "draftUsed"),
      /text: editorText\(proposal\.text\),/,
    );
    assert.match(
      component(model, "editorText"),
      /return textFromDoc\(docFromText\(text\)\);/,
    );
    // The box takes a text its owner gives as the model's document, one step to undo.
    assert.match(box, /\.setContent\(doc, \{ emitUpdate: false \}\)/);
    assert.match(box, /closeHistory\(tr\);/);
    // The working copy and the leave guard follow the draft the editor holds.
    assert.match(body, /draft: editing\.draft,/);
    assert.match(body, /changed: changed\(editing\.editor, editing\.draft\),/);
    // Nothing here saves: only the person's Save makes a version.
    assert.ok(!/sendSection|\/workspace\/workpapers\/section/.test(redraft));
  });

  it("Keep mine takes the draft away only once the server confirmed", () => {
    const keep = hook.slice(hook.indexOf("const keepMine"));
    assert.match(
      keep,
      /const problem = redraftProblem\(answer\.status, answer\.detail\);\s*if \(problem !== ""\) \{[\s\S]*?return;\s*\}\s*(?:\/\/ [^\n]*\n\s*)+setProposal\(null\);/,
    );
    assert.equal(
      count(keep.slice(0, keep.indexOf(".then(")), /setProposal\(/g),
      0,
    );
    assert.match(card, /aria-busy=\{redraft\.keeping\}/);
    assert.match(card, /const off = busy \|\| redraft\.keeping;/);
  });

  it("is off while the editor holds a draft not saved yet, so the draft it came from stands", () => {
    assert.match(
      button,
      /const off = drafting \|\| busy \|\| used \|\| redraft\.keeping;/,
    );
    assert.match(
      button,
      /title=\{used && !drafting \? SAVE_FIRST : undefined\}/,
    );
    assert.match(
      card,
      /if \(offer\.used === proposal\.id\) \{\s*return line\(IN_EDITOR\);/,
    );
    assert.match(
      body,
      /used: usedNow === null \|\| usedNow\.off \? null : usedNow\.id,/,
    );
  });

  it("forgets the draft where everything is replaced again, and never names it in another editor", () => {
    assert.match(
      body,
      /const usedNow =\s*used !== null && editing !== null && used\.editor === editing\.editor\s*\? used\s*: null;/,
    );
    assert.match(
      body,
      /if \(draft\.kind === "text"\) \{\s*setUsed\(\(before\) => usedAfter\(before, draft\.text\)\);\s*\}/,
    );
    assert.equal(count(body, /setUsed\(null\);/g), 3);
  });
});

describe("the Save after Use the draft", () => {
  it("names the proposal, and only where the editor still holds it", () => {
    assert.match(
      body,
      /withProposal\(\s*saveRequest\(scope, open\.source, open\.editor, open\.draft\),\s*namedDraft\(usedNow\),\s*\)/,
    );
    assert.equal(count(view, /sendSection\(/g), 1);
  });

  it("says the server's sentence where the draft changed, and reads the proposal again", () => {
    assert.match(
      body,
      /if \(draftChanged\(answer\.status, answer\.detail\)\) \{\s*setUsed\(null\);\s*setProposalRead\(\(count\) => count \+ 1\);\s*\}/,
    );
    assert.match(body, /reread: proposalRead,/);
  });
});

describe("the routes", () => {
  it("check what they send, call the API with the session, and answer as JSON", () => {
    for (const [name, source, check] of [
      ["redraft", routes.redraft, "redraftWrite"],
      ["proposal", routes.proposal, "proposalPath"],
      ["keep-mine", routes.keepMine, "keepMineWrite"],
    ] as const) {
      assert.ok(source.includes(`import { ${check} } from`), name);
      assert.match(
        source,
        /sessionToken\(\(await cookies\(\)\)\.get\("aw_session"\)\?\.value\)/,
        name,
      );
      assert.match(
        source,
        /NextResponse\.json\(\{ status: 422, detail: "", proposal: null \}\)/,
        name,
      );
      assert.ok(!/redirect\(|console\./.test(source), name);
    }
    assert.match(routes.redraft, /export async function POST\(/);
    assert.match(routes.keepMine, /export async function POST\(/);
    assert.match(routes.proposal, /export async function GET\(/);
    // One call of the API: its status, its sentence, its proposal; never a 200 without
    // its answer, and nothing logged.
    assert.match(call, /status = response\.ok \? 200 : response\.status;/);
    assert.match(call, /status = status === 200 \? 502 : status;/);
    assert.match(call, /detail = fields\.detail\.slice\(0, 300\);/);
    assert.ok(!/console\./.test(call));
  });
});

describe("nothing is set as HTML, and the words are the product's", () => {
  it("builds elements only", () => {
    for (const [name, source] of [
      ["section-redraft.tsx", redraft],
      ["section-redraft-model.ts", model],
      ["proposal-route.ts", call],
      ["section-editor.tsx", editor],
      ["rich-editor.tsx", box],
    ] as const) {
      assert.ok(
        !/dangerouslySetInnerHTML|\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment/.test(
          source,
        ),
        name,
      );
    }
  });

  it("never says 'the client'", () => {
    for (const source of [redraft, model]) {
      assert.ok(!/the client/i.test(source));
    }
  });

  it("styles with the tokens, without motion, as the editors do", () => {
    const own = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map((match) => ({ selectors: match[1] ?? "", body: match[2] ?? "" }))
      .filter((rule) =>
        /\.se-proposal|\.se-tools-|\.se-redraft/.test(rule.selectors),
      );
    assert.ok(own.length >= 10);
    for (const rule of own) {
      assert.ok(
        !/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(rule.body),
        rule.selectors,
      );
      assert.ok(
        !/\b(transition|animation)(-[a-z]+)?:/.test(rule.body),
        rule.selectors,
      );
    }
    assert.match(
      css,
      /\.se-proposal \{[^}]*border-left: 3px solid var\(--accent\);/,
    );
  });
});

describe("the tiers", () => {
  it("runs both files in the fast tier, beside the editors' own", () => {
    assert.match(
      makefile,
      /tests\/rich-editor-view\.test\.ts tests\/section-redraft-model\.test\.ts tests\/section-redraft-view\.test\.ts/,
    );
  });
});
