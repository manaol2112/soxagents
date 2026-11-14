// Every agent run that ends without a usable answer says so on its step (product owner,
// 13 November 2026: "I don't want anything like this type of bug", after "Run again" on
// the Attributes step ended with the planner's answers rejected, the plan kept, and
// nothing on the screen). One plain sentence per step: what happened, what was kept, and
// the next action; never an internal code.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { runFailureLine as readingLine } from "../apps/web/src/analysis-model.ts";
import { runFailureLine as answerLine } from "../apps/web/src/console-model.ts";
import {
  type Attribute,
  type AttributeReviewSummary,
  agentNotesSentence,
  runFailureLine as attributesLine,
  CRITERIA_NOT_WRITTEN,
  criteriaToWrite,
  narrativeFailureLine,
  needingCriteria,
  parseContext,
  pendingCriteriaLine,
  SETTLED_RUN_LEAD,
  settledRunLine,
} from "../apps/web/src/control-context-model.ts";
import {
  PLAN_FALLBACK_LINE,
  PLAN_KEPT_LINE,
  runFailureLine as requestsLine,
} from "../apps/web/src/design-requests-model.ts";
import { runFailureLine as draftLine } from "../apps/web/src/draft-model.ts";
import { runFailureLine as checkLine } from "../apps/web/src/evidence-assurance-model.ts";
import {
  parsePlan,
  runFailureLine as planLine,
} from "../apps/web/src/evidence-plan-model.ts";
import { runFailureLine as fileReadLine } from "../apps/web/src/evidence-wizard-model.ts";
import { runFailureLine as setupLine } from "../apps/web/src/onboarding-model.ts";
import { runFailureLine as masterPlanLine } from "../apps/web/src/planning-model.ts";
import {
  parsePolicyEvidence,
  runFailureLine as policyLine,
} from "../apps/web/src/policy-evidence-model.ts";
import { runFailureLine as referenceLine } from "../apps/web/src/references-model.ts";
import { runFailureLine as reperformLine } from "../apps/web/src/review-model.ts";
import {
  FAILURE_NOTE_FIELD,
  failureNoteOf,
  plainNote,
  withNext,
} from "../apps/web/src/run-failure.ts";
import { runFailureLine as testerLine } from "../apps/web/src/sheet-model.ts";
import { runFailureLine as notesLine } from "../apps/web/src/understanding-chat-model.ts";
import { runFailureLine as workpaperLine } from "../apps/web/src/workpaper-model.ts";

const SRC = join(import.meta.dirname, "..", "apps", "web", "src");

// The server's words for these runs (evidence_plans.py, workpaper_service.py,
// control_reviews.py, prior_year.py), as the page receives them.
const KEPT_NOTE =
  "The planner's answer could not be used, so the plan was kept as it was.";
const UNUSABLE_NOTE = "The planner's answer could not be used. Run again.";
const STOPPED_NOTE = "The run stopped before it finished. Run again.";

/** A step's sentence is one a person can read: never empty, never a code. */
function readable(line: string | null): string {
  assert.ok(line !== null, "the step shows a sentence");
  assert.ok(line.trim().length > 20, line);
  assert.doesNotMatch(
    line,
    /\b[A-Z0-9]+_[A-Z0-9_]+\b|\b[a-z0-9]+_[a-z0-9_]+\b/,
  );
  assert.match(line, /[.!?]$/);
  return line;
}

describe("the shared helpers", () => {
  it("shows a server's sentence, never a code, a key or a trace", () => {
    assert.equal(
      plainNote("The model did not answer"),
      "The model did not answer.",
    );
    assert.equal(plainNote("PLANNER_REJECTED"), "");
    assert.equal(plainNote("schema_mismatch"), "");
    assert.equal(plainNote('{"error": "x"}'), "");
    assert.equal(plainNote("Traceback (most recent call last): x"), "");
    assert.equal(plainNote("ValueError: bad attribute"), "");
    // A plain sentence beside a technical one keeps only the plain one.
    assert.equal(
      plainNote(`${KEPT_NOTE} attribute_id is not one of the control's.`),
      KEPT_NOTE,
    );
    assert.equal(plainNote(""), "");
    assert.equal(plainNote(undefined), "");
  });

  it("reads the server's failure sentence from one field", () => {
    assert.equal(FAILURE_NOTE_FIELD, "failure_note");
    assert.equal(
      failureNoteOf({ failure_note: "The reader ran out of time." }),
      "The reader ran out of time.",
    );
    assert.equal(failureNoteOf({ failure_note: "TIMEOUT" }), "");
    assert.equal(failureNoteOf(null), "");
    assert.equal(failureNoteOf({ note: "x" }), "");
  });

  it("puts the step's next action in place of the sentence's own", () => {
    assert.equal(
      withNext(STOPPED_NOTE, "Run again, or write the criteria yourself."),
      "The run stopped before it finished. Run again, or write the criteria yourself.",
    );
    assert.equal(
      withNext("It stopped", "Test again."),
      "It stopped. Test again.",
    );
  });
});

