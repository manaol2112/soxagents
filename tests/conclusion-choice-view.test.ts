import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// One conclusion, written in D&I Assessment and reviewed in its own step
// (docs/design-workpaper.md, section 3.5), and the preparer concludes while the agent
// proposes (section 3.6; product owner, 15 November 2026: "the conclusion already shows up
// in my D&I analysis then there is another step for the D&I conclusion … I don't have the
// option to edit the conclusion here"; "Agent should propose but user should finalize the
// conclusion"). Read from the screen's own files, for what must hold however it looks: the
// conclusion's text has one editor, in section 7; the choice is made only there and is
// shown as recorded only once the server confirmed it; D&I Conclusion and Review is
// read-only and signs the preparer's conclusion by its kind; nothing sets HTML.

const read = (path: string) => readFileSync(path, "utf8");
const view = read("apps/web/src/design-workpaper-view.tsx");
const choice = read("apps/web/src/conclusion-choice.tsx");
const panel = read("apps/web/src/design-conclusion-panel.tsx");
const conclusionModel = read("apps/web/src/design-conclusion-model.ts");
const route = read("apps/web/app/workspace/design-conclusions/route.ts");
const choiceRoute = read(
  "apps/web/app/workspace/design-conclusions/choice/route.ts",
);
const workflow = read("apps/web/src/control-workflow-model.ts");
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

