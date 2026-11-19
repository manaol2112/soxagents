import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// B1j (docs/control-workflow-plan.md; product owner, 16 November 2026): the understanding is
// asked once, and after it the agents never send the person back. These read the views'
// source, beside the pure tests in understanding-once-model.test.ts: what each screen draws,
// and what it never asks for.

const read = (path: string) =>
  readFileSync(new URL(`../apps/web/${path}`, import.meta.url), "utf8");

const review = read("src/understanding-review.tsx");
const setup = read("src/control-setup.tsx");
const panel = read("src/control-context-view.tsx");
const narrative = read("src/process-narrative.tsx");
const controls = read("src/controls-view.tsx");
const assumptions = read("src/attribute-assumptions.tsx");
const criteria = read("src/attribute-criteria.tsx");
const route = read("app/workspace/control-context/route.ts");
const css = read("app/attribute-list.css");
const setupCss = read("app/control-setup.css");

describe("no narrative redraft after a single answer, and none for an ITGC", () => {
  it("answering an agent's question in Control Understanding asks for no redraft", () => {
    // Before: `void action.run("narrate", { intent: "process-narrate" })` after every answer,
    // which kept the narrative's first round open and could ask again (ITGC-AC-01, ITGC-CM-06).
    assert.doesNotMatch(review, /process-narrate/);
    assert.doesNotMatch(review, /action\.run\("narrate"/);
  });

  it("the guided setup's answers ask for one draft only where the control needs one", () => {
    assert.match(setup, /narrates=\{input\.processRequired\}/);
    assert.match(
      setup,
      /if \(narrates && \(touched \|\| Object\.keys\(plan\.settled\)\.length > 0\)\) \{\s*void action\.run\("narrate", \{ intent: "process-narrate" \}\);/,
    );
  });

  it("the walkthrough's last answer, and the narrative's own buttons, never draft for an ITGC", () => {
    assert.match(
      panel,
      /const narrates = walkthrough\?\.processRequired !== false;/,
    );
    assert.match(
      panel,
      /if \(canAct && narrates\) \{\s*void action\.run\("narrate", \{ intent: "process-narrate" \}\);/,
    );
    assert.match(
      panel,
      /<ProcessNarrative\s+ids=\{ids\}\s+drafts=\{narrates\}/,
    );
    assert.match(
      controls,
      /processRequired: context\?\.processRequired \?\? false,/,
    );
    // Each drafting button waits on `drafts`; the "answer" action stays.
    assert.match(
      narrative,
      /\{canAct && drafts \? \(\s*<span className="pn-head-actions">/,
    );
    assert.match(
      narrative,
      /\.filter\(\(item\) => item === "answer" \|\| drafts\)/,
    );
    assert.match(
      narrative,
      /\{canAct && drafts \? \(\s*<button[\s\S]{0,420}Redraft to match/,
    );
  });
});

describe("Control Understanding: one pass, complete once", () => {
  it("is given the completion and the pass from the context", () => {
    assert.match(
      controls,
      /completedAt: context\.understandingCompletedAt \?\? null,\s*questionPass: context\.questionPass \?\? null,/,
    );
    // Rewritten (B1k, 16 November 2026: the specialist's review of the questions asked is
    // shown under the understanding). Old: `once={{ completedAt, questionPass }}`. New: the
    // same, and the latest review, `review: conversation.review ?? null`.
    // Rewritten again (B1l review fixes, 16 November 2026: Review again keeps the last good
    // review shown, the review that was not run says so, and the attributes not reviewed are
    // named by letter). Old: once ended at `review`. New: the same, then the request a person
    // made after completion, why no review ran, and the approved attributes.
    // Rewritten again (the second fix round of B1k): old, `notRun` then `approved`; new, the
    // server's review_due between them, which the page follows up (review/follow).
    // Rewritten again (owner decision, 18 November 2026, "Completion waits for a person"):
    // old, reviewDue then approved; new, the held review between them (review_held), which
    // ends the course on its two choices; and (round 3, same day) whether a proceed takes a
    // reason, also after a later read could not run.
    assert.match(
      setup,
      /once=\{\{\s*completedAt: conversation\.completedAt \?\? null,\s*questionPass: conversation\.questionPass \?\? null,\s*review: conversation\.review \?\? null,\s*request: conversation\.reviewRequest \?\? null,\s*notRun: conversation\.reviewNotRun \?\? null,\s*reviewDue: conversation\.reviewDue === true,\s*held: conversation\.reviewHeld \?\? null,\s*reasonNeeded: conversation\.reviewReasonNeeded === true,\s*proceeded: conversation\.reviewProceeded \?\? null,\s*approved: conversation\.approved \?\? \[\],\s*\}\}/,
    );
    assert.match(
      controls,
      /understanding:\s*context === null\s*\? null\s*: \{\s*completedAt: context\.understandingCompletedAt \?\? null,\s*questionPass: context\.questionPass \?\? null,\s*rulesOpen: rulesOpen\(context\.issues\),/,
    );
    // Rewritten (design review, 19 November 2026). Old: busy only while the pass checks.
    // New: also while a question the agents raised is still being worded, not shown yet.
    assert.match(
      controls,
      /context\?\.questionPass === "CHECKING" \|\|\s*\(setupInput\?\.preparingQuestions \?\? 0\) > 0\)[\s\S]{0,120}busy\.add\("understanding"\)/,
    );
  });

  it("while the agents check, says so and reads the page and the course again in place", () => {
    // Rewritten (design review, 19 November 2026: said twice). Old: the lede said the agents
    // were checking, and so did the end of the course. New: said once, where the course
    // ends, with no way on; the lede states only where the understanding was drafted from.
    assert.match(
      review,
      /\) : end === "checking" \? \([\s\S]{0,200}?`\$\{draftedFrom\(groups, interview\)\}\.`\s*\) : end === "failed"/,
    );
    assert.match(
      review,
      /<h3 className="ur-q">\{CHECKING_LINE\}<\/h3>\s*<p className="ur-hint ur-checking" role="status">/,
    );
    assert.match(
      review,
      /const passing = review !== null && readsAgain\(once, gatesDone\);/,
    );
    assert.match(
      review,
      /if \(!passing\) \{\s*return;\s*\}\s*const timer = window\.setInterval\(\(\) => \{\s*router\.refresh\(\);\s*void read\(\);\s*\}, 3000\);\s*return \(\) => window\.clearInterval\(timer\);/,
    );
  });

  it("labels the pass's questions in the same course", () => {
    // Rewritten (B1k). Old: `raised !== undefined && addedForAttributes(raised)`. New: a
    // question from the specialist's review is for the attributes too, whatever its origin.
    assert.match(
      review,
      /const forAttributes =\s*raised !== undefined &&\s*\(addedForAttributes\(raised\) \|\| fromReview\(raised\)\);/,
    );
    assert.match(
      review,
      /\{need\.kind === "QUESTION" \? \(\s*<span className="ur-chip is-accent">\{raisedChip\(raised\)\}<\/span>/,
    );
    // Once complete, the attributes read ready whatever a rules question holds.
    assert.match(
      review,
      /readyOnceComplete\(\s*readyLines\(review\),\s*complete,/,
    );
  });

  it("offers 'Go to the attributes' only once complete", () => {
    assert.doesNotMatch(review, /Finalize the attributes/);
    assert.equal(review.match(/Go to the attributes/g)?.length, 2);
    // Rewritten (design review, 19 November 2026: the time said in the lede and in the
    // green box). Old: the completed end showed its time above the way on. New: the way on
    // alone, then the note; the time is the lede's.
    assert.match(
      review,
      /const endStep = \(\) =>\s*complete \? \([\s\S]*?<div className="ur-complete">\s*\{onToAttributes \? \([\s\S]*?Go to the attributes[\s\S]*?\{ONCE_COMPLETE_NOTE\}/,
    );
    const completed = review.slice(
      review.indexOf("const endStep = () =>"),
      review.indexOf('end === "failed" || end === "held" ? ('),
    );
    assert.doesNotMatch(completed, /completeLine\(|\{proceededSaid\}/);
    // The understood end from before B1j offers it only where the pass says nothing.
    assert.match(
      review,
      /\{onToAttributes && offersAttributes\(once\) \? \(\s*<a className="btn btn-primary" href=\{attributesHref \?\? "#"\}>\s*Go to the attributes/,
    );
    // While checking: no way on.
    const checking = review.slice(
      review.indexOf(') : end === "checking" ? ('),
      review.indexOf(") : status.done ? ("),
    );
    assert.ok(checking.length > 0);
    assert.doesNotMatch(checking, /attributesHref|Go to the attributes/);
  });
});

describe("the assumption on the attribute", () => {
  it("is shown on every attribute row, and the set's at the top of the list", () => {
    assert.match(panel, /<TailoredCriteria[\s\S]{0,260}notes=\{notes\}/);
    assert.match(
      criteria,
      /\{state === "OWNED" \? <p className="tc-by">\{owner\}<\/p> : null\}\s*\{notes\}/,
    );
    assert.equal(
      panel.match(/items=\{context\.setAssumptions\}/g)?.length,
      2,
      "the step's list and the full list",
    );
    assert.match(panel, /items=\{item\.assumptions\}/);
    assert.match(panel, /updatedFrom=\{item\.criteriaUpdatedFrom\}/);
    assert.match(panel, /versions=\{item\.criteriaVersions\}/);
  });

  it("offers That's right and Change…, with a counted box of 10 to 1,000 characters", () => {
    // Rewritten (B1l: a question left as not known reads as such). Old: `{ASSUMED_LEAD}`
    // alone. New: the agent's lead for an assumption, the not-known lead for a question a
    // person left as not known; a conflict is led by "A conflict to decide".
    // Rewritten again (design review, 19 November 2026: a fact not yet known read "The agent
    // assumed:" with "That's right"). Old: the inline lead and the literal "That's right" and
    // "Change…". New: the lead and both choices come from one source by kind
    // (assumptionLead, confirmWords, changeWords), which words a fact not yet known as
    // "Not yet known:" with "Add the answer" and "Leave unanswered".
    assert.match(
      assumptions,
      /<strong>\{assumptionLead\(item\.kind\)\}<\/strong>/,
    );
    assert.match(assumptions, /: confirmWords\(item\.kind\)\}/);
    assert.match(assumptions, /\{changeWords\(item\.kind\)\}/);
    assert.doesNotMatch(
      assumptions,
      /[?:] "That's right"|ASSUMED_LEAD|NOT_KNOWN_LEAD/,
    );
    assert.match(assumptions, /maxLength=\{ASSUMPTION_TEXT_MAX\}/);
    assert.match(assumptions, /characterCount\(words, ASSUMPTION_TEXT_MAX\)/);
    assert.match(
      assumptions,
      /disabled=\{locked \|\| busy !== "" \|\| wordsProblem !== null\}/,
    );
  });

  it("shows a decision only once the server confirms it, and the context it answered at once", () => {
    // Rewritten (B1l). Old end marker: `return (\n    <li className="tas-open">`. New: the
    // card's kind (`const conflict = …`) is read right after `send`, before its markup.
    const end = assumptions.indexOf(
      'const conflict = item.kind === "CONFLICT";',
    );
    assert.ok(end > 0);
    const send = assumptions.slice(
      assumptions.indexOf("async function send("),
      end,
    );
    // Nothing is shown as decided before the answer: the context comes only from a 200.
    assert.match(
      send,
      /context = status === 200 \? parseContext\(body\.context\) : null;/,
    );
    assert.ok(
      send.indexOf("await fetch(") < send.indexOf("onContext(context)"),
      "the answered context is shown after the server's answer",
    );
    assert.match(send, /startTransition\(\(\) => router\.refresh\(\)\)/);
    assert.doesNotMatch(send, /window\.location|location\.reload/);
    // The panel shows the answered context until the page's newer read lands.
    assert.match(
      panel,
      /const context =\s*answered !== null && answered\.base === given \? answered\.next : given;/,
    );
  });

  it("reads the earlier criteria only when opened, and never shows a stale answer", () => {
    assert.match(assumptions, /if \(!open \|\| loaded\) \{\s*return;\s*\}/);
    assert.match(
      assumptions,
      /if \(mine !== reads\.current\) \{\s*return;\s*\}/,
    );
    assert.match(assumptions, /intent: "criteria-history"/);
    assert.match(
      route,
      /if \(query\.get\("intent"\) === "criteria-history"\) \{\s*return criteriaHistory\(query\);/,
    );
    assert.match(route, /const path = criteriaHistoryPath\(\{/);
    assert.match(route, /history: response\.status === 200 \? body : null/);
  });

  it("keeps its motion short and off under reduced motion", () => {
    for (const rule of [".tas-change", ".tas-history"]) {
      assert.match(
        css,
        new RegExp(`\\${rule} \\{[^}]*animation: tas-open 200ms ease;`),
      );
    }
    assert.match(
      css,
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.tas-change,\s*\.tas-history \{\s*animation: none;\s*\}\s*\.tas-link \{\s*transition: none;/,
    );
    assert.match(setupCss, /\.ur-complete \{/);
  });

  it("never says 'the client' in the new copy", () => {
    for (const source of [
      assumptions,
      read("src/understanding-once-model.ts"),
    ]) {
      assert.doesNotMatch(source, /\bthe client\b/i);
    }
  });
});