// The Attributes step

function attribute(id: string, overrides: Partial<Attribute> = {}): Attribute {
  return {
    id,
    position: 0,
    text: `Attribute ${id}`,
    status: "APPROVED",
    basis: "DOCUMENTED",
    sourceKind: "LIBRARY",
    sourceDocumentId: null,
    sourceTitle: "",
    sourceQuote: "",
    note: "",
    proposal: null,
    replacesId: null,
    decidedBy: null,
    version: 1,
    definition: null,
    criteria: {
      objective: "",
      condition: "",
      passCriteria: "",
      failCriteria: "",
      judgmentRequired: null,
      automatable: null,
      phases: [],
      origin: null,
      acceptedBy: "",
      acceptedAt: "",
      owned: false,
    },
    review: null,
    ...overrides,
  };
}

const owned = (id: string) =>
  attribute(id, {
    criteria: {
      ...attribute(id).criteria,
      condition: "Each change",
      passCriteria: "Approved before",
      failCriteria: "Not approved",
      origin: "PERSON",
      owned: true,
    },
  });

const REVIEWED: AttributeReviewSummary = {
  status: "REVIEWED",
  reviewedAt: "2026-11-13T10:00:00Z",
  reviewer: "Reviewer agent",
  note: "",
  findings: [],
  concerns: 0,
};

function attributesRun(
  overrides: Partial<Parameters<typeof attributesLine>[0]>,
) {
  return {
    attributesRun: "" as const,
    attributesRunNote: "",
    attributesRerunUseful: false,
    approved: [owned("a"), attribute("b")],
    proposed: [],
    reviewSummary: REVIEWED,
    ...overrides,
  };
}

