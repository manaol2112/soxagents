import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  contextWrite,
  parseContext,
  parsePoints,
  parseQuestionReview,
} from "../apps/web/src/control-context-model.ts";
import * as words from "../apps/web/src/understanding-specialist-model.ts";

// Owner decision, 18 November 2026 ("Show the support"): each point the review found
// established shows what it rests on, next to it, and a person may challenge it; round 3 of
// the independent review's fixes on the page too.

const read = (path: string) =>
  readFileSync(new URL(`../apps/web/${path}`, import.meta.url), "utf8");
const specialist = read("src/understanding-specialist.tsx");
const review = read("src/understanding-review.tsx");

function component(source: string, name: string): string {
  const start = source.search(new RegExp(`(export )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const next = source.indexOf("\nfunction ", start + 1);
  const exported = source.indexOf("\nexport function ", start + 1);
  const ends = [next, exported].filter((at) => at > 0);
  return source.slice(start, ends.length > 0 ? Math.min(...ends) : undefined);
}

const IDS = {
  organization_id: "018f0000-0000-7000-8000-000000000001",
  project_id: "018f0000-0000-7000-8000-000000000002",
  control_id: "018f0000-0000-7000-8000-000000000003",
};
const POINT = {
  key: "A2",
  kind: "ATTRIBUTE",
  attribute_id: "018f0000-0000-7000-8000-0000000000a2",
  code: "A2",
  text: "Each patch is approved before it is applied.",
  needs: ["APPROVER", "RECORD"],
  support: [
    {
      kind: "WALKTHROUGH",
      ref: "W3",
      needs: ["APPROVER"],
      label: "Who approves each patch?",
      said: "The CAB chair",
      document_id: null,
    },
    {
      kind: "DOCUMENT",
      ref: "D1",
      needs: ["RECORD"],
      label: "Patch Management Standard",
      said: "Each approval is recorded on the change ticket",
      document_id: "018f0000-0000-7000-8000-0000000000d1",
    },
  ],
  challenge: "",
  challenge_issue_id: null,
};

describe("What each established point rests on, read strictly", () => {
  it("reads the points of a READY review as the server keeps them", () => {
    const parsed = parseQuestionReview({
      id: "018f0000-0000-7000-8000-0000000000c1",
      status: "READY",
      round: 1,
      narrative: "The questions answered establish how the control operates.",
      marked: [],
      not_reviewed: [],
      open_questions: 0,
      reviewed_at: "2026-11-18T10:00:00Z",
      failure: "",
      points: [POINT],
    });
    assert.deepEqual(parsed?.points, [
      {
        key: "A2",
        kind: "ATTRIBUTE",
        attributeId: POINT.attribute_id,
        code: "A2",
        text: POINT.text,
        needs: ["APPROVER", "RECORD"],
        support: [
          {
            kind: "WALKTHROUGH",
            ref: "W3",
            needs: ["APPROVER"],
            label: "Who approves each patch?",
            said: "The CAB chair",
            documentId: null,
          },
          {
            kind: "DOCUMENT",
            ref: "D1",
            needs: ["RECORD"],
            label: "Patch Management Standard",
            said: "Each approval is recorded on the change ticket",
            documentId: "018f0000-0000-7000-8000-0000000000d1",
          },
        ],
        challenge: "",
        challengeIssueId: null,
      },
    ]);
    // An item of no known kind, or a point with a bad key, is left out; so is a point left
    // with nothing it rests on (19 November 2026: "Attribute E" listed with nothing under it).
    assert.deepEqual(
      parsePoints([
        { ...POINT, key: "bad key!" },
        { ...POINT, support: [{ kind: "GUESS", ref: "W1" }] },
        { ...POINT, key: "A5", support: [] },
      ]),
      [],
    );
    const challenged = parsePoints([
      {
        ...POINT,
        challenge: "OPEN",
        challenge_issue_id: "018f0000-0000-7000-8000-0000000000e1",
      },
    ]);
    assert.equal(challenged[0]?.challenge, "OPEN");
    assert.equal(
      challenged[0]?.challengeIssueId,
      "018f0000-0000-7000-8000-0000000000e1",
    );
  });

  it("reads whether a proceed takes a reason", () => {
    const body = {
      control_id: IDS.control_id,
      attributes: { approved: [], proposed: [], history: [] },
      issues: [],
      documents: [],
    };
    assert.equal(
      parseContext({ ...body, review_reason_needed: true })?.reviewReasonNeeded,
      true,
    );
    assert.equal(parseContext(body)?.reviewReasonNeeded, false);
  });

  it("sends a challenge as the API takes it, and refuses one it would refuse", () => {
    const fields = {
      ...IDS,
      intent: "review-challenge",
      review_id: "018f0000-0000-7000-8000-0000000000c1",
      unit: "A2",
      need: "APPROVER",
      note: "  The approver named is not the one on the ticket.  ",
    };
    const write = contextWrite(fields);
    assert.ok(!("error" in write));
    assert.equal(write.path.endsWith("/understanding/review/challenge"), true);
    assert.deepEqual(write.body, {
      review_id: fields.review_id,
      unit: "A2",
      need: "APPROVER",
      note: "The approver named is not the one on the ticket.",
    });
    for (const bad of [
      { need: "GUESS" },
      { unit: "not a key!" },
      { review_id: "x" },
      { note: "password=hunter2secret" },
    ]) {
      assert.ok(
        "error" in contextWrite({ ...fields, ...bad }),
        JSON.stringify(bad),
      );
    }
  });
});

describe("The words of the support and the challenge", () => {
  it("says each thing a point rests on in one line, a passage in quotation marks", () => {
    const [answer, passage] = parsePoints([POINT])[0]?.support ?? [];
    assert.ok(answer !== undefined && passage !== undefined);
    assert.deepEqual(words.supportLine(answer), {
      kind: "Walkthrough answer",
      label: "Who approves each patch?",
      said: "The CAB chair",
    });
    assert.deepEqual(words.supportLine(passage), {
      kind: "Document",
      label: "Patch Management Standard",
      said: "“Each approval is recorded on the change ticket”",
    });
    assert.deepEqual(
      words.supportLine({
        ...passage,
        kind: "NARRATIVE",
        label: "Process narrative",
      }),
      {
        kind: "Process narrative",
        label: "",
        said: "“Each approval is recorded on the change ticket”",
      },
    );
  });

  it("names a point as the Attributes step does", () => {
    const [point] = parsePoints([POINT]);
    assert.ok(point !== undefined);
    const approved = [
      {
        id: "018f0000-0000-7000-8000-0000000000a1",
        code: "A1",
        definition: null,
      },
      { id: POINT.attribute_id, code: "A2", definition: null },
    ];
    assert.equal(words.pointName(point, approved), "Attribute B");
    assert.equal(words.pointName(point, []), POINT.text);
    assert.equal(
      words.pointName(
        { ...point, kind: "FACT", key: "APPROVER", code: null },
        [],
      ),
      "Who approves it",
    );
  });

  it("offers a challenge only before completion, once, where it has a need to ask", () => {
    const [point] = parsePoints([POINT]);
    assert.ok(point !== undefined);
    assert.equal(words.offersChallenge(point, true, false), true);
    assert.equal(words.offersChallenge(point, false, false), false);
    assert.equal(words.offersChallenge(point, true, true), false);
    assert.equal(
      words.offersChallenge({ ...point, challenge: "OPEN" }, true, false),
      false,
    );
    assert.equal(
      words.offersChallenge({ ...point, needs: [] }, true, false),
      false,
    );
    assert.equal(words.challengeProblem(200), null);
    assert.equal(
      words.challengeProblem(409, "That point was asked already and answered."),
      "That point was asked already and answered.",
    );
    for (const text of [
      words.SUPPORT_TITLE,
      words.CHALLENGE_ACTION,
      words.CHALLENGE_NOTE_LABEL,
      words.CHALLENGE_NOTE_HINT,
      words.CHALLENGE_SENT,
      words.CHALLENGE_OPEN,
      words.CHALLENGE_PREPARING,
      words.CHALLENGE_ANSWERED,
    ]) {
      assert.doesNotMatch(text, /\b(I|we|my|our)\b|!/);
    }
  });
});

describe("A challenged point", () => {
  it("says its question is being prepared until it is shown", () => {
    // Design review, 19 November 2026: the point said "asked again in the questions below"
    // while its question was still being worded and nothing was below.
    assert.equal(
      words.challengeLine("PREPARING"),
      "Challenged: a new question is being prepared.",
    );
    // "asked again", never "open" for a question the person is asked (the words' rule).
    assert.equal(
      words.challengeLine("OPEN"),
      "Challenged: asked again in the questions.",
    );
    assert.equal(words.challengeLine(""), null);
    assert.doesNotMatch(words.CHALLENGE_SENT, /below/);
    const [point] = parsePoints([{ ...POINT, challenge: "PREPARING" }]);
    assert.ok(point !== undefined);
    assert.equal(point.challenge, "PREPARING");
    assert.equal(words.offersChallenge(point, true, false), false);
  });
});

describe("The support on the screen", () => {
  it("is styled like its neighbours, stacked on a phone, with no motion of its own", () => {
    const css = read("app/control-setup.css");
    const rule = (selector: string) =>
      new RegExp(`\\.${selector} \\{[^}]+\\}`).exec(css)?.[0] ?? "";
    for (const name of [
      "ur-review-support",
      "ur-support-list",
      "ur-support-point",
    ]) {
      assert.notEqual(rule(name), "", name);
    }
    // The kind is the small muted label the review's own labels use.
    assert.match(rule("ur-support-kind"), /color: var\(--text-tertiary\);/);
    assert.match(rule("ur-support-kind"), /text-transform: uppercase;/);
    // What it says is body text. Rewritten 19 November 2026 (screenshot pass, S3): old, the
    // link sat beside the content at 1440 and squeezed it to about 245px; new, the content
    // takes the full width and the link and Challenge sit in a row under it, at every width.
    assert.match(rule("ur-support-said"), /color: var\(--text\);/);
    assert.match(
      rule("ur-support-item"),
      /grid-template-columns: minmax\(0, 1fr\);/,
    );
    assert.match(rule("ur-support-open"), /justify-self: start;/);
    // One style for the two ways to view a source: the link's, on the narrative's button.
    assert.match(css, /\.ur-support-open button\.text-link \{/);
    // A field's problem in the danger tone; a single choice shows its marker.
    assert.match(rule("ur-hint-problem"), /color: var\(--danger\);/);
    assert.match(rule("ur-wt-dot"), /border-radius: 50%;/);
    // Only existing tokens: no colour written as a value.
    const block = css.slice(
      css.indexOf(".ur-review-support {"),
      css.indexOf("/* What the understanding is ready for"),
    );
    assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
    assert.match(block, /@media \(prefers-reduced-motion: reduce\)/);
    // The markup carries the classes the rules style.
    const point = component(specialist, "SupportPoint");
    for (const name of [
      "ur-support-item",
      "ur-support-kind",
      "ur-support-said",
      "ur-support-open",
      "ur-support-challenge",
    ]) {
      assert.ok(point.includes(name), name);
    }
  });

  it("is shown beside the review, from the review the server keeps", () => {
    const section = component(specialist, "QuestionReviewSection");
    assert.match(section, /<ReviewSupport\s/);
    assert.match(section, /points=\{shown\.points \?\? \[\]\}/);
    assert.match(
      review,
      /documentsHref=\{documentsHref\}\s*onProcess=\{onProcess\}\s*proceeded=\{once\.proceeded \?\? null\}\s*\/>/,
    );
  });

  it("challenges a point only once the server confirms it, with focus handled", () => {
    const point = component(specialist, "SupportPoint");
    assert.match(point, /await post\(ids, "review-challenge", \{/);
    assert.match(
      point,
      /const problem = challengeProblem\(answer\.status, answer\.detail\);/,
    );
    assert.match(point, /setSaid\(\{ ok: true, text: CHALLENGE_SENT \}\);/);
    assert.ok(
      point.indexOf("challengeProblem(answer.status") <
        point.indexOf("CHALLENGE_SENT }"),
    );
    assert.match(point, /"Asking…" : CHALLENGE_SEND/);
    assert.match(point, /first\.current\?\.focus\(\)/);
    assert.match(point, /opener\.current\?\.focus\(\)/);
    assert.match(point, /event\.key === "Escape"/);
    // A challenged point shows as open, not established: its support gives way, also while
    // its question is still being prepared.
    assert.match(
      point,
      /point\.challenge === "OPEN" \|\| point\.challenge === "PREPARING" \? null : \(/,
    );
    // Its state in one line, from one source (design review, 19 November 2026).
    assert.match(point, /\{challengeLine\(point\.challenge\)\}/);
    // The sources open where they are kept.
    assert.match(point, /\{OPEN_DOCUMENT\}/);
    assert.match(point, /onClick=\{onProcess\}/);
  });

  it("asks for the reason also after a later read could not run", () => {
    const choice = component(specialist, "ReviewFailed");
    assert.match(choice, /const asksReason = held !== null \|\| reasonNeeded;/);
    assert.match(review, /reasonNeeded=\{once\.reasonNeeded === true\}/);
  });

  it("reads a question being prepared again until it is ready", () => {
    // Round 3 (N9): one timer read once; an interval reads until the wording lands.
    const preparing = component(review, "PreparingQuestion");
    assert.match(preparing, /window\.setInterval\(onRead, PREPARING_READ_MS\)/);
    assert.match(preparing, /window\.clearInterval\(timer\)/);
  });
});

describe("One screen, one story after the screenshot pass (19 November 2026)", () => {
  const approved = [
    {
      id: "018f0000-0000-7000-8000-0000000000a1",
      code: "A1",
      definition: null,
    },
    {
      id: "018f0000-0000-7000-8000-0000000000a2",
      code: "A2",
      definition: null,
    },
  ];
  const proceeded = {
    by: "Dana Reyes",
    at: "2026-11-18T23:21:00Z",
    reason: "The owner confirmed the approver by email.",
    notReviewed: ["A2"],
  };

  it("says a proceed past attributes not reviewed in one sentence, and the reason once", () => {
    // Rewritten 19 November 2026 (q_ui4): the reason was in the lede, the end card and the
    // review's line, set in semibold green; now the sentence says what was not reviewed, and
    // the reason, who and when are said once, at the end of the course.
    assert.equal(
      words.proceededLine(proceeded, approved, []),
      "Completed without the review of attribute B.",
    );
    assert.equal(words.proceededLine({ notReviewed: [] }, approved), null);
    assert.match(
      words.proceededReason(proceeded, "UTC") ?? "",
      /^Reason recorded by Dana Reyes, .+: “The owner confirmed the approver by email”\.$/,
    );
    assert.equal(words.proceededReason({ ...proceeded, reason: "" }), null);
    // Design review, 19 November 2026: the panel title's words, within the node.
    assert.equal(words.PROCEEDED_STATUS, "Without the full review");
    assert.ok(words.PROCEEDED_STATUS.length <= 28);
  });

  it("says that sentence in the header, the lede and the node, once each", () => {
    // H1: the lede read "Every point ... is on record" and the review "Attribute B was not
    // reviewed" after a real proceed; the confirmation gave way to the Next card.
    assert.match(
      review,
      /const proceededSaid =\s*end === "complete" && once\.proceeded\s*\? proceededLine\(/,
    );
    assert.match(
      review,
      /\? proceededSaid !== null\s*\? `\$\{review\.controlRef\} is understood, without the full review`/,
    );
    // Rewritten (design review, 19 November 2026: the same sentence two or three times).
    // Old: the lede, the review's line and the green box each said it. New: the lede says
    // the time, the partial review and where the reason is; the green box is the way on
    // alone, and the review's line keeps only Review again. The reason is said once, at
    // the end of the course.
    assert.match(
      review,
      /\$\{proceededSaid\}\$\{proceededWhy !== null \? ` \$\{PROCEEDED_REASON_THERE\}` : ""\}/,
    );
    assert.equal(
      review.split("{proceededSaid}").length - 1,
      1,
      "said in the lede only",
    );
    assert.match(
      review,
      /<p className="ur-hint ur-proceeded-why">\{proceededWhy\}<\/p>/,
    );
    assert.equal(
      review.split("{proceededWhy}").length - 1,
      1,
      "the reason is said once",
    );
    const section = component(specialist, "QuestionReviewSection");
    assert.match(
      section,
      /const notReviewed =\s*proceededSaid !== null \|\| shown === null\s*\? null/,
    );
    assert.doesNotMatch(section, /PROCEEDED_REASON_THERE|proceededReason/);
    const workflow = read("src/control-workflow-model.ts");
    assert.match(
      workflow,
      /status:\s*once\.proceeded === true\s*\? PROCEEDED_STATUS\s*: completeStatus\(once\.completedAt\)/,
    );
    assert.match(
      read("src/controls-view.tsx"),
      /proceeded: \(context\.reviewProceeded\?\.notReviewed \?\? \[\]\)\.length > 0,/,
    );
  });

  it("never doubles a full stop under a field, nor repeats the title under it", () => {
    const parts = words.hintParts(
      "0 of 500 characters",
      "Give a reason of at least 3 characters.",
      "Recorded in the audit trail.",
    );
    assert.equal(parts.problem, "Give a reason of at least 3 characters");
    const field = component(specialist, "FieldHint");
    assert.match(field, /\{parts\.count\}/);
    assert.match(
      field,
      /<span className="ur-hint-problem">\{parts\.problem\}<\/span>/,
    );
    assert.match(field, /\. \{parts\.hint\}/);
    for (const name of ["ReviewFailed", "SupportPoint", "NotKnownPanel"]) {
      assert.doesNotMatch(component(specialist, name), /` · \$\{/, name);
    }
    assert.equal(
      words.failureDetail(
        "The review could not run: it stopped before it finished.",
      ),
      "It stopped before it finished.",
    );
    assert.match(
      component(specialist, "ReviewFailed"),
      /\? failureDetail\(failure\)/,
    );
  });

  it("names the questions being prepared with the header's own count", () => {
    // S1: "Waiting for the understanding to be read again" and the gates' "1 point left"
    // while the header said two questions were being checked.
    assert.equal(words.preparingTitle(1), "Preparing the question…");
    assert.equal(words.preparingTitle(2), "Preparing the questions…");
    assert.match(
      review,
      /\{checkingNow > 0\s*\? preparingTitle\(checkingNow\)/,
    );
    // Rewritten (design review, 19 November 2026, O1): old, the gates' status line alone;
    // new, while only walkthrough topics hold it, their questions (heldTopicsEnd).
    // Rewritten (re-shoot r9, 19 November 2026: the pane repeated the header's checking
    // sentence under "Preparing the questions…"). Old: the pane said checkingLine too. New:
    // the header's line says it once; the pane names the state only.
    assert.match(
      review,
      /\{checkingNow > 0 \? null : \(\s*<p className="ur-hint">\s*\{heldTopics !== null \? heldTopics\.text : status\.text\}/,
    );
    assert.equal(
      review.split("checkingLine(checkingNow)").length - 1,
      2,
      "the header's line and its live region only",
    );
    // The points still open, in the header's count, never the steps that hold them.
    assert.match(
      review,
      /const stillOpen = Math\.max\(0, progress\.total - progress\.done\);/,
    );
  });

  it("says the place in the course and the header's count in one way", async () => {
    const { courseWhere } = await import(
      "../apps/web/src/understanding-chat-model.ts"
    );
    const plan = ["topic:ACCESS", "topic:REVIEW", "topic:RECORDS"];
    assert.equal(
      courseWhere({
        plan,
        changing: [],
        at: 0,
        open: plan,
        settled: false,
        topics: plan,
        confirmed: { done: 0, total: 9 },
      }),
      "Topic 1 of 3 · 0 of 9 confirmed",
    );
    assert.equal(
      courseWhere({
        plan: [...plan, "A2"],
        changing: [],
        at: 1,
        open: [],
        settled: false,
        topics: plan,
      }),
      "Step 2 of 4",
    );
  });

  it("says a challenge once, and reads the review again when it changed", () => {
    const point = component(specialist, "SupportPoint");
    assert.match(
      point,
      /said !== null && \(!said\.ok \|\| point\.challenge === ""\)/,
    );
    assert.match(
      point,
      /if \(answer\.status === 409\) \{[\s\S]{0,300}setSaid\(\{ ok: false, text: CHALLENGE_REREAD \}\);[\s\S]{0,120}router\.refresh\(\)/,
    );
    assert.doesNotMatch(words.CHALLENGE_REREAD, /read it again/i);
  });

  it("offers Back only to a step that can be shown", () => {
    // S2: Back went to a step that no longer shows, so the end card stayed.
    assert.match(review, /const backTo = plan\.reduce\(/);
    assert.doesNotMatch(review, /go\(Math\.max\(0, plan\.length - 1\)\)/);
  });
});

describe("A later answer in the understanding's sections", () => {
  it("is told in place of the walkthrough's sentence, dated, never as a link to change it", () => {
    // Design review, 19 November 2026 (S5).
    assert.match(
      review,
      /if \(part\.answeredAt !== undefined\) \{[\s\S]{0,700}\{laterLine\(part\.text, part\.answeredAt\)\}/,
    );
    // Read before the part's question: never shown as the walkthrough answer to change.
    const later = review.indexOf("part.answeredAt !== undefined");
    assert.ok(later > 0);
    assert.ok(review.indexOf("if (need === undefined) {", later) > later);
  });
});

describe("The lede while only questions being prepared are left", () => {
  it("never asks to confirm what is not there yet", () => {
    // Re-shoot r8, 19 November 2026: "Confirm it, so the D&I evidence can be requested"
    // while nothing could be confirmed.
    assert.match(
      review,
      /\) : checkingNow > 0 && openKeys\.length === 0 \? \([\s\S]{0,300}?`\$\{draftedFrom\(groups, interview\)\}\.`\s*\) : \(\s*`\$\{draftedFrom\(groups, interview\)\}\. Confirm it,/,
    );
  });
});
