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
    assert.match(
      pane,
      /<QuestionReviewSection\s+ids=\{ids\}\s+canAct=\{canAct\}\s+pass=\{once\.questionPass\}\s+review=\{once\.review \?\? null\}\s+completedAt=\{once\.completedAt\}\s*\/>/,
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
    assert.match(section, /reviewedLead\(view\.review\.reviewedAt\)/);
    assert.match(section, /view\.settled \? \[\] : view\.review\.marked/);
    assert.match(section, /\{REVIEW_CHECKING\}/);
    // Failed: one line here; the sentence and the two choices end the course.
    assert.match(section, /\{REVIEW_FAILED\}\.\s*<\/p>/);
    assert.match(section, /notReviewedLine\(view\.review\.notReviewed\)/);
    assert.match(
      setupCss,
      /\.ur-review-text \{[^}]*font-family: var\(--font-display\);/,
    );
    assert.match(setupCss, /\.ur-review-mark \{[^}]*var\(--warning-soft\)/);
  });

  it("offers Review again as a person's quiet request, done only once the server accepts it", () => {
    const section = component(specialist, "QuestionReviewSection");
    assert.match(section, /offersReviewAgain\(completedAt, pass, canAct\)/);
    assert.match(
      section,
      /className="ur-skip"[\s\S]{0,160}\{sending \? "Requesting…" : REVIEW_AGAIN\}/,
    );
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
  });
});

describe("Not known yet, proceed", () => {
  it("is the third action on every question's foot, beside Skip for now", () => {
    const foot = review.slice(
      review.indexOf("const foot = ("),
      review.indexOf("const carriedStep = () =>"),
    );
    assert.ok(foot.indexOf("Skip for now") < foot.indexOf("<NotKnownButton"));
    assert.match(foot, /offersNotKnown\(asked\.issue, canAct\)/);
    assert.match(foot, /onDone=\{\(\) => void leftNotKnown\(asked\.need\)\}/);
    // Both ways a question is asked carry it.
    assert.match(
      review,
      /foot=\{\(primary\) => foot\(primary, true, asked\)\}/,
    );
    assert.match(review, /\{foot\(act, true, asked\)\}/);
  });

  it("takes an optional note of up to 500 characters, and moves on only once the server records it", () => {
    const panelSource = component(specialist, "NotKnownPanel");
    assert.match(panelSource, /maxLength=\{NOT_KNOWN_NOTE_MAX\}/);
    assert.match(panelSource, /characterCount\(note, NOT_KNOWN_NOTE_MAX\)/);
    assert.match(panelSource, /\{NOT_KNOWN_HINT\}/);
    const record = panelSource.slice(
      panelSource.indexOf("async function record"),
    );
    assert.ok(
      record.indexOf('await post(ids, "issue-not-known"') <
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
    assert.match(
      review,
      /\) : end === "failed" \? \([\s\S]{0,200}<ReviewFailed\s+ids=\{ids\}\s+canAct=\{canAct\}/,
    );
    const failed = component(specialist, "ReviewFailed");
    assert.match(failed, /<h3 className="ur-q">\{REVIEW_FAILED\}<\/h3>/);
    assert.match(failed, /\{failure\}/);
    assert.match(failed, /"Proceeding…" : PROCEED_WITHOUT\}/);
    assert.match(failed, /"Requesting…" : RUN_AGAIN\}/);
    assert.ok(
      failed.indexOf("await post(ids, intent)") <
        failed.indexOf("PROCEED_SENT"),
    );
    // Never headed as understood, and the attributes wait on the person's choice.
    assert.match(
      review,
      /\(status\.done && end !== "checking" && end !== "failed"\)/,
    );
    assert.match(
      review,
      /heldByFailedReview\([\s\S]{0,240}end === "failed",\s*\)/,
    );
    assert.match(
      review,
      /end === "failed" \? \(\s*`\$\{draftedFrom\(groups, interview\)\}\. The review of the questions asked could not run/,
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
    assert.match(panel, /const allRows = acceptAllRows\(rows\);/);
    assert.match(
      panel,
      /acceptAllWords\(allRows, toAccept\.length - allRows\.length\)/,
    );
    assert.match(panel, /onClick=\{\(\) => onAccept\(allRows\)\}/);
    assert.match(
      panel,
      /\{busyKey === "accept-all" \? "Accepting…" : allWords\.label\}/,
    );
    assert.match(
      panel,
      /<p className="ta-accept-note" id=\{`ta-accept-note-\$\{ids\.controlId\}`\}>\s*\{allNote\.charAt\(0\)\.toUpperCase\(\)\}\s*\{allNote\.slice\(1\)\}/,
    );
    // Nothing held is ever sent, whichever button is pressed.
    assert.match(
      panel,
      /const items = acceptItems\(rows\);\s*if \(items\.length === 0\) \{\s*return;\s*\}/,
    );
  });

  it("turns Accept off on a held attribute, with the reason", () => {
    assert.match(
      panel,
      /disabled=\{locked \|\| held\}\s*onClick=\{\(\) => onAccept\(\[each\]\)\}/,
    );
    assert.match(
      panel,
      /\{canAct && held \? \(\s*<p className="tc-held">\{CONFLICT_HOLDS\}<\/p>\s*\) : null\}/,
    );
    assert.match(criteria, /const held = item\.heldByConflict === true;/);
    assert.equal(
      criteria.match(/disabled=\{action\.pending \|\| held\}/g)?.length,
      2,
    );
    assert.match(panel, /unavailable: held \? CONFLICT_HOLDS : null,/);
  });

  it("reads a conflict as a decision with its two choices, and a not-known as such", () => {
    assert.match(
      assumptions,
      /\{conflict \? <p className="tas-kicker">\{CONFLICT_LEAD\}<\/p> : null\}/,
    );
    assert.match(assumptions, /\? CONFLICT_STANDS\s*: "That's right"/);
    assert.match(assumptions, />\s*Change…\s*</);
    assert.match(listCss, /\.tas-open\.is-conflict \{/);
  });
});

describe("the D&I workpaper's ASSUMPTION point", () => {
  it("links to the Attributes step, and keeps Considered… as for other points", () => {
    assert.match(points, /const href = settleHref\(action, links\);/);
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