describe("the Attributes step after Run again", () => {
  it("says the planner's answer was not used when the criteria were not written", () => {
    // The product owner's case: the planner's answers rejected, the plan kept, attribute
    // B still "Needs criteria".
    for (const note of [
      UNUSABLE_NOTE,
      `${KEPT_NOTE} Two answers broke a rule.`,
    ]) {
      assert.equal(
        attributesLine(
          attributesRun({ attributesRun: "STOPPED", attributesRunNote: note }),
        ),
        CRITERIA_NOT_WRITTEN,
      );
    }
    assert.equal(
      CRITERIA_NOT_WRITTEN,
      "The planner's answer could not be used, so the criteria were not written. The earlier plan is kept. Run again, or write the criteria yourself.",
    );
    // Write criteria opens the first attribute that still needs them.
    assert.deepEqual(
      needingCriteria(attributesRun({})).map(({ item, letter }) => [
        item.id,
        letter,
      ]),
      [["b", "B"]],
    );
  });

  it("never ends a run with Needs criteria and nothing else", () => {
    // The server reports the run as finished and nothing it read changed: still said.
    const line = readable(attributesLine(attributesRun({})));
    assert.match(line, /did not write the criteria for attribute B/);
    assert.match(line, /Run again, or write the criteria yourself\.$/);
    // A stopped run of another kind, with criteria missing, offers both ways.
    assert.equal(
      attributesLine(
        attributesRun({
          attributesRun: "STOPPED",
          attributesRunNote: STOPPED_NOTE,
        }),
      ),
      "The run stopped before it finished. Run again, or write the criteria yourself.",
    );
  });

  it("leads with the server's failure sentence, from the context's field", () => {
    const context = parseContext({
      control_id: "01a13300-0000-7000-8000-000000000002",
      attributes_run: "",
      attributes_failure_note: "The attribute agent ran out of time.",
      attributes_rerun_useful: true,
    });
    assert.ok(context !== null);
    assert.equal(
      context.attributesFailureNote,
      "The attribute agent ran out of time.",
    );
    // Every attribute has its criteria: the quiet line says it, never the error line.
    assert.equal(attributesLine({ ...context, approved: [owned("a")] }), null);
    assert.equal(
      settledRunLine({ ...context, approved: [owned("a")] }),
      `${SETTLED_RUN_LEAD} The attribute agent ran out of time.`,
    );
    // An attribute that needs criteria: the server's sentence leads the error line.
    assert.equal(
      attributesLine({ ...context, approved: [attribute("b")] }),
      "The attribute agent ran out of time. Run again, or write the criteria yourself.",
    );
    // The planner's own failure sentence, with criteria missing, says the criteria.
    assert.equal(
      attributesLine(attributesRun({}), `${UNUSABLE_NOTE}`),
      CRITERIA_NOT_WRITTEN,
    );
  });

  it("says nothing while the agents work, and settled work gets no error and no Run again", () => {
    assert.equal(
      attributesLine(attributesRun({ attributesRun: "WORKING" })),
      null,
    );
    assert.equal(
      attributesLine(attributesRun({ attributesRun: "PENDING" })),
      null,
    );
    assert.equal(
      settledRunLine({
        attributesRun: "WORKING",
        attributesFailureNote: "The planner ran out of time.",
        approved: [owned("a")],
      }),
      null,
    );
    // Every criterion owned and nothing changed: a stopped run's note is not this person's
    // problem (12 November 2026: "Why do I also keep getting this error?").
    const settled = attributesRun({
      attributesRun: "STOPPED",
      attributesRunNote: UNUSABLE_NOTE,
      approved: [owned("a")],
    });
    assert.equal(attributesLine(settled), null);
    assert.equal(settledRunLine(settled), null);
    // Rewritten for the server's failure sentence (lead's decision, 13 November 2026).
    // Old: settled work with a failure sentence showed nothing at all. New: the error
    // line stays null (no warning tone, no Run again), and the quiet settledRunLine says
    // the run could not be used and nothing changed, then the server's sentence. Why: a
    // run a person asked for must never end in silence; the 12 November rule was about
    // the alarming error and the Run again prompt, which settled work still never shows.
    const failed = {
      ...settled,
      attributesFailureNote:
        "The planner's answer could not be used. It named no attribute.",
    };
    assert.equal(attributesLine(failed), null);
    assert.equal(
      settledRunLine(failed),
      "The agents' last run could not be used. Your attributes and criteria are unchanged. The planner's answer could not be used. It named no attribute.",
    );
    // No agent has run: Needs criteria is the person's to write, said by the row.
    assert.equal(
      attributesLine(
        attributesRun({ reviewSummary: null, approved: [attribute("b")] }),
      ),
      null,
    );
  });

  it("never shows an internal code as the reason", () => {
    const line = attributesLine(
      attributesRun({
        attributesRun: "STOPPED",
        attributesRunNote: "PLAN_REJECTED",
        approved: [owned("a")],
        attributesRerunUseful: true,
      }),
    );
    assert.equal(line, STOPPED_NOTE);
  });
});

