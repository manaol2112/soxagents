import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import * as words from "../apps/web/src/understanding-specialist-model.ts";

// B1k and B1l (docs/control-workflow-plan.md; product owner, 16 November 2026; approved
// prototype brief-proto/ureview2.png). These read the views' source, beside the pure tests in
// understanding-specialist-model.test.ts: where each screen draws the review, the not-known
// action, the failed review's two choices, the held attribute and the ASSUMPTION point, and
// that nothing shows as done before the server confirms it.

const read = (path: string) =>
  readFileSync(new URL(`../apps/web/${path}`, import.meta.url), "utf8");

const review = read("src/understanding-review.tsx");
const specialist = read("src/understanding-specialist.tsx");
const question = read("src/agent-question-point.tsx");
const setup = read("src/control-setup.tsx");
const controls = read("src/controls-view.tsx");
const panel = read("src/control-context-view.tsx");
const criteria = read("src/attribute-criteria.tsx");
const assumptions = read("src/attribute-assumptions.tsx");
const points = read("src/design-points.tsx");
const paper = read("src/design-workpaper-view.tsx");
const route = read("app/workspace/control-context/route.ts");
const setupCss = read("app/control-setup.css");
const listCss = read("app/attribute-list.css");

/** The body of a top-level function or component in `source`, up to the next one. */
function component(source: string, name: string): string {
  const start = source.search(new RegExp(`\\n(export )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const next = source.slice(start + 1).search(/\n(export )?function /);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

/** The body of a function declared inside a component, up to the next one at its depth. */
function inner(source: string, name: string): string {
  const start = source.search(new RegExp(`\\n  (async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const next = source
    .slice(start + 1)
    .search(/\n {2}(\/\*\*|(async )?function )/);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

describe("the specialist's review under the understanding", () => {
  it("comes after 'The understanding' narrative and before what it is ready for", () => {
    const pane = review.slice(
      review.indexOf("const documentPane = ("),
      review.indexOf("{copyTargets.length === 1"),
    );
    const narrative = pane.indexOf("className={`ur-narrative");
    const section = pane.indexOf("<QuestionReviewSection");
    const ready = pane.indexOf("className={`ur-ready");
    assert.ok(narrative > 0 && narrative < section && section < ready);
    // Rewritten (B1l review fixes, 16 November 2026). Old: the section was given the pass,
    // the review and the completion only. New: also the read a person asked for after
    // completion, why no review ran, and the approved attributes (named by letter).
    // Rewritten again 19 November 2026 (screenshot pass): also the proceed record, so the
    // review's line says it was completed without the review, with the reason.
    // Rewritten again 18 November 2026 (owner decision, "Show the support"): old, it ended at
    // `approved`; new, also where the support's documents and process narrative open.
    assert.match(
      pane,
      /<QuestionReviewSection\s+ids=\{ids\}\s+canAct=\{canAct\}\s+pass=\{once\.questionPass\}\s+review=\{once\.review \?\? null\}\s+completedAt=\{once\.completedAt\}\s+request=\{once\.request \?\? null\}\s+notRun=\{once\.notRun \?\? null\}\s+approved=\{once\.approved \?\? \[\]\}\s+documentsHref=\{documentsHref\}\s+onProcess=\{onProcess\}\s+proceeded=\{once\.proceeded \?\? null\}\s*\/>/,
    );
  });

  it("is given the latest review from the context, through the guided setup", () => {
    assert.match(controls, /review: context\.questionReview \?\? null,/);
    assert.match(setup, /review: conversation\.review \?\? null,/);
  });

  it("writes the paragraph in the narrative's serif and marks the matters quietly", () => {
    const section = component(specialist, "QuestionReviewSection");
    assert.match(section, /\{REVIEW_TITLE\}/);
    assert.match(section, /· \{REVIEW_BY\}/);
    assert.match(section, /<p className="ur-review-text">/);
    assert.match(section, /<mark key=\{at\} className="ur-review-mark">/);
    // Settled: "Reviewed <when>: …", with nothing marked.
    // Rewritten (B1l review fixes, 16 November 2026: "Review again" made the section vanish).
    // Old: the paragraph was `view.review`'s, drawn only in the ready state. New: the
    // paragraph shown is the ready review, or the last good one while a read runs, so it is
    // never hidden; the attributes not reviewed are named by their letters.
    assert.match(
      section,
      /const shown =\s*view\.state === "ready"\s*\? view\.review\s*: view\.state === "checking"\s*\? view\.last\s*: null;/,
    );
    assert.match(section, /reviewedLead\(shown\.reviewedAt\)/);
    assert.match(
      section,
      /markedParts\(shown\.narrative, settled \? \[\] : shown\.marked\)/,
    );
    assert.match(section, /\{REVIEW_CHECKING\}/);
    // Failed: one line here; the sentence and the two choices end the course.
    assert.match(section, /\{REVIEW_FAILED\}\.\s*<\/p>/);
    // Rewritten in the second fix round of B1k: old, notReviewedLine(shown.notReviewed,
    // approved) mapped by an AttributeBody.code the API did not send; new, the API's own
    // not_reviewed_items are passed too, and place each attribute by its id.
    // Rewritten 18 November 2026 (owner decision, "Completion waits for a person"). Old: the
    // three arguments alone. New: a fourth, whether the pass is HELD before completion, so the
    // line says only what was not reviewed while the understanding waits on a person (the
    // choice says what happens next); the naming is unchanged. tests/understanding-review-
    // held.test.ts pins the held words.
    assert.match(
      section,
      /notReviewedLine\(\s*shown\.notReviewed,\s*approved,\s*shown\.notReviewedItems,\s*pass === "HELD" && completedAt === null,\s*\)/,
    );
    assert.match(
      setupCss,
      /\.ur-review-text \{[^}]*font-family: var\(--font-display\);/,
    );
    assert.match(setupCss, /\.ur-review-mark \{[^}]*var\(--warning-soft\)/);
  });

  it("offers Review again as a person's quiet request, done only once the server accepts it", () => {
    const section = component(specialist, "QuestionReviewSection");
    // Rewritten (B1l review fixes, 16 November 2026: after a failed one it could not be
    // asked again). Old: offersReviewAgain(completedAt, pass, canAct), drawn only when ready,
    // worded REVIEW_AGAIN. New: offered from the view whatever it is (never while checking,
    // never without a model), worded by it: Run again after a read that could not run.
    assert.match(
      section,
      /offersReviewAgain\(completedAt, pass, canAct, view\)/,
    );
    assert.match(
      section,
      /className="ur-skip"[\s\S]{0,160}\{sending \? "Requesting…" : reviewAgainWords\(view\)\}/,
    );
    assert.doesNotMatch(section, /again && view\.state === "ready"/);
    const send = section.slice(section.indexOf("async function reviewAgain"));
    assert.ok(
      send.indexOf('await post(ids, "review-run")') <
        send.indexOf("REVIEW_AGAIN_SENT"),
    );
    assert.match(
      send,
      /reviewProblem\("review-run", answer\.status, answer\.detail\)/,
    );
    assert.doesNotMatch(specialist, /window\.location|location\.reload/);
  });

  it("reads the page again every 3 seconds while a requested review runs, and stops after", () => {
    const section = component(specialist, "QuestionReviewSection");
    assert.match(
      section,
      /const polling = view\.state === "checking" && completedAt !== null;/,
    );
    assert.match(
      section,
      /if \(!polling\) \{\s*return;\s*\}\s*const timer = window\.setInterval\(\(\) => router\.refresh\(\), 3000\);\s*return \(\) => window\.clearInterval\(timer\);/,
    );
    // Before completion the course reads again on its own (B1j), the stale reads ignored.
    assert.match(
      review,
      /const timer = window\.setInterval\(\(\) => \{\s*router\.refresh\(\);\s*void read\(\);\s*\}, 3000\);/,
    );
    assert.match(
      review,
      /if \(mine !== reads\.current\) \{\s*return null;\s*\}/,
    );
  });
});

describe("the review's questions in the same course", () => {
  it("are labelled from the review, with what they block as the reason line", () => {
    assert.match(review, /const blocks = blocksLine\(raised\);/);
    assert.match(review, /reason=\{blocks\}/);
    assert.match(
      question,
      /\{title\}\s*\{reason !== "" \? <p className="ur-hint ur-blocks">\{reason\}<\/p> : null\}/,
    );
    // The suggested answer is preselected only as today's suggestions are: the question
    // point is unchanged in how it picks.
    assert.match(question, /const screens = inlineScreens\(row, picks\);/);
    // Design review, 19 November 2026 (C1): "selected" only when it is, and a step's question
    // that repeats the title is read, not shown twice.
    assert.match(
      question,
      /: suggestionSelected\(screens\[0\]\)\s*\? "The agents' answer is selected\./,
    );
    assert.match(
      question,
      /screen\.question\.trim\(\) === titleText\.trim\(\)\s*\? "ur-ask-q sr-only"/,
    );
  });
});

describe("Not known yet, proceed", () => {
  it("is the third action on every question's foot, beside Skip for now", () => {
    const foot = review.slice(
      review.indexOf("const foot = ("),
      review.indexOf("const carriedStep = () =>"),
    );
    assert.ok(foot.indexOf("Skip for now") < foot.indexOf("<NotKnownButton"));
    // Rewritten (B1l review fixes, product owner 16 November 2026: "Not known yet, proceed"
    // covers required walkthrough questions and statement values as well). Old: the foot
    // offered it from `offersNotKnown(asked.issue, canAct)`, an OPEN issue only. New: from
    // the step's target, which notKnownTarget gives for an OPEN question of the agents or
    // the review, and for a statement value or a walkthrough question not on record.
    assert.match(foot, /const target = asked\?\.target \?\? null;/);
    assert.match(foot, /target=\{target\}/);
    assert.match(
      review,
      /const asked = \{ need, target: notKnownTarget\(need, raised, canAct\) \};/,
    );
    assert.match(foot, /onDone=\{\(\) => void leftNotKnown\(asked\.need\)\}/);
    // Both ways a question is asked carry it.
    assert.match(
      review,
      /foot=\{\(primary\) => foot\(primary, true, asked\)\}/,
    );
    assert.match(review, /\{foot\(act, true, asked\)\}/);
    // A statement value's own step carries it too (B1l review fixes).
    assert.match(review, /!onFile,\s*asked,\s*\)\}/);
  });

  it("is offered on each walkthrough question not on record, its note in place", () => {
    const item = review.slice(
      review.indexOf("const walkthroughQuestion = (need: Need) =>"),
      review.indexOf("const topicStepView ="),
    );
    assert.match(
      item,
      /const notKnown = notKnownTarget\(need, undefined, canAct\);/,
    );
    assert.match(item, /onOpen=\{\(\) => setNotKnownFor\(need\.key\)\}/);
    assert.match(
      item,
      /<NotKnownPanel[\s\S]{0,160}target=\{notKnown\}[\s\S]{0,120}onDone=\{\(\) => void leftNotKnown\(need\)\}/,
    );
    // A walkthrough question leaves its topic's step, which stays where it is.
    const left = inner(review, "leftNotKnown");
    assert.match(
      left,
      /if \(need\.kind === "WALKTHROUGH"\) \{\s*clearWalkthrough\(\[need\.key\]\);\s*\} else \{\s*go\(nextOpen\(now, interview, at\)\);\s*\}/,
    );
    // What a person left as not known stays on record as theirs, never as an answer.
    assert.match(review, /Left as not known yet/);
    assert.match(review, /<strong>Not known yet<\/strong>/);
  });

  it("takes an optional note of up to 500 characters, and moves on only once the server records it", () => {
    const panelSource = component(specialist, "NotKnownPanel");
    assert.match(panelSource, /maxLength=\{NOT_KNOWN_NOTE_MAX\}/);
    assert.match(panelSource, /characterCount\(note, NOT_KNOWN_NOTE_MAX\)/);
    assert.match(panelSource, /\{NOT_KNOWN_HINT\}/);
    const record = panelSource.slice(
      panelSource.indexOf("async function record"),
    );
    // Rewritten (B1l review fixes). Old: the panel always posted "issue-not-known". New:
    // the write is its target's (an issue at its version, a walkthrough question or a value
    // by key, notKnownWrite), still before onDone.
    assert.ok(
      record.indexOf("const write = notKnownWrite(target, note.trim());") <
        record.indexOf("await post(ids, write.intent, write.fields)"),
    );
    assert.ok(
      record.indexOf("await post(ids, write.intent, write.fields)") <
        record.indexOf("onDone();"),
    );
    assert.match(
      record,
      /if \(refused !== null\) \{\s*setProblem\(refused\);\s*return;\s*\}\s*onDone\(\);/,
    );
    // Inside the question's own form: plain buttons, never a nested form.
    assert.doesNotMatch(panelSource, /<form/);
  });

  it("is never recorded as an answer: the question leaves the course and is never on record", () => {
    const left = inner(review, "leftNotKnown");
    assert.doesNotMatch(left, /withConfirmed/);
    assert.match(left, /const now = withoutNotKnown\(review, keys\);/);
    assert.match(left, /go\(nextOpen\(now, interview, at\)\);/);
    // Every read leaves the not-known questions out too.
    assert.match(
      review,
      /const found =\s*parsed === null \? null : withoutNotKnown\(parsed, closedRef\.current\);/,
    );
    // The issue list says "not known yet", never a status as an answer.
    assert.match(panel, /issue\.status === "NOT_KNOWN"\s*\? "not known yet"/);
  });
});

describe("a review that could not run", () => {
  it("ends the course with one line, the failure sentence and two choices", () => {
    // Rewritten 18 November 2026 (owner decision, "Completion waits for a person"). Old:
    // the end for a failed review only, headed REVIEW_FAILED, posting with no fields. New:
    // the same component also ends a held review (`held`, REVIEW_HELD, with a reason); a
    // failed one reads as before (tests/understanding-review-held.test.ts for the held one).
    assert.match(
      review,
      /\) : end === "failed" \|\| end === "held" \? \([\s\S]{0,300}<ReviewFailed\s+ids=\{ids\}\s+canAct=\{canAct\}/,
    );
    const failed = component(specialist, "ReviewFailed");
    assert.match(
      failed,
      /<h3 className="ur-q">\{held === null \? REVIEW_FAILED : REVIEW_HELD\}<\/h3>/,
    );
    assert.match(failed, /\? failure/);
    assert.match(failed, /"Proceeding…" : PROCEED_WITHOUT\}/);
    assert.match(failed, /"Requesting…" : RUN_AGAIN\}/);
    assert.ok(failed.indexOf("await post(") < failed.indexOf("PROCEED_SENT"));
    // Never headed as understood, and the attributes wait on the person's choice.
    // Rewritten 18 November 2026 (design review): the title also waits for the questions
    // the reviewer agent is still checking. Old: `(status.done && end !== "checking" &&
    // end !== "failed")`. New: the same with `checkingNow === 0`; the failed run still
    // never heads it as understood.
    // Rewritten 18 November 2026 (owner decision): old, `end !== "failed")` closed the
    // condition and the attributes were held on `end === "failed"`; new, a held review too.
    assert.match(
      review,
      /\(status\.done &&\s*checkingNow === 0 &&\s*end !== "checking" &&\s*end !== "failed" &&\s*end !== "held"\)/,
    );
    assert.match(
      review,
      /heldByFailedReview\([\s\S]{0,240}end === "failed" \|\| end === "held",\s*\)/,
    );
    // Rewritten (design review, 19 November 2026): the lede states only the state; the
    // end of the course carries the two choices.
    assert.match(
      review,
      /end === "failed" \? \(\s*`\$\{draftedFrom\(groups, interview\)\}\. \$\{REVIEW_FAILED_LEDE\}`/,
    );
    assert.equal(
      words.REVIEW_FAILED_LEDE,
      "The review of the questions asked could not run.",
    );
  });

  it("goes through the proxy, which passes the context of a review accepted to run (202)", () => {
    assert.match(specialist, /fetch\("\/workspace\/control-context"/);
    assert.match(
      route,
      /if \(status === 200 \|\| status === 202\) \{\s*context = body;/,
    );
  });
});

describe("the Attributes step", () => {
  it("leaves a held attribute out of Accept all and says what goes with it", () => {
    // Rewritten 19 November 2026 (owner-approved Review attributes prototype). Old: the
    // rows were the step's list, and the note was a line under the bar. New: the rows still
    // to decide are the list's live rows not accepted in this visit, Accept all says how
    // many rows are already reviewed ("Accept remaining n"), and the note sits beside the
    // button, inside the actions only a person who may decide sees. Kept: the set's
    // assumptions and every row not yet accepted are counted (B1l review fixes), and
    // whether a conflict holds the set.
    assert.match(panel, /const allRows = acceptAllRows\(live\);/);
    assert.match(
      panel,
      /acceptAllWords\(allRows, toAccept\.length - allRows\.length, \{\s*assumptions: context\.setAssumptions \?\? \[\],\s*remaining: notYetAccepted\(live\),\s*held: setHeldNow,\s*reviewed: progress\.reviewed,\s*\}\)/,
    );
    assert.match(panel, /\{canAct \? \(\s*<span className="ta-bar-acts">/);
    assert.match(
      panel,
      /const sent = allRows;\s*if \(await onAccept\(sent\)\)/,
    );
    assert.match(
      panel,
      /\{busyKey === "accept-all" \? "Accepting…" : allWords\.label\}/,
    );
    assert.match(
      panel,
      /\{showAllNote \? \(\s*<span\s*className="tar-all-note"\s*id=\{`ta-accept-note-\$\{ids\.controlId\}`\}\s*>\s*\{allNote\}/,
    );
    // Nothing held is ever sent, whichever button is pressed.
    assert.match(
      panel,
      /const items = acceptItems\(rows\);\s*if \(items\.length === 0\) \{\s*return false;\s*\}/,
    );
  });

  it("turns Accept off on a held attribute, with the reason", () => {
    // Rewritten 19 November 2026 (Review attributes: offer only what can succeed). Old: the
    // row's Accept was shown turned off (disabled={locked || held}). New: a held row offers
    // no Accept at all (rowOffer, tests/attributes-review-model.test.ts), and says why in the
    // same words. Kept (B1l review fixes): the reason is holdWords(item), the attribute's own
    // conflict or the set's, shown only to a person who may decide (acting).
    assert.match(panel, /const offer = rowOffer\(each, \{ held, lastOne \}\);/);
    assert.match(
      panel,
      /\{held \? <p className="tc-held">\{holdWords\(item\)\}<\/p> : null\}/,
    );
    assert.match(panel, /const acting = canAct && !running && !justAccepted;/);
    assert.match(criteria, /const held = item\.heldByConflict === true;/);
    assert.equal(
      criteria.match(/disabled=\{action\.pending \|\| held\}/g)?.length,
      2,
    );
    assert.match(panel, /unavailable: held \? holdWords\(item\) : null,/);
  });

  it("reads a conflict as a decision with its two choices, and a not-known as such", () => {
    assert.match(
      assumptions,
      /\{conflict \? <p className="tas-kicker">\{CONFLICT_LEAD\}<\/p> : null\}/,
    );
    // Rewritten (design review, 19 November 2026: a fact not yet known). Old: the literal
    // choices inline. New: by kind, from one source (confirmWords, changeWords).
    assert.match(assumptions, /: confirmWords\(item\.kind\)\}/);
    assert.match(assumptions, /\{changeWords\(item\.kind\)\}/);
    assert.match(listCss, /\.tas-open\.is-conflict \{/);
  });
});

describe("the D&I workpaper's ASSUMPTION point", () => {
  it("links to the Attributes step, and keeps Considered… as for other points", () => {
    // Rewritten (B1l review fixes: the point's link must lead to where the assumption is
    // decided). Old: settleHref(action, links), the Attributes step. New: with the point's
    // place, so the link opens the attribute's own row (#attribute-<id>).
    assert.match(
      points,
      /const href = settleHref\(action, links, point\.place\);/,
    );
    assert.match(panel, /id=\{attributeAnchor\(item\.id\)\}/);
    assert.match(
      panel,
      /const target = attributeFromHash\(window\.location\.hash\);/,
    );
    assert.match(points, /attributesHref: writes\?\.attributesHref \?\? null,/);
    assert.match(points, /\{CONSIDERED\}/);
    assert.match(points, /<b>\{YOUR_DECISION\}<\/b>/);
    assert.match(paper, /evidenceHref,\s*attributesHref,/);
  });
});

describe("the words", () => {
  const copy = (Object.values(words) as unknown[]).filter(
    (value): value is string => typeof value === "string",
  );

  it("never say 'the client', nor 'open' for a question the person is asked", () => {
    assert.ok(copy.length >= 15);
    for (const text of copy) {
      assert.doesNotMatch(text, /\bthe client\b/i, text);
      assert.doesNotMatch(text, /\bopen\b/i, text);
    }
    for (const source of [
      specialist,
      read("src/understanding-specialist-model.ts"),
    ]) {
      assert.doesNotMatch(source, /\bthe client\b/i);
    }
  });

  it("keep the motion short and off under reduced motion", () => {
    assert.match(
      setupCss,
      /\.ur-notknown \{[^}]*animation: ur-notknown-in 200ms ease;/,
    );
    assert.match(
      setupCss,
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.ur-notknown \{\s*animation: none;/,
    );
  });
});

// Regression, 18 November 2026 (the product owner's screenshot: "The UI here is terrible"):
// while the reviewer agent checked the wording of new questions, its line fell into the
// header grid's first, auto-sized column and widened it to the sentence, crushing the title
// to one word a line. Every line below the head row spans the full width.
describe("the understanding's header while questions are checked", () => {
  it("spans every line below the head row across the grid", () => {
    assert.match(
      setupCss,
      /\.ur-head > :not\(\.ur-tile, \.ur-head-text, \.ur-head-tools\) \{\s*grid-column: 1 \/ -1;/,
    );
    // In the header it is a row of the grid: no extra margin, the full width.
    assert.match(
      setupCss,
      /\.ur-head > \.ur-checking \{\s*max-width: none;\s*margin-top: 0;/,
    );
    const view = read("src/understanding-review.tsx");
    // The checking line is a direct child of the header, so the rule reaches it; the
    // live region announcing it is always rendered (WCAG 4.1.3).
    assert.match(
      view,
      /<p className="sr-only" role="status">\s*\{end !== "checking" && checkingNow > 0\s*\? checkingLine\(checkingNow\)\s*: ""\}\s*<\/p>\s*\{\/\* A completed understanding says it in its lede \(understoodLede\), not twice\. \*\/\}\s*\{end !== "checking" && checkingNow > 0 && !complete \? \(\s*<p className="ur-hint ur-checking" aria-hidden="true">/,
    );
  });

  it("never says the control is understood while new questions are being checked", () => {
    const view = read("src/understanding-review.tsx");
    // One screen, one story (design review, 18 November 2026): the title and its lede
    // wait for the questions the reviewer agent is still checking.
    // Rewritten 18 November 2026 (owner decision): a held review never heads it as
    // understood either (old: the condition ended at `end !== "failed"`).
    assert.match(
      view,
      /\(status\.done &&\s*checkingNow === 0 &&\s*end !== "checking" &&\s*end !== "failed" &&\s*end !== "held"\)\s*\? proceededSaid !== null\s*\? `\$\{review\.controlRef\} is understood, without the full review`\s*: `\$\{review\.controlRef\} is understood`/,
    );
    assert.match(
      view,
      /\) : status\.done && checkingNow === 0 \? \(\s*understoodLede\(/,
    );
  });
});