describe("section 7 is where the preparer concludes", () => {
  it("has one editor of the conclusion's text: section 7's, opened by the link or the button", () => {
    const sheet = component(view, "DocumentSheet");
    assert.equal(
      count(sheet, /<SectionEditorPanel \{\.\.\.concluding\} \/>/g),
      1,
    );
    assert.equal(count(view, /\{\.\.\.concluding\}/g), 1);
    // "Edit conclusion" is the same action as the heading's link, and the link stays.
    const button = component(view, "EditConclusion");
    assert.match(button, /onClick=\{\(\) => onEdit\("conclusion"\)\}/);
    assert.match(button, /"Edit conclusion"/);
    assert.match(button, /className="btn-secondary btn-sm"/);
    assert.match(
      sheet,
      /number=\{7\}\s+title="Conclusion"[\s\S]{0,400}<EditLink\s+section="conclusion"/,
    );
    assert.match(sheet, /<EditConclusion\s+actions=\{actions\}/);
    // Nothing else edits the conclusion: the step has no editor and no box.
    for (const source of [panel, choice]) {
      assert.equal(
        /SectionEditorPanel|RichTextBox|onEdit\(/.test(source),
        false,
      );
    }
  });

  it("draws the card top to bottom: the proposal, the results, the choice, the text", () => {
    const sheet = component(view, "DocumentSheet");
    assert.match(
      sheet,
      /<ConclusionHead paper=\{paper\} conclusion=\{conclusion\} \/>\s*<Results paper=\{paper\} \/>\s*<ConclusionChoiceOf paper=\{paper\} actions=\{actions\} \/>\s*<div className="dw-concl-text">/,
    );
    const head = component(view, "ConclusionHead");
    assert.match(head, /PROPOSED_REVIEW/);
    assert.match(head, /recordedLine\(choice\)/);
    assert.match(head, /keyed\(reasons, \(reason\) => reason\)/);
    const results = component(view, "Results");
    assert.match(results, /resultBoxes\(paper\)/);
    // Section 3 says which part is the implementation; section 4 how each is shown.
    assert.match(
      sheet,
      /number=\{3\}\s+title="Implementation: walkthrough of one instance"/,
    );
    assert.match(
      sheet,
      /<StatePill \{\.\.\.stateOf\(attribute\)\} \/>\s*\{attribute\.shownBy !== null \? \(\s*<small className="dw-shown-by">\s*\{SHOWN_BY_WORDS\[attribute\.shownBy\]\}/,
    );
  });

  it("offers the choice only in section 7, on the editable draft, and never on paper", () => {
    assert.equal(count(view, /<ConclusionChoicePanel\b/g), 1);
    const of = component(view, "ConclusionChoiceOf");
    assert.match(of, /if \(actions === null\) \{\s*return null;\s*\}/);
    assert.match(
      of,
      /paper\.canEdit && scope !== null && actions\.choice !== null/,
    );
    // The Matrix and the Evidence view: the short line and the way to section 7 only.
    for (const name of ["MatrixBoard", "EvidenceSplit"]) {
      const part = component(view, name);
      assert.equal(
        /ConclusionChoice|conclusion\.text|RichText text=\{conclusion/.test(
          part,
        ),
        false,
        name,
      );
      assert.match(
        part,
        /<ToConclusion onOpen=\{actions\.onConclusion\} \/>/,
        name,
      );
    }
    assert.equal(view.includes("Read the conclusion"), false);
    // Section 7 is where a link from the review step lands.
    assert.match(
      view,
      /anchor=\{actions === null \? undefined : CONCLUSION_ANCHOR\}/,
    );
  });

  it("links to the existing way of logging a design deficiency, never a typed verdict", () => {
    const step = component(view, "DesignWorkpaperStep");
    assert.match(
      step,
      /destinationHref\(\s*"reports",\s*"deficiencies",\s*ids\.organizationId,\s*ids\.projectId,\s*\{ new: ids\.controlId \},\s*\)/,
    );
    assert.match(
      component(view, "ConclusionChoiceOf"),
      /Log a design deficiency/,
    );
  });
});

describe("the choice is recorded by the server, and shown as recorded only then", () => {
  it("is a radio group with a legend, every hint and error tied to its field", () => {
    assert.match(
      choice,
      /<fieldset className="cc-kinds"[\s\S]{0,80}<legend>Your conclusion<\/legend>/,
    );
    assert.match(choice, /type="radio"/);
    assert.match(choice, /aria-describedby=\{hintId\}/);
    assert.match(choice, /<legend>What is not effective \(needed\)<\/legend>/);
    assert.match(
      choice,
      /<label htmlFor=\{reasonId\}>\s*Reason \(needed: \{problems\.reasonWhy\}\)/,
    );
    assert.match(choice, /aria-describedby=\{reasonHint\}/);
    // A refusal is an alert, in the server's sentence; what was chosen stays.
    assert.match(choice, /<p className="cc-refusal" role="alert">/);
    assert.match(
      choice,
      /setRefusal\(choiceRefusal\(answer\.status, answer\.detail\)\);/,
    );
  });

  it("asks the model what stands in the way, and sends one request per press", () => {
    assert.match(
      choice,
      /const problems = choiceProblems\(draft, proposal, facts\);/,
    );
    assert.match(
      choice,
      /if \(!ready \|\| busy\.current \|\| draft\.kind === null\) \{\s*return;\s*\}\s*busy\.current = true;/,
    );
    assert.equal(count(choice, /fetch\(/g), 1);
    assert.match(
      choice,
      /fetch\("\/workspace\/design-conclusions\/choice", \{\s*method: "POST",/,
    );
    // Exactly the contract's body, and `replaces` always: the standing choice's id or null.
    assert.match(choice, /replaces: standing\?\.id \?\? null,/);
    // A reason goes only with a conclusion that asks for one: what was typed for another
    // conclusion is never sent with this one.
    assert.match(
      choice,
      /const reason = problems\.reasonNeeded \? draft\.reason\.trim\(\) : "";/,
    );
    assert.match(
      choice,
      /\.\.\.\(problems\.reasonNeeded \? \{ reason \} : \{\}\),/,
    );
    assert.match(
      choice,
      /\.\.\.\(draft\.kind === "NOT_EFFECTIVE" \? \{ basis: draft\.basis \} : \{\}\)/,
    );
  });

  it("shows it as recorded only after the server confirmed it, then reads again without a reload", () => {
    const record = component(choice, "ConclusionChoicePanel");
    assert.match(
      record,
      /if \(answer\.status === 200\) \{[\s\S]{0,200}const confirmed = parseDesignConclusion\(answer\.result\)\?\.choice \?\? null;\s*setStanding\(confirmed\);/,
    );
    assert.match(
      record,
      /setNotice\(confirmed === null \? "" : "Conclusion recorded\."\)/,
    );
    assert.equal(count(record, /setNotice\("Conclusion recorded/g), 0);
    assert.match(record, /onRecorded\(confirmed\);\s*refreshRecords\(\);/);
    assert.equal(
      /location\.(reload|assign|href)|window\.location\.href/.test(choice),
      false,
    );
  });

  it("goes through a route of its own: JSON, the person's session, never a redirect", () => {
    assert.match(choiceRoute, /const write = choiceWrite\(fields\);/);
    assert.match(
      choiceRoute,
      /headers\.set\("cookie", `aw_session=\$\{session\}`\);/,
    );
    assert.match(
      choiceRoute,
      /return NextResponse\.json\(\{ status, detail, result \}\);/,
    );
    assert.equal(/NextResponse\.redirect|redirect\(/.test(choiceRoute), false);
    assert.equal(/console\.|session\b[^\n]*json/.test(choiceRoute), false);
  });
});

describe("D&I Conclusion and Review is the reviewer's, and read-only", () => {
  it("is named for what it is", () => {
    assert.match(
      workflow,
      /title: "D&I Conclusion and Review",\s*covers: "Review · Sign-off",/,
    );
  });

  it("shows the conclusion first, with its text exactly as section 7 reads it", () => {
    assert.match(
      panel,
      /fetch\(`\/workspace\/design-workpaper\?\$\{query\}`, \{\s*cache: "no-store",\s*signal: control\.signal,/,
    );
    assert.match(
      panel,
      /return \(\) => \{\s*current = false;\s*control\.abort\(\);\s*\};/,
    );
    assert.match(
      panel,
      /read = paper === null \? false : paper\.conclusion\.text;/,
    );
    assert.match(panel, /<RichText text=\{text\} \/>/);
    assert.match(
      panel,
      /The preparer has not recorded a conclusion yet\.\{" "\}\s*<a href=\{section7\}>Open section 7 in D&amp;I Assessment<\/a>/,
    );
    assert.match(
      panel,
      /<a href=\{section7\}>Edit the conclusion in D&amp;I Assessment<\/a>/,
    );
    assert.match(panel, /const section7 = conclusionHref\(assessmentHref\);/);
    // Nothing is edited here.
    // Nothing is edited here: the only boxes are the sign-off's note and the reason to
    // reopen, as before.
    assert.equal(/contentEditable|type="radio"|RichTextBox/.test(panel), false);
    assert.deepEqual(
      [...panel.matchAll(/<textarea\s+name="([a-z_]+)"/g)].map((m) => m[1]),
      ["note", "reason"],
    );
  });

  it("signs the preparer's conclusion by its kind, and its button says which", () => {
    assert.match(
      panel,
      /<input type="hidden" name="conclusion" value=\{signable \?\? ""\} \/>/,
    );
    assert.equal(/name="verdict"/.test(panel), false);
    assert.match(
      panel,
      /`Sign off: \$\{signable === null \? "" : CONCLUSION_WORDS\[signable\]\}`/,
    );
    assert.match(
      conclusionModel,
      /body: \{ conclusion, workpaper_version: version, note \},/,
    );
    assert.equal(/body: \{ verdict,/.test(conclusionModel), false);
    // The route still posts the sign-off through the model's write.
    assert.match(route, /const write = designConclusionWrite\(fields\);/);
  });

  it("says the conclusion once in the step", () => {
    // The sign-off line names it only where it signed another one.
    assert.match(
      panel,
      /signed\.conclusion !== choice\.kind\s*\?\s*` · signed as “\$\{CONCLUSION_WORDS\[signed\.conclusion\]\}”`/,
    );
    assert.equal(count(panel, /\{head\.word\}/g), 1);
  });
});

describe("the standards", () => {
  it("sets no HTML, and keeps the words plain", () => {
    for (const source of [view, choice, panel, conclusionModel]) {
      assert.equal(
        /dangerouslySetInnerHTML|innerHTML|outerHTML/.test(source),
        false,
      );
      assert.equal(/the client/i.test(source), false);
    }
  });

  it("keeps motion short and off under reduced motion", () => {
    assert.match(
      css,
      /\.cc-kind \{[^}]*transition:\s*background-color 120ms ease,\s*border-color 120ms ease;/,
    );
    const calm = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    assert.match(calm, /\.cc-kind,[\s\S]{0,200}transition: none;/);
  });

  it("runs in the fast tier", () => {
    const fast = makefile.match(/^FAST_NODE \?= (.*)$/m)?.[1] ?? "";
    assert.ok(fast.includes("tests/conclusion-choice-view.test.ts"));
  });
});