describe("criteria the planner wrote into a change to the approved test plan", () => {
  // The real cause of the product owner's case: the criteria were written, but wait in
  // the person-approved plan's pending revision.
  const five = [
    owned("a"),
    attribute("b"),
    attribute("c"),
    attribute("d"),
    attribute("e"),
  ];
  const pendingOf = (...ids: string[]) =>
    ids.map((id) => ({ attributeId: id, code: `ATTR_${id.toUpperCase()}` }));

  it("says where the criteria wait and that the change applies them", () => {
    assert.equal(
      pendingCriteriaLine({
        approved: [
          attribute("a"),
          owned("b"),
          owned("c"),
          attribute("d"),
          attribute("e"),
        ],
        attributesPendingCriteria: pendingOf("a", "d", "e"),
        planRevisionPending: true,
      }),
      "The planner proposed criteria for A, D and E in a change to the test plan. Review the change to apply them.",
    );
    assert.equal(
      pendingCriteriaLine({
        approved: five,
        attributesPendingCriteria: pendingOf("b"),
        planRevisionPending: true,
      }),
      "The planner proposed criteria for B in a change to the test plan. Review the change to apply them.",
    );
  });

  it("never says the planner's answer could not be used for those attributes", () => {
    const context = attributesRun({
      attributesRun: "STOPPED",
      attributesRunNote: UNUSABLE_NOTE,
      attributesRerunUseful: true,
      approved: five,
      attributesPendingCriteria: pendingOf("b", "c", "d", "e"),
      planRevisionPending: true,
    });
    assert.equal(attributesLine(context), null);
    assert.deepEqual(criteriaToWrite(context), []);
    // An attribute outside the change still gets its own sentence and Write criteria.
    const mixed = {
      ...context,
      attributesPendingCriteria: pendingOf("b", "c"),
    };
    assert.equal(attributesLine(mixed), CRITERIA_NOT_WRITTEN);
    assert.deepEqual(
      criteriaToWrite(mixed).map(({ letter }) => letter),
      ["D", "E"],
    );
    // A finished run that left only waiting criteria says nothing of its own either.
    assert.equal(
      attributesLine({
        ...context,
        attributesRun: "",
        attributesRunNote: "",
        attributesRerunUseful: false,
      }),
      null,
    );
  });

  it("says nothing once no change waits", () => {
    assert.equal(
      pendingCriteriaLine({
        approved: five,
        attributesPendingCriteria: pendingOf("b"),
        planRevisionPending: false,
      }),
      null,
    );
    assert.equal(pendingCriteriaLine({ approved: five }), null);
    // Criteria already owned are not waiting.
    assert.equal(
      pendingCriteriaLine({
        approved: five,
        attributesPendingCriteria: pendingOf("a"),
        planRevisionPending: true,
      }),
      null,
    );
  });

  it("reads the server's fields", () => {
    const A = "01a13300-0000-7000-8000-00000000000a";
    const context = parseContext({
      control_id: "01a13300-0000-7000-8000-000000000002",
      attributes_run: "",
      attributes_rerun_useful: false,
      attributes_failure_note: "",
      plan_revision_pending: true,
      attributes_pending_criteria: [
        { attribute_id: A, code: "A1" },
        { attribute_id: "not-an-id", code: "A2" },
      ],
      attributes_agent_notes: [
        {
          agent: "planner",
          step: "CRITERIA",
          // Sentences, not flags (lead's decision 6).
          failed: "The planner ran out of time.",
          kept: "The earlier plan is kept.",
          next_step: "Run again.",
          sentence: "The planner ran out of time.",
          model_call_id: "01a13300-0000-7000-8000-0000000000ff",
          at: "2026-11-13T10:00:00Z",
        },
        {
          agent: "reviewer",
          step: "REVIEW",
          failed: "",
          kept: "",
          next_step: "",
          sentence: "The reviewer read the set.",
          at: "2026-11-13T10:01:00Z",
        },
      ],
    });
    assert.ok(context !== null);
    assert.equal(context.planRevisionPending, true);
    assert.deepEqual(context.attributesPendingCriteria, [
      { attributeId: A, code: "A1" },
    ]);
    assert.equal(
      context.attributesAgentNotes?.[0]?.failed,
      "The planner ran out of time.",
    );
    assert.equal(context.attributesAgentNotes?.[1]?.failed, "");
    // The failed agent's sentence, with what it kept, stands in where the run sent no
    // failure sentence of its own; an agent that did not fail adds nothing.
    assert.equal(
      agentNotesSentence(context.attributesAgentNotes),
      "The planner ran out of time. The earlier plan is kept.",
    );
    assert.equal(
      attributesLine({
        ...context,
        attributesRerunUseful: true,
        approved: [attribute("b")],
      }),
      "The planner ran out of time. The earlier plan is kept. Run again, or write the criteria yourself.",
    );
    assert.equal(
      settledRunLine({ ...context, approved: [owned("a")] }),
      `${SETTLED_RUN_LEAD} The planner ran out of time. The earlier plan is kept.`,
    );
    // The confirmed field, also when nothing the agents read changed.
    const failed = parseContext({
      control_id: "01a13300-0000-7000-8000-000000000002",
      attributes_rerun_useful: false,
      attributes_failure_note:
        "The planner's answer could not be used. Run again.",
    });
    assert.ok(failed !== null);
    assert.equal(
      attributesLine({
        ...failed,
        approved: [attribute("b")],
        reviewSummary: REVIEWED,
      }),
      CRITERIA_NOT_WRITTEN,
    );
  });
});

describe("the Control Understanding narrative", () => {
  const run = { status: "FAILED" as const, mode: "DRAFT" as const, note: "" };
  it("says a failed draft kept the earlier narrative, and what to do", () => {
    assert.match(
      readable(narrativeFailureLine(run)),
      /earlier narrative is kept\. Draft it again/,
    );
    assert.match(
      readable(narrativeFailureLine({ ...run, mode: "PLAN" })),
      /plan is kept as it was\. Update the plan again\.$/,
    );
    assert.equal(
      narrativeFailureLine({
        ...run,
        note: "The drafter ran out of time. Try again.",
      }),
      "The drafter ran out of time. Try again.",
    );
    assert.equal(
      narrativeFailureLine({
        ...run,
        failureNote: "The model was busy. Draft it again.",
      }),
      "The model was busy. Draft it again.",
    );
  });
  it("says nothing of a run that finished or works", () => {
    assert.equal(narrativeFailureLine({ ...run, status: "IDLE" }), null);
    assert.equal(narrativeFailureLine({ ...run, status: "WORKING" }), null);
    assert.equal(narrativeFailureLine(null), null);
  });
});

describe("the walkthrough notes and the policy", () => {
  it("never says nothing changed as if the planner read them", () => {
    const line = readable(notesLine({ answers: [], source: "RULES" }));
    assert.match(line, /^The planner did not read the notes/);
    assert.match(line, /Read them again, or answer the questions yourself\.$/);
    assert.match(
      readable(notesLine({ answers: [], source: "RULES" }, "policy")),
      /did not read the policy.*Read it again/,
    );
  });
  it("shows the server's sentence, and nothing when the planner read them", () => {
    assert.equal(
      notesLine({
        answers: [],
        source: "RULES",
        failureNote: "The planner was busy.",
      }),
      "The planner was busy.",
    );
    assert.equal(notesLine({ answers: [], source: "MODEL" }), null);
  });
});

describe("the D&I requests and the test plan", () => {
  it("says a kept plan over the list, with the way on", () => {
    assert.equal(
      requestsLine(
        { keptNote: `${KEPT_NOTE} An answer named no attribute.` },
        false,
      ),
      PLAN_KEPT_LINE,
    );
    assert.equal(
      requestsLine({ source: "FALLBACK", status: "PROPOSED" }, false),
      PLAN_FALLBACK_LINE,
    );
    readable(PLAN_KEPT_LINE);
    readable(PLAN_FALLBACK_LINE);
  });
  it("reads the plan's kept note and failure sentence", () => {
    const plan = parsePlan({
      control_id: "01a13300-0000-7000-8000-000000000002",
      status: "PROPOSED",
      source: "MODEL",
      kept_note: KEPT_NOTE,
    });
    assert.ok(plan !== null);
    assert.equal(planLine(plan), PLAN_KEPT_LINE);
    const failed = parsePlan({
      control_id: "01a13300-0000-7000-8000-000000000002",
      failure_note: "The planner ran out of time. Plan the evidence again.",
    });
    assert.equal(
      planLine(failed),
      "The planner ran out of time. Plan the evidence again.",
    );
  });
  it("says nothing while the planner works, or of an approved plan the planner made", () => {
    assert.equal(requestsLine({ keptNote: KEPT_NOTE }, true), null);
    assert.equal(
      requestsLine({ source: "MODEL", status: "PROPOSED" }, false),
      null,
    );
    assert.equal(
      requestsLine({ source: "FALLBACK", status: "APPROVED" }, false),
      null,
    );
    assert.equal(requestsLine(null, false), null);
  });
});

describe("the D&I evidence check and the wizard's reading", () => {
  it("says a failed check, with the server's reason", () => {
    assert.equal(
      checkLine({
        status: "FAILED",
        note: "The engagement's model budget ran out.",
      }),
      "The check did not finish, so nothing of it is shown. The engagement's model budget ran out.",
    );
    assert.equal(
      checkLine({
        status: "FAILED",
        note: "x",
        failureNote: "The reader stopped.",
      }),
      "The check did not finish, so nothing of it is shown. The reader stopped.",
    );
    assert.equal(checkLine({ status: "REVIEWED", note: "" }), null);
  });
  it("says a failed reading, and how to go on where the reader gave no reason", () => {
    assert.equal(
      fileReadLine({
        status: "FAILED",
        note: "the file is password protected",
      }),
      "Could not be read. The file is password protected.",
    );
    assert.match(
      readable(fileReadLine({ status: "FAILED", note: "" })),
      /Read it again, or add a clearer copy\.$/,
    );
    assert.equal(fileReadLine({ status: "READY", note: "" }), null);
  });
});

describe("request drafting", () => {
  it("says a failed draft kept the wording, and a draft the rules made", () => {
    assert.match(
      readable(draftLine({ status: "FAILED", source: null, note: "" })),
      /wording is kept as it was\. Draft it again/,
    );
    assert.equal(
      draftLine({
        status: "FAILED",
        source: null,
        note: "The model did not answer in time.",
      }),
      "The model did not answer in time. The request's wording is kept as it was. Draft it again, or edit the request yourself.",
    );
    assert.match(
      readable(draftLine({ status: "DRAFTED", source: "FALLBACK", note: "" })),
      /drafted from the RCM/,
    );
    assert.equal(
      draftLine({ status: "DRAFTED", source: "MODEL", note: "" }),
      null,
    );
  });
});

describe("testing", () => {
  const sheet = {
    running: false,
    status: "OPEN" as const,
    runNote: "The tester stopped before it finished.",
    counts: {
      items: 5,
      tested: 2,
      noEvidence: 0,
      exceptions: 0,
      unable: 0,
      review: 0,
      unplaced: 0,
    },
  };
  it("says a stopped run, what is kept and Test again", () => {
    assert.equal(
      testerLine(sheet),
      "The tester stopped before it finished. 3 items are untested; the results so far are kept. Test again.",
    );
    assert.equal(
      testerLine({
        ...sheet,
        runNote: "",
        failureNote: "The model was busy. Run again.",
      }),
      "The model was busy. 3 items are untested; the results so far are kept. Test again.",
    );
  });
  it("says nothing while it runs, once signed off, or when nothing stopped", () => {
    assert.equal(testerLine({ ...sheet, running: true }), null);
    assert.equal(testerLine({ ...sheet, status: "SIGNED_OFF" }), null);
    assert.equal(testerLine({ ...sheet, runNote: "" }), null);
  });
});

describe("workpaper drafting and the review's re-performance", () => {
  it("says a draft that gave up kept the version on record", () => {
    const paper = {
      drafting: false,
      draftNote: "The agent could not finish the draft. Draft again.",
      currentVersion: 2,
    };
    assert.equal(
      workpaperLine(paper),
      "The agent could not finish the draft. Version 2 is kept as it was. Draft again.",
    );
    assert.equal(
      workpaperLine({ ...paper, currentVersion: 0 }),
      "The agent could not finish the draft. Draft again.",
    );
    assert.equal(workpaperLine({ ...paper, drafting: true }), null);
    // A finished draft's note is not a failure.
    assert.equal(
      workpaperLine({
        ...paper,
        draftNote:
          "No model is configured, so the narratives are the records' plain words.",
      }),
      null,
    );
  });
  it("says a re-performance that did not finish", () => {
    const review = {
      reperforming: false,
      reperformState: "IDLE" as const,
      reperformNote:
        "The re-performance did not finish. Re-perform to try again.",
    };
    assert.equal(reperformLine(review), review.reperformNote);
    assert.equal(reperformLine({ ...review, reperformState: "RUNNING" }), null);
    assert.equal(
      reperformLine({ ...review, reperformNote: "Re-performed 5 items." }),
      null,
    );
    assert.equal(
      reperformLine({
        ...review,
        reperformNote: "",
        failureNote: "The reviewer ran out of time.",
      }),
      "The reviewer ran out of time.",
    );
  });
});

describe("the console, file readings, setup, references and the master plan", () => {
  it("never shows an empty failed answer", () => {
    assert.match(
      readable(answerLine({ status: "FAILED", content: "", note: "" })),
      /nothing was changed\. Retry/,
    );
    assert.equal(
      answerLine({
        status: "FAILED",
        content: "I could not finish that. Retry, or ask in other words.",
        note: "",
      }),
      "I could not finish that. Retry, or ask in other words.",
    );
    assert.equal(
      answerLine({ status: "DONE", content: "Done", note: "" }),
      null,
    );
  });
  it("says a file's reading that did not finish", () => {
    assert.match(
      readable(
        readingLine({ status: "FAILED", classification: null, note: "" }),
      ),
      /nothing from it is classified\. Read it again\.$/,
    );
    assert.equal(
      readingLine({
        status: "FAILED",
        classification: null,
        note: "The file is empty.",
      }),
      "The file is empty.",
    );
    assert.equal(
      readingLine({ status: "WORKING", classification: null, note: "" }),
      null,
    );
  });
  it("says the setup's failed scans and readings", () => {
    for (const kind of ["systems", "terms", "soc"] as const) {
      readable(setupLine({ status: "FAILED" }, kind));
      assert.equal(setupLine({ status: "READY" }, kind), null);
    }
    assert.match(
      readable(setupLine({ status: "FAILED" }, "terms")),
      /keep the suggestions shown/,
    );
  });
  it("says a prior-year reference and a master plan whose run failed", () => {
    assert.equal(
      referenceLine({
        runStatus: "FAILED",
        runNote: "The agent could not finish this reference. Run it again.",
      }),
      "The agent could not finish this reference. Run it again.",
    );
    readable(referenceLine({ runStatus: "FAILED", runNote: "" }));
    assert.equal(referenceLine({ runStatus: "IDLE", runNote: "" }), null);
    assert.match(
      readable(masterPlanLine({ runStatus: "FAILED" })),
      /plan is kept as it was/,
    );
    assert.equal(masterPlanLine({ runStatus: "IDLE" }), null);
  });
});

describe("the review's fixes (13 November 2026)", () => {
  it("drops a validator's bracket, never the sentence around it", () => {
    assert.equal(
      plainNote(
        "The planner's answer could not be used (answers[0].criteria: Input should be a valid string). Run again.",
      ),
      "The planner's answer could not be used. Run again.",
    );
    assert.equal(
      plainNote(
        "The reviewer's answer could not be used (it does not match the schema).",
      ),
      "The reviewer's answer could not be used.",
    );
    // A plain bracket stays.
    assert.equal(
      plainNote("The plan was kept (version 3)."),
      "The plan was kept (version 3).",
    );
  });

  it("keeps whole sentences: never cut, and room for every agent's sentence", () => {
    const long = `The planner ${"read the records and ".repeat(20)}stopped.`;
    assert.ok(long.length > 300);
    // A sentence over the cap is left out whole, never cut mid-sentence.
    assert.equal(plainNote(`${long} The plan is kept.`), "The plan is kept.");
    assert.doesNotMatch(plainNote(`${long} The plan is kept.`), /…/);
    // A joined note of several agents, over 300 characters, is shown whole.
    const joined = [
      "The attribute agent's answer could not be used, so the attributes are as they were.",
      "The planner's answer could not be used, so the plan was kept as it was.",
      "The reviewer did not finish, so the attributes and criteria are as drafted and not reviewed.",
      "The criteria reviewer did not finish, so the criteria are as the planner wrote them.",
    ].join(" ");
    assert.ok(joined.length > 300);
    assert.equal(plainNote(joined), joined);
  });

  it("never repeats the workpaper's sentence", () => {
    const paper = {
      drafting: false,
      draftNote: "The agent could not finish the draft. Draft again.",
      currentVersion: 2,
      failureNote:
        "The agent could not finish the draft. Version 2 is kept as it was. Draft again.",
    };
    assert.equal(workpaperLine(paper), paper.failureNote);
  });

  it("shows the server's sentence whatever the finished status", () => {
    const said =
      "The agent's answer could not be used, so the rules' result stands.";
    assert.equal(
      masterPlanLine({ runStatus: "IDLE", failureNote: said }),
      said,
    );
    assert.equal(
      referenceLine({ runStatus: "IDLE", runNote: "", failureNote: said }),
      said,
    );
    // The RCM's terms and systems the rules mapped after the agent's answer failed
    // (FALLBACK, status READY).
    for (const kind of ["systems", "terms", "soc"] as const) {
      assert.equal(
        setupLine({ status: "READY", failureNote: said }, kind),
        said,
      );
    }
    assert.equal(
      narrativeFailureLine({
        status: "IDLE",
        mode: "DRAFT",
        note: "",
        failureNote: said,
      }),
      said,
    );
    assert.equal(
      draftLine({
        status: "DRAFTED",
        source: "MODEL",
        note: "",
        failureNote: said,
      }),
      said,
    );
    assert.equal(
      answerLine({ status: "DONE", content: "x", note: "", failureNote: said }),
      said,
    );
    assert.equal(
      readingLine({
        status: "READY",
        classification: {
          kind: "population",
          confidence: "high",
          summary: "",
          reason: "",
          items: [],
          gaps: [],
          period: "",
        },
        note: "",
        failureNote: said,
      }),
      said,
    );
    // Never while the run is still working.
    assert.equal(
      narrativeFailureLine({
        status: "WORKING",
        mode: "DRAFT",
        note: "",
        failureNote: said,
      }),
      null,
    );
    assert.equal(
      draftLine({
        status: "DRAFTING",
        source: null,
        note: "",
        failureNote: said,
      }),
      null,
    );
  });

  it("reads the policy check's failure sentence and says it on the item", () => {
    const evidence = parsePolicyEvidence({
      checking: false,
      proposals: [],
      documents: [],
      failure_note:
        "The agent could not check the policies on file. Check again later.",
    });
    assert.ok(evidence !== null);
    const item = { id: "i1", categories: ["PROCESS_DOCUMENTATION"] };
    assert.equal(
      policyLine(evidence, item),
      "The agent could not check the policies on file. Check again later.",
    );
    // Not on an item that asks for no document of the process, nor while checking.
    assert.equal(
      policyLine(evidence, { id: "i2", categories: ["CONFIGURATION"] }),
      null,
    );
    assert.equal(policyLine({ ...evidence, checking: true }, item), null);
    const quiet = parsePolicyEvidence({
      checking: false,
      proposals: [],
      documents: [],
    });
    assert.ok(quiet !== null);
    assert.equal(policyLine(quiet, item), null);
    assert.equal("failureNote" in quiet, false);
  });
});

// Source-level: a step model that parses an agent run's status also says its failure.

/** A model that reads an agent run's state: a run's status or note field from the API, or
 * a status list that holds both a working state and FAILED. */
const RUN_FIELD =
  /\b(?:run_status|run_note|kept_note|attributes_run|reperform_state|reperform_note|draft_state|draft_note)\b/;
const RUN_STATUSES =
  /"(?:WORKING|DRAFTING|CHECKING|SCANNING|READING)"[^;]{0,200}?"FAILED"|"FAILED"[^;]{0,200}?"(?:WORKING|DRAFTING|CHECKING|SCANNING|READING)"/s;
const READS_FAILURE = /from "\.\/run-failure\.ts"/;

// The step models of this audit (13 November 2026). The list only grows: a model taken off
// it must stop parsing a run's status.
const STEP_MODELS = [
  "analysis-model.ts",
  "policy-evidence-model.ts",
  "console-model.ts",
  "control-context-model.ts",
  "design-requests-model.ts",
  "draft-model.ts",
  "evidence-assurance-model.ts",
  "evidence-plan-model.ts",
  "evidence-wizard-model.ts",
  "onboarding-model.ts",
  "planning-model.ts",
  "references-model.ts",
  "review-model.ts",
  "sheet-model.ts",
  "understanding-chat-model.ts",
  "workpaper-model.ts",
];

// Where a model's failure line is not on a screen yet, and why.
const NOT_RENDERED: Record<string, string> = {
  // The coordinator's PBC drafts are loaded (load-workflow) but no screen shows them.
  "draft-model.ts": "no screen renders the PBC drafts",
};

const models = readdirSync(SRC).filter((name) => name.endsWith("-model.ts"));
const source = (name: string) => readFileSync(join(SRC, name), "utf8");
const parsesRun = (text: string) =>
  RUN_FIELD.test(text) || RUN_STATUSES.test(text) || READS_FAILURE.test(text);

describe("every step that waits on an agent run says when it ended without an answer", () => {
  it("finds the step models of the audit", () => {
    for (const name of STEP_MODELS) {
      assert.ok(models.includes(name), `${name} exists`);
      assert.ok(parsesRun(source(name)), `${name} parses an agent run`);
    }
  });

  it("shows every failure_note a model reads", () => {
    // A model that reads the server's failure sentence (failureNoteOf) passes it to a
    // runFailureLine that leads with it: never read and dropped.
    const readers = models.filter((name) =>
      /\bfailureNoteOf\(/.test(source(name)),
    );
    assert.ok(readers.length >= STEP_MODELS.length - 2, readers.join(", "));
    const dropped = readers.filter((name) => {
      const text = source(name);
      const line = text.slice(text.indexOf("export function runFailureLine("));
      return (
        !/export function runFailureLine\(/.test(text) ||
        !/failureNote/.test(line.slice(0, line.indexOf("\n}\n")))
      );
    });
    assert.deepEqual(
      dropped,
      [],
      "these read a failure_note and do not show it",
    );
  });

  it("gives every model that parses a run's status a failure line", () => {
    const missing = models.filter((name) => {
      const text = source(name);
      return parsesRun(text) && !/export function runFailureLine\(/.test(text);
    });
    assert.deepEqual(
      missing,
      [],
      "add runFailureLine (run-failure.ts) to these models",
    );
  });

  it("shows each failure line on a screen", () => {
    const screens = readdirSync(SRC)
      .filter((name) => name.endsWith(".tsx") || name.endsWith("-model.ts"))
      .map((name) => [name, source(name)] as const);
    for (const name of models.filter((each) => parsesRun(source(each)))) {
      if (name in NOT_RENDERED) {
        continue;
      }
      const module = name.replace(/\.ts$/, "");
      // Imported by a screen or another step's model, or called by the model's own
      // line for the step (the check's standing, the file's reading line).
      const imported = screens.some(
        ([other, text]) =>
          other !== name &&
          new RegExp(
            `runFailureLine[^}]*\\}\\s*from "\\./${module}(?:\\.ts)?"`,
          ).test(text),
      );
      const called =
        (source(name).match(/\brunFailureLine\(/g) ?? []).length > 1;
      assert.ok(
        imported || called,
        `${name}'s runFailureLine is shown by a screen or a step`,
      );
    }
  });
});
